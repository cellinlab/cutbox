import { useState } from "react";
import { Plus, Pencil, Trash2, Download } from "lucide-react";
import {
  entityNames,
  type Entity,
  type EntityInput,
  type Snapshot,
} from "./types";
import { Empty, Thumb, Modal, MediaChecks } from "./ui";
export function Assets({
  data,
  mutate,
  onExport,
  onOpen,
}: {
  data: Snapshot;
  mutate: (fn: () => Promise<Snapshot>) => Promise<boolean>;
  onExport: (id: string) => void;
  onOpen: (id: string) => void;
}) {
  const [type, setType] = useState<Entity["type"]>("character");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<EntityInput | null>(null);
  const [detail, setDetail] = useState<string>();
  const [remove, setRemove] = useState<Entity>();
  const [busy, setBusy] = useState(false);
  const [tagText, setTagText] = useState("");
  const entities = data.entities.filter(
    (e) =>
      e.type === type &&
      `${e.name} ${e.tags.join(" ")}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const current = data.entities.find((e) => e.id === detail);
  return (
    <>
      <div className="toolbar">
        <div className="tabs">
          {Object.entries(entityNames).map(([key, name]) => (
            <button
              key={key}
              className={type === key ? "active" : ""}
              onClick={() => {
                setType(key as Entity["type"]);
                setDetail(undefined);
              }}
            >
              {name}
            </button>
          ))}
        </div>
        <input
          aria-label="搜索资产"
          placeholder="搜索名称或标签"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button
          className="primary"
          onClick={() => {
            setTagText("");
            setEditing({
              type,
              name: "",
              description: "",
              tags: [],
              mediaIds: [],
            });
          }}
        >
          <Plus />
          新建{entityNames[type]}
        </button>
      </div>
      <div className={current ? "asset-layout" : ""}>
        <section>
          {entities.length === 0 ? (
            <Empty
              title={`建立你的${entityNames[type]}资产`}
              description="将分散的参考、出现片段与观察关联到同一个对象。"
            />
          ) : (
            <div className="media-grid">
              {entities.map((e) => (
                <button
                  key={e.id}
                  className={`media-card ${detail === e.id ? "selected" : ""}`}
                  onClick={() => setDetail(e.id)}
                >
                  <div className="thumbnail">
                    <Thumb
                      media={data.media.find(
                        (m) => m.id === (e.coverMediaId || e.mediaIds[0]),
                      )}
                    />
                  </div>
                  <div className="card-body">
                    <strong>{e.name}</strong>
                    <p>
                      {e.mediaIds.length} 份参考 ·{" "}
                      {
                        data.annotations.filter((a) => a.entityId === e.id)
                          .length
                      }{" "}
                      条标注
                    </p>
                    <div className="tags">
                      {e.tags.map((t) => (
                        <span key={t}>{t}</span>
                      ))}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>
        {current && (
          <aside className="inspector">
            <h2>{current.name}</h2>
            <p className="preserve">{current.description || "暂无描述"}</p>
            <div className="actions">
              <button
                onClick={() => {
                  setTagText(current.tags.join(", "));
                  setEditing({ ...current });
                }}
              >
                <Pencil />
                编辑
              </button>
              <button onClick={() => onExport(current.id)}>
                <Download />
                导出
              </button>
              <button
                className="icon danger"
                aria-label="删除资产"
                onClick={() => setRemove(current)}
              >
                <Trash2 />
              </button>
            </div>
            <h3>关联素材</h3>
            {current.mediaIds.map((id) => {
              const m = data.media.find((x) => x.id === id);
              return m ? (
                <button
                  className="source-row"
                  key={id}
                  onClick={() => onOpen(id)}
                >
                  <Thumb media={m} />
                  <span>{m.name}</span>
                </button>
              ) : null;
            })}
            <h3>关联标注</h3>
            {data.annotations
              .filter((a) => a.entityId === current.id)
              .map((a) => (
                <button
                  className="annotation-row"
                  key={a.id}
                  onClick={() => onOpen(a.mediaId)}
                >
                  {a.label}
                  <small>
                    {a.start.toFixed(2)} – {a.end.toFixed(2)} s
                  </small>
                </button>
              ))}
          </aside>
        )}
      </div>
      {editing && (
        <Modal
          title={`${editing.id ? "编辑" : "新建"}${entityNames[editing.type]}`}
          onClose={() => !busy && setEditing(null)}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              try {
                if (
                  await mutate(() =>
                    window.cutbox!.saveEntity({
                      ...editing,
                      tags: [
                        ...new Set(
                          tagText
                            .split(/[,，]/)
                            .map((t) => t.trim())
                            .filter(Boolean),
                        ),
                      ],
                    }),
                  )
                )
                  setEditing(null);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              名称
              <input
                required
                maxLength={160}
                value={editing.name}
                onChange={(e) =>
                  setEditing({ ...editing, name: e.target.value })
                }
              />
            </label>
            <label>
              描述
              <textarea
                rows={3}
                value={editing.description}
                onChange={(e) =>
                  setEditing({ ...editing, description: e.target.value })
                }
              />
            </label>
            <label>
              标签（以逗号分隔）
              <input
                value={tagText}
                onChange={(e) => setTagText(e.target.value)}
              />
            </label>
            <label>关联参考素材</label>
            <MediaChecks
              media={data.media}
              selected={editing.mediaIds}
              onChange={(ids) =>
                setEditing({
                  ...editing,
                  mediaIds: ids,
                  coverMediaId: ids.includes(editing.coverMediaId || "")
                    ? editing.coverMediaId
                    : undefined,
                })
              }
            />
            <label>
              封面
              <select
                value={editing.coverMediaId || ""}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    coverMediaId: e.target.value || undefined,
                  })
                }
              >
                <option value="">使用首份参考</option>
                {data.media
                  .filter(
                    (m) =>
                      editing.mediaIds.includes(m.id) && m.kind !== "audio",
                  )
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
              </select>
            </label>
            <div className="modal-actions">
              <button
                type="button"
                onClick={() => setEditing(null)}
                disabled={busy}
              >
                取消
              </button>
              <button
                className="primary"
                disabled={busy || !editing.name.trim()}
              >
                {busy ? "保存中…" : "保存资产"}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {remove && (
        <Modal title="删除资产" onClose={() => setRemove(undefined)}>
          <p>
            删除「{remove.name}
            」的资产卡？原始媒体文件保留。关联标注将解除与此资产的关联。
          </p>
          <div className="modal-actions">
            <button onClick={() => setRemove(undefined)}>取消</button>
            <button
              className="danger"
              onClick={async () => {
                if (await mutate(() => window.cutbox!.deleteEntity(remove.id)))
                  setRemove(undefined);
              }}
            >
              确认删除
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
