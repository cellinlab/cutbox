<!-- bip:project:start -->
# CutBox

Local-first film annotation, close viewing, and reusable media collections.

[简体中文](README.zh-CN.md)

CutBox is being designed to turn video, images and audio into traceable, fine-grained assets: people, clothing, poses, scenes, dialogue, sound events and cinematic relationships. Collections will retain source anchors and review history for creative reference and task-specific dataset export.

**Current status: architecture and format prototype. There is no desktop application or release yet.** macOS is the first target; Windows and Linux compatibility is a design goal.

## Explore the design

- [Product scope](specs/VISION.md)
- [Research and independent decisions](docs/research/RESEARCH.md)
- [Architecture](docs/ARCHITECTURE.md), [data model](docs/DATA_MODEL.md), [interaction](docs/INTERACTION.md)
- [CBox format experiment](docs/CBOX_FORMAT.md), [implementation roadmap](docs/ROADMAP.md)

## Run the format experiment

Requires Python 3.12+. This CLI encrypts a JSON manifest and verifies the associated files. It does not annotate, cut or copy media.

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python scripts/cbox.py demo /tmp/cutbox-demo
.venv/bin/python scripts/cbox.py pack /tmp/cutbox-demo/manifest.json /tmp/cutbox-demo/media /tmp/cutbox-demo/collection.cbox
.venv/bin/python scripts/cbox.py verify /tmp/cutbox-demo/collection.cbox /tmp/cutbox-demo/media
```

Use a new demo directory. Enter a passphrase interactively; never put real passphrases in command arguments. **The `.cbox` encrypts metadata only; the external media stays unencrypted.** Preserve the media directory when moving a collection. The example is a generated sine wave, not film footage or speech.

## Validate and contribute

```sh
.venv/bin/python -m unittest discover -s tests -v
python3 scripts/check_template.py --project
```

Read the design and propose a small change with its source anchors, failure cases and verification. The planned desktop stack is Tauri, TypeScript/React, Rust, SQLite and isolated media/model workers; it is not implemented yet. No cloud account, API key or service is needed for the prototype. There is no deployment or download to claim.

CBox is experimental and not a universal training format. Source rights, review quality, target-task schemas and train/test splits remain explicit concerns. The desktop player, GPU models, signing and cross-platform behavior have not been validated.
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
