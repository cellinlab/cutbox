/** Evidence-based production preparation. This never calls a generation service. */
const unique = (values) => [...new Set(values)];
const maps = (data) =>
  Object.fromEntries(
    ["media", "entities", "annotations"].map((key) => [
      key,
      new Map(data[key].map((item) => [item.id, item])),
    ]),
  );

export function auditProduction(snapshot, productionId) {
  const production = snapshot.productions?.find(
    (item) => item.id === productionId,
  );
  if (!production) throw new Error("找不到创作项目");
  const index = maps(snapshot),
    issues = [];
  const add = (severity, code, message, extra = {}) =>
    issues.push({ severity, code, message, ...extra });
  const shots = production.shots || [];
  const annotationIds = unique([
    ...(production.annotationIds || []),
    ...shots.flatMap((s) => s.annotationIds || []),
  ]);
  const entityIds = unique([
    ...(production.entityIds || []),
    ...shots.flatMap((s) => s.entityIds || []),
    ...annotationIds
      .map((id) => index.annotations.get(id)?.entityId)
      .filter(Boolean),
  ]);
  if (!shots.length) add("warning", "no_shots", "尚未拆分镜头。");
  for (const id of annotationIds) {
    const a = index.annotations.get(id);
    if (!a) {
      add("error", "missing_annotation", "引用标注已不存在。", {
        annotationId: id,
      });
      continue;
    }
    const m = index.media.get(a.mediaId);
    if (!m)
      add("error", "missing_media", "标注的源素材已不存在。", {
        annotationId: id,
        mediaId: a.mediaId,
      });
    if (a.reviewState !== "accepted")
      add("warning", "unreviewed", "参考尚未人工确认。", { annotationId: id });
    if (a.confidence === null)
      add("info", "unknown_confidence", "参考置信度未知，请查看证据。", {
        annotationId: id,
      });
    if (a.epistemic !== "observed")
      add("info", "non_observation", "参考含推断或创作，请勿当作原片事实。", {
        annotationId: id,
      });
    if (m?.kind !== "audio" && Math.min(m?.width || 0, m?.height || 0) < 512)
      add(
        "info",
        "small_reference",
        "源画面短边不足 512 像素，请检查生成参考的清晰度。",
        { annotationId: id },
      );
  }
  for (const shot of shots) {
    if (!shot.prompt?.trim())
      add("warning", "empty_prompt", "镜头尚未整理生成提示词。", {
        shotId: shot.id,
      });
    if (!shot.annotationIds?.length && !production.annotationIds?.length)
      add("info", "no_evidence", "镜头没有原片参考，按原创文字需求准备。", {
        shotId: shot.id,
      });
    if (!shot.continuity?.trim())
      add("info", "no_continuity", "尚未填写服装、空间、道具或动作衔接要求。", {
        shotId: shot.id,
      });
    if (shot.outputMediaId && !index.media.has(shot.outputMediaId))
      add("error", "missing_output", "关联生成结果已不存在。", {
        shotId: shot.id,
      });
    if (
      shot.outputMediaId &&
      !(shot.takes || []).some((t) => t.mediaId === shot.outputMediaId)
    )
      add(
        "info",
        "output_without_take",
        "选用结果尚未关联制作候选记录，可补充实际模型和提示词。",
        { shotId: shot.id },
      );
    for (const take of shot.takes || []) {
      if (!index.media.has(take.mediaId))
        add("error", "missing_take_media", "候选结果素材已不存在。", {
          shotId: shot.id,
        });
      if (!take.provider?.trim() || !take.prompt?.trim())
        add(
          "info",
          "incomplete_take_provenance",
          "候选的工具或实际输入尚未记录，无法据此复现。",
          { shotId: shot.id },
        );
    }
    const facts = new Map();
    for (const id of unique([
      ...(production.annotationIds || []),
      ...(shot.annotationIds || []),
    ])) {
      const a = index.annotations.get(id);
      if (!a?.entityId) continue;
      for (const [key, value] of Object.entries(a.values || {})) {
        if (
          !/costume|outfit|wardrobe|clothing|hair|makeup|location|timeOfDay|propState/i.test(
            key,
          )
        )
          continue;
        const factKey = JSON.stringify([a.entityId, key]);
        if (!facts.has(factKey)) facts.set(factKey, new Set());
        facts.get(factKey).add(JSON.stringify(value));
      }
    }
    for (const [key, values] of facts)
      if (values.size > 1) {
        const [entityId, field] = JSON.parse(key);
        add(
          "warning",
          "continuity_variants",
          `${index.entities.get(entityId)?.name || "资产"} 的 ${field} 存在多个参考状态，请在镜头连续性中明确选用。`,
          { shotId: shot.id, entityId },
        );
      }
  }
  const coverage = entityIds.map((entityId) => {
    const entity = index.entities.get(entityId);
    if (!entity)
      add("error", "missing_entity", "引用资产已不存在。", { entityId });
    const refs = annotationIds
      .map((id) => index.annotations.get(id))
      .filter((a) => a?.entityId === entityId);
    if (!refs.length)
      add(
        "warning",
        "asset_without_evidence",
        `${entity?.name || "资产"} 尚无已选定的标注参考。`,
        { entityId },
      );
    return {
      entityId,
      name: entity?.name || entityId,
      type: entity?.type || "unknown",
      referenceCount: refs.length,
      acceptedCount: refs.filter((a) => a.reviewState === "accepted").length,
      categories: unique(refs.map((a) => a.category || "uncategorized")).sort(),
    };
  });
  const blocked = issues.some((i) => i.severity === "error");
  return {
    productionId,
    status: blocked
      ? "blocked"
      : issues.some((i) => i.severity === "warning")
        ? "needs_review"
        : "ready",
    summary: {
      shots: shots.length,
      referenceAnnotations: annotationIds.length,
      entities: entityIds.length,
      readyShots: shots.filter(
        (s) =>
          s.prompt?.trim() &&
          !issues.some((i) => i.shotId === s.id && i.severity !== "info"),
      ).length,
      linkedOutputs: shots.filter((s) => s.outputMediaId).length,
    },
    issues,
    coverage,
  };
}

export function draftShotPrompt(snapshot, { productionId, shotId }) {
  const production = snapshot.productions?.find((p) => p.id === productionId),
    shot = production?.shots.find((s) => s.id === shotId);
  if (!shot) throw new Error("请先保存镜头，再整理提示词");
  const index = maps(snapshot);
  const refs = unique([
    ...(production.annotationIds || []),
    ...(shot.annotationIds || []),
  ])
    .map((id) => index.annotations.get(id))
    .filter(Boolean);
  const entityIds = unique([
    ...(production.entityIds || []),
    ...(shot.entityIds || []),
    ...refs.map((a) => a.entityId).filter(Boolean),
  ]);
  const lines = [
    `镜头：${shot.name}`,
    `时长：${shot.duration} 秒；画幅：${production.aspectRatio}`,
  ];
  if (shot.description) lines.push(`新镜头需求：${shot.description}`);
  for (const id of entityIds) {
    const entity = index.entities.get(id);
    if (entity)
      lines.push(
        `资产 ${entity.name}：${[entity.description, ...Object.entries(entity.attributes || {}).map(([k, v]) => `${k}=${v}`)].filter(Boolean).join("；")}`,
      );
  }
  for (const a of refs)
    lines.push(
      `参考证据 ${a.id}（${a.epistemic || "observed"} / ${a.reviewState}）：${[a.label, a.notes, ...Object.entries(a.values || {}).map(([k, v]) => `${k}=${v}`)].filter(Boolean).join("；")}`,
    );
  if (shot.continuity) lines.push(`连续性要求：${shot.continuity}`);
  return {
    prompt: lines.join("\n"),
    negativePrompt: shot.negativePrompt || "",
  };
}

const field = (key, label, type = "text", extra = {}) => ({
  key,
  label,
  type,
  ...extra,
});
export const productionTemplates = [
  {
    id: "cutbox-shot-v1",
    name: "影视制作 · 镜头与摄影",
    description: "从原片观察摄影、调度和剪辑；推断请使用解释类别。",
    fields: [
      field("shotSize", "景别"),
      field("angle", "机位角度"),
      field("cameraMovement", "摄影机运动"),
      field("lens", "镜头与焦段"),
      field("composition", "构图"),
      field("lighting", "布光"),
      field("screenDirection", "画面运动方向"),
      field("cutPurpose", "剪辑作用"),
    ],
  },
  {
    id: "cutbox-costume-v1",
    name: "影视制作 · 服化与连续性",
    description: "同一角色的每种服装、发型和状态应独立锚定时间区间。",
    fields: [
      field("outfit", "服装组合"),
      field("clothingColor", "服装颜色"),
      field("material", "材质"),
      field("accessories", "配饰"),
      field("hair", "发型"),
      field("makeup", "妆容"),
      field("pose", "姿势与动作"),
      field("continuityState", "连续性状态"),
    ],
  },
  {
    id: "cutbox-scene-v1",
    name: "影视制作 · 场景与美术",
    description: "记录空间、美术、光线、气氛与可复用场景元素。",
    fields: [
      field("location", "空间位置"),
      field("interiorExterior", "内外景", "select", {
        options: ["内景", "外景", "混合"],
      }),
      field("timeOfDay", "时段"),
      field("weather", "天气"),
      field("setDressing", "陈设"),
      field("palette", "色彩"),
      field("architecture", "建筑结构"),
      field("spatialLayout", "空间关系"),
    ],
  },
  {
    id: "cutbox-sound-v1",
    name: "影视制作 · 声音与表演",
    description: "对白、音色、情绪、环境声及画内画外关系。",
    fields: [
      field("speaker", "说话人"),
      field("transcript", "对白"),
      field("emotion", "情绪"),
      field("delivery", "语速与表达"),
      field("soundType", "声音类型"),
      field("perspective", "画内／画外"),
      field("ambience", "环境声"),
      field("language", "语言"),
    ],
  },
  {
    id: "cutbox-source-v1",
    name: "影视制作 · 来源与使用说明",
    description: "记录素材来源和经确认的使用范围；填写本身不构成授权。",
    fields: [
      field("sourceTitle", "来源作品"),
      field("sourceEpisode", "来源集数"),
      field("sourceUrl", "来源地址"),
      field("rightsHolder", "权利方"),
      field("usageBasis", "使用依据"),
      field("allowedUses", "已确认用途"),
      field("restrictions", "限制"),
      field("credit", "署名要求"),
    ],
  },
];
