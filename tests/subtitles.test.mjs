import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSubtitles } from '../desktop/subtitles.mjs';
const options = { mediaId: 'film', duration: 8000 };

test('SRT BOM CRLF multilingual multiline cues preserve source ids, overlap and hours', () => {
  const source = '\ufeff1\r\n01:02:03,004 --> 01:02:05,006\r\n你好 &amp; hello\r\nمرحبا\r\n\r\n2\r\n01:02:04,000 --> 01:02:06,000\r\n重叠对白';
  const { annotations, warnings } = parseSubtitles(source, options);
  assert.equal(annotations.length, 2);
  assert.equal(annotations[0].start, 3723.004);
  assert.equal(annotations[0].end, 3725.006);
  assert.equal(annotations[0].label, '你好 & hello\nمرحبا');
  assert.ok(annotations[1].start < annotations[0].end);
  assert.equal(annotations[0].values.subtitleCueId, '1');
  assert.equal(annotations[0].values.subtitleFormat, 'srt');
  assert.equal(annotations[0].reviewState, 'needs_review');
  assert.equal(annotations[0].epistemic, 'observed');
  assert.equal(annotations[0].confidence, null);
  assert.deepEqual(warnings, []);
});

test('SRT without cue indexes applies signed offsets without changing source anchors', () => {
  const input = '00:02.000 --> 00:03.500\nFirst\n\n00:04.000 --> 00:05.000\nSecond';
  const { annotations } = parseSubtitles(input, { ...options, offset: -1, category: 'subtitle' });
  assert.equal(annotations[0].start, 1);
  assert.equal(annotations[0].end, 2.5);
  assert.equal(annotations[0].values.subtitleSourceStart, 2);
  assert.equal(annotations[0].values.subtitleOffset, -1);
  assert.equal(annotations[0].values.subtitleCueId, undefined);
  assert.equal(annotations[0].category, 'subtitle');
  assert.equal(parseSubtitles(input, { ...options, offset: 1 }).annotations[0].start, 3);
});

test('WebVTT ignores NOTE STYLE REGION blocks and preserves voice names as plain text', () => {
  const input = `WEBVTT Example\n\nNOTE this is a note\n00:00.000 --> deliberately not a cue\n\nSTYLE\n::cue { color: red; }\n\nREGION\nid:wide\nwidth:40%\n\nline-A\n00:01.000 --> 00:03.000 align:start position:20%\n<v.alice 李 &amp; Alice><b>你好</b> &lt;literal&gt;<br/>世界</v>\n<v Bob>Hi &#x1f600; &#33;</v>\n\n00:02.000 --> 00:04.000\n<c.green>重叠</c><00:03.000>结束`;
  const { annotations, warnings } = parseSubtitles(input, options);
  assert.equal(annotations.length, 2);
  assert.equal(annotations[0].label, '你好 <literal>\n世界\nHi 😀 !');
  assert.deepEqual(annotations[0].tags, ['speaker:李 & Alice', 'speaker:Bob']);
  assert.equal(annotations[0].values.speaker, '李 & Alice / Bob');
  assert.equal(annotations[0].values.subtitleCueId, 'line-A');
  assert.equal(annotations[0].values.subtitleSettings, 'align:start position:20%');
  assert.equal(annotations[1].label, '重叠结束');
  assert.deepEqual(warnings.map(w => w.code), ['layout_ignored']);
});

test('plain text never evaluates markup and removes embedded style/script data', () => {
  const result = parseSubtitles('00:00.000 --> 00:01.000\n<style>bad CSS</style><script>alert(1)</script><b>Safe</b> &lt;img src=x&gt; &#0; &unknown;', options);
  assert.equal(result.annotations[0].label, 'Safe <img src=x> � &unknown;');
  // A large run of unmatched '<' must not trigger quadratic tag scanning.
  const brackets = '<'.repeat(200000);
  assert.equal(parseSubtitles(`00:00.000 --> 00:01.000\n${brackets}`, options).annotations[0].label.length, brackets.length);
});

test('malformed timestamps, missing separators and malformed cues fail the entire parse', () => {
  for (const input of [
    '00:61.000 --> 00:62.000\nBad',
    '00:00:01,00 --> 00:00:02,000\nBad',
    'nonsense\n00:00.000 --> 00:01.000\nBad',
    '00:00.000 -> 00:01.000\nBad',
    '00:00.000 --> 00:01.000\nGood\n00:01.000 --> 00:02.000\nMissing separator',
    '00:00.000 --> 00:01.000\nGood\n\n2\ncorrupt\nBad',
    '00:00.000 --> 00:01.000\n<b></b>',
  ]) assert.throws(() => parseSubtitles(input, options), /Invalid subtitles/);
});

test('out-of-range cues are never silently trimmed or shifted', () => {
  const input = '00:01.000 --> 00:02.000\nHello';
  assert.throws(() => parseSubtitles(input, { ...options, duration: 1.5 }), /outside media duration/);
  assert.throws(() => parseSubtitles(input, { ...options, offset: -2 }), /outside media duration/);
  assert.throws(() => parseSubtitles(input, { ...options, offset: Infinity }), /finite/);
  assert.throws(() => parseSubtitles('00:02.000 --> 00:01.000\nHello', options), /end must be after/);
  assert.throws(() => parseSubtitles('00:01.000 --> 00:01.000\nHello', options), /end must be after/);
  assert.equal(parseSubtitles(input, { ...options, duration: 2 }).annotations[0].end, 2);
  assert.equal(parseSubtitles('00:00.000 --> 00:00.100\nHello', { ...options, offset: 0.2, duration: 0.3 }).annotations[0].end, 0.3);
});

test('format mismatches and size/cue-count limits are explicit', () => {
  assert.throws(() => parseSubtitles('00:01.000 --> 00:02.000\nHello', { ...options, format: 'vtt' }), /header/);
  assert.throws(() => parseSubtitles('WEBVTT\n\n00:01.000 --> 00:02.000\nHello', { ...options, format: 'srt' }), /does not match/);
  assert.throws(() => parseSubtitles('汉'.repeat(4 * 1024 * 1024), options), /10 MiB/);
  assert.throws(() => parseSubtitles('00:01.000 --> 00:02.000\nA\n\n'.repeat(100001), options), /100000 cues/);
  assert.equal(parseSubtitles('WEBVTT\n\nNOTE no dialogue', options).warnings[0].code, 'no_cues');
});
