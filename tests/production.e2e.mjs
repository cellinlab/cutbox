/** Production prep acceptance in real Electron. Native file pickers alone are replaced. */
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readdir, readFile, rm } from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { _electron as electron } from "playwright";
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const fixture = await mkdtemp(join(tmpdir(), "cutbox-production-e2e-"));
const qa = process.env.CUTBOX_QA_DIR || join(tmpdir(), "cutbox-production-qa");
await mkdir(qa, { recursive: true });
const mediaPath = join(fixture, "production-reference.mp4");
const output = join(fixture, "export");
await mkdir(output);
execFileSync(process.env.CUTBOX_FFMPEG || "ffmpeg", [
  "-hide_banner",
  "-loglevel",
  "error",
  "-f",
  "lavfi",
  "-i",
  "testsrc2=size=480x270:rate=12",
  "-t",
  "3",
  "-c:v",
  "libx264",
  "-pix_fmt",
  "yuv420p",
  mediaPath,
]);
let app, page;
const errors = [];
async function launch() {
  app = await electron.launch({
    args: [...(process.platform === "linux" ? ["--no-sandbox"] : []), root],
    env: { ...process.env, CUTBOX_DATA_DIR: join(fixture, "workspace") },
  });
  page = await app.firstWindow();
  page.setDefaultTimeout(20000);
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1505, height: 1045 });
  await page.waitForFunction(() =>
    [...document.querySelectorAll("header button")].some(
      (b) => b.textContent.trim() === "导入素材" && !b.disabled,
    ),
  );
  return page;
}
async function choose(paths) {
  await app.evaluate(({ dialog }, filePaths) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths });
  }, paths);
}
async function snapshot() {
  return page.evaluate(() => window.cutbox.snapshot());
}
async function until(predicate, label) {
  const end = Date.now() + 30000;
  while (Date.now() < end) {
    const data = await snapshot();
    if (predicate(data)) return data;
    await page.waitForTimeout(100);
  }
  throw new Error(`Timed out ${label}`);
}
async function nav() {
  await page
    .getByRole("navigation", { name: "工作区" })
    .getByRole("button", { name: "创作准备", exact: true })
    .click();
}
async function waitDialogClosed() {
  await page.getByRole("dialog").waitFor({ state: "hidden" });
}
try {
  await launch();
  await choose([mediaPath]);
  // Synthetic test references are seeded through the real bridge. Tested production operations use visible controls.
  const ids = await page.evaluate(async () => {
    let d = await window.cutbox.importMedia();
    const media = d.media[0];
    d = await window.cutbox.saveEntity({
      type: "character",
      name: "测试角色",
      description: "蓝色外套的角色参考。",
      tags: ["蓝色外套"],
      attributes: { coat: "blue" },
      mediaIds: [media.id],
    });
    d = await window.cutbox.saveEntity({
      type: "scene",
      name: "测试场景",
      description: "用合成图案验证镜头计划。",
      tags: [],
      mediaIds: [media.id],
    });
    d = await window.cutbox.saveAnnotation({
      mediaId: media.id,
      entityId: d.entities.find((e) => e.type === "character").id,
      start: 0.25,
      end: 1.5,
      label: "服装与动作证据",
      notes: "人物穿蓝色外套转身。",
      category: "costume",
      epistemic: "observed",
      confidence: 0.9,
      reviewState: "accepted",
    });
    return {
      mediaId: media.id,
      entityIds: d.entities.map((e) => e.id),
      annotationId: d.annotations[0].id,
    };
  });
  await page.reload();
  await nav();
  await page.getByRole("button", { name: "新建制作项目", exact: true }).click();
  let modal = page.getByRole("dialog");
  await modal.getByLabel("项目名称").fill("短片制作计划");
  await modal.getByLabel("项目说明").fill("本地参考与镜头交接验收。");
  await modal.getByLabel("交付目标").selectOption("seedance");
  await modal.getByLabel("画幅比例").selectOption("9:16");
  await modal.getByRole("checkbox", { name: "项目资产 测试角色" }).check();
  await modal.getByRole("checkbox", { name: "项目资产 测试场景" }).check();
  await modal
    .getByRole("checkbox", { name: "项目证据 服装与动作证据" })
    .check();
  await modal.getByLabel("制作说明 / 共用约束").fill("全片保持蓝色外套。");
  await modal
    .getByRole("button", { name: "保存制作项目", exact: true })
    .click();
  await until((d) => d.productions.length === 1, "create production");
  await waitDialogClosed();
  await page.getByRole("button", { name: "添加镜头", exact: true }).click();
  modal = page.getByRole("dialog");
  await modal.getByLabel("镜头名称").fill("人物转身");
  await modal.getByLabel("镜头意图").fill("中景观察人物转身，保留服装连续性。");
  await modal.getByLabel("计划时长（秒）").fill("2");
  await modal
    .getByLabel("生成提示", { exact: true })
    .fill("人物穿蓝色外套，缓慢转身，中景固定机位。");
  await modal.getByLabel("避免内容 / 负面提示").fill("避免服装颜色改变。");
  await modal.getByLabel("连续性约束").fill("蓝色外套保持一致。");
  await modal.getByRole("button", { name: "加入项目参考" }).click();
  await modal.getByRole("button", { name: "添加生成候选" }).click();
  await modal.getByLabel("候选 1 媒体").selectOption(ids.mediaId);
  await modal.getByLabel("候选 1 平台", { exact: true }).fill("本地测试");
  await modal
    .getByLabel("候选 1 模型", { exact: true })
    .fill("synthetic-fixture");
  await modal.getByLabel("候选 1 Seed").fill("42");
  await modal.getByLabel("候选 1 外部任务 ID").fill("test-task-001");
  await modal
    .getByLabel("候选 1 实际提示", { exact: true })
    .fill("实际测试提示：蓝色外套转身。");
  await modal.getByRole("button", { name: "选用候选 1" }).click();
  await modal.getByRole("button", { name: "保存镜头", exact: true }).click();
  let saved = await until(
    (d) => d.productions[0].shots.length === 1,
    "first shot",
  );
  await waitDialogClosed();
  const productionId = saved.productions[0].id;
  const firstShotId = saved.productions[0].shots[0].id;
  assert.equal(saved.productions[0].shots[0].outputMediaId, ids.mediaId);
  assert.equal(
    saved.productions[0].shots[0].annotationIds[0],
    ids.annotationId,
  );
  assert.equal(saved.productions[0].shots[0].takes[0].seed, "42");
  assert.equal(
    saved.productions[0].shots[0].takes[0].prompt,
    "实际测试提示：蓝色外套转身。",
  );
  await page
    .getByRole("button", { name: "从证据起草提示", exact: true })
    .click();
  modal = page.getByRole("dialog");
  await modal.waitFor();
  assert(
    (await modal.getByLabel("生成提示", { exact: true }).inputValue()).length >
      10,
  );
  assert.equal(
    (await snapshot()).productions[0].shots[0].prompt,
    "人物穿蓝色外套，缓慢转身，中景固定机位。",
    "prompt assistance must not auto-save",
  );
  assert.equal(
    (await snapshot()).productions[0].shots[0].takes[0].prompt,
    "实际测试提示：蓝色外套转身。",
    "prompt assistance must preserve candidate provenance",
  );
  await modal.getByRole("button", { name: "取消", exact: true }).click();
  await page.getByRole("button", { name: "添加镜头", exact: true }).click();
  modal = page.getByRole("dialog");
  await modal.getByLabel("镜头名称").fill("场景建立");
  await modal.getByLabel("计划时长（秒）").fill("3");
  await modal.getByRole("checkbox", { name: "镜头资产 测试场景" }).check();
  await modal.getByRole("button", { name: "保存镜头", exact: true }).click();
  await until((d) => d.productions[0].shots.length === 2, "second shot");
  await waitDialogClosed();
  await page.getByRole("button", { name: "检查交付准备" }).click();
  await page.locator(".production-audit").waitFor();
  const incomplete = await page.evaluate(
    (id) => window.cutbox.productionAudit(id),
    productionId,
  );
  assert.notEqual(incomplete.status, "ready");
  await page.getByRole("button", { name: "编辑镜头 场景建立" }).click();
  modal = page.getByRole("dialog");
  await modal
    .getByLabel("生成提示", { exact: true })
    .fill("场景建立镜头，固定机位，保持前后光线一致。");
  await modal.getByLabel("连续性约束").fill("承接上一镜头的空间位置。");
  await modal.getByRole("button", { name: "保存镜头", exact: true }).click();
  await until((d) => d.productions[0].shots[1].prompt.length > 0, "edit shot");
  await waitDialogClosed();
  await page.getByRole("button", { name: "上移镜头 场景建立" }).click();
  await until((d) => d.productions[0].shots[0].name === "场景建立", "reorder");
  await page.getByRole("button", { name: "编辑项目", exact: true }).click();
  modal = page.getByRole("dialog");
  await modal.getByLabel("项目名称").fill("短片制作计划 · 已审核");
  await modal.getByLabel("交付目标").selectOption("tapnow");
  await modal.getByLabel("项目状态").selectOption("ready");
  await modal
    .getByRole("button", { name: "保存制作项目", exact: true })
    .click();
  await until((d) => d.productions[0].status === "ready", "project ready");
  await waitDialogClosed();
  await page.getByRole("button", { name: "检查交付准备" }).click();
  await page.locator(".production-audit").waitFor();
  await page.screenshot({
    path: join(qa, "production-plan.png"),
    fullPage: true,
  });
  await page
    .locator(".production-shot-select")
    .filter({ hasText: "人物转身" })
    .click();
  await page.getByRole("button", { name: /服装与动作证据/ }).click();
  await page.waitForFunction(
    () => Math.abs(document.querySelector("video")?.currentTime - 0.25) < 0.05,
  );
  await nav();
  await page
    .locator(".production-shot-select")
    .filter({ hasText: "人物转身" })
    .click();
  await page.locator(".production-take video").waitFor();
  await page.locator(".production-take video").evaluate((video) => {
    video.currentTime = 0.1;
  });
  await page.waitForFunction(
    () => document.querySelector(".production-take video")?.readyState >= 2,
  );

  await page.screenshot({
    path: join(qa, "production-shot.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 980, height: 760 });
  await page.evaluate(() => window.scrollTo(0, 0));
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    "compact layout must not overflow horizontally",
  );
  await page.screenshot({ path: join(qa, "production-compact.png") });
  await page.locator(".production-take video").scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(qa, "production-compact-shot.png") });
  await page.setViewportSize({ width: 1505, height: 1045 });
  await choose([output]);
  await page.getByRole("checkbox", { name: "携带参考片段" }).check();
  await page.getByRole("button", { name: "导出创作交接包" }).click();
  await page
    .getByRole("status")
    .filter({ hasText: "已导出到" })
    .waitFor({ timeout: 45000 });
  const outputs = await readdir(output);
  assert.equal(outputs.length, 1);
  const folder = join(output, outputs[0]);
  const files = await readdir(folder, { recursive: true });
  assert(files.some((f) => f.endsWith(".json")));
  assert(files.some((f) => f.endsWith(".md")));
  assert(
    files.some((f) => f.endsWith(".mp4")),
    "real reference clip must be present",
  );
  const allText = await Promise.all(
    files
      .filter((f) => /\.(json|md|txt|csv)$/.test(f))
      .map((f) => readFile(join(folder, f), "utf8")),
  );
  assert(allText.some((t) => t.includes("人物转身")));
  assert(allText.some((t) => t.includes("蓝色外套")));
  await page.getByRole("button", { name: "添加镜头", exact: true }).click();
  modal = page.getByRole("dialog");
  await modal.getByLabel("镜头名称").fill("临时镜头");
  await modal.getByLabel("生成提示", { exact: true }).fill("临时验证镜头");
  await modal.getByRole("button", { name: "保存镜头", exact: true }).click();
  await until((d) => d.productions[0].shots.length === 3, "temporary shot");
  await waitDialogClosed();
  await page.getByRole("button", { name: "删除镜头 临时镜头" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "确认删除镜头" })
    .click();
  await until((d) => d.productions[0].shots.length === 2, "delete shot");
  await waitDialogClosed();
  await page.getByRole("button", { name: "新建制作项目", exact: true }).click();
  modal = page.getByRole("dialog");
  await modal.getByLabel("项目名称").fill("临时项目");
  await modal
    .getByRole("button", { name: "保存制作项目", exact: true })
    .click();
  await until((d) => d.productions.length === 2, "temporary project");
  await waitDialogClosed();
  await page.getByRole("button", { name: "删除制作项目" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "确认删除项目" })
    .click();
  await until((d) => d.productions.length === 1, "delete project");
  await waitDialogClosed();
  const persisted = (await snapshot()).productions[0];
  assert.equal(persisted.id, productionId);
  assert(persisted.shots.some((s) => s.id === firstShotId));
  assert.equal(persisted.shots[0].name, "场景建立");
  await app.close();
  app = undefined;
  await launch();
  await nav();
  assert.deepEqual((await snapshot()).productions[0], persisted);
  await page
    .getByText("短片制作计划 · 已审核", { exact: true })
    .first()
    .waitFor();
  assert.deepEqual(errors, []);
  console.log(
    "PASS production desktop: create/edit project, target/aspect, references, shot CRUD/reorder, prompt assist without auto-save, selected take, readiness audit, exact source jump, real kit+clips export, deletions and restart persistence; no pageerrors.",
  );
} catch (error) {
  if (page) {
    await page
      .screenshot({ path: join(qa, "production-failure.png"), fullPage: true })
      .catch(() => {});
    console.error(
      await page
        .locator("[role=alert],.warning")
        .allTextContents()
        .catch(() => []),
    );
  }
  throw error;
} finally {
  if (app) await app.close();
  if (!process.env.CUTBOX_KEEP_TEST_DATA)
    await rm(fixture, { recursive: true, force: true });
}
