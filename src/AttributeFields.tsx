import type { Scalar } from "./types";
export function AttributeFields({
  value,
  onChange,
}: {
  value: Record<string, Scalar>;
  onChange: (v: Record<string, Scalar>) => void;
}) {
  return (
    <fieldset>
      <legend>对象属性</legend>
      {Object.entries(value).map(([key, val], i) => (
        <div className="attribute-row" key={i}>
          <input
            aria-label={`属性名 ${i + 1}`}
            value={key}
            onChange={(e) => {
              const next = Object.fromEntries(
                Object.entries(value).map(([k, v]) => [
                  k === key ? e.target.value : k,
                  v,
                ]),
              );
              onChange(next);
            }}
          />
          <select
            aria-label={`属性类型 ${i + 1}`}
            value={typeof val}
            onChange={(e) =>
              onChange({
                ...value,
                [key]:
                  e.target.value === "number"
                    ? 0
                    : e.target.value === "boolean"
                      ? false
                      : "",
              })
            }
          >
            <option value="string">文本</option>
            <option value="number">数字</option>
            <option value="boolean">布尔</option>
          </select>
          {typeof val === "boolean" ? (
            <select
              aria-label={`属性值 ${i + 1}`}
              value={String(val)}
              onChange={(e) =>
                onChange({ ...value, [key]: e.target.value === "true" })
              }
            >
              <option value="true">是</option>
              <option value="false">否</option>
            </select>
          ) : (
            <input
              aria-label={`属性值 ${i + 1}`}
              type={typeof val === "number" ? "number" : "text"}
              value={val}
              onChange={(e) =>
                onChange({
                  ...value,
                  [key]:
                    typeof val === "number"
                      ? Number(e.target.value)
                      : e.target.value,
                })
              }
            />
          )}
          <button
            type="button"
            onClick={() =>
              onChange(
                Object.fromEntries(
                  Object.entries(value).filter(([k]) => k !== key),
                ),
              )
            }
          >
            移除
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => {
          let n = Object.keys(value).length + 1;
          while (Object.hasOwn(value, `attribute_${n}`)) n++;
          onChange({ ...value, [`attribute_${n}`]: "" });
        }}
      >
        添加属性
      </button>
    </fieldset>
  );
}
