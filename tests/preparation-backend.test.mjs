import test from "node:test";
import assert from "node:assert/strict";
import { Worker } from "node:worker_threads";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
async function connect(directory) {
  const worker = new Worker(
      new URL("../desktop/backend-worker.mjs", import.meta.url),
      { workerData: { directory } },
    ),
    pending = new Map();
  await new Promise((resolve, reject) => {
    worker.once("message", resolve);
    worker.once("error", reject);
  });
  worker.on("message", (m) => {
    const item = pending.get(m.id);
    if (!item || m.type === "progress") return;
    pending.delete(m.id);
    m.error ? item.reject(new Error(m.error)) : item.resolve(m.result);
  });
  worker.on("error", (error) => {
    for (const item of pending.values()) item.reject(error);
    pending.clear();
  });
  const call = (method, input) =>
    new Promise((resolve, reject) => {
      const id = randomUUID();
      pending.set(id, { resolve, reject });
      worker.postMessage({ id, method, input });
    });
  return {
    call,
    close: async () => {
      try {
        await call("close");
      } finally {
        await worker.terminate();
      }
    },
  };
}
test(
  "preparation worker integrates atomic subtitles, cache invalidation, templates, production and training export",
  { timeout: 60000 },
  async (t) => {
    const temp = await mkdtemp(join(tmpdir(), "cutbox-prep-worker-"));
    let worker;
    t.after(async () => {
      await worker?.close();
      await rm(temp, { recursive: true, force: true });
    });
    const source = join(temp, "source.mp4");
    execFileSync("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=128x96:rate=10:duration=3",
      "-c:v",
      "libx264",
      "-threads",
      "1",
      source,
    ]);
    worker = await connect(join(temp, "db"));
    let data = await worker.call("importMedia", [source]),
      mediaId = data.media[0].id;
    data = await worker.call("installProductionTemplates");
    assert.equal(data.templates.length, 5);
    assert.deepEqual(await worker.call("installProductionTemplates"), data);
    const subtitle = join(temp, "dialogue.srt");
    await writeFile(
      subtitle,
      "1\n00:00:00,200 --> 00:00:01,000\n实验室对白\n\n2\n00:00:01,200 --> 00:00:02,000\n白外套角色\n",
    );
    const imported = await worker.call("importSubtitles", {
      mediaId,
      path: subtitle,
      offset: 0,
    });
    assert.equal(imported.count, 2);
    data = imported.snapshot;
    assert.equal(data.annotations[0].confidence, null);
    assert.equal(
      (await worker.call("discoverAnnotations", { text: "实验室" })).total,
      1,
    );
    const bad = join(temp, "bad.vtt");
    await writeFile(bad, "WEBVTT\n\n00:00.100 --> 00:10.000\n越界\n");
    await assert.rejects(
      worker.call("importSubtitles", { mediaId, path: bad, offset: 0 }),
      /duration|range|exceed|时|越/i,
    );
    assert.deepEqual(await worker.call("snapshot"), data);
    data = await worker.call("saveAnnotations", {
      annotations: data.annotations.map((a) => ({
        ...a,
        reviewState: "accepted",
      })),
    });
    assert.equal(
      (
        await worker.call("discoverAnnotations", {
          reviewState: "needs_review",
        })
      ).total,
      0,
    );
    assert.equal((await worker.call("inspectDataset", {})).summary.eligible, 2);
    await assert.rejects(
      worker.call("exportTrainingDataset", {
        directory: join(temp, "filtered"),
        minConfidence: 0.5,
      }),
      /No eligible/,
    );
    const training = await worker.call("exportTrainingDataset", {
      directory: join(temp, "training"),
      ratios: { train: 1, validation: 0, test: 0 },
      seed: "same",
      profile: "trimmed",
    });
    const rows = (await readFile(training.path, "utf8"))
      .trim()
      .split("\n")
      .map(JSON.parse);
    assert.equal(rows.length, 2);
    assert.equal(new Set(rows.map((r) => r.split)).size, 1);
    assert.equal(rows[0].split, "train");
    assert.ok(!JSON.stringify(rows).includes(temp));
    data = await worker.call("saveProduction", {
      name: "新剧实验",
      annotationIds: [data.annotations[0].id],
      shots: [
        {
          name: "开场",
          duration: 2,
          prompt: "进入实验室",
          continuity: "白外套",
        },
      ],
    });
    const production = data.productions[0];
    assert.equal(
      (await worker.call("productionAudit", production.id)).summary.shots,
      1,
    );
    assert.match(
      (
        await worker.call("draftShotPrompt", {
          productionId: production.id,
          shotId: production.shots[0].id,
        })
      ).prompt,
      /实验室对白/,
    );
    const kit = await worker.call("exportProduction", {
      productionId: production.id,
      directory: join(temp, "kit"),
      includeClips: true,
    });
    const manifest = JSON.parse(await readFile(kit.path, "utf8"));
    assert.ok(manifest.files.some((f) => f.kind === "frame"));
    assert.ok(manifest.files.some((f) => f.kind === "clip"));
    assert.ok(!JSON.stringify(manifest).includes(temp));
    await worker.close();
    worker = await connect(join(temp, "db"));
    assert.equal(
      (await worker.call("snapshot")).productions[0].name,
      "新剧实验",
    );
    assert.equal(
      (await worker.call("discoverAnnotations", { text: "白外套" })).total,
      1,
    );
    await worker.call("undo");
    assert.equal((await worker.call("snapshot")).productions.length, 0);
    assert.equal((await worker.call("discoverAnnotations", {})).total, 2);
  },
);
