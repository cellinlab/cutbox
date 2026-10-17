/** Real Electron data-preparation workflow; only native picker answers are substituted. */
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  readdir,
  rm,
} from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { _electron as electron } from "playwright";
const root = dirname(dirname(fileURLToPath(import.meta.url))),
  temp = await mkdtemp(join(tmpdir(), "cutbox-data-e2e-")),
  qa = join(tmpdir(), "cutbox-data-qa");
await mkdir(qa, { recursive: true });
const source = join(temp, "data-source.mp4"),
  subtitle = join(temp, "source.srt"),
  exports = join(temp, "exports");
await mkdir(exports);
execFileSync("ffmpeg", [
  "-v",
  "error",
  "-f",
  "lavfi",
  "-i",
  "testsrc2=size=640x360:rate=10:duration=3",
  "-c:v",
  "libx264",
  "-threads",
  "1",
  source,
]);
await writeFile(
  subtitle,
  "1\n00:00:00,200 --> 00:00:01,000\n实验室里的白外套\n\n2\n00:00:01,200 --> 00:00:02,000\n角色走向传送门\n",
);
let app;
const errors = [];
try {
  app = await electron.launch({
    args: [...(process.platform === "linux" ? ["--no-sandbox"] : []), root],
    env: { ...process.env, CUTBOX_DATA_DIR: join(temp, "workspace") },
  });
  const page = await app.firstWindow();
  page.setDefaultTimeout(20000);
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1505, height: 1045 });
  await page.getByRole("button", { name: "选择本地文件" }).waitFor();
  assert.equal(await page.title(), "CutBox · 本地影视素材工作台");
  assert.match(page.url(), /dist\/index.html/);
  const choose = (paths) =>
    app.evaluate(({ dialog }, filePaths) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths });
    }, paths);
  const nav = (name) =>
    page
      .getByRole("navigation", { name: "工作区" })
      .getByRole("button", { name, exact: true })
      .click();
  await choose([source]);
  await page.getByRole("button", { name: "导入素材", exact: true }).click();
  await page.waitForFunction(
    async () => (await window.cutbox.snapshot()).media.length === 1,
  );
  await nav("数据准备");
  await page.getByRole("heading", { name: "片段检索" }).waitFor();
  await page.screenshot({ path: join(qa, "data-search.png"), fullPage: false });
  await page.getByRole("button", { name: "安装影视制作模板" }).click();
  await page.waitForFunction(
    async () => (await window.cutbox.snapshot()).templates.length === 5,
  );
  await page
    .getByLabel("字幕对应素材")
    .selectOption({ label: "data-source.mp4" });
  await choose([subtitle]);
  await page.getByRole("button", { name: "选择并导入字幕" }).click();
  await page
    .getByRole("status")
    .filter({ hasText: "已导入 2 条字幕" })
    .waitFor();
  await page.getByLabel("检索内容", { exact: true }).fill("白外套");
  await page.getByText("找到 1 条标注", { exact: true }).waitFor();
  await page.locator(".data-results").getByRole("button").click();
  await page.locator("video").waitFor();
  await page.waitForFunction(
    () => Math.abs(document.querySelector("video").currentTime - 0.2) < 0.15,
  );
  await nav("数据准备");
  await page.getByRole("button", { name: "检查数据质量" }).click();
  await page.getByText("可用 0 / 2 条 · 排除 2 条", { exact: true }).waitFor();
  assert.equal(
    await page.getByRole("button", { name: "导出训练准备包" }).isDisabled(),
    true,
  );
  await page.evaluate(async () => {
    const d = await window.cutbox.snapshot();
    await window.cutbox.saveAnnotations({
      annotations: d.annotations.map((a) => ({
        ...a,
        reviewState: "accepted",
        epistemic: "observed",
      })),
    });
  });
  await page.reload();
  await page.getByRole("button", { name: "导入素材", exact: true }).waitFor();
  await nav("数据准备");
  await page.getByRole("button", { name: "检查数据质量" }).click();
  await page.getByText("可用 2 / 2 条 · 排除 0 条", { exact: true }).waitFor();
  await page.getByLabel("训练集 %", { exact: true }).fill("100");
  await page.getByLabel("验证集 %", { exact: true }).fill("0");
  await choose([exports]);
  await page.getByRole("button", { name: "导出训练准备包" }).click();
  await page.getByText(/已导出到.*samples\.jsonl/).waitFor();
  const dirs = await readdir(exports);
  assert.equal(dirs.length, 1);
  const rows = (await readFile(join(exports, dirs[0], "samples.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .map(JSON.parse);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].split, "train");
  assert.ok(!JSON.stringify(rows).includes(temp));
  await page.screenshot({
    path: join(qa, "data-preparation.png"),
    fullPage: false,
  });
  await page.setViewportSize({ width: 980, height: 760 });
  await page.screenshot({
    path: join(qa, "data-preparation-compact.png"),
    fullPage: false,
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    true,
  );
  assert.equal(await page.locator("vite-error-overlay").count(), 0);
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      status: "passed",
      workflow:
        "subtitle import -> source search/seek -> quality exclusions -> accepted samples -> real training export",
      pageErrors: errors,
      screenshots: qa,
    }),
  );
} finally {
  await app?.close();
  await rm(temp, { recursive: true, force: true });
}
