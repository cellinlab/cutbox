import { useRef, useState } from "react";
import { Download, Plus, Trash2, Pencil } from "lucide-react";
import { Empty, time } from "./ui";
import type { Snapshot, Media, AnnotationInput, Capabilities } from "./types";
export function Editor({
  data,
  mediaId,
  onSelect,
  mutate,
  capabilities,
  run,
  study = false,
}: {
  data: Snapshot;
  mediaId?: string;
  onSelect: (id: string) => void;
  mutate: (fn: () => Promise<Snapshot>) => Promise<boolean>;
  capabilities?: Capabilities;
  run: (fn: () => Promise<unknown>) => Promise<void>;
  study?: boolean;
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
}: {
  media: Media;
  data: Snapshot;
  mutate: (fn: () => Promise<Snapshot>) => Promise<boolean>;
  capabilities?: Capabilities;
  run: (fn: () => Promise<unknown>) => Promise<void>;
  study: boolean;
}) {
  const player = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  const blank = (): AnnotationInput => ({
    mediaId: media.id,
    start: 0,
    end: media.duration || 0,
    label: "",
    notes: "",
    reviewState: "accepted",
  });
  const [draft, setDraft] = useState<AnnotationInput>(blank);
  const [current, setCurrent] = useState(0);
  const [busy, setBusy] = useState(false);
  const [playError, setPlayError] = useState("");
  const [useRegion, setUseRegion] = useState(false);
  const [region, setRegion] = useState({ x: 0, y: 0, width: 1, height: 1 });
  const [mode, setMode] = useState<"clip" | "edges">("clip");
  const annotations = data.annotations.filter((a) => a.mediaId === media.id);
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
  const mark = (field: "start" | "end") =>
    setDraft({ ...draft, [field]: player.current?.currentTime || 0 });
  return (
    <div className="editor-layout">
      <div className="editor-main">
        <div className="player-frame">
          {media.kind === "image" ? (
            <img
              src={window.cutbox!.mediaUrl(media.id)}
              alt={media.name}
              onError={() => setPlayError("无法显示此图片，请检查文件格式。")}
            />
          ) : media.kind === "video" ? (
            <video
              ref={player}
              controls
              preload="metadata"
              src={window.cutbox!.mediaUrl(media.id)}
              onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
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
              src={window.cutbox!.mediaUrl(media.id)}
              onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
              onError={() => setPlayError("播放器无法解码此音频。")}
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
                  setDraft(a);
                  setUseRegion(Boolean(a.region));
                  setRegion(a.region || { x: 0, y: 0, width: 1, height: 1 });
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
                          step="0.01"
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
          {(!rangeValid || !regionValid) && (
            <p className="warning">请检查时间范围或区域边界。</p>
          )}
          <button
            className="primary full"
            disabled={
              busy || !draft.label.trim() || !rangeValid || !regionValid
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
              onChange={(e) => setMode(e.target.value as "clip" | "edges")}
            >
              <option value="clip">原片参考</option>
              <option value="edges">边缘 / 轮廓视频</option>
            </select>
          </label>
          <button
            className="full"
            disabled={
              media.kind !== "video" ||
              !rangeValid ||
              draft.end <= draft.start ||
              !capabilities?.[mode]
            }
            onClick={() =>
              void run(() =>
                window.cutbox!.exportReference({
                  mediaId: media.id,
                  start: draft.start,
                  end: draft.end,
                  mode,
                }),
              )
            }
          >
            <Download />
            导出选定区间
          </button>
          <p className="fine">
            仅视频可导出 MP4
            参考。深度、姿态与蒙版：模型尚未接入。当前支持原片与确定性边缘参考。
          </p>
          {!capabilities?.ffmpeg && (
            <p className="warning">FFmpeg 不可用，参考导出暂不可用。</p>
          )}
        </div>
      </aside>
    </div>
  );
}
