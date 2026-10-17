import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execute = promisify(execFile);
const tokens = (text) => new Set(String(text).toLowerCase().split(/[\s,，;；]+/).filter(Boolean));
export function searchAnnotations(snapshot, { text = '', tags = [], category, entityId, reviewState, epistemic, series, episode } = {}) {
  const words = [...tokens(text)];
  return snapshot.annotations.filter(annotation => {
    const media = snapshot.media.find(item => item.id === annotation.mediaId);
    const entity = snapshot.entities.find(item => item.id === annotation.entityId);
    const haystack = [annotation.label, annotation.notes, ...(annotation.tags || []), entity?.name, ...(entity?.tags || []), media?.name, ...Object.values(annotation.values || {})].join(' ').toLowerCase();
    return words.every(word => haystack.includes(word)) && tags.every(tag => (annotation.tags || []).includes(tag))
      && (!category || annotation.category === category) && (!entityId || annotation.entityId === entityId)
      && (!reviewState || annotation.reviewState === reviewState) && (!epistemic || annotation.epistemic === epistemic)
      && (!series || media?.series === series) && (!episode || media?.episode === episode);
  });
}
async function signature(media, ffmpegPath, signal) {
  if (media.kind === 'audio') return null;
  const result = await execute(ffmpegPath, ['-v','error','-i',media.thumbnailPath || media.path,'-frames:v','1','-vf','scale=16:16:flags=area,format=rgb24','-f','rawvideo','pipe:1'], { encoding: 'buffer', maxBuffer: 1024 * 1024, timeout: 30000, signal });
  if (result.stdout.length !== 768) throw new Error('无法提取视觉特征');
  return result.stdout;
}
export async function findSimilar(snapshot, { mediaId, limit = 8, ffmpegPath = 'ffmpeg', signal } = {}) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) throw new Error('相似结果数量应为 1–50');
  const source = snapshot.media.find(item => item.id === mediaId);
  if (!source) throw new Error('找不到参考素材');
  if (source.kind === 'audio') throw new Error('视觉相似候选仅支持图片与视频；音频请按描述检索');
  const reference = await signature(source, ffmpegPath, signal);
  const candidates = [], unavailable = [];
  for (const media of snapshot.media) {
    signal?.throwIfAborted();
    if (media.id === source.id || media.kind === 'audio') continue;
    try {
      const candidate = await signature(media, ffmpegPath, signal);
      let difference = 0;
      for (let i = 0; i < reference.length; i++) difference += Math.abs(reference[i] - candidate[i]);
      candidates.push({ mediaId: media.id, score: Math.max(0, 1 - difference / (768 * 255)), reason: '首帧色彩与布局相似度；请人工确认对象身份' });
    } catch (error) { signal?.throwIfAborted(); unavailable.push({ mediaId: media.id, reason: error.message }); }
  }
  return { candidates: candidates.sort((a, b) => b.score - a.score).slice(0, limit), unavailable, method: '16×16 RGB mean absolute distance; first-frame only' };
}
