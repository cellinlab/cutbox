# Local model runtime

CutBox can run OCR, optical-flow tracking, pedestrian proposals, depth, pose, foreground masks and speech transcription locally. Analysis creates **suggested** annotations; it does not identify actors, infer emotions, or silently accept a model's guesses. Reference exports are real H.264 videos with model provenance returned to the backend. No source media is uploaded and the worker never downloads weights.

## Install

Use Python 3.11 or 3.12. The optional runtime is separate from the app and the earlier `.cbox` Python experiment:

```sh
python3 -m venv .venv-models
.venv-models/bin/python -m pip install -r requirements-models.txt
export CUTBOX_PYTHON="$PWD/.venv-models/bin/python"
```

On Windows use `.venv-models\Scripts\python.exe` and set the corresponding environment variable. FFmpeg must be installed for reference encoding and audio extraction. OCR additionally needs Tesseract and language data (`brew install tesseract` on macOS; install `tesseract-lang` for additional languages). Chinese OCR uses `ocrLanguage: "chi_sim+eng"`; installation of the matching trained data is required. Nothing installs models merely by importing media.

The checked-in requirements pin the main runtime and compatibility-sensitive dependencies. Transitive wheels still vary by platform; this is not a reproducible operating-system image. Linux CPU is exercised; macOS Apple Silicon/Intel and Windows still require platform verification. MediaPipe 0.10.21 does not provide every Python/platform wheel combination; use a supported Python and architecture.

## Capabilities and assets

| Capability | Actual implementation | Required model assets | Limits |
|---|---|---|---|
| OCR | Tesseract TSV lines with regions/confidence | Installed Tesseract language data | Sampled frames; text is not speaker identity |
| Tracking | OpenCV pyramidal Lucas–Kanade flow with forward/backward checking | None | User selects initial region; fixed-size box; stops when texture is lost; no re-identification |
| Detection | OpenCV HOG pedestrian detector | Detector bundled with OpenCV | Upright pedestrian proposals only, not general object recognition |
| Depth | MiDaS v2.1 small ONNX via OpenCV DNN | Official `model-small.onnx` | Relative inverse depth, CPU, independent frames |
| Depth (alternative) | Transformers Depth Anything V2 | Local model directory with config, processor config and safetensors | Optional Torch/Transformers; CPU/MPS/CUDA where supported |
| Pose | MediaPipe 33-point pose | Pinned wheel's bundled full pose + detection weights, or local Pose Landmarker `.task` | Bundled model detects one person; task adapter allows four; no person identity tracking |
| Foreground mask | MediaPipe selfie segmentation | Pinned wheel's bundled selfie weights, or compatible local Image Segmenter | Foreground person mask, not arbitrary object segmentation |
| Transcription | faster-whisper / CTranslate2 with word timing and VAD | Local CTranslate2 model directory containing `model.bin` | No diarization; CPU int8 or CUDA; MPS unsupported |

MediaPipe's bundled fallback verifies the expected model files exist before opening the solution. It selects `model_complexity=1` / `model_selection=0`, which use the included assets. Missing files produce an actionable error. Explicit `poseModelPath` / `maskModelPath` settings select the Tasks API instead. The explicit mask model must use background category 0; other category conventions require a different adapter.

Capability status checks dependencies and local asset presence. `available: true` means the runtime and expected files are configured; actual execution still validates loadability, codec support and model compatibility. A corrupt or incompatible model fails clearly without producing a fake reference.

## Obtain the small depth model

Official source: [MiDaS v2.1 release](https://github.com/isl-org/MiDaS/releases/tag/v2_1), [license](https://github.com/isl-org/MiDaS/blob/v2_1/LICENSE) (MIT).

```sh
mkdir -p .local-models
curl --fail --location \
  https://github.com/isl-org/MiDaS/releases/download/v2_1/model-small.onnx \
  --output .local-models/midas-v21-small.onnx
export CUTBOX_DEPTH_MODEL="$PWD/.local-models/midas-v21-small.onnx"
```

The official artifact downloaded during validation was 66,764,249 bytes, SHA-256:

```text
2d8c6cb8f415229daf1eb041024208e2608c9f98e17c81cc7c6ecb449c56fd58
```

The digest records the tested bytes; it is not an upstream signature. Check the publisher and license before obtaining different weights. CutBox includes no weights in Git. This adapter expects the official v2.1 small input contract: 256×256 RGB, ImageNet mean/std. It is deliberately named **MiDaS**, not Depth Anything.

Depth is relative inverse depth, not metres. The export fixes normalization at the first frame's 2nd/98th percentiles; later depths can clip, and independent frame inference can flicker. It is useful as a visual reference but is not temporally consistent scene geometry. Output is at most 1280 pixels on its longest side and 30 fps, silent, and rounded to the output frame duration. Variable-frame-rate source timing is approximate.

## Optional alternatives

For Depth Anything V2, install `torch==2.6.0 transformers==4.49.0 safetensors==0.5.3`, obtain a complete local Transformers model directory, and set `CUTBOX_DEPTH_MODEL` to it. Loading uses `local_files_only=True`, `trust_remote_code=False`, and `use_safetensors=True`; pickle model files and remote model IDs are not accepted. [Depth Anything V2 Small](https://github.com/DepthAnything/Depth-Anything-V2) is Apache-2.0; larger checkpoints have different restrictions. Verify the chosen checkpoint's own model card.

For speech, obtain a compatible local [faster-whisper model](https://github.com/SYSTRAN/faster-whisper) and set `CUTBOX_WHISPER_MODEL` to its directory. The package is MIT; verify the selected model's license separately. A local directory is mandatory; passing a remote identifier will not download anything. The optional Depth Anything and Whisper weights normally come from `huggingface.co` (large-file downloads may also use Hugging Face's Xet/CDN hosts). This cloud workspace's network policy does not permit that route, so those two model paths were not downloaded or end-to-end validated here. No proxy/mirror bypass was attempted. The independently downloaded official GitHub MiDaS model supplies the tested depth capability.

MediaPipe's [source and model documentation](https://github.com/google-ai-edge/mediapipe) describe the Apache-2.0 package and model-specific terms. The normal Tasks downloads use `storage.googleapis.com`, which was not used in this environment. The tested bundled model files came from the official PyPI `mediapipe==0.10.21` wheel. Provenance includes SHA-256 hashes of the actual configured/bundled model files.

## API and operational behavior

`desktop/models.mjs` exports:

- `modelConfig(input)` normalizes the configured interpreter, local asset paths, device, FFmpeg/Tesseract executables and language settings.
- `modelStatus({ config, signal })` reports each capability and unavailable reasons.
- `analyzeMedia({ inputPath, task, start, end, sampleFps, region, config, signal, onProgress })` returns `{ task, annotations, provenance }`. Tasks are `ocr`, `tracking`, `detection`, `pose`, `transcription`. Region coordinates are normalized to the source frame; word/keypoint details remain suggestions.
- `exportModelReference({ inputPath, outputPath, start, end, mode, config, signal, onProgress })` returns `{ outputPath, duration, mode, provenance }`. Modes are `depth`, `pose`, `mask`.

Config keys: `pythonPath`, `depthModelPath`, `poseModelPath`, `maskModelPath`, `whisperModelPath`, `device`, `ffmpegPath`, `tesseractPath`, `language` (Whisper), `ocrLanguage` (Tesseract). Paths can also use `CUTBOX_PYTHON`, `CUTBOX_DEPTH_MODEL`, `CUTBOX_POSE_MODEL`, `CUTBOX_MASK_MODEL`, `CUTBOX_WHISPER_MODEL`, `CUTBOX_FFMPEG`, `CUTBOX_TESSERACT`.

The Node host spawns a separate Python process with argument arrays and JSON stdin, never a shell command. Output is bounded NDJSON, operations have timeouts, and cancellation terminates the process group on Unix; the Windows branch uses `taskkill /T` for the process tree and remains pending platform validation. Each worker receives its own temporary directory. Python signal handling unwinds it, and the Node host removes it and output staging even after errors, abrupt process exit or cancellation. Final publication uses an exclusive hard link so an existing destination is never overwritten. Models run offline, but malformed local model files can still fail the inference runtime; use trusted weights.

Each sampled analysis is limited to 10,000 suggestions and two hours of video; reference exports are bounded to 108,000 output frames. Operations should use short selected ranges for interactive work. No-result detection is returned as an empty list, not invented detections. MediaPipe generates black pose frames when nobody is detected, which is an actual negative result.

## Validation

```sh
CUTBOX_PYTHON="$PWD/.venv-models/bin/python" \
CUTBOX_DEPTH_MODEL="$PWD/.local-models/midas-v21-small.onnx" \
node --test --test-isolation=none tests/models.test.mjs
```

The test suite runs actual OCR on rendered text, tracks a moving texture, runs HOG on a blank image, verifies nonconstant depth video, executes MediaPipe pose/mask inference and MP4 encoding, checks unavailable runtimes, validates regions, and checks cleanup/overwrite protection. Optional runtime tests skip only when the corresponding dependencies or weights are absent; report the skip count when describing validation. These are integration checks of inference and export mechanics, not accuracy benchmarks on cinema footage.
