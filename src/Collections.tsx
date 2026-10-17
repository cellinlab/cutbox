import { useState } from "react";
import { Plus, Download, Pencil, Folder } from "lucide-react";
import { Playlist } from "./Playlist";
import { Empty, Modal, MediaChecks } from "./ui";
import type { CollectionInput, Snapshot, ReferenceMode } from "./types";
export function Collections({
  data,
  mutate,
  onExport,
  run,
  open,
}: {
  data: Snapshot;
  mutate: (fn: () => Promise<Snapshot>) => Promise<boolean>;
  onExport: (id: string) => void;
  run: (fn: () => Promise<unknown>) => Promise<void>;
  open: (id: string, start?: number) => void;
}) {
  const [editing, setEditing] = useState<CollectionInput | null>(null);
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState<string>();
  const [referenceMode, setReferenceMode] = useState<ReferenceMode>("clip");
  const [format, setFormat] = useState<"jsonl" | "coco" | "srt">("jsonl");
  const [profile, setProfile] = useState<"full" | "trimmed">("full");
  return (
    <>
      <div className="toolbar">
        <p className="muted">将素材、资产与标注整理为可以带走的集合。</p>
        <button
          className="primary"
          onClick={() =>
            setEditing({
              name: "",
              description: "",
              mediaIds: [],
              entityIds: [],
              annotationIds: [],
            })
          }
        >
          <Plus />
          新建集合
        </button>
      </div>
      {data.collections.length === 0 ? (
        <Empty
          title="把有用的瞬间放进同一个盒子"
          description="创建集合，选择成员，再连同加密描述与素材一起导出。"
        />
      ) : (
        <div className="collection-list">
          {data.collections.map((c) => (
            <article key={c.id}>
              <Folder size={32} />
              <div className="grow">
                <h2>{c.name}</h2>
                <p>{c.description || "暂无描述"}</p>
                <small>
                  {c.mediaIds.length} 份素材 · {c.entityIds.length} 个资产 ·{" "}
                  {c.annotationIds.length} 条标注
                </small>
              </div>
              <button
                onClick={() => setPlaying(playing === c.id ? undefined : c.id)}
              >
                播放列表
              </button>
              <button onClick={() => setEditing({ ...c })}>
                <Pencil />
                编辑
              </button>
              <button onClick={() => onExport(c.id)}>
                <Download />
                导出集合
              </button>
              <div className="portable-export">
                <select
                  aria-label="交换格式"
                  value={format}
                  onChange={(e) => setFormat(e.target.value as typeof format)}
                >
                  <option value="jsonl">JSONL</option>
                  <option value="coco">COCO</option>
                  <option value="srt">SRT 字幕</option>
                </select>
                <select
                  aria-label="导出范围"
                  value={profile}
                  onChange={(e) => setProfile(e.target.value as typeof profile)}
                >
                  <option value="full">完整素材</option>
                  <option value="trimmed">选段裁切</option>
                </select>
                <button
                  onClick={() =>
                    void run(() =>
                      window.cutbox!.exportDataset({
                        format,
                        collectionId: c.id,
                        profile,
                      }),
                    )
                  }
                >
                  导出交换格式
                </button>
              </div>
              <div className="portable-export">
                <select
                  aria-label="批量参考类型"
                  value={referenceMode}
                  onChange={(e) =>
                    setReferenceMode(e.target.value as ReferenceMode)
                  }
                >
                  {Object.entries({
                    clip: "原片参考",
                    edges: "边缘参考",
                    crop: "区域裁切",
                    frame: "关键帧",
                    audio: "音频",
                    depth: "深度",
                    pose: "姿态",
                    mask: "蒙版",
                  }).map(([id, label]) => (
                    <option key={id} value={id}>
                      {label}
                    </option>
                  ))}
                </select>
                <button
                  disabled={!c.annotationIds.length}
                  onClick={() =>
                    void run(() =>
                      window.cutbox!.exportReferences({
                        annotationIds: c.annotationIds,
                        mode: referenceMode,
                      }),
                    )
                  }
                >
                  批量导出标注参考
                </button>
              </div>
              {playing === c.id && (
                <div className="full">
                  <Playlist collection={c} data={data} open={open} />
                </div>
              )}
            </article>
          ))}
        </div>
      )}
      {editing && (
        <Modal
          title={editing.id ? "编辑集合" : "新建集合"}
          onClose={() => !busy && setEditing(null)}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              try {
                if (await mutate(() => window.cutbox!.saveCollection(editing)))
                  setEditing(null);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              集合名称
              <input
                required
                value={editing.name}
                onChange={(e) =>
                  setEditing({ ...editing, name: e.target.value })
                }
              />
            </label>
            <label>
              描述
              <textarea
                value={editing.description}
                onChange={(e) =>
                  setEditing({ ...editing, description: e.target.value })
                }
              />
            </label>
            <label>素材成员</label>
            <MediaChecks
              media={data.media}
              selected={editing.mediaIds}
              onChange={(ids) => setEditing({ ...editing, mediaIds: ids })}
            />
            <label>资产成员（自动携带关联素材）</label>
            <div className="checks">
              {data.entities.map((entity) => (
                <label className="check" key={entity.id}>
                  <input
                    type="checkbox"
                    checked={editing.entityIds.includes(entity.id)}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        entityIds: e.target.checked
                          ? [...editing.entityIds, entity.id]
                          : editing.entityIds.filter((id) => id !== entity.id),
                      })
                    }
                  />
                  {entity.name}
                </label>
              ))}
            </div>
            <label>标注成员</label>
            <div className="checks">
              {data.annotations.map((a) => (
                <label className="check" key={a.id}>
                  <input
                    type="checkbox"
                    checked={editing.annotationIds.includes(a.id)}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        annotationIds: e.target.checked
                          ? [...editing.annotationIds, a.id]
                          : editing.annotationIds.filter((id) => id !== a.id),
                      })
                    }
                  />
                  {a.label}
                </label>
              ))}
            </div>
            <div className="modal-actions">
              <button
                type="button"
                disabled={busy}
                onClick={() => setEditing(null)}
              >
                取消
              </button>
              <button
                className="primary"
                disabled={busy || !editing.name.trim()}
              >
                保存集合
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
