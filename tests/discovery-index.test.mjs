import test from "node:test";
import assert from "node:assert/strict";
import { createDiscoveryIndex } from "../desktop/discovery-index.mjs";
const fixture = (count) => ({
  media: [{ id: "m", name: "第一集", series: "实验室", episode: "01" }],
  entities: [{ id: "e", name: "研究员", description: "蓝发", tags: ["角色"] }],
  annotations: Array.from({ length: count }, (_, i) => ({
    id: String(i).padStart(8, "0"),
    mediaId: "m",
    entityId: "e",
    label: i % 2 ? "白色外套实验室" : "Yellow shirt",
    notes: '表情 "开心"',
    tags: ["wardrobe"],
    values: { material: "cotton" },
    words: [{ text: "hello" }],
    category: "costume",
    reviewState: "accepted",
    epistemic: "observed",
  })),
});
test("indexed AND search preserves Unicode/substrings, structured filters and paging", (t) => {
  const index = createDiscoveryIndex();
  t.after(() => index.close());
  index.replace(fixture(10));
  assert.equal(
    index.search({
      text: "白色外套 研究员",
      series: "实验室",
      tags: ["wardrobe"],
    }).total,
    5,
  );
  assert.equal(index.search({ text: "白色" }).total, 5);
  assert.equal(index.search({ text: "cotton hello" }).total, 10);
  assert.equal(index.search({ text: '"开心"' }).total, 10);
  assert.equal(index.search({ text: "shirt", episode: "02" }).total, 0);
  const first = index.search({ limit: 3 }),
    second = index.search({ limit: 3, offset: 3 });
  assert.equal(first.total, 10);
  assert.equal(first.hasMore, true);
  assert.equal(
    new Set([...first.items, ...second.items].map((a) => a.id)).size,
    6,
  );
  assert.throws(() => index.search({ limit: 1000 }), /分页/);
  assert.throws(() => index.search({ tags: [1] }), /格式/);
});
test("cache replacement removes stale results and rollback retains previous index", (t) => {
  const index = createDiscoveryIndex();
  t.after(() => index.close());
  index.replace(fixture(4));
  const invalid = fixture(2);
  invalid.annotations[1].id = invalid.annotations[0].id;
  assert.throws(() => index.replace(invalid));
  assert.equal(index.search().total, 4);
  index.replace(fixture(1));
  assert.equal(index.search({ text: "白色" }).total, 0);
  assert.equal(index.search().total, 1);
});
test("large catalog returns bounded pages without transferring all annotations", (t) => {
  const index = createDiscoveryIndex();
  t.after(() => index.close());
  const start = performance.now();
  index.replace(fixture(10000));
  const result = index.search({ text: "白色外套", limit: 25, offset: 100 });
  assert.equal(result.total, 5000);
  assert.equal(result.items.length, 25);
  assert.ok(JSON.stringify(result).length < 20000);
  t.diagnostic(
    `10k records build + query: ${Math.round(performance.now() - start)} ms`,
  );
});
