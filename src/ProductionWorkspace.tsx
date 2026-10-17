import { useState } from "react";
import {
  Plus,
  Pencil,
  Trash2,
  ArrowUp,
  ArrowDown,
  Download,
  ClipboardCheck,
  Clapperboard,
  ExternalLink,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import type {
  Snapshot,
  Production,
  ProductionShot,
  ProductionTake,
  Input,
} from "./types";
import { Modal, Empty, Thumb, time } from "./ui";
import "./production.css";
type Props = {
  data: Snapshot;
  mutate: (fn: () => Promise<Snapshot>) => Promise<boolean>;
  run: (fn: () => Promise<unknown>) => Promise<void>;
  open: (id: string, start?: number) => void;
};
const targets = {
  generic: "通用创作交接",
  seedance: "Seedance",
  libtv: "LibTV",
  tapnow: "TapNow",
};
const states = { draft: "草稿", review: "待审核", ready: "已就绪" };
const shotStates = {
  planned: "待生成",
  generated: "已生成",
  selected: "已选用",
};
const freshProduction = (): Input<Production> => ({
  name: "",
  description: "",
  status: "draft",
  target: "generic",
  aspectRatio: "16:9",
  entityIds: [],
  annotationIds: [],
  notes: "",
  shots: [],
});
const freshShot = (): ProductionShot => ({
  id: crypto.randomUUID(),
  name: "",
  description: "",
  duration: 5,
  status: "planned",
  entityIds: [],
  annotationIds: [],
  prompt: "",
  negativePrompt: "",
  continuity: "",
});
export function ProductionWorkspace({ data, mutate, run, open }: Props) {
  const [selectedId, setSelectedId] = useState<string>();
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<Input<Production> | null>(null);
  const [shotDraft, setShotDraft] = useState<ProductionShot | null>(null);
  const [remove, setRemove] = useState<Production>();
  const [removeShot, setRemoveShot] = useState<ProductionShot>();
  const [busy, setBusy] = useState(false);
  const [audit, setAudit] =
    useState<
      Awaited<ReturnType<NonNullable<typeof window.cutbox>["productionAudit"]>>
    >();
  const [auditError, setAuditError] = useState("");
  const [includeClips, setIncludeClips] = useState(true);
  const [cropRegions, setCropRegions] = useState(false);
  const [activeShot, setActiveShot] = useState<string>();
  const productions = data.productions || [];
  const selected =
    productions.find((p) => p.id === selectedId) || productions[0];
  const filtered = productions.filter((p) =>
    `${p.name} ${p.description}`.toLowerCase().includes(query.toLowerCase()),
  );
  const currentShot =
    selected?.shots.find((s) => s.id === activeShot) || selected?.shots[0];
  async function saveProject(input: Input<Production>) {
    setBusy(true);
    try {
      const before = new Set(productions.map((p) => p.id));
      const saved = await mutate(async () => {
        const next = await window.cutbox!.saveProduction(input);
        if (!input.id)
          setSelectedId(next.productions.find((p) => !before.has(p.id))?.id);
        return next;
      });
      if (saved) {
        setDraft(null);
        setAudit(undefined);
      }
    } finally {
      setBusy(false);
    }
  }
  async function saveShot(shot: ProductionShot) {
    if (!selected) return;
    setBusy(true);
    try {
      const exists = selected.shots.some((s) => s.id === shot.id);
      if (
        await mutate(() =>
          window.cutbox!.saveProduction({
            ...selected,
            shots: exists
              ? selected.shots.map((s) => (s.id === shot.id ? shot : s))
              : [...selected.shots, shot],
          }),
        )
      ) {
        setShotDraft(null);
        setActiveShot(shot.id);
        setAudit(undefined);
      }
    } finally {
      setBusy(false);
    }
  }
  async function reorder(index: number, offset: number) {
    if (!selected) return;
    const shots = [...selected.shots];
    [shots[index], shots[index + offset]] = [
      shots[index + offset],
      shots[index],
    ];
    setBusy(true);
    try {
      if (
        await mutate(() =>
          window.cutbox!.saveProduction({ ...selected, shots }),
        )
      )
        setAudit(undefined);
    } finally {
      setBusy(false);
    }
  }
  async function assistPrompt(shot: ProductionShot) {
    if (!selected) return;
    setBusy(true);
    setAuditError("");
    try {
      const result = await window.cutbox!.draftShotPrompt({
        productionId: selected.id,
        shotId: shot.id,
      });
      setShotDraft({
        ...structuredClone(shot),
        prompt: result.prompt,
        negativePrompt: result.negativePrompt,
      });
    } catch (error) {
      setAuditError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }
  async function inspect() {
    if (!selected) return;
    setBusy(true);
    setAuditError("");
    try {
      setAudit(await window.cutbox!.productionAudit(selected.id));
    } catch (error) {
      setAuditError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="production-workspace">
      <div className="toolbar">
        <p className="muted">从已整理的资产与证据，准备可交付的镜头计划。</p>
        <button className="primary" onClick={() => setDraft(freshProduction())}>
          <Plus />
          新建制作项目
        </button>
      </div>
      <p className="production-local-note">
        输出本地创作交接文件。目标名称用于组织交付内容，不代表已连接厂商 API
        或获得格式兼容认证。
      </p>
      {productions.length === 0 ? (
        <Empty
          title="把参考变成下一次创作的准备"
          description="建立制作项目，选取角色、场景与证据，再逐镜头整理提示、连续性与生成结果。"
        />
      ) : (
        <div className="production-layout">
          <aside className="production-projects">
            <input
              aria-label="搜索制作项目"
              placeholder="搜索制作项目"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {filtered.map((p) => (
              <button
                key={p.id}
                className={selected?.id === p.id ? "selected" : ""}
                onClick={() => {
                  setSelectedId(p.id);
                  setActiveShot(undefined);
                  setAudit(undefined);
                  setAuditError("");
                }}
              >
                <strong>{p.name}</strong>
                <span>
                  {targets[p.target]} · {p.aspectRatio}
                </span>
                <small>
                  {p.shots.length} 个镜头 · {states[p.status]}
                </small>
              </button>
            ))}
            {filtered.length === 0 && (
              <p className="muted">没有匹配的制作项目。</p>
            )}
          </aside>
          {selected && (
            <section className="production-detail">
              <div className="production-heading">
                <div>
                  <h2>{selected.name}</h2>
                  <p>{selected.description || "尚未填写项目说明"}</p>
                  <span>
                    {targets[selected.target]} · {selected.aspectRatio} ·{" "}
                    {states[selected.status]}
                  </span>
                </div>
                <div className="actions">
                  <button onClick={() => setDraft(structuredClone(selected))}>
                    <Pencil />
                    编辑项目
                  </button>
                  <button
                    className="icon danger"
                    aria-label="删除制作项目"
                    onClick={() => setRemove(selected)}
                  >
                    <Trash2 />
                  </button>
                </div>
              </div>
              <div className="production-reference-strip">
                <details>
                  <summary>项目资产 · {selected.entityIds.length}</summary>
                  <ReferenceLinks
                    data={data}
                    entityIds={selected.entityIds}
                    annotationIds={[]}
                    open={open}
                  />
                </details>
                <details>
                  <summary>项目证据 · {selected.annotationIds.length}</summary>
                  <ReferenceLinks
                    data={data}
                    entityIds={[]}
                    annotationIds={selected.annotationIds}
                    open={open}
                  />
                </details>
                {selected.notes && (
                  <details>
                    <summary>制作说明</summary>
                    <p className="preserve">{selected.notes}</p>
                  </details>
                )}
              </div>
              <div className="production-delivery">
                <div className="actions">
                  <button disabled={busy} onClick={() => void inspect()}>
                    <ClipboardCheck />
                    检查交付准备
                  </button>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={includeClips}
                      onChange={(e) => setIncludeClips(e.target.checked)}
                    />
                    携带参考片段
                  </label>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={cropRegions}
                      disabled={!includeClips}
                      onChange={(e) => setCropRegions(e.target.checked)}
                    />
                    按标注区域裁切
                  </label>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void run(() =>
                        window.cutbox!.exportProduction({
                          productionId: selected.id,
                          includeClips,
                          cropRegions: includeClips && cropRegions,
                        }),
                      )
                    }
                  >
                    <Download />
                    导出创作交接包
                  </button>
                </div>
                <p className="fine">
                  包含项目描述、镜头计划、提示与来源清单；导出前校验真实引用。勾选片段会增加本地处理时间和磁盘占用。
                </p>
                {auditError && (
                  <p className="warning" role="alert">
                    {auditError}
                  </p>
                )}
                {audit && (
                  <ProductionAuditView
                    report={audit}
                    onShot={(id) => {
                      setActiveShot(id);
                      requestAnimationFrame(() =>
                        document
                          .querySelector(".production-shot-detail")
                          ?.scrollIntoView({
                            behavior: "smooth",
                            block: "start",
                          }),
                      );
                    }}
                  />
                )}
              </div>
              <div className="section-heading">
                <h3>
                  镜头计划{" "}
                  <span>
                    {selected.shots.length} 个 ·{" "}
                    {selected.shots
                      .reduce((sum, s) => sum + s.duration, 0)
                      .toFixed(1)}{" "}
                    秒计划时长
                  </span>
                </h3>
                <button onClick={() => setShotDraft(freshShot())}>
                  <Plus />
                  添加镜头
                </button>
              </div>
              {selected.shots.length === 0 ? (
                <Empty
                  title="从第一个镜头开始"
                  description="给镜头安排时长、参考与创作意图，逐步补充提示和连续性要求。"
                />
              ) : (
                <>
                  <ol className="production-shots">
                    {selected.shots.map((shot, index) => (
                      <li
                        key={shot.id}
                        className={
                          currentShot?.id === shot.id ? "selected" : ""
                        }
                      >
                        <button
                          className="production-shot-select"
                          onClick={() => setActiveShot(shot.id)}
                        >
                          <span className="production-shot-number">
                            {String(index + 1).padStart(2, "0")}
                          </span>
                          <div>
                            <strong>{shot.name}</strong>
                            <small>
                              {shot.duration} 秒 · {shotStates[shot.status]} ·{" "}
                              {shot.annotationIds.length} 条证据
                            </small>
                          </div>
                        </button>
                        <div className="actions">
                          <button
                            className="icon"
                            aria-label={`上移镜头 ${shot.name}`}
                            disabled={busy || index === 0}
                            onClick={() => void reorder(index, -1)}
                          >
                            <ArrowUp />
                          </button>
                          <button
                            className="icon"
                            aria-label={`下移镜头 ${shot.name}`}
                            disabled={
                              busy || index === selected.shots.length - 1
                            }
                            onClick={() => void reorder(index, 1)}
                          >
                            <ArrowDown />
                          </button>
                          <button
                            className="icon"
                            aria-label={`编辑镜头 ${shot.name}`}
                            onClick={() => setShotDraft(structuredClone(shot))}
                          >
                            <Pencil />
                          </button>
                          <button
                            className="icon danger"
                            aria-label={`删除镜头 ${shot.name}`}
                            onClick={() => setRemoveShot(shot)}
                          >
                            <Trash2 />
                          </button>
                        </div>
                      </li>
                    ))}
                  </ol>
                  {currentShot && (
                    <ShotDetail
                      shot={currentShot}
                      data={data}
                      open={open}
                      onEdit={() => setShotDraft(structuredClone(currentShot))}
                      onAssist={() => void assistPrompt(currentShot)}
                      busy={busy}
                    />
                  )}
                </>
              )}
            </section>
          )}
        </div>
      )}
      {draft && (
        <ProjectEditor
          draft={draft}
          setDraft={setDraft}
          data={data}
          busy={busy}
          onSave={saveProject}
          onClose={() => !busy && setDraft(null)}
        />
      )}{" "}
      {shotDraft && selected && (
        <ShotEditor
          shot={shotDraft}
          setShot={setShotDraft}
          production={selected}
          data={data}
          busy={busy}
          onSave={saveShot}
          onClose={() => !busy && setShotDraft(null)}
        />
      )}{" "}
      {remove && (
        <Modal
          title="删除制作项目"
          onClose={() => !busy && setRemove(undefined)}
        >
          <p>
            删除「{remove.name}」及其镜头计划？关联的资产、标注和媒体会保留。
          </p>
          <div className="modal-actions">
            <button disabled={busy} onClick={() => setRemove(undefined)}>
              取消
            </button>
            <button
              className="danger"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  if (
                    await mutate(() =>
                      window.cutbox!.deleteProduction(remove.id),
                    )
                  ) {
                    setRemove(undefined);
                    setSelectedId(undefined);
                    setAudit(undefined);
                  }
                } finally {
                  setBusy(false);
                }
              }}
            >
              确认删除项目
            </button>
          </div>
        </Modal>
      )}{" "}
      {removeShot && selected && (
        <Modal
          title="删除镜头"
          onClose={() => !busy && setRemoveShot(undefined)}
        >
          <p>从镜头计划中删除「{removeShot.name}」？素材与证据不会被删除。</p>
          <div className="modal-actions">
            <button disabled={busy} onClick={() => setRemoveShot(undefined)}>
              取消
            </button>
            <button
              className="danger"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  if (
                    await mutate(() =>
                      window.cutbox!.saveProduction({
                        ...selected,
                        shots: selected.shots.filter(
                          (s) => s.id !== removeShot.id,
                        ),
                      }),
                    )
                  ) {
                    setRemoveShot(undefined);
                    setAudit(undefined);
                  }
                } finally {
                  setBusy(false);
                }
              }}
            >
              确认删除镜头
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
function ReferencePicker({
  data,
  entityIds,
  annotationIds,
  onChange,
  prefix,
}: {
  data: Snapshot;
  entityIds: string[];
  annotationIds: string[];
  onChange: (value: { entityIds: string[]; annotationIds: string[] }) => void;
  prefix: string;
}) {
  const [query, setQuery] = useState("");
  const entities = data.entities.filter((e) =>
    `${e.name} ${e.tags.join(" ")}`.toLowerCase().includes(query.toLowerCase()),
  );
  const annotations = data.annotations.filter((a) =>
    `${a.label} ${a.notes}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <fieldset className="production-picker">
      <legend>{prefix}资产与证据</legend>
      <input
        aria-label={`${prefix}参考筛选`}
        placeholder="筛选资产名称或证据描述"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="production-picker-columns">
        <div>
          <h4>资产 · 已选 {entityIds.length}</h4>
          <div className="checks">
            {entities.map((e) => (
              <label className="check" key={e.id}>
                <input
                  type="checkbox"
                  aria-label={`${prefix}资产 ${e.name}`}
                  checked={entityIds.includes(e.id)}
                  onChange={(event) =>
                    onChange({
                      entityIds: event.target.checked
                        ? [...entityIds, e.id]
                        : entityIds.filter((id) => id !== e.id),
                      annotationIds,
                    })
                  }
                />
                <span>{e.name}</span>
                <small>{e.type}</small>
              </label>
            ))}
            {entities.length === 0 && (
              <p className="fine">没有匹配的资产，可先创建纯文本计划。</p>
            )}
          </div>
        </div>
        <div>
          <h4>证据 · 已选 {annotationIds.length}</h4>
          <div className="checks">
            {annotations.map((a) => (
              <label className="check" key={a.id}>
                <input
                  type="checkbox"
                  aria-label={`${prefix}证据 ${a.label}`}
                  checked={annotationIds.includes(a.id)}
                  onChange={(event) =>
                    onChange({
                      entityIds,
                      annotationIds: event.target.checked
                        ? [...annotationIds, a.id]
                        : annotationIds.filter((id) => id !== a.id),
                    })
                  }
                />
                <span>
                  {a.label}
                  <small>
                    {time(a.start)}–{time(a.end)} ·{" "}
                    {a.reviewState === "accepted" ? "已审核" : "待审核"}
                  </small>
                </span>
              </label>
            ))}
            {annotations.length === 0 && (
              <p className="fine">没有匹配的证据。</p>
            )}
          </div>
        </div>
      </div>
    </fieldset>
  );
}
function ProjectEditor({
  draft,
  setDraft,
  data,
  busy,
  onSave,
  onClose,
}: {
  draft: Input<Production>;
  setDraft: (value: Input<Production>) => void;
  data: Snapshot;
  busy: boolean;
  onSave: (value: Input<Production>) => Promise<void>;
  onClose: () => void;
}) {
  return (
    <Modal title={draft.id ? "编辑制作项目" : "新建制作项目"} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void onSave(draft);
        }}
      >
        <label>
          项目名称
          <input
            required
            maxLength={160}
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
        </label>
        <label>
          项目说明
          <textarea
            aria-label="项目说明"
            rows={3}
            value={draft.description}
            onChange={(e) =>
              setDraft({ ...draft, description: e.target.value })
            }
          />
        </label>
        <div className="field-pair">
          <label>
            交付目标
            <select
              value={draft.target}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  target: e.target.value as Production["target"],
                })
              }
            >
              {Object.entries(targets).map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            画幅比例
            <select
              value={draft.aspectRatio}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  aspectRatio: e.target.value as Production["aspectRatio"],
                })
              }
            >
              {["16:9", "9:16", "1:1", "4:3"].map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
          </label>
        </div>
        <label>
          项目状态
          <select
            value={draft.status}
            onChange={(e) =>
              setDraft({
                ...draft,
                status: e.target.value as Production["status"],
              })
            }
          >
            {Object.entries(states).map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <p className="fine">
          “已就绪”需要至少一个镜头，且每个镜头都有提示内容；它不代表第三方平台已接受交付。
        </p>
        <ReferencePicker
          data={data}
          entityIds={draft.entityIds}
          annotationIds={draft.annotationIds}
          prefix="项目"
          onChange={(refs) => setDraft({ ...draft, ...refs })}
        />
        <label>
          制作说明 / 共用约束
          <textarea
            aria-label="制作说明 / 共用约束"
            rows={3}
            value={draft.notes}
            onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
          />
        </label>
        <div className="modal-actions">
          <button type="button" disabled={busy} onClick={onClose}>
            取消
          </button>
          <button className="primary" disabled={busy || !draft.name.trim()}>
            {busy ? "保存中…" : "保存制作项目"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
function ShotEditor({
  shot,
  setShot,
  production,
  data,
  busy,
  onSave,
  onClose,
}: {
  shot: ProductionShot;
  setShot: (shot: ProductionShot) => void;
  production: Production;
  data: Snapshot;
  busy: boolean;
  onSave: (shot: ProductionShot) => Promise<void>;
  onClose: () => void;
}) {
  return (
    <Modal
      title={
        production.shots.some((s) => s.id === shot.id) ? "编辑镜头" : "添加镜头"
      }
      onClose={onClose}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void onSave(shot);
        }}
      >
        <label>
          镜头名称
          <input
            required
            maxLength={160}
            value={shot.name}
            onChange={(e) => setShot({ ...shot, name: e.target.value })}
          />
        </label>
        <label>
          镜头意图
          <textarea
            aria-label="镜头意图"
            rows={2}
            value={shot.description}
            onChange={(e) => setShot({ ...shot, description: e.target.value })}
          />
        </label>
        <div className="field-pair">
          <label>
            计划时长（秒）
            <input
              type="number"
              required
              min="0.001"
              max="600"
              step="any"
              value={shot.duration}
              onChange={(e) =>
                setShot({ ...shot, duration: Number(e.target.value) })
              }
            />
          </label>
          <label>
            镜头状态
            <select
              value={shot.status}
              onChange={(e) =>
                setShot({
                  ...shot,
                  status: e.target.value as ProductionShot["status"],
                })
              }
            >
              {Object.entries(shotStates).map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label>
          生成提示
          <textarea
            aria-label="生成提示"
            rows={5}
            value={shot.prompt}
            placeholder="主体、动作、场景、机位、光线与声音要求…"
            onChange={(e) => setShot({ ...shot, prompt: e.target.value })}
          />
        </label>
        <label>
          避免内容 / 负面提示
          <textarea
            aria-label="避免内容 / 负面提示"
            rows={2}
            value={shot.negativePrompt}
            onChange={(e) =>
              setShot({ ...shot, negativePrompt: e.target.value })
            }
          />
        </label>
        <label>
          连续性约束
          <textarea
            aria-label="连续性约束"
            rows={3}
            value={shot.continuity}
            placeholder="与前后镜头保持一致的服装、位置、视线、道具和声音…"
            onChange={(e) => setShot({ ...shot, continuity: e.target.value })}
          />
        </label>
        <button
          type="button"
          onClick={() =>
            setShot({
              ...shot,
              entityIds: [
                ...new Set([...shot.entityIds, ...production.entityIds]),
              ],
              annotationIds: [
                ...new Set([
                  ...shot.annotationIds,
                  ...production.annotationIds,
                ]),
              ],
            })
          }
        >
          加入项目参考
        </button>
        <ReferencePicker
          data={data}
          entityIds={shot.entityIds}
          annotationIds={shot.annotationIds}
          prefix="镜头"
          onChange={(refs) => setShot({ ...shot, ...refs })}
        />
        <TakeFields
          shot={shot}
          setShot={setShot}
          data={data}
          target={production.target}
        />
        <label>
          关联生成结果
          <select
            value={shot.outputMediaId || ""}
            required={shot.status === "selected"}
            onChange={(e) =>
              setShot({ ...shot, outputMediaId: e.target.value || undefined })
            }
          >
            <option value="">尚未关联</option>
            {data.media.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        <p className="fine">
          先把外部生成结果导入素材库，再在这里关联。选用状态必须关联一个实际媒体文件。
        </p>
        <div className="modal-actions">
          <button type="button" disabled={busy} onClick={onClose}>
            取消
          </button>
          <button className="primary" disabled={busy || !shot.name.trim()}>
            {busy ? "保存中…" : "保存镜头"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
function ReferenceLinks({
  data,
  entityIds,
  annotationIds,
  open,
}: {
  data: Snapshot;
  entityIds: string[];
  annotationIds: string[];
  open: (id: string, start?: number) => void;
}) {
  return (
    <div className="production-reference-links">
      {entityIds.map((id) => {
        const entity = data.entities.find((e) => e.id === id);
        if (!entity)
          return (
            <p key={id} className="warning">
              缺少资产 {id}
            </p>
          );
        const media = data.media.find(
          (m) => m.id === (entity.coverMediaId || entity.mediaIds[0]),
        );
        return (
          <div className="production-entity-reference" key={id}>
            <div className="production-tiny-thumb">
              <Thumb media={media} />
            </div>
            <span>{entity.name}</span>
            {media ? (
              <button
                className="icon"
                aria-label={`查看资产参考 ${entity.name}`}
                onClick={() => open(media.id)}
              >
                <ExternalLink />
              </button>
            ) : (
              <small>无源素材</small>
            )}
          </div>
        );
      })}
      {annotationIds.map((id) => {
        const annotation = data.annotations.find((a) => a.id === id);
        return annotation ? (
          <button
            className="source-row"
            key={id}
            onClick={() => open(annotation.mediaId, annotation.start)}
          >
            <ExternalLink />
            <span>
              {annotation.label}
              <small>
                {time(annotation.start)}–{time(annotation.end)} ·{" "}
                {annotation.epistemic === "invented"
                  ? "创作设定"
                  : annotation.epistemic === "interpreted"
                    ? "解释推断"
                    : "原片观察"}
              </small>
            </span>
          </button>
        ) : (
          <p key={id} className="warning">
            缺少证据 {id}
          </p>
        );
      })}
    </div>
  );
}
function ShotDetail({
  shot,
  data,
  open,
  onEdit,
  onAssist,
  busy,
}: {
  shot: ProductionShot;
  data: Snapshot;
  open: (id: string, start?: number) => void;
  onEdit: () => void;
  onAssist: () => void;
  busy: boolean;
}) {
  const output = data.media.find((m) => m.id === shot.outputMediaId);
  return (
    <div className="production-shot-detail">
      <div className="section-heading">
        <h3>
          <Clapperboard size={18} />
          {shot.name}
        </h3>
        <div className="actions">
          <button disabled={busy} onClick={onAssist}>
            从证据起草提示
          </button>
          <button onClick={onEdit}>
            <Pencil />
            编辑当前镜头
          </button>
        </div>
      </div>
      {shot.description && <p>{shot.description}</p>}
      <div className="production-shot-columns">
        <div>
          <h4>生成提示</h4>
          <p className="fine">
            从证据起草只生成可编辑草稿，保存前不会覆盖当前计划。
          </p>
          <p className="preserve">{shot.prompt || "尚未填写提示"}</p>
          {shot.negativePrompt && (
            <>
              <h4>避免内容</h4>
              <p className="preserve">{shot.negativePrompt}</p>
            </>
          )}
          {shot.continuity && (
            <>
              <h4>连续性</h4>
              <p className="preserve">{shot.continuity}</p>
            </>
          )}
        </div>
        <div>
          <h4>镜头参考</h4>
          <ReferenceLinks
            data={data}
            entityIds={shot.entityIds}
            annotationIds={shot.annotationIds}
            open={open}
          />
          {shot.entityIds.length === 0 && shot.annotationIds.length === 0 && (
            <p className="fine">没有引用原片证据；当前为纯文本创作计划。</p>
          )}
        </div>
      </div>
      {(shot.takes || []).length > 0 && (
        <details className="production-take-history">
          <summary>生成候选记录 · {shot.takes!.length}</summary>
          {shot.takes!.map((t) => (
            <div key={t.id}>
              <strong>
                {data.media.find((m) => m.id === t.mediaId)?.name || "缺少媒体"}
              </strong>
              <p>
                {t.provider || "未填写平台"} · {t.model || "未填写模型"}
                {t.seed ? ` · Seed ${t.seed}` : ""}
                {shot.outputMediaId === t.mediaId ? " · 此媒体已选用" : ""}
              </p>
              <small>记录时间：{new Date(t.createdAt).toLocaleString()}</small>
              {t.externalTaskId && <small>外部任务：{t.externalTaskId}</small>}
              <details>
                <summary>实际提示与备注</summary>
                <p className="preserve">{t.prompt || "未记录实际提示"}</p>
                {t.negativePrompt && (
                  <p className="preserve">避免内容：{t.negativePrompt}</p>
                )}
                {t.notes && <p className="preserve">{t.notes}</p>}
              </details>
              <button onClick={() => open(t.mediaId)}>查看候选素材</button>
            </div>
          ))}
        </details>
      )}
      {output && (
        <div className="production-take">
          <div className="section-heading">
            <h4>关联结果 · {output.name}</h4>
            <button onClick={() => open(output.id)}>
              <ExternalLink />
              回到素材
            </button>
          </div>
          {output.kind === "video" ? (
            <video
              controls
              preload="metadata"
              src={window.cutbox!.mediaUrl(output.id)}
            />
          ) : output.kind === "audio" ? (
            <audio controls src={window.cutbox!.mediaUrl(output.id)} />
          ) : (
            <img src={window.cutbox!.mediaUrl(output.id)} alt={output.name} />
          )}
        </div>
      )}
    </div>
  );
}
function ProductionAuditView({
  report,
  onShot,
}: {
  report: Awaited<
    ReturnType<NonNullable<typeof window.cutbox>["productionAudit"]>
  >;
  onShot: (id: string) => void;
}) {
  return (
    <div className="production-audit">
      <div
        className={`audit-heading ${report.status === "ready" ? "ready" : "warning"}`}
      >
        {report.status === "ready" ? (
          <CheckCircle2 size={18} />
        ) : (
          <AlertCircle size={18} />
        )}
        <strong>
          {
            {
              blocked: "存在交付阻塞",
              needs_review: "仍需人工审核",
              ready: "描述与引用已就绪",
            }[report.status]
          }
        </strong>
      </div>
      <p>
        {report.summary.shots} 个镜头 · {report.summary.readyShots} 个镜头已准备
        · {report.summary.referenceAnnotations} 条参考 ·{" "}
        {report.summary.linkedOutputs} 个关联结果
      </p>
      <p className="fine">
        此处检查描述与引用关系。源文件是否存在、内容是否变化，会在实际导出时再次校验。
      </p>
      {report.issues.length > 0 ? (
        <ul>
          {report.issues.map((issue, i) => (
            <li key={`${issue.code}-${i}`}>
              <span className={issue.severity === "error" ? "warning" : ""}>
                {issue.severity === "error"
                  ? "阻塞"
                  : issue.severity === "warning"
                    ? "待检查"
                    : "提示"}{" "}
                · {issue.message}
              </span>
              {issue.shotId && (
                <button
                  className="production-audit-jump"
                  onClick={() => onShot(issue.shotId!)}
                >
                  查看镜头
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p>未发现描述或引用问题。</p>
      )}
      {report.coverage.length > 0 && (
        <details>
          <summary>资产参考覆盖</summary>
          <div className="production-coverage">
            {report.coverage.map((item) => (
              <div key={item.entityId}>
                <strong>{item.name}</strong>
                <span>
                  {item.acceptedCount} / {item.referenceCount} 条已审核
                </span>
                <small>{item.categories.join(" · ") || "尚无类别证据"}</small>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function TakeFields({
  shot,
  setShot,
  data,
  target,
}: {
  shot: ProductionShot;
  setShot: (value: ProductionShot) => void;
  data: Snapshot;
  target: Production["target"];
}) {
  function update(id: string, patch: Partial<ProductionTake>) {
    setShot({
      ...shot,
      takes: (shot.takes || []).map((t) =>
        t.id === id ? { ...t, ...patch } : t,
      ),
    });
  }
  return (
    <fieldset className="production-take-fields">
      <legend>生成候选与参数记录</legend>
      <p className="fine">
        记录已导入的真实候选文件及实际使用的参数；此处不会发起生成请求。记录时间由本地创建，不代表厂商生成时间。
      </p>
      {(shot.takes || []).map((take, i) => (
        <details key={take.id} open>
          <summary>
            候选 {i + 1} ·{" "}
            {data.media.find((m) => m.id === take.mediaId)?.name ||
              "请选择媒体"}
          </summary>
          <label>
            候选 {i + 1} 媒体
            <select
              required
              value={take.mediaId}
              onChange={(e) => update(take.id, { mediaId: e.target.value })}
            >
              <option value="">请选择已导入结果</option>
              {data.media.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
          <div className="field-pair">
            <label>
              候选 {i + 1} 平台
              <input
                value={take.provider}
                onChange={(e) => update(take.id, { provider: e.target.value })}
              />
            </label>
            <label>
              候选 {i + 1} 模型
              <input
                value={take.model}
                onChange={(e) => update(take.id, { model: e.target.value })}
              />
            </label>
            <label>
              候选 {i + 1} Seed
              <input
                maxLength={100}
                placeholder="未知则留空"
                value={take.seed || ""}
                onChange={(e) =>
                  update(take.id, { seed: e.target.value || undefined })
                }
              />
            </label>
            <label>
              候选 {i + 1} 外部任务 ID
              <input
                value={take.externalTaskId || ""}
                onChange={(e) =>
                  update(take.id, {
                    externalTaskId: e.target.value || undefined,
                  })
                }
              />
            </label>
          </div>
          <label>
            候选 {i + 1} 实际提示
            <textarea
              aria-label={`候选 ${i + 1} 实际提示`}
              rows={3}
              value={take.prompt}
              onChange={(e) => update(take.id, { prompt: e.target.value })}
            />
          </label>
          <label>
            候选 {i + 1} 实际负面提示
            <textarea
              aria-label={`候选 ${i + 1} 实际负面提示`}
              rows={2}
              value={take.negativePrompt}
              onChange={(e) =>
                update(take.id, { negativePrompt: e.target.value })
              }
            />
          </label>
          <label>
            候选 {i + 1} 备注
            <textarea
              aria-label={`候选 ${i + 1} 备注`}
              rows={2}
              value={take.notes}
              onChange={(e) => update(take.id, { notes: e.target.value })}
            />
          </label>
          <div className="actions">
            <button
              type="button"
              disabled={!take.mediaId}
              onClick={() =>
                setShot({
                  ...shot,
                  outputMediaId: take.mediaId,
                  status: "selected",
                })
              }
            >
              选用候选 {i + 1}
            </button>
            <button
              type="button"
              onClick={() =>
                setShot({
                  ...shot,
                  takes: (shot.takes || []).filter((t) => t.id !== take.id),
                  ...(shot.outputMediaId === take.mediaId
                    ? { outputMediaId: undefined, status: "planned" as const }
                    : {}),
                })
              }
            >
              移除候选 {i + 1}
            </button>
          </div>
        </details>
      ))}
      <button
        type="button"
        onClick={() =>
          setShot({
            ...shot,
            takes: [
              ...(shot.takes || []),
              {
                id: crypto.randomUUID(),
                mediaId: "",
                provider: target === "generic" ? "" : targets[target],
                model: "",
                prompt: "",
                negativePrompt: "",
                notes: "",
                createdAt: new Date().toISOString(),
              },
            ],
          })
        }
      >
        添加生成候选
      </button>
    </fieldset>
  );
}
