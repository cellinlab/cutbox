<!-- bip:project:start -->
# CutBox

Local-first film annotation, production reference preparation, and reusable media datasets.

[简体中文](README.zh-CN.md)

**Electron 0.3 development preview.** Turn local video, audio and images into evidence-backed asset records, shot briefs, reference kits, playable stories and reviewed dataset exports. Keep the original media and the reasoning behind each selection connected.

![CutBox desktop](docs/design/desktop.png)

## Run the desktop app

Requires Node.js 22.16+ (Node 24 LTS recommended), npm, and `ffmpeg` / `ffprobe` on PATH. On macOS, install the latter with `brew install ffmpeg`.

```sh
npm ci
npm start
```

Electron + React/TypeScript provides the desktop interface; a Node Worker owns SQLite metadata and coordinates FFmpeg and optional Python models. No cloud account or API key is needed. Normal media import stores local references; bundle import copies verified media into managed storage. Data lives in Electron's user-data directory. `CUTBOX_DATA_DIR`, `CUTBOX_FFMPEG` and `CUTBOX_FFPROBE` can select alternative locations or executables.

## Implemented workflows

- **Annotate and organize:** character / actor / scene / prop / sound assets, custom typed fields, observed / interpreted / invented provenance, nullable confidence, review state, boxes, polygons, keyframes, word timings and pose points.
- **Prepare productions:** project and shot plans, continuity notes, evidence-derived prompt drafts, generated-take records bound to imported output media, and a separately selected result. Five optional templates cover camera, wardrobe, scene art, sound/performance and source/use information.
- **Hand off references:** plaintext asset bibles, shot-list CSV, prompts, source-anchored reference images/audio and optional clips, a contact sheet, take outputs and a hashed file manifest. See [AIGC workflow](docs/AIGC_WORKFLOW.md).
- **Prepare datasets:** eligibility and quality audit; deterministic source-, episode- or entity-grouped train/validation/test splits; JSONL records retaining original and exported/rebased annotations, source anchors, reports and a dataset card. See [dataset preparation](docs/DATASET_PREPARATION.md).
- **Find and review:** SQLite FTS5 paged annotation discovery with structured filters and a substring fallback for short terms; visual similarity candidates, source jumps, frame-time indexing, multi-lane timelines and interval looping.
- **Analyze locally:** shot cuts, waveform, UTF-8 SRT/WebVTT import, OCR, HOG person detection, optical-flow tracking, and optional model adapters. Imported subtitles remain unreviewed with unknown confidence.
- **Export references:** clips, edges, fixed/moving crops, PNG frames, WAV audio and atomic batches; optional MiDaS/Depth Anything depth and MediaPipe pose/masks. Common audio/video time-origin handling preserves delayed audio in supported exports and proxies.
- **Build interactive stories:** events, evidence relationships, state changes, typed branching rules, playable preview, graph diagnostics and JSON/RenPy/Godot narrative exchange.
- **Exchange and recover:** encrypted `.cbox` metadata, full/trimmed media profiles, JSONL/SRT/COCO adapters, verified source relinking, proxies, backups, undo/redo and task history.

Seedance/SeeDance, LibTV and TapNow are **manual handoff target labels**, not connected services. CutBox does not upload references, call their generation APIs or promise their current model limits. The [production research](docs/research/PRODUCTION_PIPELINE.md) distinguishes verified first-party sources from inaccessible vendor documentation. OpenTimelineIO, OpenAssetIO, USD, OCIO and IMF are research references, not implemented integrations.

## Models, formats and practical limits

Optional inference dependencies and local weights are separate from Electron; follow [local model setup](docs/LOCAL_MODELS.md). Models never download silently during inference. Missing dependencies show a specific unavailable reason. Actual faster-whisper speech inference and the Depth Anything weight path remain unverified here; tested depth uses MiDaS. Similarity, detection and tracking provide candidates, not established identity.

**`.cbox` encrypts metadata only; external media remains plaintext.** Desktop schema `cutbox.desktop/0.3` imports desktop 0.1, 0.2 and 0.3 packages. The earlier Python prototype has a different schema. Transfer the complete exported folder. Production kits, project backups and dataset exports are plaintext. RenPy/Godot adapters export narrative logic; connect media separately in the target engine.

This preview has been exercised on Linux. macOS is the primary target, but macOS/Windows hardware testing, installers, signing and notarization remain pending. A shared time origin fixes specific stream-offset problems; browser seeking and re-encoding are still not guaranteed frame-exact for every VFR, rotation, HDR or multi-track source.

FTS5 pagination and Map-based domain lookups improve discovery and reference validation; they do not make the entire app stream large libraries. The renderer still receives the full graph, writes still validate snapshots, undo keeps 30 metadata snapshots by default, and a dirty search cache is rebuilt from the snapshot. Synthetic 10,000-annotation tests are not long-film or million-record performance evidence. Full transformation lineage, automatic identity re-identification, multi-speaker diarization and temporal depth quality remain limitations. Consult the [validation record](docs/VALIDATION.md).

## Design and verification

[Product scope](specs/VISION.md) · [Open-source research](docs/research/RESEARCH.md) · [Production research](docs/research/PRODUCTION_PIPELINE.md) · [AIGC workflow](docs/AIGC_WORKFLOW.md) · [Dataset preparation](docs/DATASET_PREPARATION.md) · [Architecture](docs/ARCHITECTURE.md) · [Data model](docs/DATA_MODEL.md) · [CBox format](docs/CBOX_FORMAT.md) · [Roadmap](docs/ROADMAP.md)

```sh
npm run check
npm run test:desktop:all  # needs a graphical display; Linux CI can use Xvfb
```

`npm run dev` serves a renderer preview only; native operations require Electron. After renderer edits, run `npm run build` and `npm run desktop`.

The earlier format CLI remains available for research:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python -m unittest discover -s tests -v
.venv/bin/python scripts/cbox.py demo /tmp/cutbox-demo
```

Contribute a complete user task with source anchors, failure cases and verification. Dataset preparation does not train a model or establish suitability for every training task.
<!-- bip:project:end -->

## 造物矩阵

欢迎到 [造物矩阵](https://zaowujuzhen.com/about) 交流创作与实践。已有的 [GitHub 月度会员礼物入口](https://zaowujuzhen.com/prime?plan=monthly&discount=GITHUB) 使用兑换码 `GITHUB`；当前权益与可用性以兑换页面为准，本轮未验证兑换结果。

<!-- bip:creator:start -->
## 关于作者

你好，我是 **Cell 细胞**。我写代码，也写文章，把好奇心做成作品，探索更自主的工作与生活。

- [个人站 · cellinlab.com](https://cellinlab.com/)：作品、文章与联系入口。
- [造物矩阵](https://zaowujuzhen.com/about)：连接正在创造的人、作品与实践；公开创作记录、会员内容与交流是其中的一部分。
- [X · @cellinlab](https://x.com/cellinlab)：公开探索和开发进展。

扫码加我微信，备注 **GitHub** 就行。点击图片可查看原图。

<table>
  <tr>
    <td align="center" width="33%"><a href="public/wetouch/wechat.webp"><img src="public/wetouch/wechat.webp" alt="Cell 细胞个人微信二维码" width="180"></a><br>个人微信</td>
    <td align="center" width="33%"><a href="public/wetouch/wechat-channels.webp"><img src="public/wetouch/wechat-channels.webp" alt="Cell 细胞视频号二维码" width="180"></a><br>视频号</td>
    <td align="center" width="33%"><a href="public/wetouch/wechat-official.webp"><img src="public/wetouch/wechat-official.webp" alt="Cell 细胞呀微信公众号二维码" width="180"></a><br>公众号 · Cell 细胞呀</td>
  </tr>
</table>

## 赞助

如果这些项目对你有帮助，也欢迎支持我的持续探索。

<table>
  <tr>
    <td align="center" width="50%"><img src="public/sponsor/zfb.webp" alt="支付宝赞助二维码" width="180"><br>支付宝</td>
    <td align="center" width="50%"><img src="public/sponsor/wx.webp" alt="微信赞赏二维码" width="180"><br>微信赞赏</td>
  </tr>
</table>
<!-- bip:creator:end -->

## License

[MIT](LICENSE). Based on [vibecoding-bip-template](https://github.com/cellinlab/vibecoding-bip-template); original license and creator assets retained.
