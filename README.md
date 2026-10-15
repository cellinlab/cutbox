<!-- bip:project:start -->
# CutBox

Local-first film annotation, close viewing, and reusable media collections.

[简体中文](README.zh-CN.md)

**Working Electron development preview.** Import local video, audio and images; organize character, scene, prop and sound assets; annotate time ranges and rectangular regions; curate collections; export clips, edge-reference videos and encrypted `.cbox` manifests with their media.

![CutBox desktop](docs/design/desktop.png)

## Run the desktop app

Requires Node.js 22.16+ (Node 24 LTS recommended), npm, and `ffmpeg` / `ffprobe` on PATH. On macOS, install the latter with `brew install ffmpeg`.

```sh
npm ci
npm start
```

The app uses Electron + React/TypeScript, SQLite and an isolated backend worker. No cloud account or API key is needed. Normal media import stores local file references; keep source files in place. Bundle import copies verified media into app-managed storage. Data lives in Electron's application user-data directory; `CUTBOX_DATA_DIR` optionally selects another directory. `CUTBOX_FFMPEG` and `CUTBOX_FFPROBE` can select executable paths.

This preview has been exercised on Linux with real Electron and FFmpeg. macOS is the primary product target, but native macOS/Windows testing, signing and installers remain pending. Some imported codecs cannot play in Chromium; automatic playback proxies are not implemented. Video selection uses seconds and is not frame-exact for variable-frame-rate sources.

## Implemented and planned

- Library with thumbnails, search, grid/list and playback.
- Character / scene / prop / sound cards with editing, tags, covers and linked media.
- Time-range annotations, optional rectangular region, entity links, review state and study notes.
- Collections, encrypted metadata export, checked media copies and transactional import.
- Actual MP4 clip and edge-reference export, progress/cancellation and provenance sidecars.

Depth, pose and segmentation models are **not installed or implemented**; the UI reports them unavailable. Automatic tracking, transcription, waveform editing, frame-accurate timelines and training-format adapters remain planned. Edge detection is not depth estimation.

**`.cbox` encrypts metadata only; external media remains plaintext.** Transfer the entire exported folder. The desktop schema is `cutbox.desktop/0.1`; the earlier Python `cutbox.prototype/0.1` experiment is distinct and is not interchangeable. Formats remain experimental; keep source backups.

## Design and validation

[Product scope](specs/VISION.md) · [Research](docs/research/RESEARCH.md) · [Architecture](docs/ARCHITECTURE.md) · [Data model](docs/DATA_MODEL.md) · [Interaction](docs/INTERACTION.md) · [Reference export](docs/REFERENCE_EXPORT.md) · [Asset workspace](docs/ASSET_WORKSPACE.md) · [CBox format](docs/CBOX_FORMAT.md) · [Roadmap](docs/ROADMAP.md) · [Validation](docs/VALIDATION.md)

```sh
npm run check
npm run test:desktop  # requires a graphical display; Linux CI can use Xvfb
```

`npm run dev` serves a renderer design preview only; native operations require Electron. After renderer edits, rebuild with `npm run build` and launch with `npm run desktop`.

The earlier format CLI remains available for research:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python -m unittest discover -s tests -v
.venv/bin/python scripts/cbox.py demo /tmp/cutbox-demo
```

Contribute a complete user task with source anchors, failure cases and verification. CBox is not a universal training format; task-specific schemas and provenance remain explicit design work.
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
