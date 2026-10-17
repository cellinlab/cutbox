import type { Media, Snapshot } from "./types";
export interface SearchFilters {
  series: string;
  episode: string;
  entityId: string;
  category: string;
  tag: string;
  review: string;
  epistemic: string;
}
export const emptyFilters: SearchFilters = {
  series: "",
  episode: "",
  entityId: "",
  category: "",
  tag: "",
  review: "",
  epistemic: "",
};
export function matchesMedia(media: Media, data: Snapshot, f: SearchFilters) {
  if (
    f.series &&
    !(media.series || "").toLowerCase().includes(f.series.toLowerCase())
  )
    return false;
  if (
    f.episode &&
    !(media.episode || "").toLowerCase().includes(f.episode.toLowerCase())
  )
    return false;
  if (!f.entityId && !f.category && !f.tag && !f.review && !f.epistemic)
    return true;
  return data.annotations.some(
    (a) =>
      a.mediaId === media.id &&
      (!f.entityId || a.entityId === f.entityId) &&
      (!f.category || (a.category || "general") === f.category) &&
      (!f.tag ||
        a.tags?.some((t) => t.toLowerCase().includes(f.tag.toLowerCase()))) &&
      (!f.review || a.reviewState === f.review) &&
      (!f.epistemic || (a.epistemic || "observed") === f.epistemic),
  );
}
export function Search({
  data,
  value,
  onChange,
  open,
}: {
  data: Snapshot;
  value: SearchFilters;
  onChange: (v: SearchFilters) => void;
  open: (id: string, start?: number) => void;
}) {
  return (
    <details className="search-filters">
      <summary>组合筛选 · 所有条件同时匹配</summary>
      <div className="filter-fields">
        <label>
          系列
          <input
            value={value.series}
            onChange={(e) => onChange({ ...value, series: e.target.value })}
          />
        </label>
        <label>
          集数
          <input
            value={value.episode}
            onChange={(e) => onChange({ ...value, episode: e.target.value })}
          />
        </label>
        <label>
          关联对象
          <select
            value={value.entityId}
            onChange={(e) => onChange({ ...value, entityId: e.target.value })}
          >
            <option value="">任意</option>
            {data.entities.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          标注类别
          <input
            value={value.category}
            onChange={(e) => onChange({ ...value, category: e.target.value })}
          />
        </label>
        <label>
          标注标签
          <input
            value={value.tag}
            onChange={(e) => onChange({ ...value, tag: e.target.value })}
          />
        </label>
        <label>
          审核状态
          <select
            value={value.review}
            onChange={(e) => onChange({ ...value, review: e.target.value })}
          >
            <option value="">任意</option>
            <option value="accepted">已审核</option>
            <option value="needs_review">待审核</option>
            <option value="suggested">建议</option>
          </select>
        </label>
        <label>
          信息性质
          <select
            value={value.epistemic}
            onChange={(e) => onChange({ ...value, epistemic: e.target.value })}
          >
            <option value="">任意</option>
            <option value="observed">观察</option>
            <option value="interpreted">推断</option>
            <option value="invented">创作</option>
          </select>
        </label>
        <button onClick={() => onChange(emptyFilters)}>清除条件</button>
      </div>
      {(value.entityId ||
        value.category ||
        value.tag ||
        value.review ||
        value.epistemic) && (
        <div className="checks">
          {data.annotations
            .filter((a) => {
              const m = data.media.find((m) => m.id === a.mediaId);
              return m && matchesMedia(m, { ...data, annotations: [a] }, value);
            })
            .map((a) => (
              <button
                className="source-row"
                key={a.id}
                onClick={() => open(a.mediaId, a.start)}
              >
                {a.label} · {a.start.toFixed(3)}–{a.end.toFixed(3)} s
              </button>
            ))}
        </div>
      )}
    </details>
  );
}
