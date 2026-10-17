import { DatabaseSync } from "node:sqlite";

/** Rebuildable search cache: canonical project data remains in domain.sqlite. */
export function createDiscoveryIndex({ path = ":memory:" } = {}) {
  const db = new DatabaseSync(path);
  db.exec(`CREATE TABLE IF NOT EXISTS documents(id TEXT PRIMARY KEY, media_id TEXT, entity_id TEXT, category TEXT, review TEXT, epistemic TEXT, series TEXT, episode TEXT, tags TEXT, body TEXT, annotation TEXT);
    CREATE INDEX IF NOT EXISTS documents_media ON documents(media_id);
    CREATE INDEX IF NOT EXISTS documents_entity ON documents(entity_id);
    CREATE INDEX IF NOT EXISTS documents_review ON documents(review);
    CREATE VIRTUAL TABLE IF NOT EXISTS search_fts USING fts5(body, tokenize='trigram');`);
  const insert = db.prepare(
    "INSERT INTO documents VALUES(?,?,?,?,?,?,?,?,?,?,?)",
  );
  const insertFts = db.prepare(
    "INSERT INTO search_fts(rowid,body) VALUES(?,?)",
  );
  return {
    replace(snapshot) {
      const media = new Map(snapshot.media.map((m) => [m.id, m])),
        entities = new Map(snapshot.entities.map((e) => [e.id, e]));
      db.exec("BEGIN IMMEDIATE");
      try {
        db.exec("DELETE FROM documents; DELETE FROM search_fts;");
        for (const a of snapshot.annotations) {
          const m = media.get(a.mediaId),
            e = entities.get(a.entityId);
          const body = [
            a.label,
            a.notes,
            ...(a.tags || []),
            ...Object.values(a.values || {}),
            ...(a.words || []).map((w) => w.text),
            e?.name,
            e?.description,
            ...(e?.tags || []),
            m?.name,
          ]
            .filter((v) => v !== undefined)
            .join(" ")
            .toLocaleLowerCase();
          const row = insert.run(
            a.id,
            a.mediaId,
            a.entityId || "",
            a.category || "",
            a.reviewState,
            a.epistemic || "observed",
            m?.series || "",
            m?.episode || "",
            JSON.stringify(a.tags || []),
            body,
            JSON.stringify(a),
          );
          insertFts.run(row.lastInsertRowid, body);
        }
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      return snapshot.annotations.length;
    },
    search(input = {}) {
      const { text = "", tags = [], limit = 50, offset = 0 } = input;
      if (
        typeof text !== "string" ||
        text.length > 2000 ||
        !Array.isArray(tags) ||
        tags.length > 100 ||
        tags.some((t) => typeof t !== "string" || t.length > 1000)
      )
        throw new Error("检索条件过长或格式无效");
      if (
        !Number.isSafeInteger(limit) ||
        limit < 1 ||
        limit > 200 ||
        !Number.isSafeInteger(offset) ||
        offset < 0 ||
        offset > 10000000
      )
        throw new Error("检索分页参数无效");
      const words = [
        ...new Set(
          text
            .toLocaleLowerCase()
            .split(/[\s,，;；]+/u)
            .filter(Boolean),
        ),
      ];
      if (words.length > 50) throw new Error("检索词过多");
      const clauses = [],
        params = [];
      const indexed = words.filter(
        (w) => [...w].length >= 3 && !w.includes("\0"),
      );
      if (indexed.length) {
        clauses.push(
          "d.rowid IN (SELECT rowid FROM search_fts WHERE search_fts MATCH ?)",
        );
        params.push(
          indexed.map((w) => '"' + w.replaceAll('"', '""') + '"').join(" AND "),
        );
      }
      // Exact substring guards preserve legacy AND semantics, including punctuation and short CJK tokens.
      for (const word of words) {
        clauses.push("instr(d.body,?)>0");
        params.push(word);
      }
      for (const [key, column] of Object.entries({
        mediaId: "media_id",
        entityId: "entity_id",
        category: "category",
        reviewState: "review",
        epistemic: "epistemic",
        series: "series",
        episode: "episode",
      })) {
        if (input[key] !== undefined && input[key] !== "") {
          if (typeof input[key] !== "string")
            throw new Error("检索筛选值必须是文本");
          clauses.push(`d.${column}=?`);
          params.push(input[key]);
        }
      }
      for (const tag of tags) {
        clauses.push("EXISTS(SELECT 1 FROM json_each(d.tags) WHERE value=?)");
        params.push(tag);
      }
      const where = clauses.length ? " WHERE " + clauses.join(" AND ") : "";
      const total = db
        .prepare("SELECT count(*) AS count FROM documents d" + where)
        .get(...params).count;
      const items = db
        .prepare(
          "SELECT annotation FROM documents d" +
            where +
            " ORDER BY d.id LIMIT ? OFFSET ?",
        )
        .all(...params, limit, offset)
        .map((r) => JSON.parse(r.annotation));
      return {
        items,
        total,
        limit,
        offset,
        hasMore: offset + items.length < total,
        method:
          "SQLite FTS5 trigram + exact substring/structured filters; short terms use substring scan",
      };
    },
    close() {
      db.close();
    },
  };
}
