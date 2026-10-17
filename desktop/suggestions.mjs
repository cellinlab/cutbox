/** Reconcile approximate model timing with the authoritative imported media range. */
export function normalizeSuggestions(media, annotations, range = {}) {
  if (!Array.isArray(annotations)) throw new Error('模型返回的标注必须是数组');
  const minimum = media.kind === 'image' ? 0 : Math.max(0, range.start ?? 0);
  const maximum = media.kind === 'image' ? 0 : Math.min(media.duration, range.end ?? media.duration);
  const result = [];
  for (const input of annotations) {
    if (!input || !Number.isFinite(input.start) || !Number.isFinite(input.end) || input.end < input.start) throw new Error('模型返回了无效时间区间');
    const start = media.kind === 'image' ? 0 : Math.max(minimum, input.start);
    const end = media.kind === 'image' ? 0 : Math.min(maximum, input.end);
    if (end < start || (media.kind !== 'image' && end === start)) continue;
    const item = { ...input, mediaId: media.id, start, end };
    if (input.region) {
      const r = input.region;
      if (!['x','y','width','height'].every(key => Number.isFinite(r[key])) || r.x < 0 || r.y < 0 || r.width <= 0 || r.height <= 0 || r.x >= 1 || r.y >= 1 || r.x + r.width > 1.000001 || r.y + r.height > 1.000001) throw new Error('模型返回了无效画面区域');
      item.region = { ...r, width: Math.min(r.width, 1-r.x), height: Math.min(r.height, 1-r.y) };
    }
    if (input.words) {
      if (!Array.isArray(input.words)) throw new Error('模型返回了无效逐词时间');
      item.words = input.words.map(word => {
        if (!Number.isFinite(word.start) || !Number.isFinite(word.end) || word.end < word.start) throw new Error('模型返回了无效逐词时间');
        return { ...word, start: Math.max(start, word.start), end: Math.min(end, word.end) };
      }).filter(word => word.end >= word.start);
    }
    result.push(item);
  }
  return result;
}
