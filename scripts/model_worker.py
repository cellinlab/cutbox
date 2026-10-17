#!/usr/bin/env python3
"""CutBox local-only model subprocess. JSON input, NDJSON progress/result output.

Weights are never downloaded here. Every generated annotation is a suggestion.
"""
import csv
import hashlib
import importlib.util
import io
import json
import math
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import wave

os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")
MAX_SUGGESTIONS = 10000
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff"}


def cancelled(signum, frame):
    raise InterruptedError("Local model operation cancelled")


signal.signal(signal.SIGTERM, cancelled)


def emit(kind, **data):
    print(json.dumps({"type": kind, **data}, ensure_ascii=False, allow_nan=False), flush=True)


def installed(name):
    try:
        return importlib.util.find_spec(name) is not None
    except (ImportError, ValueError):
        return False


def executable(command):
    return bool(shutil.which(command))


def bundled_mediapipe(task):
    """Only the pinned wheel's actual assets enable this offline fallback."""
    try:
        spec = importlib.util.find_spec("mediapipe")
        if spec is None or spec.origin is None:
            return []
        root = Path(spec.origin).parent
        names = ["modules/pose_detection/pose_detection.tflite", "modules/pose_landmark/pose_landmark_full.tflite"] if task == "pose" else ["modules/selfie_segmentation/selfie_segmentation.tflite"]
        files = [root / name for name in names]
        return files if all(file.is_file() for file in files) else []
    except (ImportError, ValueError):
        return []


def model_status(config):
    basic = all(installed(name) for name in ("cv2", "numpy"))
    state = {"python": {"available": True, "version": sys.version.split()[0]}}
    missing_basic = "Install numpy and OpenCV in CUTBOX_PYTHON; see docs/LOCAL_MODELS.md."
    for task in ("tracking", "detection"):
        state[task] = {"available": basic, "model": "OpenCV Lucas-Kanade optical flow" if task == "tracking" else "OpenCV HOG pedestrian detector", "license": "OpenCV Apache-2.0", **({"reason": missing_basic} if not basic else {})}
    ocr = basic and executable(config.get("tesseractPath", "tesseract"))
    state["ocr"] = {"available": ocr, "model": "Tesseract OCR", "license": "Apache-2.0", **({"reason": missing_basic if not basic else "Install Tesseract and its language data, or set CUTBOX_TESSERACT."} if not ocr else {})}
    for task, key, modules in (
        ("depth", "depthModelPath", ("torch", "transformers", "PIL")),
        ("pose", "poseModelPath", ("mediapipe",)),
        ("mask", "maskModelPath", ("mediapipe",)),
        ("transcription", "whisperModelPath", ("faster_whisper",)),
    ):
        path = Path(config[key]) if config.get(key) else None
        onnx = task == "depth" and path is not None and path.suffix.lower() == ".onnx"
        bundled = task in ("pose", "mask") and path is None and bundled_mediapipe(task)
        missing = [] if onnx else [name for name in modules if not installed(name)]
        if not basic:
            reason = missing_basic
        elif missing:
            reason = "Install Python dependencies: " + ", ".join(missing) + "; see docs/LOCAL_MODELS.md."
        elif not bundled and (path is None or not path.exists()):
            reason = f"Configure {key} with local model weights; automatic downloads are disabled."
        elif onnx and not path.is_file():
            reason = "MiDaS ONNX model path must be a file."
        elif task in ("pose", "mask") and not bundled and not path.is_file():
            reason = "MediaPipe model path must be a local .task/.tflite file."
        elif task == "depth" and not onnx and (not path.is_dir() or not (path / "config.json").is_file() or not list(path.glob("*.safetensors"))):
            reason = "Depth Anything requires a local Transformers directory with config.json and safetensors weights."
        elif task == "transcription" and (not path.is_dir() or not (path / "model.bin").is_file()):
            reason = "Whisper requires a local CTranslate2 directory containing model.bin."
        elif task == "transcription" and config.get("device") == "mps":
            reason = "faster-whisper does not support MPS. Select CPU (int8) or CUDA."
        else:
            reason = None
        model = {"depth": "MiDaS v2.1 small ONNX" if onnx else "Depth Anything V2 (local Transformers)", "pose": "MediaPipe bundled full pose" if bundled else "MediaPipe Pose Landmarker", "mask": "MediaPipe bundled selfie segmentation" if bundled else "MediaPipe Image Segmenter", "transcription": "faster-whisper (local CTranslate2)"}[task]
        state[task] = {"available": reason is None, "model": model, "readiness": "dependencies and local assets present; inference validates compatibility", **({"reason": reason} if reason else {})}
    return state


def require(task, config):
    status = model_status(config)[task]
    if not status["available"]:
        raise ValueError(status["reason"])


def digest_model(config, task):
    key = {"depth": "depthModelPath", "pose": "poseModelPath", "mask": "maskModelPath", "transcription": "whisperModelPath"}.get(task)
    bundled = bundled_mediapipe(task) if task in ("pose", "mask") and not config.get(key) else []
    if not key or (not config.get(key) and not bundled):
        return None
    path = Path(config[key]) if config.get(key) else None
    entries = bundled or (sorted(path.iterdir()) if path.is_dir() else [path])
    digests = []
    for file in entries:
        if not file.is_file() or file.suffix not in {".json", ".safetensors", ".bin", ".onnx", ".task", ".tflite", ".txt"}:
            continue
        hasher = hashlib.sha256()
        with file.open("rb") as stream:
            while chunk := stream.read(1024 * 1024):
                hasher.update(chunk)
        digests.append({"file": file.name, "sha256": hasher.hexdigest()})
    return digests


def provenance(task, config):
    import cv2
    state = model_status(config)[task]
    configurable_device = task == "transcription" or (task == "depth" and not str(config.get("depthModelPath", "")).lower().endswith(".onnx"))
    actual_device = config.get("device", "cpu") if configurable_device else "cpu"
    value = {"schema": "cutbox.local-analysis/0.1", "task": task, "model": state["model"], "device": actual_device, "requestedDevice": config.get("device", "cpu"), "opencv": cv2.__version__, "createdAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "reviewState": "suggested", "timing": "decoded seconds; VFR frame accuracy is not guaranteed", "network": "local assets only; no inference uploads"}
    hashes = digest_model(config, task)
    if hashes:
        value["modelFiles"] = hashes
    return value


class Source:
    def __init__(self, request):
        import cv2
        self.cv2 = cv2
        self.path = request["inputPath"]
        self.image = Path(self.path).suffix.lower() in IMAGE_EXTENSIONS
        self.start = request.get("start", 0)
        self.cap = None
        if self.image:
            self.frame = cv2.imread(self.path)
            if self.frame is None:
                raise ValueError("Cannot decode source image")
            self.fps, self.end, self.duration = 1.0, 0.0, 0.0
            if self.start != 0 or request.get("end") is not None:
                raise ValueError("Image analysis requires start=0 and no end time")
        else:
            self.cap = cv2.VideoCapture(self.path)
            if not self.cap.isOpened():
                raise ValueError("Cannot decode source video with OpenCV; generate a playback proxy first")
            self.fps = self.cap.get(cv2.CAP_PROP_FPS)
            count = self.cap.get(cv2.CAP_PROP_FRAME_COUNT)
            if not math.isfinite(self.fps) or self.fps <= 0 or not math.isfinite(count) or count <= 0:
                self.close()
                raise ValueError("Source has no finite video frame rate or frame count")
            self.duration = count / self.fps
            self.end = request.get("end") or self.duration
            if self.start >= self.duration or self.end > self.duration + 0.05 or self.end <= self.start:
                self.close()
                raise ValueError("Analysis range is outside source duration")
            if self.end - self.start > 7200:
                self.close()
                raise ValueError("Analyze at most two hours per operation")

    def frames(self, sample_fps=1, sequential=False, limit=MAX_SUGGESTIONS):
        cv2 = self.cv2
        if self.image:
            yield 0.0, self.frame
            return
        rate = min(self.fps, sample_fps)
        count = math.ceil((self.end - self.start) * rate)
        if count > limit and not sequential:
            raise ValueError("Too many sampled frames; lower the sample rate or choose a shorter range")
        if sequential:
            self.cap.set(cv2.CAP_PROP_POS_MSEC, self.start * 1000)
            index = 0
            while self.start + index / self.fps < self.end - 1e-7:
                ok, frame = self.cap.read()
                if not ok:
                    break
                yield self.start + index / self.fps, frame
                index += 1
        else:
            for index in range(count):
                timestamp = self.start + index / rate
                self.cap.set(cv2.CAP_PROP_POS_MSEC, timestamp * 1000)
                ok, frame = self.cap.read()
                if not ok:
                    raise ValueError(f"Cannot decode video frame near {timestamp:.3f}s")
                yield timestamp, frame

    def close(self):
        if self.cap:
            self.cap.release()


def resized(frame, maximum=1280):
    import cv2
    h, w = frame.shape[:2]
    if max(h, w) > maximum:
        return cv2.resize(frame, (max(1, round(w * maximum / max(h, w))), max(1, round(h * maximum / max(h, w)))))
    return frame


def box(x, y, w, h, width, height):
    x, y = max(0, x), max(0, y)
    w, h = min(w, width - x), min(h, height - y)
    return {"x": x / width, "y": y / height, "width": w / width, "height": h / height}


def suggestion(timestamp, source, fps, label, notes, **extra):
    return {"start": round(timestamp, 6), "end": round(min(source.end, timestamp + 1 / fps), 6), "label": label, "notes": notes, "reviewState": "suggested", **extra}


def track(source, region, sample_fps):
    import cv2
    import numpy as np
    results, previous, points, bounds = [], None, None, None
    last_output = -math.inf
    for timestamp, original in source.frames(sequential=True):
        frame = resized(original)
        h, w = frame.shape[:2]
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        if previous is None:
            bounds = np.array([region["x"] * w, region["y"] * h, region["width"] * w, region["height"] * h], dtype=np.float64)
        else:
            forward, status, _ = cv2.calcOpticalFlowPyrLK(previous, gray, points, None)
            if forward is None or status is None:
                break
            backward, back_status, _ = cv2.calcOpticalFlowPyrLK(gray, previous, forward, None)
            if backward is None or back_status is None:
                break
            valid = (status.reshape(-1) == 1) & (back_status.reshape(-1) == 1) & (np.linalg.norm(points.reshape(-1, 2) - backward.reshape(-1, 2), axis=1) < 1.5)
            if np.count_nonzero(valid) < 4:
                break
            delta = np.median(forward.reshape(-1, 2)[valid] - points.reshape(-1, 2)[valid], axis=0)
            bounds[:2] += delta
            bounds[0] = min(max(0, bounds[0]), w - bounds[2])
            bounds[1] = min(max(0, bounds[1]), h - bounds[3])
        if timestamp - last_output >= 1 / sample_fps - 1e-7:
            results.append(suggestion(timestamp, source, sample_fps, "跟踪区域", "Lucas-Kanade 光流建议；固定大小框，不代表身份识别；遮挡或纹理不足时停止。", region=box(*bounds, w, h)))
            last_output = timestamp
        mask = np.zeros_like(gray)
        x, y, bw, bh = (int(v) for v in bounds)
        mask[y:y + bh, x:x + bw] = 255
        points = cv2.goodFeaturesToTrack(gray, maxCorners=150, qualityLevel=0.02, minDistance=4, mask=mask)
        if points is None or len(points) < 4:
            if previous is None:
                raise ValueError("No trackable texture in the selected region; choose a region with visible details")
            break
        previous = gray
        emit("progress", value=(timestamp - source.start) / max(1e-8, source.end - source.start))
        if len(results) >= MAX_SUGGESTIONS:
            raise ValueError("Tracking exceeds 10000 suggestions; choose a shorter range")
    if not results:
        raise ValueError("No trackable points in the selected region")
    return results


def ocr_frame(frame, config, directory):
    import cv2
    path = os.path.join(directory, "frame.png")
    if not cv2.imwrite(path, frame):
        raise ValueError("Cannot write OCR working image")
    language = config.get("ocrLanguage", "eng")
    completed = subprocess.run([config.get("tesseractPath", "tesseract"), path, "stdout", "-l", language, "--psm", "11", "tsv"], capture_output=True, text=True, timeout=60, check=False)
    if completed.returncode:
        raise ValueError("Tesseract failed. Install the selected language data: " + completed.stderr[-1500:])
    lines = {}
    for word in csv.DictReader(io.StringIO(completed.stdout), delimiter="\t", quoting=csv.QUOTE_NONE):
        if not word.get("text", "").strip() or float(word.get("conf", -1)) < 30:
            continue
        key = (word["block_num"], word["par_num"], word["line_num"])
        lines.setdefault(key, []).append(word)
    for words in lines.values():
        x, y = min(int(v["left"]) for v in words), min(int(v["top"]) for v in words)
        right = max(int(v["left"]) + int(v["width"]) for v in words)
        bottom = max(int(v["top"]) + int(v["height"]) for v in words)
        yield " ".join(v["text"] for v in words), box(x, y, right-x, bottom-y, frame.shape[1], frame.shape[0]), sum(float(v["conf"]) for v in words) / len(words) / 100


POSE_CONNECTIONS = [(11,12),(11,13),(13,15),(12,14),(14,16),(11,23),(12,24),(23,24),(23,25),(25,27),(24,26),(26,28),(27,29),(29,31),(28,30),(30,32),(0,1),(1,2),(2,3),(3,7),(0,4),(4,5),(5,6),(6,8),(9,10)]


class VisionModel:
    def __init__(self, task, config):
        import cv2
        self.task, self.config, self.model, self.processor = task, config, None, None
        self.bounds = None
        self.bundled = task in ("pose", "mask") and not config.get("poseModelPath" if task == "pose" else "maskModelPath")
        self.onnx = task == "depth" and Path(config["depthModelPath"]).suffix.lower() == ".onnx"
        if self.onnx:
            self.model = cv2.dnn.readNetFromONNX(config["depthModelPath"])
            self.model.setPreferableBackend(cv2.dnn.DNN_BACKEND_OPENCV)
            self.model.setPreferableTarget(cv2.dnn.DNN_TARGET_CPU)
        elif task == "depth":
            import torch
            from transformers import AutoImageProcessor, AutoModelForDepthEstimation
            device = config.get("device", "cpu")
            if device == "mps" and not torch.backends.mps.is_available():
                raise ValueError("MPS is not available in this Python/PyTorch installation")
            if device == "cuda" and not torch.cuda.is_available():
                raise ValueError("CUDA is not available in this Python/PyTorch installation")
            self.processor = AutoImageProcessor.from_pretrained(config["depthModelPath"], local_files_only=True, trust_remote_code=False)
            self.model = AutoModelForDepthEstimation.from_pretrained(config["depthModelPath"], local_files_only=True, trust_remote_code=False, use_safetensors=True).to(device).eval()
        else:
            import mediapipe as mp
            from mediapipe.tasks import python
            from mediapipe.tasks.python import vision
            self.mp = mp
            if self.bundled:
                if not bundled_mediapipe(task):
                    raise ValueError("Bundled MediaPipe assets are missing; reinstall mediapipe==0.10.21")
                self.model = mp.solutions.pose.Pose(static_image_mode=True, model_complexity=1) if task == "pose" else mp.solutions.selfie_segmentation.SelfieSegmentation(model_selection=0)
                return
            base = python.BaseOptions(model_asset_path=config["poseModelPath" if task == "pose" else "maskModelPath"])
            if task == "pose":
                self.model = vision.PoseLandmarker.create_from_options(vision.PoseLandmarkerOptions(base_options=base, running_mode=vision.RunningMode.IMAGE, num_poses=4))
            else:
                self.model = vision.ImageSegmenter.create_from_options(vision.ImageSegmenterOptions(base_options=base, running_mode=vision.RunningMode.IMAGE, output_category_mask=True))

    def infer(self, frame):
        import cv2
        import numpy as np
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        if self.task == "depth":
            if self.onnx:
                # Official MiDaS v2.1 small ONNX input: RGB, 256x256, ImageNet mean/std.
                pixels = cv2.resize(rgb, (256, 256)).astype(np.float32) / 255.0
                pixels = (pixels - np.array([0.485, 0.456, 0.406], dtype=np.float32)) / np.array([0.229, 0.224, 0.225], dtype=np.float32)
                self.model.setInput(np.transpose(pixels, (2, 0, 1))[None])
                depth = self.model.forward().squeeze()
            else:
                import torch
                from PIL import Image
                inputs = self.processor(images=Image.fromarray(rgb), return_tensors="pt").to(self.config.get("device", "cpu"))
                with torch.inference_mode():
                    depth = self.model(**inputs).predicted_depth.squeeze().float().cpu().numpy()
            depth = cv2.resize(depth, (frame.shape[1], frame.shape[0]), interpolation=cv2.INTER_CUBIC)
            if not np.isfinite(depth).all():
                raise ValueError("Depth model returned non-finite values")
            if self.bounds is None:
                self.bounds = np.percentile(depth, [2, 98])
            low, high = self.bounds
            return np.clip((depth - low) / max(float(high-low), 1e-8) * 255, 0, 255).astype(np.uint8)
        if self.bundled:
            result = self.model.process(rgb)
            if self.task == "pose":
                return [result.pose_landmarks.landmark] if result.pose_landmarks else []
            return (result.segmentation_mask > 0.5).astype(np.uint8) * 255
        image = self.mp.Image(image_format=self.mp.ImageFormat.SRGB, data=np.ascontiguousarray(rgb))
        if self.task == "pose":
            return self.model.detect(image).pose_landmarks
        result = self.model.segment(image)
        if result.category_mask is None:
            raise ValueError("Segmentation model returned no category mask")
        # Category 0 is background for the supported selfie segmenter.
        return (result.category_mask.numpy_view().copy() != 0).astype(np.uint8) * 255

    def close(self):
        if self.task in ("pose", "mask") and self.model:
            self.model.close()


def pose_annotations(poses, frame, timestamp, source, fps):
    for landmarks in poses:
        points = [{"index": i, "x": min(1, max(0, p.x)), "y": min(1, max(0, p.y)), "z": p.z, "visibility": p.visibility} for i, p in enumerate(landmarks)]
        visible = [p for p in points if p["visibility"] > 0.5]
        if not visible:
            continue
        x, y = min(p["x"] for p in visible), min(p["y"] for p in visible)
        w, h = max(p["x"] for p in visible) - x, max(p["y"] for p in visible) - y
        if w <= 0 or h <= 0:
            continue
        yield suggestion(timestamp, source, fps, "人体姿态", "MediaPipe 33 点姿态建议；逐帧检测，无身份关联。", region={"x": x, "y": y, "width": w, "height": h}, keypoints=points, confidence=sum(p["visibility"] for p in visible) / len(visible))


def transcribe(request):
    from faster_whisper import WhisperModel
    config = request["config"]
    if not executable(config.get("ffmpegPath", "ffmpeg")):
        raise ValueError("Install FFmpeg for transcription audio extraction")
    start, end = request.get("start", 0), request.get("end")
    with tempfile.TemporaryDirectory(prefix="cutbox-whisper-") as directory:
        audio = os.path.join(directory, "audio.wav")
        args = [config.get("ffmpegPath", "ffmpeg"), "-v", "error", "-nostdin", "-n", "-ss", str(start), "-i", request["inputPath"]]
        args += ["-t", str(end - start if end is not None else 7200.001)]
        args += ["-map", "0:a:0", "-ac", "1", "-ar", "16000", audio]
        result = subprocess.run(args, capture_output=True, text=True, timeout=180)
        if result.returncode:
            raise ValueError("Cannot extract audio for transcription: " + result.stderr[-1200:])
        with wave.open(audio, "rb") as audio_file:
            if audio_file.getnframes() / audio_file.getframerate() > 7200:
                raise ValueError("Transcribe at most two hours per operation; select a shorter range")
        device = config.get("device", "cpu")
        model = WhisperModel(config["whisperModelPath"], device=device, compute_type="int8" if device == "cpu" else "float16", local_files_only=True)
        segments, info = model.transcribe(audio, language=config.get("language"), beam_size=5, vad_filter=True, word_timestamps=True)
        annotations = []
        for segment in segments:
            annotations.append({"start": round(start + segment.start, 6), "end": round(start + segment.end, 6), "label": segment.text.strip() or "语音", "notes": "本地 Whisper 转写建议；不包含说话人身份识别。", "reviewState": "suggested", "words": [{"start": start + w.start, "end": start + w.end, "text": w.word, "confidence": w.probability} for w in (segment.words or [])]})
            emit("progress", value=min(0.99, segment.end / max(info.duration, 1e-8)))
            if len(annotations) > MAX_SUGGESTIONS:
                raise ValueError("Transcription exceeds 10000 segments; choose a shorter range")
        return annotations


def analyze(request):
    import cv2
    task, config, fps = request["task"], request["config"], request.get("sampleFps", 1)
    require(task, config)
    if task == "transcription":
        results = transcribe(request)
    else:
        source = Source(request)
        model = None
        try:
            if task == "tracking":
                if source.image:
                    raise ValueError("Tracking requires video")
                results = track(source, request["region"], fps)
            else:
                results = []
                if task == "detection":
                    detector = cv2.HOGDescriptor()
                    detector.setSVMDetector(cv2.HOGDescriptor_getDefaultPeopleDetector())
                if task == "pose":
                    model = VisionModel(task, config)
                with tempfile.TemporaryDirectory(prefix="cutbox-analysis-") as directory:
                    for timestamp, original in source.frames(fps):
                        frame = resized(original)
                        if task == "ocr":
                            for text, region, confidence in ocr_frame(frame, config, directory):
                                results.append(suggestion(timestamp, source, fps, text, "Tesseract OCR 建议；请核对原画面。", region=region, confidence=confidence))
                        elif task == "detection":
                            if frame.shape[0] >= 128 and frame.shape[1] >= 64:
                                rects, weights = detector.detectMultiScale(frame, winStride=(8, 8), padding=(8, 8), scale=1.05)
                                for rect, score in zip(rects, weights):
                                    results.append(suggestion(timestamp, source, fps, "人物候选", f"OpenCV HOG 行人检测建议；SVM margin={float(score):.3f}，不是概率或身份识别。", region=box(*rect, frame.shape[1], frame.shape[0])))
                        elif task == "pose":
                            results.extend(pose_annotations(model.infer(frame), frame, timestamp, source, fps))
                        if len(results) > MAX_SUGGESTIONS:
                            raise ValueError("Analysis exceeds 10000 suggestions; choose a shorter range")
                        emit("progress", value=(timestamp - source.start) / max(1e-8, source.end - source.start))
        finally:
            source.close()
            if model:
                model.close()
    emit("progress", value=1)
    return {"task": task, "annotations": results, "provenance": provenance(task, config)}


def reference(request):
    import cv2
    import numpy as np
    mode, config = request["mode"], request["config"]
    require(mode, config)
    if not executable(config.get("ffmpegPath", "ffmpeg")):
        raise ValueError("Install FFmpeg for reference video encoding")
    source = Source(request)
    writer, model = None, None
    try:
        if source.image:
            raise ValueError("Reference video requires a video source")
        duration = source.end - source.start
        fps = min(source.fps, 30)
        if duration * fps > 108000:
            raise ValueError("Reference export exceeds 108000 frames; choose a shorter range")
        model = VisionModel(mode, config)
        with tempfile.TemporaryDirectory(prefix="cutbox-reference-") as directory:
            raw = os.path.join(directory, "reference.avi")
            count = 0
            for timestamp, original in source.frames(fps, limit=108000):
                frame = resized(original)
                # yuv420p requires even dimensions.
                h, w = frame.shape[:2]
                frame = cv2.resize(frame, (max(2, w - w % 2), max(2, h - h % 2)))
                result = model.infer(frame)
                if mode == "pose":
                    rendered = np.zeros_like(frame)
                    h, w = frame.shape[:2]
                    for landmarks in result:
                        for a, b in POSE_CONNECTIONS:
                            pa, pb = landmarks[a], landmarks[b]
                            if pa.visibility > 0.5 and pb.visibility > 0.5:
                                cv2.line(rendered, (int(pa.x * w), int(pa.y * h)), (int(pb.x * w), int(pb.y * h)), (80, 220, 250), 3)
                        for p in landmarks:
                            if p.visibility > 0.5:
                                cv2.circle(rendered, (int(p.x * w), int(p.y * h)), 3, (255, 255, 255), -1)
                else:
                    rendered = cv2.cvtColor(result, cv2.COLOR_GRAY2BGR)
                    if rendered.shape[:2] != frame.shape[:2]:
                        rendered = cv2.resize(rendered, (frame.shape[1], frame.shape[0]), interpolation=cv2.INTER_NEAREST)
                if writer is None:
                    writer = cv2.VideoWriter(raw, cv2.VideoWriter_fourcc(*"MJPG"), fps, (rendered.shape[1], rendered.shape[0]))
                    if not writer.isOpened():
                        raise ValueError("Cannot open intermediate reference video encoder")
                writer.write(rendered)
                count += 1
                emit("progress", value=min(0.90, 0.90 * (timestamp - source.start) / duration))
            if writer:
                writer.release()
                writer = None
            if not count:
                raise ValueError("No frames decoded for reference export")
            encoded = subprocess.run([config.get("ffmpegPath", "ffmpeg"), "-v", "error", "-nostdin", "-n", "-i", raw, "-an", "-c:v", "libx264", "-threads", "2", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart", request["outputPath"]], capture_output=True, text=True, timeout=600)
            if encoded.returncode:
                raise ValueError("Reference encoding failed: " + encoded.stderr[-1500:])
        proof = provenance(mode, config)
        proof["normalization"] = "relative inverse depth, first-frame 2nd/98th percentile bounds fixed across clip" if mode == "depth" else "binary non-background mask" if mode == "mask" else "33-point skeleton; missing detections produce empty frames"
        proof["temporal"] = "independent image inference; no temporal consistency or metric distance guarantee"
        proof["fps"] = fps
        proof["sourceRange"] = {"start": source.start, "end": source.end}
        emit("progress", value=1)
        return {"mode": mode, "duration": count / fps, "provenance": proof}
    finally:
        source.close()
        if writer:
            writer.release()
        if model:
            model.close()


def main():
    request = json.load(sys.stdin)
    operation = request.get("operation")
    if operation == "status":
        return model_status(request.get("config", {}))
    if operation == "analyze":
        return analyze(request)
    if operation == "reference":
        return reference(request)
    raise ValueError("Unknown local model operation")


if __name__ == "__main__":
    try:
        emit("result", value=main())
    except Exception as error:
        emit("error", message=f"{type(error).__name__}: {error}")
        sys.exit(1)
