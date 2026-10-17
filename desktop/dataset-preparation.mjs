/** Dataset auditing and deterministic source-disjoint splits; no model training. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { prepareMedia, portableMetadata, staged } from './packages.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const sorted = values => [...new Set(values)].sort();
const sha = value => typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
const finite = value => typeof value === 'number' && Number.isFinite(value);
const check = (condition, message) => { if (!condition) throw new Error(message); };
const SPLITS = ['train', 'validation', 'test'];
const defaults = { train: .8, validation: .1, test: .1 };
const emptyCounts = () => ({ train: 0, validation: 0, test: 0 });
// Authored configuration stays exact in JSON, but must be literal prose in Markdown.
const markdownLiteral = value => String(value).replace(/[\\`*_{}\[\]()#+\-.!|]/g, '\\$&').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

class Union {
  parents = new Map();
  root(key) {
    if (!this.parents.has(key)) this.parents.set(key, key);
    const chain = []; let root = key;
    while (this.parents.get(root) !== root) { chain.push(root); root = this.parents.get(root); }
    for (const value of chain) this.parents.set(value, root);
    return root;
  }
  join(a, b) {
    a = this.root(a); b = this.root(b);
    if (a !== b) this.parents.set(a < b ? b : a, a < b ? a : b);
  }
}

function options(input = {}) {
  const { collectionId, acceptedOnly = true, minConfidence, requireObserved = false } = input;
  check(typeof acceptedOnly === 'boolean' && typeof requireObserved === 'boolean', 'Dataset filters must be boolean');
  check(minConfidence === undefined || (finite(minConfidence) && minConfidence >= 0 && minConfidence <= 1), 'Minimum confidence must be within 0..1');
  check(collectionId === undefined || (typeof collectionId === 'string' && collectionId.length > 0), 'Invalid collection ID');
  return { ...(collectionId !== undefined ? { collectionId } : {}), acceptedOnly, ...(minConfidence !== undefined ? { minConfidence } : {}), requireObserved };
}

function inputLists(snapshot) {
  check(snapshot && typeof snapshot === 'object', 'Dataset snapshot is required');
  const data = {};
  for (const name of ['media', 'entities', 'annotations', 'collections', 'templates', 'events', 'relations', 'stories']) {
    check(snapshot[name] === undefined || Array.isArray(snapshot[name]), `${name} must be an array`);
    data[name] = snapshot[name] || [];
    const seen = new Set();
    for (const item of data[name]) {
      check(item && typeof item.id === 'string' && item.id && !seen.has(item.id), `Invalid or duplicate ${name} ID`);
      seen.add(item.id);
    }
  }
  return data;
}

function sourceIndex(media) {
  const union = new Union(), children = new Set();
  for (const item of media) {
    if (!sha(item.sha256)) continue;
    const own = item.sha256.toLowerCase(); union.root(own);
    if (sha(item.sourceAnchor?.sha256)) {
      const parent = item.sourceAnchor.sha256.toLowerCase();
      union.join(own, parent);
      if (parent !== own) children.add(own);
    }
  }
  const components = new Map();
  for (const value of union.parents.keys()) {
    const key = union.root(value);
    if (!components.has(key)) components.set(key, []);
    components.get(key).push(value);
  }
  const result = new Map();
  for (const values of components.values()) {
    const aliases = sorted(values), roots = aliases.filter(value => !children.has(value));
    const canonical = roots[0] || aliases[0];
    for (const value of aliases) result.set(value, { sourceGroup: `sha256:${canonical}`, sourceAliases: aliases, canonicalSha256: canonical });
  }
  return result;
}

// Split identity and temporal coordinates are separate: identical derived bytes
// may occur at more than one location in their original sources.
function temporalSources(media) {
  const byHash = new Map(), cache = new Map();
  for (const item of media) {
    if (!sha(item.sha256)) continue;
    const key = item.sha256.toLowerCase();
    if (!byHash.has(key)) byHash.set(key, []);
    byHash.get(key).push(item);
  }
  const resolveSource = (item, visited = new Set()) => {
    if (cache.has(item.id)) return cache.get(item.id);
    const anchor = item.sourceAnchor;
    const direct = { sha256: sha(anchor?.sha256) ? anchor.sha256.toLowerCase() : sha(item.sha256) ? item.sha256.toLowerCase() : undefined, offset: finite(anchor?.start) ? anchor.start : 0, mediaId: anchor?.mediaId || item.id, duration: anchor?.duration ?? item.duration, availableDuration: anchor ? anchor.end - anchor.start : item.duration,
      ...(anchor?.width || item.width ? { width: anchor?.width || item.width, height: anchor?.height || item.height } : {}) };
    if (anchor && (!sha(anchor.sha256) || !finite(anchor.start) || !finite(anchor.end) || !finite(anchor.duration) || anchor.start < 0 || anchor.end < anchor.start || anchor.end > anchor.duration)) return { ...direct, sha256: sha(item.sha256) ? item.sha256.toLowerCase() : undefined, offset: 0, mediaId: item.id, duration: item.duration, ambiguous: true };
    if (visited.has(item.id) || visited.size > 100) return { ...direct, ambiguous: true };
    const next = new Set([...visited, item.id]);
    let candidates = (byHash.get(direct.sha256) || []).filter(parent => parent.id !== item.id);
    if (!anchor) candidates = candidates.filter(parent => parent.sourceAnchor);
    else if (candidates.some(parent => parent.sourceAnchor)) candidates = candidates.filter(parent => parent.sourceAnchor);
    const resolved = candidates.map(parent => resolveSource(parent, next));
    const identities = new Set(resolved.map(parent => JSON.stringify([parent.sha256, parent.offset, parent.duration, parent.availableDuration, parent.ambiguous || false])));
    let result = direct;
    if (identities.size === 1 && !resolved[0].ambiguous) result = { ...resolved[0], offset: resolved[0].offset + direct.offset, availableDuration: Math.min(direct.availableDuration, resolved[0].availableDuration - direct.offset) };
    else if (identities.size > 1 || resolved.some(parent => parent.ambiguous)) result = { ...direct, ambiguous: true };
    if (!visited.size) cache.set(item.id, result);
    return result;
  };
  return new Map(media.map(item => [item.id, resolveSource(item)]));
}

function selectedAnnotations(data, collectionId) {
  if (!collectionId) return data.annotations;
  const collection = data.collections.find(item => item.id === collectionId);
  check(collection, 'Unknown collection');
  const annotations = new Set(collection.annotationIds || []), media = new Set(collection.mediaIds || []), entities = new Set(collection.entityIds || []);
  return data.annotations.filter(item => annotations.has(item.id) || media.has(item.mediaId) || entities.has(item.entityId));
}

const tally = values => {
  const result = Object.create(null);
  for (const value of values) result[value] = (result[value] || 0) + 1;
  return Object.fromEntries(Object.entries(result).sort(([a], [b]) => a.localeCompare(b, 'en')));
};

/** Pure metadata audit. Actual file integrity is verified when exporting. */
export function inspectDataset(snapshot, input = {}) {
  const filters = options(input), data = inputLists(snapshot);
  const media = new Map(data.media.map(item => [item.id, item]));
  const entities = new Map(data.entities.map(item => [item.id, item]));
  const templateIds = new Set(data.templates.map(item => item.id));
  const sourceGroups = sourceIndex(data.media);
  const timeSources = temporalSources(data.media), mediaEntities = new Map();
  for (const entity of data.entities) for (const id of entity.mediaIds || []) {
    if (!mediaEntities.has(id)) mediaEntities.set(id, []);
    mediaEntities.get(id).push(entity.id);
  }
  const selected = selectedAnnotations(data, filters.collectionId).slice().sort((a, b) => a.id.localeCompare(b.id, 'en'));
  const issues = [], samples = [];
  const issue = (code, severity, message, annotationId, mediaId) => issues.push({ code, severity, ...(annotationId ? { annotationId } : {}), ...(mediaId ? { mediaId } : {}), message });
  for (const annotation of selected) {
    const item = media.get(annotation.mediaId);
    let eligible = true;
    const exclude = (code, message) => { eligible = false; issue(code, 'error', message, annotation.id, annotation.mediaId); };
    if (!item) { exclude('missing_media', 'Annotation references missing media.'); continue; }
    if (!sha(item.sha256) || !Number.isSafeInteger(item.size) || item.size <= 0 || !['image', 'audio', 'video'].includes(item.kind) || !finite(item.duration) || item.duration < 0 || (item.kind !== 'image' && item.duration <= 0) || typeof item.path !== 'string' || !path.isAbsolute(item.path)) exclude('invalid_source_metadata', 'Source hash, size, duration, kind or local reference is invalid.');
    if (item.kind !== 'audio' && (!Number.isSafeInteger(item.width) || item.width <= 0 || !Number.isSafeInteger(item.height) || item.height <= 0)) exclude('invalid_dimensions', 'Visual source dimensions are missing or invalid.');
    if (!finite(annotation.start) || !finite(annotation.end) || annotation.start < 0 || annotation.end < annotation.start || annotation.end > item.duration || (item.kind !== 'image' && annotation.start === annotation.end) || (item.kind === 'image' && (annotation.start !== 0 || annotation.end !== 0))) exclude('invalid_interval', 'Training samples need a valid nonempty interval; image samples use 0..0.');
    if (item.sourceAnchor && (!sha(item.sourceAnchor.sha256) || typeof item.sourceAnchor.mediaId !== 'string' || !item.sourceAnchor.mediaId || !finite(item.sourceAnchor.start) || !finite(item.sourceAnchor.end) || !finite(item.sourceAnchor.duration) || item.sourceAnchor.start < 0 || item.sourceAnchor.end < item.sourceAnchor.start || item.sourceAnchor.end > item.sourceAnchor.duration)) exclude('invalid_lineage', 'Source lineage is malformed; repair it before dataset export.');
    if (filters.acceptedOnly && annotation.reviewState !== 'accepted') exclude('not_accepted', 'Annotation has not been accepted by a reviewer.');
    if (filters.requireObserved && annotation.epistemic !== 'observed') exclude('not_observed', 'Only directly observed annotations are allowed by this filter.');
    const confidence = annotation.confidence == null ? null : annotation.confidence;
    if (confidence !== null && (!finite(confidence) || confidence < 0 || confidence > 1)) exclude('invalid_confidence', 'Confidence must be within 0..1 or unknown.');
    else if (filters.minConfidence !== undefined && (confidence === null || confidence < filters.minConfidence)) exclude(confidence === null ? 'unknown_confidence' : 'low_confidence', confidence === null ? 'Unknown confidence cannot satisfy a numeric threshold.' : 'Confidence is below the selected threshold.');
    const caption = [annotation.values?.caption, annotation.text, annotation.label].find(value => typeof value === 'string' && value.trim())?.trim() || '';
    if (!caption) exclude('missing_caption', 'No caption is available in values.caption, text or label.');
    if (annotation.entityId && !entities.has(annotation.entityId)) exclude('missing_entity', 'Annotation references a missing entity.');
    if (annotation.templateId && !templateIds.has(annotation.templateId)) exclude('missing_template', 'Annotation references a missing template.');
    if (annotation.keyframes != null && !Array.isArray(annotation.keyframes)) exclude('invalid_geometry', 'Keyframes must be an array.');
    const geometry = [annotation.region, ...(Array.isArray(annotation.keyframes) ? annotation.keyframes : []).map(frame => frame?.region)].filter(Boolean);
    if (geometry.some(region => !['x', 'y', 'width', 'height'].every(key => finite(region[key])) || region.x < 0 || region.y < 0 || region.width <= 0 || region.height <= 0 || region.x + region.width > 1 || region.y + region.height > 1)) exclude('invalid_geometry', 'Region geometry is outside normalized image bounds.');
    if (!eligible) continue;
    const linked = sorted([...(annotation.entityId ? [annotation.entityId] : []), ...(mediaEntities.get(item.id) || [])]);
    const linkedSet = new Set(linked);
    for (let index = 0; index < linked.length; index++) {
      const id = linked[index];
      const actorId = entities.get(id)?.actorEntityId;
      if (actorId && !entities.has(actorId)) exclude('missing_entity_dependency', 'A linked entity references a missing performer.');
      if (actorId && entities.has(actorId) && !linkedSet.has(actorId)) { linked.push(actorId); linkedSet.add(actorId); }
    }
    if (!eligible) continue;
    const lineage = sourceGroups.get(item.sha256.toLowerCase());
    const timeSource = timeSources.get(item.id);
    const sourceStart = timeSource.offset + annotation.start;
    const sourceEnd = timeSource.offset + annotation.end;
    if (timeSource.ambiguous) issue('ambiguous_lineage', 'warning', 'Multiple ancestor coordinates are possible for identical derived bytes; temporal coordinates retain the nearest unambiguous source.', annotation.id, item.id);
    if (annotation.end > timeSource.availableDuration + 1e-6) {
      exclude('lineage_padding', 'Sample extends beyond the known original source interval into encoded padding.');
      continue;
    }
    samples.push({ id: `sample-${hash(annotation.id).slice(0, 24)}`, annotationId: annotation.id, mediaId: item.id,
      ...lineage, start: annotation.start, end: annotation.end, sourceStart, sourceEnd, timeSourceSha256: timeSource.sha256,
      caption, tags: sorted((Array.isArray(annotation.tags) ? annotation.tags : []).filter(value => typeof value === 'string')),
      entityIds: sorted(linked), kind: item.kind, category: annotation.category || 'general',
      reviewState: annotation.reviewState || 'unknown', epistemic: annotation.epistemic || 'unknown', confidence,
      series: typeof item.series === 'string' ? item.series : '', episode: typeof item.episode === 'string' ? item.episode : '' });
  }
  const windows = new Map(), prior = new Map(), series = new Map();
  let duplicateWindows = 0, overlappingWindows = 0;
  for (const sample of [...samples].sort((a, b) => a.sourceGroup.localeCompare(b.sourceGroup) || a.sourceStart - b.sourceStart || a.sourceEnd - b.sourceEnd || a.id.localeCompare(b.id))) {
    const temporalKey = sample.timeSourceSha256;
    const key = JSON.stringify([temporalKey, sample.sourceStart, sample.sourceEnd]);
    if (windows.has(key)) {
      duplicateWindows++;
      issue('duplicate_window', 'warning', 'Another eligible annotation uses this same canonical source interval; both stay in one split.', sample.annotationId, sample.mediaId);
    } else if ((prior.get(temporalKey) ?? -Infinity) > sample.sourceStart) {
      overlappingWindows++;
      issue('overlapping_window', 'warning', 'This interval overlaps another eligible interval of the same source; both stay in one split.', sample.annotationId, sample.mediaId);
    }
    windows.set(key, sample.id); prior.set(temporalKey, Math.max(prior.get(temporalKey) || 0, sample.sourceEnd));
    if (!series.has(sample.sourceGroup)) series.set(sample.sourceGroup, new Set());
    if (sample.series) series.get(sample.sourceGroup).add(sample.series);
  }
  const crossSeriesSources = [...series.values()].filter(values => values.size > 1).length;
  if (crossSeriesSources) issue('cross_series_source', 'warning', `${crossSeriesSources} canonical source groups occur under multiple series labels; labels do not make those sources independent.`);
  if (!samples.length) issue('empty_dataset', 'error', 'No annotations satisfy the selected dataset filters.');
  return { filters,
    summary: { total: selected.length, eligible: samples.length, excluded: selected.length - samples.length, media: new Set(samples.map(item => item.mediaId)).size, entities: new Set(samples.flatMap(item => item.entityIds)).size },
    issues, samples,
    distribution: { kinds: tally(samples.map(item => item.kind)), categories: tally(samples.map(item => item.category)), reviewStates: tally(selected.map(item => item.reviewState || 'unknown')), epistemic: tally(samples.map(item => item.epistemic)),
      series: tally(samples.map(item => item.series || '(unspecified)')), tags: tally(samples.flatMap(item => item.tags)), sourceGroups: new Set(samples.map(item => item.sourceGroup)).size,
      unknownConfidence: samples.filter(item => item.confidence === null).length, duplicateWindows, overlappingWindows, crossSeriesSources } };
}

function splitOptions({ groupBy = 'source', seed = 'cutbox', ratios = defaults } = {}) {
  check(['source', 'episode', 'entity'].includes(groupBy), 'Group by source, episode or entity');
  check(typeof seed === 'string' && seed.length > 0 && seed.length <= 1024, 'Split seed must be a nonempty string of at most 1024 characters');
  check(ratios && typeof ratios === 'object' && !Array.isArray(ratios) && Object.keys(ratios).length === 3 && SPLITS.every(key => finite(ratios[key]) && ratios[key] >= 0 && ratios[key] <= 1), 'Split ratios require train, validation and test values within 0..1');
  check(Math.abs(SPLITS.reduce((sum, key) => sum + ratios[key], 0) - 1) < 1e-9, 'Split ratios must sum to 1');
  const sum = SPLITS.reduce((total, key) => total + ratios[key], 0);
  return { groupBy, seed, ratios: Object.fromEntries(SPLITS.map(key => [key, ratios[key] / sum])) };
}

/** Hash-based assignment preserves components, not exact sample ratios. */
export function splitDataset(samples, input = {}) {
  check(Array.isArray(samples), 'Dataset samples must be an array');
  const config = splitOptions(input), union = new Union(), seen = new Set();
  for (const sample of samples) {
    check(sample && typeof sample.id === 'string' && !seen.has(sample.id) && typeof sample.sourceGroup === 'string', 'Invalid or duplicate dataset sample'); seen.add(sample.id);
    const token = `sample:${sample.id}`; union.join(token, `source:${sample.sourceGroup}`);
    for (const alias of sample.sourceAliases || []) union.join(token, `hash:${alias}`);
    if (config.groupBy === 'episode' && sample.episode) union.join(token, `episode:${JSON.stringify([sample.series || '', sample.episode])}`);
    if (config.groupBy === 'entity') for (const id of sample.entityIds || []) union.join(token, `entity:${id}`);
  }
  const components = new Map();
  for (const sample of samples) {
    const root = union.root(`sample:${sample.id}`);
    if (!components.has(root)) components.set(root, []);
    components.get(root).push(sample);
  }
  const assigned = new Map(), splitCounts = emptyCounts(), groupCounts = emptyCounts();
  for (const component of components.values()) {
    const group = `group-${hash(JSON.stringify(sorted(component.map(sample => sample.sourceGroup))))}`;
    const score = Number.parseInt(hash(JSON.stringify([config.seed, group])).slice(0, 13), 16) / 0x10000000000000;
    const split = score < config.ratios.train ? 'train' : score < config.ratios.train + config.ratios.validation ? 'validation' : 'test';
    groupCounts[split]++;
    for (const sample of component) { assigned.set(sample.id, { split, splitGroup: group }); splitCounts[split]++; }
  }
  const issues = [];
  for (const split of SPLITS) if (config.ratios[split] > 0 && !splitCounts[split]) issues.push({ code: 'empty_split', severity: 'warning', message: `${split} has no samples. Source-disjoint grouping cannot guarantee populated splits for small datasets.` });
  return { ...config, samples: samples.map(sample => ({ ...structuredClone(sample), ...assigned.get(sample.id) })).sort((a, b) => a.id.localeCompare(b.id, 'en')), splitCounts, groupCounts, issues };
}

function selectedGraph(snapshot, samples) {
  const all = inputLists(snapshot), annotationIds = new Set(samples.map(sample => sample.annotationId)), mediaIds = new Set(samples.map(sample => sample.mediaId)), entityIds = new Set(samples.flatMap(sample => sample.entityIds));
  const annotations = all.annotations.filter(item => annotationIds.has(item.id));
  const templateIds = new Set(annotations.map(item => item.templateId).filter(Boolean));
  const entities = all.entities.filter(item => entityIds.has(item.id)).map(item => ({ ...item, mediaIds: (item.mediaIds || []).filter(id => mediaIds.has(id)), ...(!mediaIds.has(item.coverMediaId) ? { coverMediaId: undefined } : {}) }));
  const events = all.events.filter(item => (item.annotationIds || []).length && (item.annotationIds || []).every(id => annotationIds.has(id)) && (item.entityIds || []).every(id => entityIds.has(id)) && (!item.sceneId || entityIds.has(item.sceneId)) && (item.changes || []).every(change => entityIds.has(change.entityId)));
  const eventIds = new Set(events.map(item => item.id));
  return structuredClone({ media: all.media.filter(item => mediaIds.has(item.id)).map(item => ({ ...item, sha256: item.sha256.toLowerCase(), ...(item.sourceAnchor ? { sourceAnchor: { ...item.sourceAnchor, sha256: item.sourceAnchor.sha256.toLowerCase() } } : {}) })), entities, annotations,
    templates: all.templates.filter(item => templateIds.has(item.id)), events,
    relations: all.relations.filter(item => entityIds.has(item.fromEntityId) && entityIds.has(item.toEntityId) && (item.evidenceAnnotationIds || []).every(id => annotationIds.has(id))),
    collections: all.collections.map(item => ({ ...item, mediaIds: (item.mediaIds || []).filter(id => mediaIds.has(id)), entityIds: (item.entityIds || []).filter(id => entityIds.has(id)), annotationIds: (item.annotationIds || []).filter(id => annotationIds.has(id)) })).filter(item => item.annotationIds.length),
    stories: all.stories.filter(item => item.nodes?.some(node => node.mediaId || node.eventIds?.length) && item.nodes.every(node => (!node.mediaId || mediaIds.has(node.mediaId)) && (node.eventIds || []).every(id => eventIds.has(id)))) });
}

function restoreLineage(manifest, original, timeSources) {
  const originalMedia = new Map(original.media.map(item => [item.id, item]));
  const originalAnnotations = new Map(original.annotations.map(item => [item.id, item]));
  for (const item of manifest.media) {
    const prior = originalMedia.get(item.id);
    const source = timeSources.get(item.id);
    if (prior.sourceAnchor || item.sourceAnchor?.sha256 === prior.sha256 || source.sha256 !== prior.sha256 || source.offset !== 0) {
      const newlyTrimmed = item.sourceAnchor?.sha256 === prior.sha256;
      const localStart = newlyTrimmed ? item.sourceAnchor.start : 0;
      const localEnd = newlyTrimmed ? item.sourceAnchor.end : prior.duration;
      item.sourceAnchor = { mediaId: source.mediaId, sha256: source.sha256, start: source.offset + localStart, end: Math.min(source.duration, source.offset + source.availableDuration, source.offset + localEnd), duration: source.duration,
        ...(source.width ? { width: source.width, height: source.height } : {}) };
    }
  }
  for (const annotation of manifest.annotations) {
    const prior = originalAnnotations.get(annotation.id), media = originalMedia.get(prior.mediaId);
    const source = timeSources.get(media.id);
    annotation.sourceAnchor = { mediaId: source.mediaId, start: source.offset + prior.start, end: source.offset + prior.end };
  }
}

export async function exportTrainingDataset({ directory, snapshot, collectionId, acceptedOnly = true, minConfidence, requireObserved = false, groupBy = 'source', seed = 'cutbox', ratios = defaults, profile = 'trimmed', signal, ffmpegPath, ffprobePath, onProgress }) {
  signal?.throwIfAborted();
  check(typeof directory === 'string' && directory.length > 0, 'Dataset output directory is required');
  check(['full', 'trimmed'].includes(profile), 'Unknown training export profile');
  const audit = inspectDataset(snapshot, { collectionId, acceptedOnly, minConfidence, requireObserved });
  check(audit.samples.length > 0, 'No eligible training samples; inspect the dataset filters and quality issues');
  const split = splitDataset(audit.samples, { groupBy, seed, ratios });
  const report = { schema: 'cutbox.dataset-report/0.1', ...audit, samples: split.samples, issues: [...audit.issues, ...split.issues], split: { groupBy, seed, ratios: split.ratios, splitCounts: split.splitCounts, groupCounts: split.groupCounts }, profile,
    limitations: ['Metadata inspection cannot verify file presence; export verifies every copied media SHA-256 and size.', 'Split groups prevent known source/entity/episode overlap, not unknown semantic similarity or identity leakage.', 'No model performance, rights clearance, or dataset balance is inferred.'] };
  const graph = selectedGraph(snapshot, split.samples), original = portableMetadata(graph);
  directory = path.resolve(directory);
  await staged(directory, async temporary => {
    const manifest = await prepareMedia(graph, temporary, { profile, signal, ffmpegPath, ffprobePath, onProgress });
    signal?.throwIfAborted(); restoreLineage(manifest, original, temporalSources(inputLists(snapshot).media));
    const media = new Map(manifest.media.map(item => [item.id, item])), annotations = new Map(manifest.annotations.map(item => [item.id, item]));
    const originals = new Map(original.annotations.map(item => [item.id, item]));
    const rows = split.samples.map(sample => ({ schema: 'cutbox.training-sample/0.1', ...sample, media: media.get(sample.mediaId), annotation: annotations.get(sample.annotationId), originalAnnotation: originals.get(sample.annotationId), source: { sha256: sample.timeSourceSha256, start: sample.sourceStart, end: sample.sourceEnd } }));
    const jsonl = values => values.map(row => JSON.stringify(row)).join('\n') + (values.length ? '\n' : '');
    const write = async (name, contents) => { signal?.throwIfAborted(); await fs.writeFile(path.join(temporary, name), contents, { flag: 'wx', mode: 0o600 }); };
    await write('samples.jsonl', jsonl(rows));
    for (const name of SPLITS) await write(`${name}.jsonl`, jsonl(rows.filter(row => row.split === name)));
    await write('manifest.json', JSON.stringify({ ...manifest, dataset: { schema: 'cutbox.training-dataset/0.1', filters: audit.filters, ...report.split, profile } }, null, 2));
    await write('report.json', JSON.stringify(report, null, 2));
    await write('dataset-card.md', `# CutBox training dataset\n\n${rows.length} eligible annotation samples across ${audit.summary.media} media files and ${audit.distribution.sourceGroups} known canonical source groups.\n\n## Selection\n\nFilters: ${markdownLiteral(JSON.stringify(audit.filters))}\n\nCaption preference: values.caption, text, then label. Each JSONL row retains the original temporal annotation and the rebased portable annotation. Media paths are relative to this directory. Metadata and media are plaintext.\n\n## Splits\n\nGrouping: ${groupBy}; seed: ${markdownLiteral(JSON.stringify(seed))}; requested ratios: ${JSON.stringify(split.ratios)}. Actual counts: ${JSON.stringify(split.splitCounts)}. Assignment hashes connected source groups, so ratios are targets rather than quotas; a split may be empty. The same known source hash/ancestor never crosses splits. Episode/entity grouping adds conservative connections.\n\n## Provenance and limitations\n\nProfile: ${profile}. Trimmed output retains a bounding interval for each source and may retain gaps between annotations. Source hashes and original intervals are recorded. This is not a rights or consent declaration. Fill in the source ownership, allowed uses, attribution and retention requirements before distributing or training.\n\nKnown source grouping cannot detect unrecorded duplicates, shared identities, or semantic similarity. Review report.json and the original media. No training performance or balance guarantee is made.\n`);
    signal?.throwIfAborted();
  });
  return { path: path.join(directory, 'samples.jsonl'), directory, sampleCount: split.samples.length, splitCounts: split.splitCounts, report };
}
