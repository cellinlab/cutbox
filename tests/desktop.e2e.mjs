/** Real Electron + SQLite + FFmpeg workflow. Only native file pickers are mocked. */
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readdir, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { _electron as electron } from "playwright";

const project = dirname(dirname(fileURLToPath(import.meta.url)));
const fixture = await mkdtemp(join(tmpdir(), "cutbox-desktop-e2e-"));
const screenshots = process.env.CUTBOX_QA_DIR || join(tmpdir(), "cutbox-qa");
await mkdir(screenshots, { recursive: true });
const video = join(fixture, "synthetic-reference.mp4");
const edge = join(fixture, "edges.mp4");
const exports = join(fixture, "exports");
await mkdir(exports);
execFileSync(process.env.CUTBOX_FFMPEG || "ffmpeg", [
  "-hide_banner",
  "-loglevel",
  "error",
  "-f",
  "lavfi",
  "-i",
  "testsrc2=size=640x360:rate=24",
  "-f",
  "lavfi",
  "-i",
  "sine=frequency=440:sample_rate=48000",
  "-t",
  "3",
  "-c:v",
  "libx264",
  "-pix_fmt",
  "yuv420p",
  "-c:a",
  "aac",
  "-shortest",
  video,
]);
const errors = [];
let app;
async function launch(directory) {
  app = await electron.launch({
    args: [...(process.platform === "linux" ? ["--no-sandbox"] : []), project],
    env: { ...process.env, CUTBOX_DATA_DIR: directory },
  });
  const page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1505, height: 1045 });
  await page.waitForFunction(() => Boolean(window.cutbox));
  await page.getByRole("button", { name: "导入素材", exact: true }).waitFor();
  await page.waitForFunction(
    () => !document.querySelector("header button")?.disabled,
  );
  return page;
}
async function picker(paths) {
  await app.evaluate(({ dialog }, filePaths) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths });
  }, paths);
}
async function saved(page, condition) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const data = await page.evaluate(() => window.cutbox.snapshot());
    const ready = {
      media: data.media.length === 1,
      character: data.entities.some((e) => e.name === "角色 A"),
      edited: data.entities.some((e) => e.name === "角色 A · 已编辑"),
      scene: data.entities.some((e) => e.name === "测试场景"),
      annotation: data.annotations.some((e) => e.label === "构图观察"),
      collection: data.collections.some((e) => e.name === "合成参考集合"),
      imported:
        data.media.length === 1 &&
        data.entities.length === 2 &&
        data.annotations.length === 1 &&
        data.collections.length === 1,
    }[condition];
    if (ready) return;
    await page.waitForTimeout(100);
  }
  throw new Error(`Snapshot condition timed out: ${condition}`);
}

try {
  let page = await launch(join(fixture, "workspace"));
  await page.getByRole("button", { name: "选择本地文件" }).waitFor();
  await page.screenshot({ path: join(screenshots, "empty-e2e.png") });
  await picker([video]);
  await page.getByRole("button", { name: "导入素材", exact: true }).click();
  await saved(page, "media");
  await page.getByRole("button", { name: /synthetic-reference.mp4/ }).waitFor();
  await page.screenshot({ path: join(screenshots, "library-populated.png") });

  await page.getByRole("button", { name: "资产", exact: true }).click();
  await page.getByRole("button", { name: "新建角色" }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("名称", { exact: true }).fill("角色 A");
  await dialog
    .getByLabel("描述", { exact: true })
    .fill("合成测试素材中的参考角色，不是真实人物。");
  await dialog.getByLabel("标签（以逗号分隔）").fill("蓝色外套, 转身, ");
  await dialog
    .getByRole("checkbox", { name: /synthetic-reference.mp4/ })
    .check();
  await dialog.getByRole("button", { name: "保存资产" }).click();
  await saved(page, "character");
  await page.getByRole("button", { name: /角色 A.*份参考/ }).click();
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("名称", { exact: true }).fill("角色 A · 已编辑");
  await dialog.getByRole("button", { name: "保存资产" }).click();
  await saved(page, "edited");
  await page.getByRole("dialog").waitFor({state:"hidden"});
  await page.screenshot({ path: join(screenshots, "character-assets.png") });
  await page.getByRole("button", { name: "场景", exact: true }).click();
  await page.getByRole("button", { name: "新建场景" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("名称", { exact: true }).fill("测试场景");
  await dialog.getByLabel("描述", { exact: true }).fill("色彩与构图测试场景。");
  await dialog
    .getByRole("checkbox", { name: /synthetic-reference.mp4/ })
    .check();
  await dialog.getByRole("button", { name: "保存资产" }).click();
  await saved(page, "scene");

  await page.getByRole("button", { name: "标注工作台", exact: true }).click();
  await page.locator("video").waitFor();
  await page.waitForFunction(
    () => document.querySelector("video")?.readyState >= 2,
  );
  await page.locator("video").evaluate(async (element) => {
    await element.play();
  });
  await page.waitForFunction(
    () => document.querySelector("video")?.currentTime > 0.2,
  );
  await page.locator("video").evaluate((element) => element.pause());
  await page.getByLabel("标注名称").fill("构图观察");
  await page.getByLabel("入点（秒）").fill("0.25");
  await page.getByLabel("出点（秒）").fill("1.5");
  const first = await page.evaluate(() => window.cutbox.snapshot());
  await page
    .getByLabel("关联资产")
    .selectOption(first.entities.find((e) => e.type === "character").id);
  await page
    .getByLabel("详细描述")
    .fill("合成色块运动，用于验证时间范围与资产关联。");
  await page.getByRole("checkbox", { name: "指定画面区域" }).check();
  await page.getByLabel("X", { exact: true }).fill("0.1");
  await page.getByLabel("Y", { exact: true }).fill("0.1");
  await page.getByLabel("宽度", { exact: true }).fill("0.5");
  await page.getByLabel("高度", { exact: true }).fill("0.5");
  await page.getByRole("button", { name: "保存标注" }).click();
  await saved(page, "annotation");
  await page.getByRole("button", { name: "编辑 构图观察" }).click();
  await page.screenshot({ path: join(screenshots, "annotation-editor.png") });
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath });
  }, edge);
  await page.getByLabel("输出类型").selectOption("edges");
  await page.getByRole("button", { name: "导出选定区间" }).click();
  await page
    .getByRole("status")
    .filter({ hasText: edge })
    .waitFor({ timeout: 30000 });
  assert((await stat(edge)).size > 1000);
  const probe = JSON.parse(
    execFileSync(
      process.env.CUTBOX_FFPROBE || "ffprobe",
      ["-v", "error", "-show_streams", "-show_format", "-of", "json", edge],
      { encoding: "utf8" },
    ),
  );
  assert(probe.streams.some((s) => s.codec_type === "video"));
  assert(
    Number(probe.format.duration) > 1 && Number(probe.format.duration) < 1.6,
  );

  await page.getByRole("button", { name: "素材集合", exact: true }).click();
  await page.getByRole("button", { name: "新建集合" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("集合名称").fill("合成参考集合");
  await dialog
    .getByLabel("描述", { exact: true })
    .fill("真实导出与重新导入验证。");
  for (const checkbox of await dialog.getByRole("checkbox").all())
    await checkbox.check();
  await dialog.getByRole("button", { name: "保存集合" }).click();
  await saved(page, "collection");
  await picker([exports]);
  await page.getByRole("button", { name: "导出集合" }).click();
  dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("素材包口令", { exact: true })
    .fill("test-only-passphrase-2026");
  await dialog.getByRole("button", { name: "选择位置并导出" }).click();
  await page
    .getByRole("status")
    .filter({ hasText: "素材包已导出" })
    .waitFor({ timeout: 30000 });
  const directories = await readdir(exports);
  assert.equal(directories.length, 1);
  const packageDirectory = join(exports, directories[0]);
  const cbox = (await readdir(packageDirectory)).find((name) =>
    name.endsWith(".cbox"),
  );
  assert(cbox);
  const beforeRestart = await page.evaluate(() => window.cutbox.snapshot());
  assert.deepEqual(
    beforeRestart.entities.find((e) => e.type === "character").tags,
    ["蓝色外套", "转身"],
  );
  assert.equal(beforeRestart.annotations[0].region.width, 0.5);
  await app.close();
  app = undefined;
  page = await launch(join(fixture, "workspace"));
  assert.deepEqual(
    await page.evaluate(() => window.cutbox.snapshot()),
    beforeRestart,
  );
  await app.close();
  app = undefined;

  page = await launch(join(fixture, "imported-workspace"));
  await picker([join(packageDirectory, cbox)]);
  await page.getByRole("button", { name: "导入素材包", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("素材包口令", { exact: true })
    .fill("test-only-passphrase-2026");
  await dialog.getByRole("button", { name: "选择素材包并导入" }).click();
  await saved(page, "imported");
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  const imported = await page.evaluate(() => window.cutbox.snapshot());
  assert.equal(imported.media.length, 1);
  assert.equal(imported.media[0].sha256, beforeRestart.media[0].sha256);
  assert.equal(imported.annotations[0].start, 0.25);
  assert.equal(imported.annotations[0].end, 1.5);
  assert.deepEqual(
    imported.annotations[0].region,
    beforeRestart.annotations[0].region,
  );
  assert.equal(
    imported.entities.find((e) => e.type === "character").name,
    "角色 A · 已编辑",
  );
  await page.getByRole("button", { name: "资产", exact: true }).click();
  await page.getByRole("button", { name: /角色 A.*份参考/ }).waitFor();
  await page.screenshot({ path: join(screenshots, "imported-assets.png") });
  assert.deepEqual(errors, []);
  console.log(
    "PASS Electron: native-picker import, playback, character create/edit, scene create, region annotation, collection, real edge video, encrypted package export/import, persistence; no pageerrors.",
  );
  console.log(`Screenshots: ${screenshots}`);
} finally {
  if (app) await app.close();
  if (!process.env.CUTBOX_KEEP_TEST_DATA)
    await rm(fixture, { recursive: true, force: true });
}
