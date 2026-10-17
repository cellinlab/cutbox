import { useState } from "react";
import { Plus, Trash2, Pencil } from "lucide-react";
import { Modal, Empty } from "./ui";
import type { Snapshot, Template, Input, TemplateField, Scalar } from "./types";
export function TypedFields({
  fields,
  values,
  onChange,
}: {
  fields: TemplateField[];
  values: Record<string, Scalar>;
  onChange: (value: Record<string, Scalar>) => void;
}) {
  return (
    <>
      {fields.map((f) => (
        <label key={f.key}>
          {f.label}
          {f.unit ? `（${f.unit}）` : ""}
          {f.required ? " *" : ""}
          {f.type === "boolean" ? (
            <select
              required={f.required}
              value={values[f.key] === undefined ? "" : String(values[f.key])}
              onChange={(e) => {
                const next = { ...values };
                if (e.target.value === "") delete next[f.key];
                else next[f.key] = e.target.value === "true";
                onChange(next);
              }}
            >
              <option value="">请选择</option>
              <option value="true">是</option>
              <option value="false">否</option>
            </select>
          ) : f.type === "select" ? (
            <select
              required={f.required}
              value={String(values[f.key] ?? "")}
              onChange={(e) => onChange({ ...values, [f.key]: e.target.value })}
            >
              <option value="">请选择</option>
              {f.options?.map((option) => (
                <option key={option}>{option}</option>
              ))}
            </select>
          ) : (
            <input
              required={f.required}
              type={f.type === "number" ? "number" : "text"}
              step={f.type === "number" ? "any" : undefined}
              value={String(values[f.key] ?? "")}
              onChange={(e) => {
                const next = { ...values };
                if (e.target.value === "") delete next[f.key];
                else
                  next[f.key] =
                    f.type === "number"
                      ? Number(e.target.value)
                      : e.target.value;
                onChange(next);
              }}
            />
          )}
        </label>
      ))}
    </>
  );
}
export function Templates({
  data,
  mutate,
}: {
  data: Snapshot;
  mutate: (fn: () => Promise<Snapshot>) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState<Input<Template> | null>(null);
  const [busy, setBusy] = useState(false);
  function field(index: number, patch: Partial<TemplateField>) {
    if (draft)
      setDraft({
        ...draft,
        fields: draft.fields.map((f, i) =>
          i === index ? { ...f, ...patch } : f,
        ),
      });
  }
  return (
    <>
      <div className="toolbar">
        <p className="muted">为服装、镜头、声音与训练任务定义可复用的字段。</p>
        <button
          className="primary"
          onClick={() => setDraft({ name: "", description: "", fields: [] })}
        >
          <Plus />
          新建模板
        </button>
      </div>
      {!data.templates?.length ? (
        <Empty
          title="按你的工作方式定义标注"
          description="文本、数字、布尔值和选项字段，保留明确的数据类型。"
        />
      ) : (
        <div className="collection-list">
          {data.templates.map((t) => (
            <article key={t.id}>
              <div className="grow">
                <h2>{t.name}</h2>
                <p>{t.description}</p>
                <small>
                  {t.fields.map((f) => `${f.label} (${f.type})`).join(" · ")}
                </small>
              </div>
              <button onClick={() => setDraft(t)}>
                <Pencil />
                编辑
              </button>
              <button
                className="icon danger"
                aria-label={`删除模板 ${t.name}`}
                onClick={() => {
                  if (confirm("删除模板？已关联的标注可能阻止此操作。"))
                    void mutate(() => window.cutbox!.deleteTemplate(t.id));
                }}
              >
                <Trash2 />
              </button>
            </article>
          ))}
        </div>
      )}
      {draft && (
        <Modal
          title={draft.id ? "编辑模板" : "新建模板"}
          onClose={() => !busy && setDraft(null)}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              try {
                if (await mutate(() => window.cutbox!.saveTemplate(draft)))
                  setDraft(null);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              模板名称
              <input
                required
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </label>
            <label>
              模板说明
              <textarea
                value={draft.description}
                onChange={(e) =>
                  setDraft({ ...draft, description: e.target.value })
                }
              />
            </label>
            {draft.fields.map((f, i) => (
              <fieldset key={i}>
                <legend>字段 {i + 1}</legend>
                <div className="field-pair">
                  <label>
                    标识键
                    <input
                      required
                      pattern="[A-Za-z_][A-Za-z0-9_]*"
                      value={f.key}
                      onChange={(e) => field(i, { key: e.target.value })}
                    />
                  </label>
                  <label>
                    显示名称
                    <input
                      required
                      value={f.label}
                      onChange={(e) => field(i, { label: e.target.value })}
                    />
                  </label>
                  <label>
                    类型
                    <select
                      value={f.type}
                      onChange={(e) =>
                        field(i, {
                          type: e.target.value as TemplateField["type"],
                        })
                      }
                    >
                      <option value="text">文本</option>
                      <option value="number">数字</option>
                      <option value="boolean">是 / 否</option>
                      <option value="select">单选</option>
                    </select>
                  </label>
                  <label>
                    单位
                    <input
                      value={f.unit || ""}
                      onChange={(e) => field(i, { unit: e.target.value })}
                    />
                  </label>
                </div>
                {f.type === "select" && (
                  <label>
                    可选值（每行一个）
                    <textarea
                      required
                      value={(f.options || []).join("\n")}
                      onChange={(e) =>
                        field(i, { options: e.target.value.split("\n") })
                      }
                    />
                  </label>
                )}
                <div className="actions">
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={f.required || false}
                      onChange={(e) => field(i, { required: e.target.checked })}
                    />
                    必填
                  </label>
                  <button
                    type="button"
                    onClick={() =>
                      setDraft({
                        ...draft,
                        fields: draft.fields.filter((_, n) => n !== i),
                      })
                    }
                  >
                    移除字段
                  </button>
                </div>
              </fieldset>
            ))}
            <button
              type="button"
              onClick={() =>
                setDraft({
                  ...draft,
                  fields: [
                    ...draft.fields,
                    {
                      key: `field_${draft.fields.length + 1}`,
                      label: "",
                      type: "text",
                    },
                  ],
                })
              }
            >
              <Plus />
              添加字段
            </button>
            <p className="fine">
              修改已使用的模板必须保持现有标注兼容；不兼容的变更会被拒绝。
            </p>
            <div className="modal-actions">
              <button
                type="button"
                onClick={() => setDraft(null)}
                disabled={busy}
              >
                取消
              </button>
              <button className="primary" disabled={busy}>
                保存模板
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
