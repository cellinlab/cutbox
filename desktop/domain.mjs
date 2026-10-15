import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';

const TABLES = ['media', 'entities', 'annotations', 'collections'];
const fail = (message) => { throw new Error(message); };
const object = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : fail('Expected an object');
const string = (value, field, empty = false) => typeof value === 'string' && (empty || value.trim()) ? value : fail(`${field} must be a string${empty ? '' : ' and not empty'}`);
const number = (value, field) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fail(`${field} must be a finite nonnegative number`);
const choice = (value, values, field) => values.includes(value) ? value : fail(`Invalid ${field}`);
const strings = (value, field) => Array.isArray(value) ? [...new Set(value.map((v) => string(v, field)))] : fail(`${field} must be an array`);

/** Local metadata only. Original media files are never modified by this module. */
export function createDomain({ directory }) {
  string(directory, 'directory');
  mkdirSync(directory, { recursive: true });
  const db = new DatabaseSync(join(directory, 'cutbox.sqlite'));
  db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
  const version = db.prepare('PRAGMA user_version').get().user_version;
  if (version > 1) { db.close(); fail('This database requires a newer version of CutBox'); }
  db.exec(`BEGIN; ${TABLES.map((table) => `CREATE TABLE IF NOT EXISTS ${table} (id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data)));`).join(' ')} PRAGMA user_version=1; COMMIT;`);

  const get = (table, id) => {
    const row = db.prepare(`SELECT data FROM ${table} WHERE id=?`).get(id);
    return row ? JSON.parse(row.data) : undefined;
  };
  const all = (table) => db.prepare(`SELECT data FROM ${table} ORDER BY rowid`).all().map((row) => JSON.parse(row.data));
  const put = (table, value) => {
    db.prepare(`INSERT INTO ${table}(id,data) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data`).run(value.id, JSON.stringify(value));
    return value;
  };
  let transactionDepth = 0;
  const transaction = (fn) => {
    if (transactionDepth) return fn();
    db.exec('BEGIN IMMEDIATE');
    transactionDepth++;
    try { const result = fn(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
    finally { transactionDepth--; }
  };
  const reference = (table, id) => get(table, string(id, `${table} id`)) ?? fail(`Unknown ${table} id: ${id}`);
  const references = (table, value, field) => strings(value, field).map((id) => { reference(table, id); return id; });
  const base = (table, input) => {
    object(input);
    const existing = input.id === undefined ? undefined : reference(table, input.id);
    const now = new Date().toISOString();
    return { ...existing, ...input, id: existing?.id ?? randomUUID(), createdAt: existing?.createdAt ?? now, updatedAt: now };
  };

  const domain = {
    snapshot: () => Object.fromEntries(TABLES.map((table) => [table, all(table)])),
    addMedia(input) {
      return transaction(() => {
        object(input);
        const id = input.id === undefined ? randomUUID() : string(input.id, 'id');
        if (get('media', id)) fail('Media id already exists');
        const sha256 = string(input.sha256, 'sha256').toLowerCase();
        if (!/^[a-f0-9]{64}$/.test(sha256)) fail('sha256 must be a SHA-256 hexadecimal digest');
        const path = string(input.path, 'path');
        if (!isAbsolute(path)) fail('Media path must be absolute');
        const record = {
          id, name: string(input.name, 'name'), kind: choice(input.kind, ['video', 'audio', 'image'], 'media kind'),
          path, sha256, size: number(input.size, 'size'), duration: number(input.duration, 'duration'),
          createdAt: new Date().toISOString(),
        };
        if (!Number.isSafeInteger(record.size)) fail('size must be a safe integer');
        for (const field of ['width', 'height']) {
          if (input[field] !== undefined) {
            record[field] = number(input[field], field);
            if (!Number.isSafeInteger(record[field]) || record[field] === 0) fail(`${field} must be a positive integer`);
          }
        }
        if (input.thumbnailPath !== undefined) {
          record.thumbnailPath = string(input.thumbnailPath, 'thumbnailPath');
          if (!isAbsolute(record.thumbnailPath)) fail('thumbnailPath must be absolute');
        }
        const duplicate = all('media').find((media) => media.sha256 === sha256);
        return duplicate ?? put('media', record);
      });
    },
    saveEntity(input) {
      return transaction(() => {
        const value = base('entities', input);
        const entity = {
          id: value.id, type: choice(value.type, ['character', 'scene', 'prop', 'sound'], 'entity type'),
          name: string(value.name, 'name'), description: string(value.description ?? '', 'description', true),
          tags: strings(value.tags ?? [], 'tags'), mediaIds: references('media', value.mediaIds ?? [], 'mediaIds'),
          createdAt: value.createdAt, updatedAt: value.updatedAt,
        };
        if (value.coverMediaId != null && value.coverMediaId !== '') {
          if (!entity.mediaIds.includes(value.coverMediaId)) fail('coverMediaId must belong to mediaIds');
          entity.coverMediaId = value.coverMediaId;
        }
        return put('entities', entity);
      });
    },
    deleteEntity(id) {
      return transaction(() => {
        reference('entities', id);
        for (const annotation of all('annotations')) {
          if (annotation.entityId === id) { delete annotation.entityId; put('annotations', annotation); }
        }
        for (const collection of all('collections')) {
          if (collection.entityIds.includes(id)) put('collections', { ...collection, entityIds: collection.entityIds.filter((item) => item !== id), updatedAt: new Date().toISOString() });
        }
        db.prepare('DELETE FROM entities WHERE id=?').run(id);
        return { id };
      });
    },
    saveAnnotation(input) {
      return transaction(() => {
        const value = base('annotations', input);
        const media = reference('media', value.mediaId);
        const annotation = {
          id: value.id, mediaId: media.id, start: number(value.start, 'start'), end: number(value.end, 'end'),
          label: string(value.label, 'label'), notes: string(value.notes ?? '', 'notes', true),
          reviewState: choice(value.reviewState ?? 'accepted', ['suggested', 'accepted', 'needs_review'], 'reviewState'),
          createdAt: value.createdAt, updatedAt: value.updatedAt,
        };
        if (annotation.end < annotation.start || annotation.end > media.duration) fail('Annotation range must be within media duration');
        if (value.entityId != null && value.entityId !== '') annotation.entityId = reference('entities', value.entityId).id;
        if (value.region != null) {
          object(value.region);
          annotation.region = Object.fromEntries(['x', 'y', 'width', 'height'].map((key) => [key, number(value.region[key], `region.${key}`)]));
          const { x, y, width, height } = annotation.region;
          if (width <= 0 || height <= 0 || x + width > 1 || y + height > 1) fail('Region must be a nonempty rectangle within normalized image bounds');
          if (media.kind === 'audio') fail('Audio annotations cannot have image regions');
        }
        return put('annotations', annotation);
      });
    },
    deleteAnnotation(id) {
      return transaction(() => {
        reference('annotations', id);
        for (const collection of all('collections')) {
          if (collection.annotationIds.includes(id)) put('collections', { ...collection, annotationIds: collection.annotationIds.filter((item) => item !== id), updatedAt: new Date().toISOString() });
        }
        db.prepare('DELETE FROM annotations WHERE id=?').run(id);
        return { id };
      });
    },
    saveCollection(input) {
      return transaction(() => {
        const value = base('collections', input);
        return put('collections', {
          id: value.id, name: string(value.name, 'name'), description: string(value.description ?? '', 'description', true),
          mediaIds: references('media', value.mediaIds ?? [], 'mediaIds'),
          entityIds: references('entities', value.entityIds ?? [], 'entityIds'),
          annotationIds: references('annotations', value.annotationIds ?? [], 'annotationIds'),
          createdAt: value.createdAt, updatedAt: value.updatedAt,
        });
      });
    },
    importSnapshot(input) {
      return transaction(() => {
        object(input);
        const maps = Object.fromEntries(TABLES.map((table) => [table, new Map()]));
        for (const table of TABLES) {
          if (!Array.isArray(input[table])) fail(`Import ${table} must be an array`);
          const seen = new Set();
          for (const item of input[table]) {
            object(item);
            const id = string(item.id, `Import ${table} id`);
            if (seen.has(id)) fail(`Duplicate import ${table} id: ${id}`);
            seen.add(id);
          }
        }
        const mapped = (table, id) => maps[table].get(string(id, `Import ${table} reference`)) ?? fail(`Missing import ${table} reference: ${id}`);
        const mappedList = (table, ids) => strings(ids ?? [], `Import ${table} references`).map((id) => mapped(table, id));
        for (const item of input.media) maps.media.set(item.id, domain.addMedia({ ...item, id: undefined }).id);
        for (const item of input.entities) maps.entities.set(item.id, domain.saveEntity({
          ...item, id: undefined, mediaIds: mappedList('media', item.mediaIds),
          coverMediaId: item.coverMediaId ? mapped('media', item.coverMediaId) : undefined,
        }).id);
        for (const item of input.annotations) maps.annotations.set(item.id, domain.saveAnnotation({
          ...item, id: undefined, mediaId: mapped('media', item.mediaId),
          entityId: item.entityId ? mapped('entities', item.entityId) : undefined,
        }).id);
        for (const item of input.collections) maps.collections.set(item.id, domain.saveCollection({
          ...item, id: undefined, mediaIds: mappedList('media', item.mediaIds),
          entityIds: mappedList('entities', item.entityIds), annotationIds: mappedList('annotations', item.annotationIds),
        }).id);
        return domain.snapshot();
      });
    },
    close: () => db.close(),
  };
  return domain;
}
