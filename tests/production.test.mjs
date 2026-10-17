import test from "node:test";
import assert from "node:assert/strict";
import {
  auditProduction,
  draftShotPrompt,
  productionTemplates,
} from "../desktop/production.mjs";
const data = () => ({
  media: [{ id: "m", kind: "video", width: 1920, height: 1080 }],
  entities: [
    {
      id: "e",
      name: "研究员",
      type: "character",
      description: "蓝色短发",
      attributes: { outfit: "白外套" },
    },
  ],
  annotations: [
    {
      id: "a",
      mediaId: "m",
      entityId: "e",
      label: "实验室服装",
      notes: "袖口卷起",
      category: "wardrobe",
      values: { outfit: "白外套" },
      reviewState: "accepted",
      epistemic: "observed",
      confidence: 1,
    },
  ],
  productions: [
    {
      id: "p",
      name: "新剧",
      aspectRatio: "16:9",
      annotationIds: ["a"],
      entityIds: ["e"],
      shots: [
        {
          id: "s",
          name: "走入实验室",
          duration: 5,
          prompt: "原创镜头",
          continuity: "保持袖口卷起",
          annotationIds: [],
          entityIds: ["e"],
        },
      ],
    },
  ],
});
test("production readiness uses selected evidence and detects unreviewed/conflicting wardrobe", () => {
  const d = data();
  assert.equal(auditProduction(d, "p").status, "ready");
  d.annotations.push({
    ...d.annotations[0],
    id: "b",
    reviewState: "suggested",
    confidence: null,
    values: { outfit: "黑夹克" },
  });
  d.productions[0].shots[0].annotationIds = ["b"];
  const report = auditProduction(d, "p");
  assert.equal(report.status, "needs_review");
  assert.ok(report.issues.some((i) => i.code === "continuity_variants"));
  assert.equal(report.coverage[0].acceptedCount, 1);
  assert.equal(report.summary.referenceAnnotations, 2);
});
test("missing references block audit; incomplete original shots remain reviewable", () => {
  const d = data();
  d.annotations = [];
  assert.equal(auditProduction(d, "p").status, "blocked");
  d.productions[0].annotationIds = [];
  d.productions[0].entityIds = [];
  d.productions[0].shots[0].entityIds = [];
  d.productions[0].shots[0].prompt = "";
  assert.equal(auditProduction(d, "p").status, "needs_review");
  assert.throws(() => auditProduction(d, "missing"), /找不到/);
});
test("prompt drafting only assembles saved requirements/evidence and does not mutate", () => {
  const d = data(),
    before = structuredClone(d),
    result = draftShotPrompt(d, { productionId: "p", shotId: "s" });
  assert.match(result.prompt, /白外套/);
  assert.match(result.prompt, /observed \/ accepted/);
  assert.match(result.prompt, /保持袖口卷起/);
  assert.deepEqual(d, before);
  assert.equal(result.negativePrompt, "");
  assert.throws(
    () => draftShotPrompt(d, { productionId: "p", shotId: "absent" }),
    /保存/,
  );
});
test("production templates have distinct keys and actionable costume/shot/source fields", () => {
  assert.equal(new Set(productionTemplates.map((t) => t.id)).size, 5);
  for (const t of productionTemplates)
    assert.equal(new Set(t.fields.map((f) => f.key)).size, t.fields.length);
  assert.ok(
    productionTemplates.some((t) =>
      t.fields.some((f) => f.key === "usageBasis"),
    ),
  );
});
