import { useRef, useState, useEffect } from "react";
import { Download, Plus, Trash2, Pencil } from "lucide-react";
import { GeometryOverlay } from "./GeometryOverlay";
import { Timeline } from "./Timeline";
import { AnnotationDetails } from "./AnnotationDetails";
import { Empty, time } from "./ui";
import type {
  Snapshot,
  Media,
  AnnotationInput,
  Capabilities,
  Annotation,
  ReferenceMode,
} from "./types";
export function Editor({
  data,
  mediaId,
  onSelect,
  mutate,
  capabilities,
  run,
  study = false,
  initialTime = 0,
}: {
  data: Snapshot;
  mediaId?: string;
  onSelect: (id: string) => void;
  mutate: (fn: () => Promise<Snapshot>) => Promise<boolean>;
  capabilities?: Capabilities;
  run: (fn: () => Promise<unknown>) => Promise<void>;
  study?: boolean;
  initialTime?: number;
}) {
  const media = data.media.find((m) => m.id === mediaId) || data.media[0];
  return (
    <>
      <div className="toolbar">
        <select
          aria-label="选择素材"
          value={media?.id || ""}
          onChange={(e) => onSelect(e.target.value)}
        >
          <option value="" disabled>
            选择素材
          </option>
          {data.media.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
        <span className="muted">
          {study
            ? "记录镜头观察与创作解释"
            : "以秒标记范围 · 关联资产与画面区域"}
        </span>
      </div>
      {media ? (
        <MediaEditor
          key={`${media.id}-${study}`}
          media={media}
          data={data}
          mutate={mutate}
          capabilities={capabilities}
          run={run}
          study={study}
          initialTime={initialTime}
        />
      ) : (
        <Empty
          title="先导入一份素材"
          description="在素材库中导入视频、音频或图片，即可开始标注。"
        />
      )}
    </>
  );
}
function MediaEditor({
  media,
  data,
  mutate,
  capabilities,
  run,
  study,
  initialTime,
}: {
  media: Media;
  data: Snapshot;
  mutate: (fn: () => Promise<Snapshot>) => Promise<boolean>;
  capabilities?: Capabilities;
  run: (fn: () => Promise<unknown>) => Promise<void>;
  study: boolean;
  initialTime: number;
}) {
  const player = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  const blank = (): AnnotationInput => ({
    mediaId: media.id,
    start: 0,
    end: media.duration || 0,
    label: "",
    notes: "",
    reviewState: "accepted",
    category: study ? "shot" : "general",
    epistemic: "observed",
    confidence: 1,
    tags: [],
    values: {},
  });
  const [draft, setDraft] = useState<AnnotationInput>(blank);
  const [current, setCurrent] = useState(0);
  const [intrinsic, setIntrinsic] = useState({
    width: media.width || 16,
    height: media.height || 9,
  });
  const [busy, setBusy] = useState(false);
  const [playError, setPlayError] = useState("");
  const [useRegion, setUseRegion] = useState(false);
  const [region, setRegion] = useState({ x: 0, y: 0, width: 1, height: 1 });
  const [mode, setMode] = useState<ReferenceMode>("clip");
  const annotations = data.annotations.filter((a) => a.mediaId === media.id);
  const [tool, setTool] = useState<"view" | "box" | "polygon">("view");
  const [loop, setLoop] = useState(false);
  const [proxy, setProxy] = useState(false);
  const [width, setWidth] = useState(640);
  const [fps, setFps] = useState(24);
  const [series, setSeries] = useState(media.series || "");
  const [episode, setEpisode] = useState(media.episode || "");
  const [edgeLow, setEdgeLow] = useState(0.1);
  const [edgeHigh, setEdgeHigh] = useState(0.4);
  const [frameTimes, setFrameTimes] = useState<number[]>([]);
  function seek(t: number) {
    if (player.current) {
      player.current.currentTime = Math.max(0, Math.min(media.duration, t));
      setCurrent(player.current.currentTime);
    }
  }
  function selectAnnotation(a: Annotation) {
    setDraft(a);
    setUseRegion(Boolean(a.region));
    setRegion(a.region || { x: 0, y: 0, width: 1, height: 1 });
    seek(a.start);
  }
  useEffect(() => {
    seek(initialTime);
  }, [initialTime]);
  function tick(element: HTMLMediaElement) {
    if (loop && draft.end > draft.start && element.currentTime >= draft.end)
      element.currentTime = draft.start;
    setCurrent(element.currentTime);
  }
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLElement &&
        (e.target.matches("input,textarea,select") ||
          e.target.isContentEditable)
      )
        return;
      const p = player.current;
      if (!p) return;
      switch (e.key.toLowerCase()) {
        case " ":
          e.preventDefault();
          if (p.paused) void p.play().catch(() => {});
          else p.pause();
          break;
        case "i":
          setDraft((d) => ({ ...d, start: p.currentTime }));
          break;
        case "o":
          setDraft((d) => ({ ...d, end: p.currentTime }));
          break;
        case "k":
          p.pause();
          break;
        case "l":
          p.playbackRate = Math.min(4, p.playbackRate * 2);
          void p.play().catch(() => {});
          break;
        case "j":
          p.playbackRate = Math.max(0.25, p.playbackRate / 2);
          void p.play().catch(() => {});
          break;
        case "arrowright":
          e.preventDefault();
          p.pause();
          seek(
            frameTimes.find((t) => t > p.currentTime + 0.00001) ??
              Math.min(media.duration, p.currentTime + 0.04),
          );
          break;
        case "arrowleft":
          e.preventDefault();
          p.pause();
          seek(
            [...frameTimes]
              .reverse()
              .find((t) => t < p.currentTime - 0.00001) ??
              Math.max(0, p.currentTime - 0.04),
          );
          break;
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [frameTimes, media.duration]);

  const rangeValid =
    Number.isFinite(draft.start) &&
    Number.isFinite(draft.end) &&
    draft.start >= 0 &&
    draft.end >= draft.start &&
    (media.kind === "image" || draft.end <= media.duration);
  const regionValid =
    !useRegion ||
    (region.x >= 0 &&
      region.y >= 0 &&
      region.width > 0 &&
      region.height > 0 &&
      region.x + region.width <= 1 &&
      region.y + region.height <= 1);
  let displayRegion = useRegion ? region : undefined;
  if (tool === "view" && draft.keyframes?.length) {
    const before =
      [...draft.keyframes].reverse().find((f) => f.time <= current) ||
      draft.keyframes[0];
    const after =
      draft.keyframes.find((f) => f.time >= current) ||
      draft.keyframes[draft.keyframes.length - 1];
    const mix =
      after.time === before.time
        ? 0
        : (current - before.time) / (after.time - before.time);
    displayRegion = {
      x: before.region.x + (after.region.x - before.region.x) * mix,
      y: before.region.y + (after.region.y - before.region.y) * mix,
      width:
        before.region.width + (after.region.width - before.region.width) * mix,
      height:
        before.region.height +
        (after.region.height - before.region.height) * mix,
    };
  }
  const geometryVisible =
    tool !== "view" || (current >= draft.start && current <= draft.end);
  const mark = (field: "start" | "end") =>
    setDraft({ ...draft, [field]: player.current?.currentTime || 0 });
  return (
    <div className="editor-layout">
      <div className="editor-main">
        <details className="media-metadata">
          <summary>系列 / 集数与源信息</summary>
          <div className="toolbar">
            <label>
              系列名称
              <input
                value={series}
                onChange={(e) => setSeries(e.target.value)}
              />
            </label>
            <label>
              集数
              <input
                value={episode}
                onChange={(e) => setEpisode(e.target.value)}
              />
            </label>
            <button
              onClick={() =>
                void mutate(() =>
                  window.cutbox!.updateMedia({ id: media.id, series, episode }),
                )
              }
            >
              保存源信息
            </button>
          </div>
          <p className="fine">SHA-256: {media.sha256}</p>
        </details>
        <div className="drawing-tools">
          <div className="tabs">
            {(
              [
                ["view", "观看"],
                ["box", "框选区域"],
                ["polygon", "多边形"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                className={tool === id ? "active" : ""}
                disabled={media.kind === "audio" && id !== "view"}
                onClick={() => {
                  setTool(id);
                  player.current?.pause();
                }}
              >
                {label}
              </button>
            ))}
          </div>
          {draft.polygon?.length ? (
            <button onClick={() => setDraft({ ...draft, polygon: undefined })}>
              清除多边形
            </button>
          ) : null}
          {media.proxyPath && (
            <label className="check">
              <input
                type="checkbox"
                checked={proxy}
                onChange={(e) => {
                  setProxy(e.target.checked);
                  setPlayError("");
                }}
              />
              播放代理
            </label>
          )}
        </div>
        {draft.keyframes?.length ? (
          <p className="fine">
            轨迹预览在关键帧间使用线性插值，插值不代表人工观测。
          </p>
        ) : null}
        <div className="player-frame">
          {media.kind === "image" ? (
            <img
              src={window.cutbox!.mediaUrl(media.id)}
              alt={media.name}
              onLoad={(e) =>
                setIntrinsic({
                  width: e.currentTarget.naturalWidth,
                  height: e.currentTarget.naturalHeight,
                })
              }
              onError={() => setPlayError("无法显示此图片，请检查文件格式。")}
            />
          ) : media.kind === "video" ? (
            <video
              ref={player}
              controls
              preload="metadata"
              src={window.cutbox!.mediaUrl(
                media.id,
                proxy ? "proxy" : "original",
              )}
              onLoadedMetadata={(e) => {
                seek(initialTime);
                if (e.currentTarget instanceof HTMLVideoElement)
                  setIntrinsic({
                    width: e.currentTarget.videoWidth || media.width || 16,
                    height: e.currentTarget.videoHeight || media.height || 9,
                  });
              }}
              onTimeUpdate={(e) => tick(e.currentTarget)}
              onError={() =>
                setPlayError(
                  "播放器无法解码此素材。标注和导出仍可操作；请使用受支持的播放格式。",
                )
              }
            />
          ) : (
            <audio
              ref={player}
              controls
              src={window.cutbox!.mediaUrl(
                media.id,
                proxy ? "proxy" : "original",
              )}
              onLoadedMetadata={(e) => {
                seek(initialTime);
                if (e.currentTarget instanceof HTMLVideoElement)
                  setIntrinsic({
                    width: e.currentTarget.videoWidth || media.width || 16,
                    height: e.currentTarget.videoHeight || media.height || 9,
                  });
              }}
              onTimeUpdate={(e) => tick(e.currentTarget)}
              onError={() => setPlayError("播放器无法解码此音频。")}
            />
          )}
          {media.kind !== "audio" && (
            <GeometryOverlay
              sourceWidth={intrinsic.width}
              sourceHeight={intrinsic.height}
              tool={tool}
              region={geometryVisible ? displayRegion : undefined}
              polygon={geometryVisible ? draft.polygon : undefined}
              keypoints={geometryVisible ? draft.keypoints : undefined}
              onRegion={(r) => {
                setRegion(r);
                setUseRegion(true);
              }}
              onPolygon={(polygon) => setDraft({ ...draft, polygon })}
            />
          )}
        </div>
        {playError && (
          <p role="alert" className="warning">
            {playError}
          </p>
        )}
        <div className="playback-meta">
          <span>
            {time(current)} / {time(media.duration)}
          </span>
          <span>
            {media.width && `${media.width} × ${media.height}`} · {media.kind}
          </span>
        </div>
        <div className="range-bar">
          <button
            onClick={() => mark("start")}
            disabled={media.kind === "image"}
          >
            设为入点
          </button>
          <span>
            {time(draft.start)} — {time(draft.end)}
          </span>
          <button onClick={() => mark("end")} disabled={media.kind === "image"}>
            设为出点
          </button>
          <button
            onClick={() => {
              if (player.current) {
                player.current.currentTime = draft.start;
                void player.current.play().catch(() => {});
              }
            }}
            disabled={media.kind === "image"}
          >
            播放选段起点
          </button>
        </div>
        <p className="fine">
          当前为浏览器时间定位，尚不提供可变帧率的精确逐帧保证。
        </p>
        <div className="toolbar">
          <label className="check">
            <input
              type="checkbox"
              checked={loop}
              onChange={(e) => setLoop(e.target.checked)}
            />
            循环选定区间
          </label>
          <button
            disabled={media.kind !== "video"}
            onClick={() =>
              void run(async () => {
                const r = await window.cutbox!.analyzeMedia({
                  mediaId: media.id,
                  kind: "frames",
                });
                setFrameTimes((r.frames || []).map((f) => f.time));
              })
            }
          >
            {frameTimes.length
              ? `已索引 ${frameTimes.length} 帧`
              : "读取源帧时间"}
          </button>
          <small>Space 播放 · I/O 入出点 · ←/→ 定位 · J/L 变速 · K 暂停</small>
        </div>
        <Timeline
          annotations={annotations}
          duration={media.duration}
          current={current}
          onSelect={selectAnnotation}
          onSeek={seek}
        />
        <div className="section-heading">
          <h3>
            {study ? "镜头笔记" : "素材标注"} <span>{annotations.length}</span>
          </h3>
          <button
            onClick={() => {
              setDraft(blank());
              setUseRegion(false);
            }}
          >
            <Plus />
            新增
          </button>
        </div>
        {annotations.length === 0 ? (
          <p className="muted">还没有标注。在右侧记录第一个值得留下的瞬间。</p>
        ) : (
          annotations.map((a) => (
            <div className="annotation-row" key={a.id}>
              <button
                className="annotation-content"
                onClick={() => {
                  if (player.current) player.current.currentTime = a.start;
                }}
              >
                <strong>{a.label}</strong>
                <small>
                  {time(a.start)} — {time(a.end)} ·{" "}
                  {a.reviewState === "accepted"
                    ? "已审核"
                    : a.reviewState === "suggested"
                      ? "建议"
                      : "待审核"}
                </small>
                <p>{a.notes}</p>
              </button>
              <button
                className="icon"
                aria-label={`编辑 ${a.label}`}
                onClick={() => {
                  selectAnnotation(a);
                }}
              >
                <Pencil />
              </button>
              <button
                className="icon"
                aria-label={`删除 ${a.label}`}
                onClick={() => {
                  if (confirm(`删除标注「${a.label}」？`))
                    void mutate(() => window.cutbox!.deleteAnnotation(a.id));
                }}
              >
                <Trash2 />
              </button>
            </div>
          ))
        )}
      </div>
      <aside className="inspector">
        <h2>{draft.id ? "编辑标注" : study ? "记录镜头" : "新建标注"}</h2>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              if (
                await mutate(() =>
                  window.cutbox!.saveAnnotation({
                    ...draft,
                    tags: (draft.tags || [])
                      .map((t) => t.trim())
                      .filter(Boolean),
                    region: useRegion ? region : undefined,
                  }),
                )
              ) {
                setDraft(blank());
                setUseRegion(false);
              }
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            {study ? "镜头观察" : "标注名称"}
            <input
              required
              value={draft.label}
              placeholder={
                study ? "例如：固定机位，人物进入前景" : "例如：蓝色外套，转身"
              }
              onChange={(e) => setDraft({ ...draft, label: e.target.value })}
            />
          </label>
          <div className="field-pair">
            <label>
              入点（秒）
              <input
                type="number"
                min="0"
                max={media.duration || undefined}
                step="0.001"
                value={draft.start}
                onChange={(e) =>
                  setDraft({ ...draft, start: Number(e.target.value) })
                }
              />
            </label>
            <label>
              出点（秒）
              <input
                type="number"
                min={draft.start}
                max={media.duration || undefined}
                step="0.001"
                value={draft.end}
                onChange={(e) =>
                  setDraft({ ...draft, end: Number(e.target.value) })
                }
              />
            </label>
          </div>
          <label>
            关联资产
            <select
              value={draft.entityId || ""}
              onChange={(e) =>
                setDraft({ ...draft, entityId: e.target.value || undefined })
              }
            >
              <option value="">不关联</option>
              {data.entities.map((entity) => (
                <option key={entity.id} value={entity.id}>
                  {entity.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            {study ? "分析与解释（与观察分开）" : "详细描述"}
            <textarea
              rows={4}
              value={draft.notes}
              onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
            />
          </label>
          <label>
            审核状态
            <select
              value={draft.reviewState}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  reviewState: e.target.value as AnnotationInput["reviewState"],
                })
              }
            >
              <option value="accepted">已审核</option>
              <option value="needs_review">待审核</option>
              <option value="suggested">建议</option>
            </select>
          </label>
          <AnnotationDetails data={data} draft={draft} setDraft={setDraft} />
          {media.kind !== "audio" && (
            <>
              <label className="check">
                <input
                  type="checkbox"
                  checked={useRegion}
                  onChange={(e) => setUseRegion(e.target.checked)}
                />
                指定画面区域
              </label>
              {useRegion && (
                <>
                  <p className="fine">
                    相对画面坐标，取值 0–1，原点位于左上角。
                  </p>
                  <div className="field-pair">
                    {(["x", "y", "width", "height"] as const).map((key, i) => (
                      <label key={key}>
                        {["X", "Y", "宽度", "高度"][i]}
                        <input
                          type="number"
                          min="0"
                          max="1"
                          step="any"
                          value={region[key]}
                          onChange={(e) =>
                            setRegion({
                              ...region,
                              [key]: Number(e.target.value),
                            })
                          }
                        />
                      </label>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
          {useRegion && (
            <div className="keyframe-editor">
              <button
                type="button"
                disabled={current < draft.start || current > draft.end}
                onClick={() =>
                  setDraft({
                    ...draft,
                    keyframes: [
                      ...(draft.keyframes || []).filter(
                        (f) => Math.abs(f.time - current) > 0.00001,
                      ),
                      { time: current, region: { ...region } },
                    ].sort((a, b) => a.time - b.time),
                  })
                }
              >
                记录当前框为关键帧
              </button>
              {draft.keyframes?.map((f, i) => (
                <div className="actions" key={f.time}>
                  <button
                    type="button"
                    onClick={() => {
                      seek(f.time);
                      setRegion(f.region);
                    }}
                  >
                    {time(f.time)}
                  </button>
                  <button
                    type="button"
                    aria-label={`删除关键帧 ${i + 1}`}
                    onClick={() =>
                      setDraft({
                        ...draft,
                        keyframes: draft.keyframes!.filter((_, j) => j !== i),
                      })
                    }
                  >
                    移除
                  </button>
                </div>
              ))}
            </div>
          )}
          {draft.polygon && draft.polygon.length < 3 && (
            <p className="warning">多边形至少需要三个顶点。</p>
          )}
          {(!rangeValid || !regionValid) && (
            <p className="warning">请检查时间范围或区域边界。</p>
          )}
          <button
            className="primary full"
            disabled={
              busy ||
              !draft.label.trim() ||
              !rangeValid ||
              !regionValid ||
              Boolean(draft.polygon && draft.polygon.length < 3)
            }
          >
            {busy ? "保存中…" : "保存标注"}
          </button>
        </form>
        <div className="reference">
          <h3>导出参考</h3>
          <label>
            输出类型
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as ReferenceMode)}
            >
              <option value="clip">原片参考</option>
              <option value="edges">边缘 / 轮廓视频</option>
              <option value="crop">当前区域裁切</option>
              <option value="frame">入点关键帧</option>
              <option value="audio">音频片段</option>
              <option value="depth">深度参考</option>
              <option value="pose">姿态参考</option>
              <option value="mask">分割蒙版</option>
            </select>
          </label>
          <div className="field-pair">
            <label>
              输出宽度
              <input
                type="number"
                min="64"
                max="4096"
                step="2"
                value={width}
                onChange={(e) => setWidth(Number(e.target.value))}
              />
            </label>
            <label>
              输出帧率
              <input
                type="number"
                min="1"
                max="120"
                value={fps}
                onChange={(e) => setFps(Number(e.target.value))}
              />
            </label>
          </div>
          {mode === "edges" && (
            <div className="field-pair">
              <label>
                边缘低阈值
                <input
                  type="number"
                  min="0"
                  max="1"
                  step=".01"
                  value={edgeLow}
                  onChange={(e) => setEdgeLow(Number(e.target.value))}
                />
              </label>
              <label>
                边缘高阈值
                <input
                  type="number"
                  min="0"
                  max="1"
                  step=".01"
                  value={edgeHigh}
                  onChange={(e) => setEdgeHigh(Number(e.target.value))}
                />
              </label>
            </div>
          )}
          <button
            className="full"
            disabled={
              !rangeValid ||
              (mode !== "frame" && draft.end <= draft.start) ||
              (mode === "crop" && !useRegion)
            }
            onClick={() =>
              void run(() =>
                window.cutbox!.exportReference({
                  mediaId: media.id,
                  start: draft.start,
                  end: draft.end,
                  mode,
                  options: {
                    width,
                    fps,
                    edgeLow,
                    edgeHigh,
                    ...(mode === "crop"
                      ? { crop: region, track: draft.keyframes }
                      : {}),
                  },
                }),
              )
            }
          >
            <Download />
            导出选定区间
          </button>
          <p className="fine">
            深度、姿态与蒙版需要配置本地模型。当前区域裁切使用已选矩形。模型输出是估计，不是测量真值；不可用时会显示具体原因。
          </p>
          {!capabilities?.ffmpeg && (
            <p className="warning">FFmpeg 不可用，参考导出暂不可用。</p>
          )}
        </div>
      </aside>
    </div>
  );
}
