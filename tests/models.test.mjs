import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { analyzeMedia, exportModelReference, modelConfig, modelStatus } from '../desktop/models.mjs';

const exec = promisify(execFile);
const config = { pythonPath: process.env.CUTBOX_PYTHON || 'python3', ...(process.env.CUTBOX_DEPTH_MODEL ? { depthModelPath: process.env.CUTBOX_DEPTH_MODEL } : {}) };
const status = await modelStatus({ config });

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'cutbox-model-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await exec(config.pythonPath, ['-c', `
import cv2, numpy as np, sys, os
root=sys.argv[1]
frame=np.full((240,400,3),255,np.uint8)
cv2.putText(frame,'CUTBOX 123',(20,130),cv2.FONT_HERSHEY_SIMPLEX,1.7,(0,0,0),3)
cv2.imwrite(os.path.join(root,'text.png'),frame)
cv2.imwrite(os.path.join(root,'blank.png'),np.zeros_like(frame))
video=cv2.VideoWriter(os.path.join(root,'motion.avi'),cv2.VideoWriter_fourcc(*'MJPG'),5,(400,240))
assert video.isOpened()
for i in range(10):
 frame=np.full((240,400,3),50,np.uint8)
 for y in range(60,140,10):
  for x in range(60,140,10):
   cv2.rectangle(frame,(x+i*3,y),(x+i*3+8,y+8),(220,220,220) if (x+y)%20==0 else (0,0,0),-1)
 video.write(frame)
video.release()
`, directory], { timeout: 30_000 });
  return directory;
}

test('model settings reject invalid executable, language and device settings', () => {
  assert.throws(() => modelConfig({ device: 'magic' }), /device/);
  assert.throws(() => modelConfig({ pythonPath: '\0python' }), /pythonPath/);
  assert.throws(() => modelConfig({ ocrLanguage: 'eng; anything' }), /ocrLanguage/);
  assert.equal(modelConfig({ device: 'cpu' }).device, 'cpu');
});

test('missing runtime reports actionable unavailable capabilities', async () => {
  const result = await modelStatus({ config: { pythonPath: '/missing-cutbox-python' } });
  for (const capability of ['python', 'depth', 'pose', 'mask', 'transcription', 'ocr', 'tracking', 'detection']) {
    assert.equal(result[capability].available, false);
    assert.match(result[capability].reason, /CUTBOX_PYTHON/);
  }
});

test('analysis validates tasks, ranges, and tracking region before execution', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'cutbox-model-validation-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'input.mp4');
  await writeFile(path, 'invalid media');
  await assert.rejects(analyzeMedia({ task: 'invented', inputPath: path }), /Unsupported/);
  await assert.rejects(analyzeMedia({ task: 'tracking', inputPath: path }), /initial region/);
  await assert.rejects(analyzeMedia({ task: 'ocr', inputPath: path, start: 3, end: 1 }), /range/);
  await assert.rejects(analyzeMedia({ task: 'tracking', inputPath: path, region: { x: 0.9, y: 0, width: 0.5, height: 1 } }), /normalized/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(analyzeMedia({ task: 'ocr', inputPath: path, signal: controller.signal }), { name: 'AbortError' });
});

test('real Tesseract recognizes text and returns source regions as unreviewed suggestions', { skip: !status.ocr.available }, async t => {
  const directory = await fixture(t);
  const result = await analyzeMedia({ inputPath: join(directory, 'text.png'), task: 'ocr', config });
  assert.match(result.annotations.map(item => item.label).join(' '), /CUTBOX 123/);
  assert.ok(result.annotations.every(item => item.reviewState === 'suggested' && item.start === 0 && item.end === 0));
  assert.ok(result.annotations.every(item => item.region.width > 0 && item.region.x + item.region.width <= 1));
  assert.equal(result.provenance.model, 'Tesseract OCR');
  await assert.rejects(analyzeMedia({ inputPath: join(directory, 'text.png'), task: 'ocr', config: { ...config, ocrLanguage: 'missinglanguage' } }), /language data/);
});

test('real optical flow follows translated texture and refuses blank initial regions', { skip: !status.tracking.available }, async t => {
  const directory = await fixture(t);
  const inputPath = join(directory, 'motion.avi');
  const result = await analyzeMedia({ inputPath, task: 'tracking', region: { x: .13, y: .20, width: .27, height: .43 }, sampleFps: 2, config });
  assert.ok(result.annotations.length >= 3);
  assert.ok(result.annotations.at(-1).region.x - result.annotations[0].region.x > .05);
  assert.ok(result.annotations.every(item => item.end <= 2 && item.end > item.start));
  await assert.rejects(analyzeMedia({ inputPath, task: 'tracking', region: { x: .8, y: .1, width: .1, height: .1 }, config }), /trackable texture/);
});

test('real HOG detector returns an honest empty result on a blank image', { skip: !status.detection.available }, async t => {
  const directory = await fixture(t);
  const result = await analyzeMedia({ inputPath: join(directory, 'blank.png'), task: 'detection', config });
  assert.deepEqual(result.annotations, []);
  assert.match(result.provenance.model, /HOG/);
});

test('real MiDaS exports spatially varying H264 depth and refuses overwrite', { skip: !status.depth.available || !config.depthModelPath?.endsWith('.onnx') }, async t => {
  const directory = await fixture(t);
  const outputPath = join(directory, 'depth.mp4');
  const result = await exportModelReference({ inputPath: join(directory, 'motion.avi'), outputPath, start: 0, end: .4, mode: 'depth', config });
  assert.equal(result.duration, .4);
  assert.match(result.provenance.model, /MiDaS/);
  assert.equal(result.provenance.modelFiles[0].sha256.length, 64);
  const { stdout } = await exec(config.pythonPath, ['-c', 'import cv2,sys; c=cv2.VideoCapture(sys.argv[1]); ok,f=c.read(); assert ok; print(float(f.std())); c.release()', outputPath]);
  assert.ok(Number(stdout) > 10, 'depth output contains spatial variation from inference');
  const before = await readFile(outputPath);
  await assert.rejects(exportModelReference({ inputPath: join(directory, 'motion.avi'), outputPath, mode: 'depth', config }), /already exists/);
  assert.deepEqual(await readFile(outputPath), before);
  assert.equal((await readdir(directory)).filter(name => name.startsWith('.cutbox-model-')).length, 0);
});

test('missing model leaves no partial reference or staging output', { skip: !status.tracking.available }, async t => {
  const directory = await fixture(t);
  const outputPath = join(directory, 'missing.mp4');
  await assert.rejects(exportModelReference({ inputPath: join(directory, 'motion.avi'), outputPath, mode: 'depth', config: { ...config, depthModelPath: join(directory, 'missing.onnx') } }), /local model weights/);
  assert.ok(!(await readdir(directory)).some(name => name === 'missing.mp4' || name.startsWith('.cutbox-model-')));
});

test('cancelling active depth inference removes unpublished output', { skip: !status.depth.available || !config.depthModelPath?.endsWith('.onnx') }, async t => {
  const directory = await fixture(t);
  const outputPath = join(directory, 'cancelled.mp4');
  const controller = new AbortController();
  await assert.rejects(exportModelReference({ inputPath: join(directory, 'motion.avi'), outputPath, mode: 'depth', config, signal: controller.signal, onProgress() { controller.abort(); } }), { name: 'AbortError' });
  assert.ok(!(await readdir(directory)).some(name => name === 'cancelled.mp4' || name.startsWith('.cutbox-model-')));
});

test('real bundled MediaPipe executes pose detection and mask/pose video exports', { skip: !status.pose.available || !status.mask.available }, async t => {
  const directory = await fixture(t);
  const pose = await analyzeMedia({ inputPath: join(directory, 'blank.png'), task: 'pose', config });
  assert.deepEqual(pose.annotations, []);
  for (const mode of ['pose', 'mask']) {
    const outputPath = join(directory, `${mode}.mp4`);
    const result = await exportModelReference({ inputPath: join(directory, 'motion.avi'), outputPath, start: 0, end: .4, mode, config });
    assert.equal(result.duration, .4);
    assert.ok(result.provenance.modelFiles.length > 0);
    assert.ok((await readFile(outputPath)).length > 1000);
  }
});
