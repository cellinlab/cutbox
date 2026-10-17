import { useState } from "react";
import {
  Plus,
  Play,
  Pencil,
  Trash2,
  ArrowRight,
  Download,
  Upload,
  RotateCcw,
  Link,
  GitBranch,
} from "lucide-react";
import type {
  Snapshot,
  Story,
  StoryEvent,
  Relation,
  Input,
  Scalar,
  StoryVariable,
  StoryNode,
  StoryChoice,
  Epistemic,
} from "./types";
import { Empty, Modal, time } from "./ui";
// @ts-expect-error The shared pure ES module is also used by the backend worker.
// prettier-ignore
import { validateStory, diagnoseStory, beginStory, chooseStory, storyChoices } from "../desktop/story.mjs";
import "./story.css";

type Mutate = (fn: () => Promise<Snapshot>) => Promise<boolean>;
type Props = {
  data: Snapshot;
  mutate: Mutate;
  run?: (fn: () => Promise<unknown>) => Promise<void>;
  open?: (id: string, start?: number) => void;
};
type Diagnostic = {
  severity: string;
  code: string;
  message: string;
  nodeId?: string;
};
type Session = {
  nodeId: string;
  values: Record<string, Scalar>;
  steps: number;
  history: { from: string; choiceId: string; to: string }[];
};
const uid = () => crypto.randomUUID();
const clone = <T,>(value: T): T => structuredClone(value);
const epistemics: [Epistemic, string][] = [
  ["observed", "原片观察"],
  ["interpreted", "解释 / 推断"],
  ["invented", "创作设定"],
];
const kindNames = { scene: "剧情", clue: "线索", ending: "结局" };
const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
const freshStory = (): Input<Story> => {
  const id = uid();
  return {
    name: "未命名故事",
    description: "",
    variables: [],
    startNodeId: id,
    nodes: [
      { id, title: "起点", body: "", kind: "scene", eventIds: [], choices: [] },
    ],
  };
};
function exampleStory(): Input<Story> {
  return {
    name: "车站信件 · 线索探索示例",
    description:
      "创作示例；不代表任何已导入原片的事实。阅读线索后解锁还原事件。",
    variables: [
      {
        id: "read_letter",
        name: "已阅读信件",
        type: "boolean",
        initial: false,
      },
      { id: "trust", name: "同伴信任", type: "number", initial: 0 },
    ],
    startNodeId: "station",
    nodes: [
      {
        id: "station",
        title: "车站发现信件",
        body: "候车室里有一封无人认领的信。你可以调查，也可以直接离开。",
        kind: "scene",
        eventIds: [],
        choices: [
          {
            id: "investigate",
            label: "查看信件",
            targetId: "letter",
            conditions: [],
            effects: [],
          },
          {
            id: "solve",
            label: "根据线索还原会面计划",
            targetId: "solved",
            conditions: [
              { variable: "read_letter", operator: "eq", value: true },
            ],
            effects: [],
          },
          {
            id: "leave",
            label: "离开车站",
            targetId: "left",
            conditions: [],
            effects: [],
          },
        ],
      },
      {
        id: "letter",
        title: "信件的背面",
        body: "背面写着：钟声响起时，在东侧入口见面。",
        kind: "clue",
        eventIds: [],
        choices: [
          {
            id: "read",
            label: "记住线索并返回",
            targetId: "station",
            conditions: [],
            effects: [{ variable: "read_letter", op: "set", value: true }],
          },
          {
            id: "share",
            label: "把线索分享给同伴",
            targetId: "station",
            conditions: [
              { variable: "read_letter", operator: "eq", value: false },
            ],
            effects: [
              { variable: "read_letter", op: "set", value: true },
              { variable: "trust", op: "add", value: 1 },
            ],
          },
        ],
      },
      {
        id: "solved",
        title: "找到会面地点",
        body: "你知道了时间和地点，可以继续创作下一段调查。",
        kind: "ending",
        eventIds: [],
        choices: [],
      },
      {
        id: "left",
        title: "错过的线索",
        body: "你离开了车站，信件仍留在候车室。",
        kind: "ending",
        eventIds: [],
        choices: [],
      },
    ],
  };
}

export function StoryWorkspace({ data, mutate, run, open }: Props) {
  const [tab, setTab] = useState<"events" | "relations" | "stories">("events");
  const [event, setEvent] = useState<Input<StoryEvent> | null>(null);
  const [relation, setRelation] = useState<Input<Relation> | null>(null);
  const [story, setStory] = useState<Input<Story> | null>(null);
  const [playing, setPlaying] = useState<Story | null>(null);
  const [importing, setImporting] = useState(false);
  const [deleting, setDeleting] = useState<{
    title: string;
    action: () => Promise<Snapshot>;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const events = [...data.events].sort(
    (a, b) => (a.storyTime ?? Infinity) - (b.storyTime ?? Infinity),
  );
  const entityName = (id: string) =>
    data.entities.find((e) => e.id === id)?.name ?? "未找到资产";
  async function remove() {
    if (!deleting || busy) return;
    setBusy(true);
    try {
      if (await mutate(deleting.action)) setDeleting(null);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="story-workspace">
      <div className="toolbar">
        <div className="tabs" role="tablist" aria-label="故事工作区">
          {(
            [
              ["events", "事件与状态"],
              ["relations", "人物关系"],
              ["stories", "互动故事"],
            ] as const
          ).map(([key, label]) => (
            <button
              role="tab"
              aria-selected={tab === key}
              className={tab === key ? "active" : ""}
              key={key}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="actions">
          {tab === "events" && (
            <button
              className="primary"
              onClick={() =>
                setEvent({
                  name: "",
                  description: "",
                  entityIds: [],
                  annotationIds: [],
                  epistemic: "observed",
                  confidence: null,
                  changes: [],
                })
              }
            >
              <Plus />
              新建事件
            </button>
          )}
          {tab === "relations" && (
            <button
              className="primary"
              disabled={data.entities.length < 1}
              onClick={() =>
                setRelation({
                  fromEntityId: data.entities[0]?.id ?? "",
                  toEntityId:
                    data.entities[1]?.id ?? data.entities[0]?.id ?? "",
                  type: "ally",
                  description: "",
                  evidenceAnnotationIds: [],
                  epistemic: "observed",
                  confidence: null,
                })
              }
            >
              <Plus />
              新建关系
            </button>
          )}
          {tab === "stories" && (
            <>
              <button onClick={() => setImporting(true)}>
                <Upload />
                导入故事 JSON
              </button>
              <button onClick={() => setStory(exampleStory())}>
                打开探索示例
              </button>
              <button
                className="primary"
                onClick={() => setStory(freshStory())}
              >
                <Plus />
                新建故事
              </button>
            </>
          )}
        </div>
      </div>
      {tab === "events" &&
        (events.length ? (
          <div className="event-timeline">
            {events.map((e) => (
              <article className="story-card" key={e.id}>
                <div className="story-card-head">
                  <div>
                    <small>
                      故事时间 {e.storyTime ?? "未排序"} ·{" "}
                      {epistemics.find(([k]) => k === e.epistemic)?.[1]} ·{" "}
                      {e.confidence === null
                        ? "置信度未提供"
                        : `${Math.round(e.confidence * 100)}%`}
                    </small>
                    <h3>{e.name}</h3>
                  </div>
                  <div className="actions">
                    <button
                      aria-label={`编辑事件 ${e.name}`}
                      onClick={() => setEvent(clone(e))}
                    >
                      <Pencil />
                    </button>
                    <button
                      aria-label={`删除事件 ${e.name}`}
                      onClick={() =>
                        setDeleting({
                          title: e.name,
                          action: () => window.cutbox!.deleteEvent(e.id),
                        })
                      }
                    >
                      <Trash2 />
                    </button>
                  </div>
                </div>
                <p className="story-prose">{e.description}</p>
                <div className="story-chips">
                  {e.entityIds.map((id) => (
                    <span key={id}>{entityName(id)}</span>
                  ))}
                  {e.sceneId && <span>地点：{entityName(e.sceneId)}</span>}
                </div>
                {e.changes.length > 0 && (
                  <ul className="story-state-changes">
                    {e.changes.map((c, i) => (
                      <li key={i}>
                        {entityName(c.entityId)} · {c.key}：
                        {c.before === undefined ? "未知" : String(c.before)} →{" "}
                        {String(c.after)}
                      </li>
                    ))}
                  </ul>
                )}
                <Evidence ids={e.annotationIds} data={data} open={open} />
              </article>
            ))}
          </div>
        ) : (
          <Empty
            title="把片段连接成事件"
            description="记录谁在何处做了什么、状态如何变化，并关联原片证据。故事时间用于叙事顺序，与视频秒数分开。"
          />
        ))}
      {tab === "relations" &&
        (data.relations.length ? (
          <div className="story-card-grid">
            {data.relations.map((r) => (
              <article className="story-card" key={r.id}>
                <div className="story-relation-line">
                  <strong>{entityName(r.fromEntityId)}</strong>
                  <span>
                    {r.type}
                    <ArrowRight size={16} />
                  </span>
                  <strong>{entityName(r.toEntityId)}</strong>
                </div>
                <p className="story-prose">{r.description}</p>
                <small>
                  {epistemics.find(([k]) => k === r.epistemic)?.[1]} ·{" "}
                  {r.confidence === null
                    ? "置信度未提供"
                    : `${Math.round(r.confidence * 100)}%`}
                </small>
                <Evidence
                  ids={r.evidenceAnnotationIds}
                  data={data}
                  open={open}
                />
                <div className="actions">
                  <button onClick={() => setRelation(clone(r))}>
                    <Pencil />
                    编辑关系
                  </button>
                  <button
                    aria-label={`删除关系 ${r.type}`}
                    onClick={() =>
                      setDeleting({
                        title: `${entityName(r.fromEntityId)} → ${entityName(r.toEntityId)}`,
                        action: () => window.cutbox!.deleteRelation(r.id),
                      })
                    }
                  >
                    <Trash2 />
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <Empty
            title="建立有证据的人物关系"
            description="先在资产页添加人物与场景，再记录信任、持有、位置或其他自定义关系。"
          />
        ))}
      {tab === "stories" &&
        (data.stories.length ? (
          <div className="story-card-grid">
            {data.stories.map((s) => {
              const diagnostics = diagnoseStory(s) as Diagnostic[];
              return (
                <article className="story-card" key={s.id}>
                  <GitBranch />
                  <h3>{s.name}</h3>
                  <p className="story-prose">{s.description}</p>
                  <small>
                    {s.nodes.length} 个节点 · {s.variables.length} 个变量 ·{" "}
                    {diagnostics.length} 条结构提示
                  </small>
                  <div className="actions">
                    <button className="primary" onClick={() => setPlaying(s)}>
                      <Play />
                      预演
                    </button>
                    <button onClick={() => setStory(clone(s))}>
                      <Pencil />
                      编辑故事
                    </button>
                    <button
                      aria-label={`删除故事 ${s.name}`}
                      onClick={() =>
                        setDeleting({
                          title: s.name,
                          action: () => window.cutbox!.deleteStory(s.id),
                        })
                      }
                    >
                      <Trash2 />
                    </button>
                  </div>
                  <div className="actions story-export">
                    {(["json", "renpy", "godot"] as const).map((format) => (
                      <button
                        key={format}
                        onClick={() =>
                          void run?.(() =>
                            window.cutbox!.exportStory({
                              storyId: s.id,
                              format,
                            }),
                          )
                        }
                      >
                        <Download />
                        {format === "json"
                          ? "JSON"
                          : format === "renpy"
                            ? "Ren’Py"
                            : "Godot"}
                      </button>
                    ))}
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <Empty
            title="把故事变成可探索的世界"
            description="创建线索、决策点、变量与条件，直接试玩分支。预演状态不会修改原片标注。"
          >
            <button
              className="primary"
              onClick={() => setStory(exampleStory())}
            >
              打开线索探索示例
            </button>
          </Empty>
        ))}
      {event && (
        <EventEditor
          key={event.id ?? "new"}
          initial={event}
          data={data}
          mutate={mutate}
          close={() => setEvent(null)}
        />
      )}
      {relation && (
        <RelationEditor
          key={relation.id ?? "new"}
          initial={relation}
          data={data}
          mutate={mutate}
          close={() => setRelation(null)}
        />
      )}
      {story && (
        <StoryEditor
          initial={story}
          data={data}
          mutate={mutate}
          close={() => setStory(null)}
        />
      )}
      {playing && (
        <Modal
          title={`预演 · ${playing.name}`}
          onClose={() => setPlaying(null)}
        >
          <StoryPreview story={playing} data={data} open={open} />
        </Modal>
      )}
      {importing && (
        <StoryImport
          data={data}
          mutate={mutate}
          close={() => setImporting(false)}
        />
      )}
      {deleting && (
        <Modal title="删除记录" onClose={() => !busy && setDeleting(null)}>
          <p>
            删除「{deleting.title}
            」？存在依赖时会阻止删除并提示；可使用工作区撤销恢复记录。
          </p>
          <div className="actions">
            <button disabled={busy} onClick={() => setDeleting(null)}>
              取消
            </button>
            <button
              className="danger"
              disabled={busy}
              onClick={() => void remove()}
            >
              {busy ? "删除中…" : "确认删除"}
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}
function Evidence({
  ids,
  data,
  open,
}: {
  ids: string[];
  data: Snapshot;
  open?: (id: string, start?: number) => void;
}) {
  return (
    <div className="story-evidence">
      {ids.map((id) => {
        const a = data.annotations.find((item) => item.id === id);
        return a ? (
          <button
            key={id}
            title="在标注工作台打开原片"
            onClick={() => open?.(a.mediaId, a.start)}
          >
            <Link size={14} />
            {a.label} · {time(a.start)}–{time(a.end)}
          </button>
        ) : null;
      })}
    </div>
  );
}
function Checks({
  title,
  items,
  selected,
  change,
}: {
  title: string;
  items: { id: string; name: string }[];
  selected: string[];
  change: (ids: string[]) => void;
}) {
  return (
    <fieldset className="story-checks">
      <legend>{title}</legend>
      {items.length ? (
        items.map((item) => (
          <label key={item.id}>
            <input
              type="checkbox"
              checked={selected.includes(item.id)}
              onChange={(e) =>
                change(
                  e.target.checked
                    ? [...selected, item.id]
                    : selected.filter((id) => id !== item.id),
                )
              }
            />
            {item.name}
          </label>
        ))
      ) : (
        <small>暂无可关联记录</small>
      )}
    </fieldset>
  );
}
function EpistemicFields({
  value,
  change,
}: {
  value: { epistemic: Epistemic; confidence: number | null };
  change: (v: { epistemic: Epistemic; confidence: number | null }) => void;
}) {
  return (
    <div className="story-fields">
      <label>
        信息性质
        <select
          value={value.epistemic}
          onChange={(e) =>
            change({ ...value, epistemic: e.target.value as Epistemic })
          }
        >
          {epistemics.map(([key, label]) => (
            <option value={key} key={key}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label>
        置信度（0–1）
        <input
          type="number"
          min={0}
          max={1}
          step={0.05}
          value={value.confidence ?? ""}
          placeholder="未提供"
          onChange={(e) =>
            change({
              ...value,
              confidence: e.target.value === "" ? null : e.target.valueAsNumber,
            })
          }
        />
      </label>
    </div>
  );
}
function ScalarInput({
  value,
  type,
  change,
  label,
}: {
  value: Scalar;
  type: string;
  change: (v: Scalar) => void;
  label: string;
}) {
  if (type === "boolean")
    return (
      <select
        aria-label={label}
        value={String(value)}
        onChange={(e) => change(e.target.value === "true")}
      >
        <option value="false">否 / false</option>
        <option value="true">是 / true</option>
      </select>
    );
  return (
    <input
      aria-label={label}
      required={type === "number"}
      type={type === "number" ? "number" : "text"}
      step="any"
      value={String(value)}
      onChange={(e) =>
        change(type === "number" ? e.target.valueAsNumber : e.target.value)
      }
    />
  );
}
function EventEditor({
  initial,
  data,
  mutate,
  close,
}: {
  initial: Input<StoryEvent>;
  data: Snapshot;
  mutate: Mutate;
  close: () => void;
}) {
  const [draft, setDraft] = useState(() => clone(initial));
  const [busy, setBusy] = useState(false);
  const change = (patch: Partial<Input<StoryEvent>>) =>
    setDraft((prev) => ({ ...prev, ...patch }));
  return (
    <Modal
      title={initial.id ? "编辑事件" : "新建事件"}
      onClose={() => !busy && close()}
    >
      <form
        className="story-form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          setBusy(true);
          try {
            if (await mutate(() => window.cutbox!.saveEvent(draft))) close();
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          事件名称
          <input
            required
            value={draft.name}
            onChange={(e) => change({ name: e.target.value })}
          />
        </label>
        <label>
          事件描述
          <textarea
            aria-label="事件描述"
            rows={3}
            value={draft.description}
            onChange={(e) => change({ description: e.target.value })}
          />
        </label>
        <div className="story-fields">
          <label>
            故事时间 / 顺序
            <input
              type="number"
              step="any"
              value={draft.storyTime ?? ""}
              onChange={(e) =>
                change({
                  storyTime:
                    e.target.value === "" ? undefined : e.target.valueAsNumber,
                })
              }
            />
          </label>
          <label>
            发生场景
            <select
              value={draft.sceneId ?? ""}
              onChange={(e) => change({ sceneId: e.target.value || undefined })}
            >
              <option value="">未指定</option>
              {data.entities
                .filter((x) => x.type === "scene")
                .map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
            </select>
          </label>
        </div>
        <EpistemicFields value={draft} change={change} />
        <Checks
          title="参与资产"
          items={data.entities}
          selected={draft.entityIds}
          change={(entityIds) => change({ entityIds })}
        />
        <Checks
          title="原片证据"
          items={data.annotations.map((a) => ({
            id: a.id,
            name: `${a.label} · ${time(a.start)}`,
          }))}
          selected={draft.annotationIds}
          change={(annotationIds) => change({ annotationIds })}
        />
        <fieldset>
          <legend>状态变化</legend>
          {draft.changes.map((c, i) => (
            <div className="story-change" key={i}>
              <select
                aria-label={`变化 ${i + 1} 资产`}
                required
                value={c.entityId}
                onChange={(e) =>
                  change({
                    entityIds: [
                      ...new Set([...draft.entityIds, e.target.value]),
                    ],
                    changes: draft.changes.map((v, j) =>
                      j === i ? { ...v, entityId: e.target.value } : v,
                    ),
                  })
                }
              >
                <option value="">选择资产</option>
                {data.entities.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
              <input
                aria-label={`变化 ${i + 1} 属性`}
                required
                placeholder="属性键，如 location"
                pattern="[A-Za-z][A-Za-z0-9_]*"
                value={c.key}
                onChange={(e) =>
                  change({
                    changes: draft.changes.map((v, j) =>
                      j === i ? { ...v, key: e.target.value } : v,
                    ),
                  })
                }
              />
              <select
                aria-label={`变化 ${i + 1} 类型`}
                value={typeof c.after}
                onChange={(e) => {
                  const after =
                    e.target.value === "boolean"
                      ? false
                      : e.target.value === "number"
                        ? 0
                        : "";
                  change({
                    changes: draft.changes.map((v, j) =>
                      j === i ? { ...v, before: undefined, after } : v,
                    ),
                  });
                }}
              >
                <option value="string">文本</option>
                <option value="number">数值</option>
                <option value="boolean">布尔</option>
              </select>
              <label className="story-inline">
                <input
                  type="checkbox"
                  checked={c.before !== undefined}
                  onChange={(e) =>
                    change({
                      changes: draft.changes.map((v, j) =>
                        j === i
                          ? {
                              ...v,
                              before: e.target.checked ? c.after : undefined,
                            }
                          : v,
                      ),
                    })
                  }
                />
                已知原值
              </label>
              {c.before !== undefined && (
                <ScalarInput
                  label={`变化 ${i + 1} 原值`}
                  value={c.before}
                  type={typeof c.after}
                  change={(before) =>
                    change({
                      changes: draft.changes.map((v, j) =>
                        j === i ? { ...v, before } : v,
                      ),
                    })
                  }
                />
              )}
              <ScalarInput
                label={`变化 ${i + 1} 新值`}
                value={c.after}
                type={typeof c.after}
                change={(after) =>
                  change({
                    changes: draft.changes.map((v, j) =>
                      j === i ? { ...v, after } : v,
                    ),
                  })
                }
              />
              <button
                type="button"
                aria-label={`删除状态变化 ${i + 1}`}
                onClick={() =>
                  change({ changes: draft.changes.filter((_, j) => j !== i) })
                }
              >
                <Trash2 />
              </button>
            </div>
          ))}
          <button
            type="button"
            disabled={!data.entities.length}
            onClick={() =>
              change({
                entityIds: [
                  ...new Set([...draft.entityIds, data.entities[0].id]),
                ],
                changes: [
                  ...draft.changes,
                  { entityId: data.entities[0].id, key: "", after: "" },
                ],
              })
            }
          >
            <Plus />
            添加状态变化
          </button>
        </fieldset>
        <p className="muted">
          状态变化是事件记录，不会自动覆盖资产当前属性；不同时间或解释可并存。
        </p>
        <div className="actions">
          <button type="button" disabled={busy} onClick={close}>
            取消
          </button>
          <button className="primary" disabled={busy}>
            {busy ? "保存中…" : "保存事件"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
function RelationEditor({
  initial,
  data,
  mutate,
  close,
}: {
  initial: Input<Relation>;
  data: Snapshot;
  mutate: Mutate;
  close: () => void;
}) {
  const [draft, setDraft] = useState(() => clone(initial));
  const [busy, setBusy] = useState(false);
  const change = (patch: Partial<Input<Relation>>) =>
    setDraft((prev) => ({ ...prev, ...patch }));
  return (
    <Modal
      title={initial.id ? "编辑关系" : "新建关系"}
      onClose={() => !busy && close()}
    >
      <form
        className="story-form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          setBusy(true);
          try {
            if (await mutate(() => window.cutbox!.saveRelation(draft))) close();
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="story-fields">
          {(["fromEntityId", "toEntityId"] as const).map((key) => (
            <label key={key}>
              {key === "fromEntityId" ? "关系起点" : "关系终点"}
              <select
                required
                value={draft[key]}
                onChange={(e) => change({ [key]: e.target.value })}
              >
                {data.entities.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
        <label>
          关系类型
          <input
            required
            list="relation-types"
            value={draft.type}
            onChange={(e) => change({ type: e.target.value })}
          />
          <datalist id="relation-types">
            {[
              "ally",
              "owns",
              "knows",
              "located_in",
              "rival",
              "family",
              "trusts",
            ].map((x) => (
              <option key={x} value={x} />
            ))}
          </datalist>
        </label>
        <label>
          关系描述
          <textarea
            aria-label="关系描述"
            rows={3}
            value={draft.description}
            onChange={(e) => change({ description: e.target.value })}
          />
        </label>
        <EpistemicFields value={draft} change={change} />
        <Checks
          title="关系证据"
          items={data.annotations.map((a) => ({ id: a.id, name: a.label }))}
          selected={draft.evidenceAnnotationIds}
          change={(evidenceAnnotationIds) => change({ evidenceAnnotationIds })}
        />
        <div className="actions">
          <button type="button" disabled={busy} onClick={close}>
            取消
          </button>
          <button className="primary" disabled={busy}>
            {busy ? "保存中…" : "保存关系"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function StoryEditor({
  initial,
  data,
  mutate,
  close,
}: {
  initial: Input<Story>;
  data: Snapshot;
  mutate: Mutate;
  close: () => void;
}) {
  const [draft, setDraft] = useState(() => clone(initial));
  const [nodeId, setNodeId] = useState(initial.startNodeId);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(false);
  const node = draft.nodes.find((n) => n.id === nodeId) ?? draft.nodes[0];
  const patch = (value: Partial<Input<Story>>) => {
    setDraft((prev) => ({ ...prev, ...value }));
    setError("");
  };
  const patchNode = (value: Partial<StoryNode>) =>
    patch({
      nodes: draft.nodes.map((n) =>
        n.id === node.id ? { ...n, ...value } : n,
      ),
    });
  const patchChoice = (id: string, value: Partial<StoryChoice>) =>
    patchNode({
      choices: node.choices.map((c) => (c.id === id ? { ...c, ...value } : c)),
    });
  const diagnostics = diagnoseStory(draft) as Diagnostic[];
  function valid() {
    try {
      validateStory(draft, data);
      setError("");
      return true;
    } catch (e) {
      setError(message(e));
      return false;
    }
  }
  async function save() {
    if (busy || !valid()) return;
    setBusy(true);
    try {
      if (await mutate(() => window.cutbox!.saveStory(draft))) close();
    } finally {
      setBusy(false);
    }
  }
  function removeNode() {
    if (draft.nodes.length === 1) {
      setError("故事至少保留一个节点。");
      return;
    }
    const incoming = draft.nodes.filter(
      (n) => n.id !== node.id && n.choices.some((c) => c.targetId === node.id),
    );
    if (incoming.length) {
      setError(
        `请先移除指向此节点的选项：${incoming.map((n) => n.title).join("、")}`,
      );
      return;
    }
    const nodes = draft.nodes.filter((n) => n.id !== node.id);
    patch({
      nodes,
      startNodeId:
        draft.startNodeId === node.id ? nodes[0].id : draft.startNodeId,
    });
    setNodeId(nodes[0].id);
  }
  return (
    <Modal
      title={initial.id ? "编辑互动故事" : "新建互动故事"}
      onClose={() => !busy && close()}
    >
      <div className="story-editor">
        <div className="story-editor-top">
          <div className="tabs">
            <button
              className={!preview ? "active" : ""}
              onClick={() => setPreview(false)}
            >
              结构编辑
            </button>
            <button
              className={preview ? "active" : ""}
              onClick={() => {
                if (valid()) setPreview(true);
              }}
            >
              <Play />
              试玩当前草稿
            </button>
          </div>
          <button
            className="primary"
            disabled={busy}
            onClick={() => void save()}
          >
            {busy ? "保存中…" : "保存故事"}
          </button>
        </div>
        {error && (
          <p role="alert" className="warning">
            {error}
          </p>
        )}
        {preview ? (
          <StoryPreview story={draft} data={data} />
        ) : (
          <>
            <div className="story-fields">
              <label>
                故事名称
                <input
                  required
                  value={draft.name}
                  onChange={(e) => patch({ name: e.target.value })}
                />
              </label>
              <label>
                起始节点
                <select
                  value={draft.startNodeId}
                  onChange={(e) => patch({ startNodeId: e.target.value })}
                >
                  {draft.nodes.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.title}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label>
              故事说明
              <textarea
                aria-label="故事说明"
                rows={2}
                value={draft.description}
                onChange={(e) => patch({ description: e.target.value })}
              />
            </label>
            <details
              className="story-variables"
              open={draft.variables.length === 0}
            >
              <summary>世界状态变量（{draft.variables.length}）</summary>
              {draft.variables.map((v, i) => (
                <div className="story-variable" key={v.id}>
                  <input
                    aria-label={`变量 ${i + 1} 名称`}
                    placeholder="变量名称"
                    value={v.name}
                    onChange={(e) =>
                      patch({
                        variables: draft.variables.map((x) =>
                          x.id === v.id ? { ...x, name: e.target.value } : x,
                        ),
                      })
                    }
                  />
                  <select
                    aria-label={`变量 ${i + 1} 类型`}
                    value={v.type}
                    onChange={(e) => {
                      const type = e.target.value as StoryVariable["type"];
                      if (
                        draft.nodes.some((n) =>
                          n.choices.some((c) =>
                            [...c.conditions, ...c.effects].some(
                              (x) => x.variable === v.id,
                            ),
                          ),
                        )
                      ) {
                        setError(
                          "变量已被条件或状态变化引用，请先移除引用再修改类型。",
                        );
                        return;
                      }
                      patch({
                        variables: draft.variables.map((x) =>
                          x.id === v.id
                            ? {
                                ...x,
                                type,
                                initial:
                                  type === "number"
                                    ? 0
                                    : type === "boolean"
                                      ? false
                                      : "",
                              }
                            : x,
                        ),
                      });
                    }}
                  >
                    <option value="boolean">布尔</option>
                    <option value="number">数值</option>
                    <option value="string">文本</option>
                  </select>
                  <ScalarInput
                    label={`变量 ${i + 1} 初始值`}
                    value={v.initial}
                    type={v.type}
                    change={(initial) =>
                      patch({
                        variables: draft.variables.map((x) =>
                          x.id === v.id ? { ...x, initial } : x,
                        ),
                      })
                    }
                  />
                  <button
                    aria-label={`删除变量 ${v.name}`}
                    onClick={() => {
                      if (
                        draft.nodes.some((n) =>
                          n.choices.some((c) =>
                            [...c.conditions, ...c.effects].some(
                              (x) => x.variable === v.id,
                            ),
                          ),
                        )
                      )
                        setError("变量已被引用，请先删除相应条件和状态变化。");
                      else
                        patch({
                          variables: draft.variables.filter(
                            (x) => x.id !== v.id,
                          ),
                        });
                    }}
                  >
                    <Trash2 />
                  </button>
                </div>
              ))}
              <button
                onClick={() =>
                  patch({
                    variables: [
                      ...draft.variables,
                      {
                        id: uid(),
                        name: `变量 ${draft.variables.length + 1}`,
                        type: "boolean",
                        initial: false,
                      },
                    ],
                  })
                }
              >
                <Plus />
                添加变量
              </button>
            </details>
            <div className="story-node-layout">
              <aside className="story-node-list" aria-label="故事节点">
                {draft.nodes.map((n) => (
                  <button
                    className={n.id === node.id ? "active" : ""}
                    key={n.id}
                    onClick={() => setNodeId(n.id)}
                  >
                    <span>
                      {n.id === draft.startNodeId ? "起点 · " : ""}
                      {n.title || "未命名"}
                    </span>
                    <small>
                      {kindNames[n.kind]} · {n.choices.length} 条分支
                    </small>
                  </button>
                ))}
                <button
                  onClick={() => {
                    const id = uid();
                    patch({
                      nodes: [
                        ...draft.nodes,
                        {
                          id,
                          title: `节点 ${draft.nodes.length + 1}`,
                          body: "",
                          kind: "scene",
                          eventIds: [],
                          choices: [],
                        },
                      ],
                    });
                    setNodeId(id);
                  }}
                >
                  <Plus />
                  添加节点
                </button>
              </aside>
              <div className="story-node-detail">
                <div className="story-fields">
                  <label>
                    节点名称
                    <input
                      value={node.title}
                      onChange={(e) => patchNode({ title: e.target.value })}
                    />
                  </label>
                  <label>
                    节点类型
                    <select
                      value={node.kind}
                      onChange={(e) => {
                        const kind = e.target.value as StoryNode["kind"];
                        if (kind === "ending" && node.choices.length) {
                          setError("请先删除此节点的选项，再设为结局。");
                          return;
                        }
                        patchNode({ kind });
                      }}
                    >
                      {Object.entries(kindNames).map(([key, label]) => (
                        <option key={key} value={key}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <label>
                  节点信息性质
                  <select
                    value={node.epistemic ?? "invented"}
                    onChange={(e) =>
                      patchNode({ epistemic: e.target.value as Epistemic })
                    }
                  >
                    {epistemics.map(([key, label]) => (
                      <option key={key} value={key}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="muted">
                  关联原片不会自动证明分支实际发生；请单独区分原剧情、推断与创作。
                </p>
                <label>
                  玩家看到的内容
                  <textarea
                    aria-label="玩家看到的内容"
                    rows={4}
                    value={node.body}
                    onChange={(e) => patchNode({ body: e.target.value })}
                  />
                </label>
                <label>
                  关联原片素材
                  <select
                    value={node.mediaId ?? ""}
                    onChange={(e) => {
                      const media = data.media.find(
                        (m) => m.id === e.target.value,
                      );
                      patchNode({
                        mediaId: media?.id,
                        start: media ? 0 : undefined,
                        end: media?.duration,
                      });
                    }}
                  >
                    <option value="">不关联素材</option>
                    {data.media.map((m) => (
                      <option value={m.id} key={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </label>
                {node.mediaId && (
                  <div className="story-fields">
                    <label>
                      素材入点（秒）
                      <input
                        type="number"
                        min={0}
                        max={
                          data.media.find((m) => m.id === node.mediaId)
                            ?.duration
                        }
                        step="0.01"
                        value={node.start ?? 0}
                        onChange={(e) =>
                          patchNode({ start: e.target.valueAsNumber })
                        }
                      />
                    </label>
                    <label>
                      素材出点（秒）
                      <input
                        type="number"
                        min={node.start ?? 0}
                        max={
                          data.media.find((m) => m.id === node.mediaId)
                            ?.duration
                        }
                        step="0.01"
                        value={node.end ?? 0}
                        onChange={(e) =>
                          patchNode({ end: e.target.valueAsNumber })
                        }
                      />
                    </label>
                  </div>
                )}
                <Checks
                  title="关联故事事件"
                  items={data.events}
                  selected={node.eventIds ?? []}
                  change={(eventIds) => patchNode({ eventIds })}
                />
                <h3>选项与规则</h3>
                {node.choices.map((c, i) => (
                  <ChoiceEditor
                    key={c.id}
                    choice={c}
                    index={i}
                    nodes={draft.nodes}
                    variables={draft.variables}
                    patch={(value) => patchChoice(c.id, value)}
                    remove={() =>
                      patchNode({
                        choices: node.choices.filter((x) => x.id !== c.id),
                      })
                    }
                  />
                ))}
                {node.kind !== "ending" && (
                  <button
                    onClick={() =>
                      patchNode({
                        choices: [
                          ...node.choices,
                          {
                            id: uid(),
                            label: `选项 ${node.choices.length + 1}`,
                            targetId:
                              draft.nodes.find((n) => n.id !== node.id)?.id ??
                              node.id,
                            conditions: [],
                            effects: [],
                          },
                        ],
                      })
                    }
                  >
                    <Plus />
                    添加选项
                  </button>
                )}
                <button
                  className="danger story-delete-node"
                  onClick={removeNode}
                >
                  <Trash2 />
                  删除当前节点
                </button>
              </div>
            </div>
            <details className="story-graph">
              <summary>分支地图 · {draft.nodes.length} 个节点</summary>
              <div className="story-graph-grid">
                {draft.nodes.map((source) => (
                  <article
                    key={source.id}
                    className={source.id === node.id ? "active" : ""}
                  >
                    <button onClick={() => setNodeId(source.id)}>
                      <strong>
                        {source.id === draft.startNodeId ? "起点 · " : ""}
                        {source.title}
                      </strong>
                      <small>{kindNames[source.kind]}</small>
                    </button>
                    {source.choices.map((choice) => (
                      <button
                        key={choice.id}
                        onClick={() => setNodeId(choice.targetId)}
                      >
                        <span>
                          {choice.label}
                          <small>
                            {choice.conditions.length
                              ? `${choice.conditions.length} 个条件`
                              : "无条件"}
                          </small>
                        </span>
                        <ArrowRight />
                        <span>
                          {draft.nodes.find(
                            (target) => target.id === choice.targetId,
                          )?.title ?? "目标缺失"}
                        </span>
                      </button>
                    ))}
                    {!source.choices.length && (
                      <small>
                        {source.kind === "ending" ? "结局" : "尚无出路"}
                      </small>
                    )}
                  </article>
                ))}
              </div>
            </details>
            <details
              className="story-diagnostics"
              open={diagnostics.length > 0}
            >
              <summary>
                结构检查 ·{" "}
                {diagnostics.length
                  ? `${diagnostics.length} 条提示`
                  : "未发现结构问题"}
              </summary>
              <p className="muted">
                可达性按连线检查；条件是否可满足，请在预演中检查。允许循环，不会自动执行分支。
              </p>
              {diagnostics.map((d, i) => (
                <p
                  key={i}
                  className={d.severity === "error" ? "warning" : "muted"}
                >
                  {d.message}
                </p>
              ))}
            </details>
          </>
        )}
      </div>
    </Modal>
  );
}
function ChoiceEditor({
  choice: c,
  index,
  nodes,
  variables,
  patch,
  remove,
}: {
  choice: StoryChoice;
  index: number;
  nodes: StoryNode[];
  variables: StoryVariable[];
  patch: (v: Partial<StoryChoice>) => void;
  remove: () => void;
}) {
  return (
    <fieldset className="story-choice">
      <legend>选项 {index + 1}</legend>
      <div className="story-fields">
        <label>
          选项文字
          <input
            value={c.label}
            onChange={(e) => patch({ label: e.target.value })}
          />
        </label>
        <label>
          前往节点
          <select
            value={c.targetId}
            onChange={(e) => patch({ targetId: e.target.value })}
          >
            {nodes.map((n) => (
              <option value={n.id} key={n.id}>
                {n.title}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="muted">
        所有条件同时满足才可选择；状态变化按顺序全部成功后生效。
      </p>
      {c.conditions.map((condition, i) => {
        const variable = variables.find((v) => v.id === condition.variable);
        return (
          <div className="story-rule" key={i}>
            <select
              aria-label={`条件 ${i + 1} 变量`}
              value={condition.variable}
              onChange={(e) => {
                const v = variables.find((v) => v.id === e.target.value)!;
                patch({
                  conditions: c.conditions.map((x, j) =>
                    j === i
                      ? { variable: v.id, operator: "eq", value: v.initial }
                      : x,
                  ),
                });
              }}
            >
              {variables.map((v) => (
                <option value={v.id} key={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
            <select
              aria-label={`条件 ${i + 1} 运算符`}
              value={condition.operator}
              onChange={(e) =>
                patch({
                  conditions: c.conditions.map((x, j) =>
                    j === i
                      ? {
                          ...x,
                          operator: e.target.value as typeof condition.operator,
                        }
                      : x,
                  ),
                })
              }
            >
              {(variable?.type === "number"
                ? ["eq", "ne", "gt", "gte", "lt", "lte"]
                : ["eq", "ne"]
              ).map((op) => (
                <option value={op} key={op}>
                  {
                    {
                      eq: "等于",
                      ne: "不等于",
                      gt: "大于",
                      gte: "大于等于",
                      lt: "小于",
                      lte: "小于等于",
                    }[op]
                  }
                </option>
              ))}
            </select>
            <ScalarInput
              label={`条件 ${i + 1} 值`}
              type={variable?.type ?? "string"}
              value={condition.value}
              change={(value) =>
                patch({
                  conditions: c.conditions.map((x, j) =>
                    j === i ? { ...x, value } : x,
                  ),
                })
              }
            />
            <button
              aria-label={`删除条件 ${i + 1}`}
              onClick={() =>
                patch({ conditions: c.conditions.filter((_, j) => j !== i) })
              }
            >
              <Trash2 />
            </button>
          </div>
        );
      })}
      <button
        disabled={!variables.length}
        onClick={() =>
          patch({
            conditions: [
              ...c.conditions,
              {
                variable: variables[0].id,
                operator: "eq",
                value: variables[0].initial,
              },
            ],
          })
        }
      >
        <Plus />
        添加条件
      </button>
      {c.effects.map((effect, i) => {
        const variable = variables.find((v) => v.id === effect.variable);
        return (
          <div className="story-rule" key={i}>
            <select
              aria-label={`效果 ${i + 1} 变量`}
              value={effect.variable}
              onChange={(e) => {
                const v = variables.find((v) => v.id === e.target.value)!;
                patch({
                  effects: c.effects.map((x, j) =>
                    j === i
                      ? { variable: v.id, op: "set", value: v.initial }
                      : x,
                  ),
                });
              }}
            >
              {variables.map((v) => (
                <option value={v.id} key={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
            <select
              aria-label={`效果 ${i + 1} 操作`}
              value={effect.op}
              onChange={(e) =>
                patch({
                  effects: c.effects.map((x, j) =>
                    j === i
                      ? { ...x, op: e.target.value as typeof effect.op }
                      : x,
                  ),
                })
              }
            >
              <option value="set">设为</option>
              {variable?.type === "number" && (
                <option value="add">增加（可负数）</option>
              )}
            </select>
            <ScalarInput
              label={`效果 ${i + 1} 值`}
              type={variable?.type ?? "string"}
              value={effect.value}
              change={(value) =>
                patch({
                  effects: c.effects.map((x, j) =>
                    j === i ? { ...x, value } : x,
                  ),
                })
              }
            />
            <button
              aria-label={`删除效果 ${i + 1}`}
              onClick={() =>
                patch({ effects: c.effects.filter((_, j) => j !== i) })
              }
            >
              <Trash2 />
            </button>
          </div>
        );
      })}
      <div className="actions">
        <button
          disabled={!variables.length}
          onClick={() =>
            patch({
              effects: [
                ...c.effects,
                {
                  variable: variables[0].id,
                  op: "set",
                  value: variables[0].initial,
                },
              ],
            })
          }
        >
          <Plus />
          添加状态变化
        </button>
        <button className="danger" onClick={remove}>
          <Trash2 />
          删除选项
        </button>
      </div>
    </fieldset>
  );
}
function StoryPreview({
  story,
  data,
  open,
}: {
  story: Input<Story>;
  data: Snapshot;
  open?: (id: string, start?: number) => void;
}) {
  const [session, setSession] = useState<Session>(() => beginStory(story));
  const [error, setError] = useState("");
  const node = story.nodes.find((n) => n.id === session.nodeId)!;
  const media = data.media.find((m) => m.id === node.mediaId);
  const choices = storyChoices(story, session) as (StoryChoice & {
    available: boolean;
  })[];
  return (
    <div className="story-preview">
      <div className="story-preview-head">
        <span className="story-kind">
          {kindNames[node.kind]} ·{" "}
          {
            epistemics.find(
              ([key]) => key === (node.epistemic ?? "invented"),
            )?.[1]
          }{" "}
          · 第 {session.steps} 步
        </span>
        <button
          onClick={() => {
            setSession(beginStory(story));
            setError("");
          }}
        >
          <RotateCcw />
          重新开始
        </button>
      </div>
      <h2>{node.title}</h2>
      <p className="story-prose">{node.body}</p>
      {media && (
        <div className="story-preview-media" key={`${node.id}:${media.id}`}>
          {media.kind === "image" ? (
            <img src={window.cutbox!.mediaUrl(media.id)} alt={media.name} />
          ) : media.kind === "audio" ? (
            <audio
              controls
              src={window.cutbox!.mediaUrl(media.id)}
              onLoadedMetadata={(e) => {
                e.currentTarget.currentTime = node.start ?? 0;
              }}
              onPlay={(e) => {
                if (e.currentTarget.currentTime >= (node.end ?? media.duration))
                  e.currentTarget.currentTime = node.start ?? 0;
              }}
              onTimeUpdate={(e) => {
                if (e.currentTarget.currentTime < (node.start ?? 0))
                  e.currentTarget.currentTime = node.start ?? 0;
                if (
                  e.currentTarget.currentTime > (node.end ?? media.duration)
                ) {
                  e.currentTarget.pause();
                  e.currentTarget.currentTime = node.end ?? media.duration;
                }
              }}
            />
          ) : (
            <video
              controls
              src={window.cutbox!.mediaUrl(media.id)}
              onLoadedMetadata={(e) => {
                e.currentTarget.currentTime = node.start ?? 0;
              }}
              onPlay={(e) => {
                if (e.currentTarget.currentTime >= (node.end ?? media.duration))
                  e.currentTarget.currentTime = node.start ?? 0;
              }}
              onTimeUpdate={(e) => {
                if (e.currentTarget.currentTime < (node.start ?? 0))
                  e.currentTarget.currentTime = node.start ?? 0;
                if (
                  e.currentTarget.currentTime > (node.end ?? media.duration)
                ) {
                  e.currentTarget.pause();
                  e.currentTarget.currentTime = node.end ?? media.duration;
                }
              }}
            />
          )}
          <small>
            {media.name} · {time(node.start ?? 0)}–
            {time(node.end ?? media.duration)}
          </small>
          {open && <button onClick={() => open(media.id, node.start ?? 0)}>打开原片标注</button>}
        </div>
      )}
      {(node.eventIds ?? []).length > 0 && (
        <details>
          <summary>关联事件与证据</summary>
          {node.eventIds!.map((id) => {
            const event = data.events.find((e) => e.id === id);
            return event ? (
              <div key={id}>
                <strong>{event.name}</strong>
                <p>{event.description}</p>
                <Evidence ids={event.annotationIds} data={data} open={open} />
              </div>
            ) : null;
          })}
        </details>
      )}
      <div className="story-play-choices">
        {choices.map((c) => (
          <button
            key={c.id}
            disabled={!c.available}
            onClick={() => {
              try {
                setSession(chooseStory(story, session, c.id));
                setError("");
              } catch (e) {
                setError(message(e));
              }
            }}
          >
            <span>{c.label}</span>
            {!c.available && (
              <small>
                {session.steps >= 500 ? "达到 500 步上限" : "条件未满足"}
              </small>
            )}
            <ArrowRight />
          </button>
        ))}
      </div>
      {node.kind === "ending" && (
        <p role="status" className="story-ending">
          已到达结局。可以重新开始，探索其他选择。
        </p>
      )}
      {node.kind !== "ending" && !choices.some((c) => c.available) && (
        <p role="status" className="warning">
          当前没有可执行选项。检查条件、连线或预演步数上限。
        </p>
      )}
      {error && (
        <p role="alert" className="warning">
          {error}
        </p>
      )}
      <details className="story-runtime-state" open>
        <summary>本次预演状态 · 不写入原片数据</summary>
        {story.variables.length ? (
          <dl>
            {story.variables.map((v) => (
              <div key={v.id}>
                <dt>{v.name}</dt>
                <dd>{String(session.values[v.id])}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="muted">本故事没有状态变量。</p>
        )}
        {session.history.length > 0 && (
          <ol>
            {session.history.map((step, i) => (
              <li key={i}>
                {story.nodes.find((n) => n.id === step.from)?.title} →{" "}
                {story.nodes.find((n) => n.id === step.to)?.title}
              </li>
            ))}
          </ol>
        )}
      </details>
    </div>
  );
}
function StoryImport({
  data,
  mutate,
  close,
}: {
  data: Snapshot;
  mutate: Mutate;
  close: () => void;
}) {
  const [json, setJson] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Modal title="导入故事 JSON" onClose={() => !busy && close()}>
      <form
        className="story-form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          setError("");
          setBusy(true);
          try {
            const parsed = JSON.parse(json);
            if (parsed.schema && parsed.schema !== "cutbox.story/0.1")
              throw new Error("不支持的故事格式版本");
            const validated = validateStory(
              parsed.story ?? parsed,
              data,
            ) as Story;
            const {
              id: _id,
              createdAt: _created,
              updatedAt: _updated,
              ...input
            } = validated;
            if (await mutate(() => window.cutbox!.saveStory(input))) close();
          } catch (e) {
            setError(message(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        <p>
          粘贴 CutBox 导出的 JSON
          或故事对象，作为新故事导入。素材与事件引用必须已在当前项目中；跨项目迁移请使用包含素材的
          .cbox 包。
        </p>
        <label>
          故事 JSON
          <textarea
            aria-label="故事 JSON"
            required
            rows={14}
            value={json}
            onChange={(e) => setJson(e.target.value)}
            placeholder={'{"schema":"cutbox.story/0.1","story":{…}}'}
          />
        </label>
        {error && (
          <p role="alert" className="warning">
            {error}
          </p>
        )}
        <div className="actions">
          <button type="button" disabled={busy} onClick={close}>
            取消
          </button>
          <button className="primary" disabled={busy}>
            {busy ? "导入中…" : "验证并导入"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
