const MAX_BYTES = 10 * 1024 * 1024;
const MAX_CUES = 100_000;
const fail = (message, cue) => { throw new Error(`Invalid subtitles${cue ? ` (cue ${cue})` : ''}: ${message}`); };

function timestamp(value, cue) {
  const match = /^(?:(\d+):)?(\d{2}):(\d{2})[.,](\d{3})$/.exec(value);
  if (!match) fail(`malformed timestamp ${value}`, cue);
  const hours = Number(match[1] ?? 0), minutes = Number(match[2]), seconds = Number(match[3]);
  if (!Number.isSafeInteger(hours) || minutes >= 60 || seconds >= 60) fail(`malformed timestamp ${value}`, cue);
  const result = hours * 3600 + minutes * 60 + seconds + Number(match[4]) / 1000;
  if (!Number.isFinite(result) || !Number.isSafeInteger(hours * 3600000)) fail('timestamp exceeds supported precision', cue);
  return result;
}

function decodeEntities(text) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0', lrm: '\u200e', rlm: '\u200f' };
  return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp|lrm|rlm);/gi, (whole, entity) => {
    if (entity[0] !== '#') return named[entity.toLowerCase()] ?? whole;
    const number = /^#x/i.test(entity) ? Number.parseInt(entity.slice(2), 16) : Number(entity.slice(1));
    return number > 0 && number <= 0x10ffff && !(number >= 0xd800 && number <= 0xdfff) ? String.fromCodePoint(number) : '\ufffd';
  });
}

function plainText(text) {
  // Tokenize bounded tags in one pass. Escaped '<...>' is decoded only afterwards.
  let output = '', cursor = 0, blocked;
  for (const match of text.matchAll(/<[^<>]*>/g)) {
    if (!blocked) output += text.slice(cursor, match.index);
    const tag = match[0];
    if (/^<(?:script|style)\b/i.test(tag)) blocked = /^<([a-z]+)/i.exec(tag)[1].toLowerCase();
    else if (blocked && new RegExp(`^</${blocked}\\s*>$`, 'i').test(tag)) blocked = undefined;
    else if (!blocked && /^<br\s*\/?\s*>$/i.test(tag)) output += '\n';
    cursor = match.index + tag.length;
  }
  if (!blocked) output += text.slice(cursor);
  return decodeEntities(output).replace(/\u0000/g, '').trim();
}

/** Parse a local subtitle document. No file access, HTML rendering, or cue deduplication. */
export function parseSubtitles(text, { format = 'auto', mediaId, duration, offset = 0, category = 'dialogue' } = {}) {
  if (typeof text !== 'string') fail('text must be a string');
  if (Buffer.byteLength(text, 'utf8') > MAX_BYTES) fail('document exceeds 10 MiB');
  if (!['auto', 'srt', 'vtt'].includes(format)) fail('format must be srt, vtt or auto');
  if (typeof mediaId !== 'string' || !mediaId.trim()) fail('mediaId is required');
  if (typeof category !== 'string' || !category.trim()) fail('category is required');
  if (!Number.isFinite(duration) || duration <= 0) fail('duration must be positive and finite');
  if (!Number.isFinite(offset)) fail('offset must be finite');
  let document = text.replace(/^\ufeff/, '').replace(/\r\n?/g, '\n').trim();
  const isVtt = /^WEBVTT(?:[ \t].*)?(?:\n|$)/.test(document);
  if (format === 'auto') format = isVtt ? 'vtt' : 'srt';
  if (format === 'vtt' && !isVtt) fail('WebVTT header is missing');
  if (format === 'srt' && isVtt) fail('WebVTT document does not match srt format');
  if (!document) fail('document is empty');
  const warnings = [], annotations = [];
  if (isVtt) {
    const end = document.indexOf('\n');
    document = end < 0 ? '' : document.slice(end + 1);
    // Standard header metadata is descriptive only and never used to shift cue times.
    document = document.replace(/^(?:(?:Kind|Language):[^\n]*\n)*/i, '');
  }
  const blocks = document.split(/\n[ \t]*\n+/).filter(block => block.trim());
  for (const block of blocks) {
    const lines = block.trim().split('\n');
    if (format === 'vtt' && /^(?:NOTE(?:[ \t]|$)|STYLE$|REGION$)/.test(lines[0])) continue;
    const cue = annotations.length + 1;
    if (cue > MAX_CUES) fail('document exceeds 100000 cues');
    let cueId;
    if (!lines[0].includes('-->')) {
      cueId = lines.shift().trim();
      if (format === 'srt' && !/^\d+$/.test(cueId)) fail('expected a numeric cue index or timing line', cue);
    }
    const timing = lines.shift();
    const match = timing && /^(\S+)\s+-->\s+(\S+)(?:[ \t]+(.+))?$/.exec(timing.trim());
    if (!match) fail('malformed cue timing line', cue);
    const sourceStart = timestamp(match[1], cue), sourceEnd = timestamp(match[2], cue);
    if (sourceEnd <= sourceStart) fail('cue end must be after start', cue);
    // Subtitle anchors are millisecond decimals; suppress binary addition noise at bounds.
    const start = Number((sourceStart + offset).toFixed(9)), end = Number((sourceEnd + offset).toFixed(9));
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end > duration || end <= start) fail('cue range falls outside media duration after offset', cue);
    if (lines.some(line => line.includes('-->'))) fail('unexpected timing marker in cue text; check missing blank separator', cue);
    const rawText = lines.join('\n');
    const speakers = [...new Set([...rawText.matchAll(/<v(?:\.[^\s<>]+)?[ \t]+([^<>]+)>/gi)].map(match => plainText(match[1])).filter(Boolean))];
    const label = plainText(rawText);
    if (!label) fail('cue text is empty after removing markup', cue);
    const values = { subtitleFormat: format, subtitleCueIndex: cue, subtitleSourceStart: sourceStart, subtitleSourceEnd: sourceEnd, subtitleOffset: offset };
    if (cueId !== undefined) values.subtitleCueId = cueId;
    if (match[3]) {
      values.subtitleSettings = match[3];
      warnings.push({ code: 'layout_ignored', cue, message: 'Subtitle layout settings are retained as metadata; screen placement is not imported.' });
    }
    if (speakers.length) values.speaker = speakers.join(' / ');
    annotations.push({ mediaId, start, end, label, notes: '', category, tags: speakers.map(speaker => `speaker:${speaker}`), values, reviewState: 'needs_review', epistemic: 'observed', confidence: null });
  }
  if (!annotations.length) warnings.push({ code: 'no_cues', message: 'The document contains no subtitle cues.' });
  return { annotations, warnings };
}
