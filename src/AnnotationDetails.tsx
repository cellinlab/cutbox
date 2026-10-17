import { TypedFields } from "./Templates";
import type { AnnotationInput, Snapshot } from "./types";
export function AnnotationDetails({
  data,
  draft,
  setDraft,
}: {
  data: Snapshot;
  draft: AnnotationInput;
  setDraft: (d: AnnotationInput) => void;
}) {
  const template = data.templates.find((t) => t.id === draft.templateId);
  return (
    <>
      <label>
        标注类别
        <input
          list="annotation-categories"
          value={draft.category || "general"}
          onChange={(e) => setDraft({ ...draft, category: e.target.value })}
        />
        <datalist id="annotation-categories">
          {[
            "general",
            "shot",
            "character",
            "costume",
            "action",
            "scene",
            "dialogue",
            "sound",
            "composition",
            "lighting",
          ].map((c) => (
            <option key={c}>{c}</option>
          ))}
        </datalist>
      </label>
      <div className="field-pair">
        <label>
          信息性质
          <select
            value={draft.epistemic || "observed"}
            onChange={(e) =>
              setDraft({
                ...draft,
                epistemic: e.target.value as AnnotationInput["epistemic"],
              })
            }
          >
            <option value="observed">直接观察</option>
            <option value="interpreted">分析推断</option>
            <option value="invented">创作设定</option>
          </select>
        </label>
        <label>
          置信度（0–1，可留空）
          <input
            type="number"
            min="0"
            max="1"
            step="any"
            value={draft.confidence ?? ""}
            onChange={(e) =>
              setDraft({ ...draft, confidence: e.target.value === "" ? null : Number(e.target.value) })
            }
          />
        </label>
      </div>
      <label>
        标签（每行一个）
        <textarea
          rows={2}
          value={(draft.tags || []).join("\n")}
          onChange={(e) =>
            setDraft({ ...draft, tags: e.target.value.split("\n") })
          }
        />
      </label>
      <label>
        字段模板
        <select
          value={draft.templateId || ""}
          onChange={(e) =>
            setDraft({
              ...draft,
              templateId: e.target.value || undefined,
              values: {},
            })
          }
        >
          <option value="">不使用模板</option>
          {data.templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </label>
      {template && (
        <TypedFields
          fields={template.fields}
          values={draft.values || {}}
          onChange={(values) => setDraft({ ...draft, values })}
        />
      )}
      {draft.words?.length ? (
        <details className="fine-fields">
          <summary>逐词时间与转录 ({draft.words.length})</summary>
          {draft.words.map((word, i) => (
            <div className="word-editor" key={i}>
              <input
                aria-label={`词 ${i + 1}`}
                value={word.text}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    words: draft.words!.map((w, n) =>
                      n === i ? { ...w, text: e.target.value } : w,
                    ),
                  })
                }
              />
              <input
                aria-label={`词 ${i + 1} 入点`}
                type="number"
                min={draft.start}
                max={draft.end}
                step="any"
                value={word.start}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    words: draft.words!.map((w, n) =>
                      n === i ? { ...w, start: Number(e.target.value) } : w,
                    ),
                  })
                }
              />
              <input
                aria-label={`词 ${i + 1} 出点`}
                type="number"
                min={word.start}
                max={draft.end}
                step="any"
                value={word.end}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    words: draft.words!.map((w, n) =>
                      n === i ? { ...w, end: Number(e.target.value) } : w,
                    ),
                  })
                }
              />
            </div>
          ))}
        </details>
      ) : null}
      {draft.keypoints?.length ? (
        <details className="fine-fields">
          <summary>姿态关键点 ({draft.keypoints.length})</summary>
          {draft.keypoints.map((point, i) => (
            <div className="word-editor" key={point.index}>
              <span>点 {point.index}</span>
              {(["x", "y"] as const).map((key) => (
                <input
                  key={key}
                  aria-label={`点 ${point.index} ${key}`}
                  type="number"
                  min="0"
                  max="1"
                  step="any"
                  value={point[key]}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      keypoints: draft.keypoints!.map((p, n) =>
                        n === i ? { ...p, [key]: Number(e.target.value) } : p,
                      ),
                    })
                  }
                />
              ))}
            </div>
          ))}
        </details>
      ) : null}
      <label>
        轨迹标识
        <input
          placeholder="相同对象使用相同标识"
          value={draft.trackId || ""}
          onChange={(e) =>
            setDraft({ ...draft, trackId: e.target.value || undefined })
          }
        />
      </label>
    </>
  );
}
