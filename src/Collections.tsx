import { useState } from "react";
import { Plus, Download, Pencil, Folder } from "lucide-react";
import { Empty, Modal, MediaChecks } from "./ui";
import type { CollectionInput, Snapshot } from "./types";
export function Collections({
  data,
  mutate,
  onExport,
}: {
  data: Snapshot;
  mutate: (fn: () => Promise<Snapshot>) => Promise<boolean>;
  onExport: (id: string) => void;
}) {
  const [editing, setEditing] = useState<CollectionInput | null>(null);
  const [busy, setBusy] = useState(false);
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
              <button onClick={() => setEditing({ ...c })}>
                <Pencil />
                编辑
              </button>
              <button onClick={() => onExport(c.id)}>
                <Download />
                导出集合
              </button>
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
