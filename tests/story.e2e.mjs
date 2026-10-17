/** Real Electron story authoring and playthrough. Only OS file pickers are replaced. */
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { _electron as electron } from "playwright";

const project = dirname(dirname(fileURLToPath(import.meta.url)));
const fixture = await mkdtemp(join(tmpdir(), "cutbox-story-e2e-"));
const screenshots =
  process.env.CUTBOX_QA_DIR || join(tmpdir(), "cutbox-story-qa");
await mkdir(screenshots, { recursive: true });
const source = join(fixture, "station.mp4");
execFileSync(process.env.CUTBOX_FFMPEG || "ffmpeg", [
  "-hide_banner",
  "-loglevel",
  "error",
  "-f",
  "lavfi",
  "-i",
  "testsrc2=size=480x270:rate=12",
  "-t",
  "2",
  "-c:v",
  "libx264",
  "-pix_fmt",
  "yuv420p",
  source,
]);
let app;
const errors = [];
async function launch() {
  app = await electron.launch({
    args: [...(process.platform === "linux" ? ["--no-sandbox"] : []), project],
    env: { ...process.env, CUTBOX_DATA_DIR: join(fixture, "data") },
  });
  const page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.waitForFunction(() =>
    [...document.querySelectorAll("header button")].some(
      (b) => b.textContent.trim() === "导入素材" && !b.disabled,
    ),
  );
  return page;
}
try {
  let page = await launch();
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [path],
    });
  }, source);
  // Fixture entities are created through the real bridge; tested event/relation/story operations use UI.
  const fixtureIds = await page.evaluate(async () => {
    let data = await window.cutbox.importMedia();
    data = await window.cutbox.saveEntity({
      type: "character",
      name: "调查者",
      description: "",
      tags: [],
      mediaIds: [data.media[0].id],
    });
    data = await window.cutbox.saveEntity({
      type: "scene",
      name: "车站",
      description: "",
      tags: [],
      mediaIds: [data.media[0].id],
    });
    data = await window.cutbox.saveAnnotation({
      mediaId: data.media[0].id,
      entityId: data.entities[0].id,
      start: 0.2,
      end: 1.4,
      label: "信件证据",
      notes: "",
      reviewState: "accepted",
    });
    return {
      media: data.media[0].id,
      character: data.entities[0].id,
      scene: data.entities[1].id,
    };
  });
  await page.reload();
  await page.getByRole("button", { name: "故事与关系", exact: true }).click();
  await page.getByRole("button", { name: "新建事件", exact: true }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("事件名称", { exact: true }).fill("发现信件");
  await dialog
    .getByLabel("事件描述", { exact: true })
    .fill("调查者在车站发现信件。");
  await dialog.getByLabel("故事时间 / 顺序").fill("10");
  await dialog.getByLabel("发生场景").selectOption(fixtureIds.scene);
  await dialog.getByRole("checkbox", { name: "调查者", exact: true }).check();
  await dialog.getByRole("checkbox", { name: /信件证据/ }).check();
  await dialog
    .getByRole("button", { name: "添加状态变化", exact: true })
    .click();
  await dialog.getByLabel("变化 1 属性").fill("knowledge");
  await dialog.getByLabel("变化 1 新值").fill("知道会面地点");
  await dialog.getByRole("button", { name: "保存事件", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  await page
    .getByRole("button", { name: "编辑事件 发现信件", exact: true })
    .click();
  await page
    .getByLabel("事件描述", { exact: true })
    .fill("已核对原片：调查者在车站发现信件。");
  await page.getByRole("button", { name: "保存事件", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  let data = await page.evaluate(() => window.cutbox.snapshot());
  assert.equal(
    data.events[0].description,
    "已核对原片：调查者在车站发现信件。",
  );
  assert.equal(data.events[0].changes[0].after, "知道会面地点");
  assert.equal(data.events[0].annotationIds.length, 1);
  assert.equal(data.events[0].confidence, null);
  await page.screenshot({ path: join(screenshots, "story-events.png") });
  await page.getByRole("button", { name: /信件证据 ·/ }).click();
  await page.waitForFunction(() => {
    const video = document.querySelector("video");
    return video && Math.abs(video.currentTime - 0.2) < 0.03;
  });
  await page.getByRole("button", { name: "故事与关系", exact: true }).click();
  await page.getByRole("tab", { name: "人物关系", exact: true }).click();
  await page.getByRole("button", { name: "新建关系", exact: true }).click();
  await page.getByLabel("关系起点").selectOption(fixtureIds.character);
  await page.getByLabel("关系终点").selectOption(fixtureIds.scene);
  await page.getByLabel("关系类型").fill("located_in");
  await page.getByLabel("关系描述").fill("调查者位于车站。");
  await page.getByRole("checkbox", { name: "信件证据", exact: true }).check();
  await page.getByRole("button", { name: "保存关系", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "编辑关系", exact: true }).click();
  await page.getByLabel("置信度（0–1）").fill("0.95");
  await page.getByRole("button", { name: "保存关系", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  data = await page.evaluate(() => window.cutbox.snapshot());
  assert.equal(data.relations[0].confidence, 0.95);
  await page.getByRole("tab", { name: "互动故事", exact: true }).click();
  await page.getByRole("button", { name: "打开探索示例", exact: true }).click();
  await page.getByLabel("故事名称", { exact: true }).fill("车站调查测试");
  await page.getByLabel("关联原片素材").selectOption(fixtureIds.media);
  await page.getByLabel("素材入点（秒）").fill("0.2");
  await page.getByLabel("素材出点（秒）").fill("1.4");
  await page.getByLabel("节点信息性质").selectOption("observed");
  await page.getByRole("checkbox", { name: "发现信件", exact: true }).check();
  await page.getByRole("button", { name: "试玩当前草稿", exact: true }).click();
  const locked = page.getByRole("button", {
    name: "根据线索还原会面计划 条件未满足",
  });
  assert.equal(await locked.isDisabled(), true);
  await page.waitForFunction(
    () => document.querySelector("video")?.readyState >= 2,
  );
  await page.screenshot({
    path: join(screenshots, "story-preview-locked.png"),
  });
  await page.getByRole("button", { name: "查看信件", exact: true }).click();
  await page
    .getByRole("button", { name: "记住线索并返回", exact: true })
    .click();
  assert.equal(
    await page
      .getByRole("button", { name: "根据线索还原会面计划", exact: true })
      .isEnabled(),
    true,
  );
  await page
    .getByRole("button", { name: "根据线索还原会面计划", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "找到会面地点", exact: true })
    .waitFor();
  await page.screenshot({
    path: join(screenshots, "story-preview-ending.png"),
  });
  await page.getByRole("button", { name: "重新开始", exact: true }).click();
  assert.equal(await locked.isDisabled(), true);
  await page.getByRole("button", { name: "结构编辑", exact: true }).click();
  await page.screenshot({ path: join(screenshots, "story-editor.png") });
  await page.getByRole("button", { name: "保存故事", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  data = await page.evaluate(() => window.cutbox.snapshot());
  assert.equal(data.stories.length, 1);
  assert.equal(data.stories[0].variables[0].initial, false);
  assert.equal(data.stories[0].nodes[0].epistemic, "observed");
  assert.equal(data.stories[0].nodes[1].epistemic, "invented");
  assert.equal(data.stories[0].nodes[0].eventIds[0], data.events[0].id);
  // Export uses the real worker and native save dialog path.
  const exported = join(fixture, "story.json");
  await app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
  }, exported);
  await page.getByRole("button", { name: "JSON", exact: true }).click();
  await page.getByRole("status").filter({ hasText: exported }).waitFor();
  const envelope = JSON.parse(await readFile(exported, "utf8"));
  assert.equal(envelope.schema, "cutbox.story/0.1");
  envelope.story.name = "导入的调查故事";
  await page
    .getByRole("button", { name: "导入故事 JSON", exact: true })
    .click();
  await page
    .getByLabel("故事 JSON", { exact: true })
    .fill(JSON.stringify(envelope));
  await page.getByRole("button", { name: "验证并导入", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  data = await page.evaluate(() => window.cutbox.snapshot());
  assert.equal(data.stories.length, 2);
  assert.notEqual(data.stories[0].id, data.stories[1].id);
  // A broken import must not create partial records.
  await page
    .getByRole("button", { name: "导入故事 JSON", exact: true })
    .click();
  envelope.story.nodes[0].choices[0].targetId = "missing";
  await page
    .getByLabel("故事 JSON", { exact: true })
    .fill(JSON.stringify(envelope));
  await page.getByRole("button", { name: "验证并导入", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("alert")
    .filter({ hasText: "目标节点不存在" })
    .waitFor();
  assert.equal(
    (await page.evaluate(() => window.cutbox.snapshot())).stories.length,
    2,
  );
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await app.close();
  app = undefined;
  page = await launch();
  data = await page.evaluate(() => window.cutbox.snapshot());
  assert.equal(data.stories.length, 2);
  assert.equal(data.events.length, 1);
  assert.equal(data.relations.length, 1);
  assert.deepEqual(errors, []);
  console.log(
    "Story Electron E2E passed: event + relation CRUD, evidence, playable gated branches, source media, JSON roundtrip, invalid-import rollback and restart persistence.",
  );
} catch (error) {
  if (app) {
    const page = await app.firstWindow();
    await page.screenshot({ path: join(screenshots, "story-failure.png") });
    console.error((await page.locator("body").innerText()).slice(-5000));
  }
  throw error;
} finally {
  await app?.close();
  await rm(fixture, { recursive: true, force: true });
}
