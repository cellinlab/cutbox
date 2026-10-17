/** End-to-end expansion acceptance: real renderer, storage and local media workers. */
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { _electron as electron } from "playwright";
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const temp = await mkdtemp(join(tmpdir(), "cutbox-expansion-"));
const qa = process.env.CUTBOX_QA_DIR || join(tmpdir(), "cutbox-qa");
await mkdir(qa, { recursive: true });
const source = join(temp, "expansion-fixture.mp4");
const output = join(temp, "exports");
await mkdir(output);
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
  "4",
  "-c:v",
  "libx264",
  "-pix_fmt",
  "yuv420p",
  "-c:a",
  "aac",
  "-shortest",
  source,
]);
let app, page;
const pageErrors = [];
try {
  app = await electron.launch({
    args: [...(process.platform === "linux" ? ["--no-sandbox"] : []), root],
    env: { ...process.env, CUTBOX_DATA_DIR: join(temp, "workspace") },
  });
  page = await app.firstWindow();
  page.setDefaultTimeout(20000);
  page.on("pageerror", (e) => pageErrors.push(e.message));
  await page.setViewportSize({ width: 1505, height: 1045 });
  await page.getByRole("button", { name: "选择本地文件" }).waitFor();
  async function snapshot() {
    return page.evaluate(() => window.cutbox.snapshot());
  }
  async function until(predicate, label) {
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      const data = await snapshot();
      if (predicate(data)) return data;
      await page.waitForTimeout(100);
    }
    throw new Error(`Timed out ${label}`);
  }
  async function choose(paths) {
    await app.evaluate(({ dialog }, filePaths) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths });
    }, paths);
  }
  async function nav(name) {
    await page
      .getByRole("navigation", { name: "工作区" })
      .getByRole("button", { name, exact: true })
      .click();
  }
  await choose([source]);
  await page.getByRole("button", { name: "导入素材", exact: true }).click();
  await until((d) => d.media.length === 1, "import");
  await nav("标注模板");
  await page.getByRole("button", { name: "新建模板", exact: true }).click();
  let modal = page.getByRole("dialog");
  await modal.getByLabel("模板名称").fill("服装观察模板");
  await modal.getByLabel("模板说明").fill("颜色与层次的结构化观察");
  await modal.getByRole("button", { name: "添加字段" }).click();
  await modal.getByLabel("标识键").fill("color");
  await modal.getByLabel("显示名称").fill("服装颜色");
  await modal.getByRole("checkbox", { name: "必填" }).check();
  await modal.getByRole("button", { name: "保存模板" }).click();
  await until((d) => d.templates.length === 1, "template");
  await modal.waitFor({ state: "hidden" });
  await nav("标注工作台");
  await page.locator("video").waitFor();
  await page.waitForFunction(
    () => document.querySelector("video")?.readyState >= 2,
  );
  await page.getByText("系列 / 集数与源信息", { exact: true }).click();
  await page.getByLabel("系列名称").fill("测试系列");
  await page.getByLabel("集数", { exact: true }).fill("E01");
  await page.getByRole("button", { name: "保存源信息" }).click();
  await until((d) => d.media[0].episode === "E01", "source metadata");
  await page.getByRole("button", { name: "框选区域", exact: true }).click();
  const overlay = page.getByLabel("画面标注层");
  const box = await overlay.boundingBox();
  assert(box && box.width > 200);
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.7, {
    steps: 10,
  });
  await page.mouse.up();
  await page.getByLabel("标注名称", { exact: true }).fill("蓝色外套证据");
  await page.getByLabel("入点（秒）").fill("0.5");
  await page.getByLabel("出点（秒）").fill("2.5");
  await page.getByLabel("标注类别").fill("costume");
  await page.getByLabel("信息性质").selectOption("observed");
  await page.getByLabel("置信度（0–1，可留空）").fill("0.9");
  await page.getByLabel("标签（每行一个）").fill("蓝色\n外套");
  const template = (await snapshot()).templates[0];
  await page.getByLabel("字段模板").selectOption(template.id);
  await page.getByLabel("服装颜色 *").fill("蓝色");
  await page.getByLabel("轨迹标识").fill("character-a-track");
  await page.locator("video").evaluate((v) => {
    v.currentTime = 0.75;
  });
  await page.waitForFunction(
    () => document.querySelector("video").currentTime >= 0.74,
  );
  await page.getByRole("button", { name: "记录当前框为关键帧" }).click();
  await page.getByRole("button", { name: "保存标注", exact: true }).click();
  const marked = await until(
    (d) => d.annotations.length === 1,
    "geometry annotation",
  );
  const a = marked.annotations[0];
  assert(Math.abs(a.region.x - 0.2) < 0.015);
  assert(Math.abs(a.region.width - 0.4) < 0.015);
  assert.equal(a.values.color, "蓝色");
  assert.equal(a.keyframes.length, 1);
  assert.equal(a.epistemic, "observed");
  await page.getByRole("button", { name: "编辑 蓝色外套证据" }).click();
  await page.getByRole("button", { name: "多边形", exact: true }).click();
  await overlay.scrollIntoViewIfNeeded();
  const poly = await overlay.boundingBox();
  for (const [x, y] of [
    [0.25, 0.25],
    [0.55, 0.25],
    [0.5, 0.65],
  ])
    await page.mouse.click(poly.x + poly.width * x, poly.y + poly.height * y);
  await page.getByRole("button", { name: "保存标注", exact: true }).click();
  await until((d) => d.annotations[0].polygon?.length === 3, "polygon");
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await until((d) => !d.annotations[0].polygon, "undo polygon");
  await page.getByRole("button", { name: "重做", exact: true }).click();
  await until((d) => d.annotations[0].polygon?.length === 3, "redo polygon");
  await page.getByRole("button",{name:"编辑 蓝色外套证据"}).click();
  await page.getByLabel("置信度（0–1，可留空）").fill("");
  await page.getByRole("button",{name:"保存标注",exact:true}).click();
  await until(d=>d.annotations[0].confidence===null,"unknown confidence");
  await page.getByRole("button", { name: "读取源帧时间" }).click();
  await page.getByRole("button", { name: /已索引 96 帧/ }).waitFor();
  await page.getByRole("button", { name: "时间线 蓝色外套证据" }).click();
  await page.waitForFunction(
    () => Math.abs(document.querySelector("video").currentTime - 0.5) < 0.05,
  );
  await page.getByRole("button", { name: "观看", exact: true }).click();
  await page.keyboard.press("ArrowRight");
  await page.waitForFunction(
    () => document.querySelector("video").currentTime > 0.5,
  );
  await page.getByRole("checkbox",{name:"循环选定区间"}).check();
  await page.locator("video").evaluate(async v=>{v.currentTime=2.45;await v.play()});
  await page.waitForFunction(()=>document.querySelector("video").currentTime<1.5);
  await page.locator("video").evaluate(v=>v.pause());
  await page.getByRole("checkbox",{name:"循环选定区间"}).uncheck();
  await page.screenshot({ path: join(qa, "expanded-editor.png") });
  await nav("素材库");
  await page.getByText("组合筛选 · 所有条件同时匹配", { exact: true }).click();
  await page.getByLabel("系列", { exact: true }).fill("测试系列");
  await page.getByLabel("标注标签").fill("蓝色");
  await page.getByRole("button", { name: /蓝色外套证据 · 0.500/ }).click();
  await page.waitForFunction(
    () => Math.abs(document.querySelector("video")?.currentTime - 0.5) < 0.05,
  );
  await nav("分析与维护");
  await page.getByLabel("分析类型").selectOption("scenes");
  await page.getByRole("button", { name: "开始分析", exact: true }).click();
  await page.getByRole("button", { name: "全选", exact: true }).waitFor();
  assert.equal(
    (await snapshot()).annotations.length,
    1,
    "suggestions must not auto-save",
  );
  await page.getByRole("button", { name: "全选", exact: true }).click();
  await page.getByRole("button", { name: "接受所选建议" }).click();
  await until((d) => d.annotations.length > 1, "accept scenes");
  await page.getByLabel("分析类型").selectOption("waveform");
  await page.getByRole("button", { name: "开始分析", exact: true }).click();
  await page.getByLabel("音频波形").waitFor();
  assert((await page.getByLabel("音频波形").locator("button").count()) > 10);
  await page.getByRole("button", { name: "检查源文件完整性" }).click();
  await page.getByText("已验证", { exact: true }).waitFor();
  await page.screenshot({ path: join(qa, "analysis-tools.png") });
  await nav("素材集合");
  await page.getByRole("button", { name: "新建集合" }).click();
  modal = page.getByRole("dialog");
  await modal.getByLabel("集合名称").fill("结构化证据集合");
  for (const checkbox of await modal.getByRole("checkbox").all())
    await checkbox.check();
  await modal.getByRole("button", { name: "保存集合" }).click();
  await until((d) => d.collections.length === 1, "collection");
  await modal.waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "播放列表" }).click();
  await page.locator(".playlist video").waitFor();
  await choose([output]);
  await page.getByLabel("交换格式").selectOption("jsonl");
  await page.getByRole("button", { name: "导出交换格式" }).click();
  await page.getByRole("status").filter({ hasText: "已导出到" }).waitFor();
  const entries = await readdir(output);
  assert(entries.some((e) => e.includes("jsonl")));
  await page.getByLabel("批量参考类型").selectOption("frame");
  await page.getByRole("button", { name: "批量导出标注参考" }).click();
  await page
    .getByRole("status")
    .filter({ hasText: "CutBox-references" })
    .waitFor({ timeout: 30000 });
  assert((await readdir(output)).some((e) => e.includes("references")));
  await nav("分析与维护");
  await choose([output]);
  await page.getByRole("button", { name: "创建项目备份" }).click();
  await page
    .getByRole("status")
    .filter({ hasText: "CutBox-backup" })
    .waitFor({ timeout: 30000 });
  assert((await readdir(output)).some((e) => e.includes("backup")));
  assert.deepEqual(pageErrors, []);
  console.log(
    "PASS expansion desktop: templates+typed values, source episode, direct box/polygon+keyframes, undo/redo, frame index seek, conjunctive search/source jump, scene suggestions manual acceptance, waveform, source verification, playlist, portable export, batch frame references, backup; no pageerrors.",
  );
} catch (error) {
  if (page) {
    await page
      .screenshot({ path: join(qa, "expansion-failure.png"), fullPage: true })
      .catch(() => {});
    console.error(
      await page.locator("[role=alert],.warning").allTextContents(),
    );
  }
  throw error;
} finally {
  if (app) await app.close();
  if (!process.env.CUTBOX_KEEP_TEST_DATA)
    await rm(temp, { recursive: true, force: true });
}
