<!-- bip:project:start -->
# CutBox

本地优先的影视素材标注、拉片与素材集合制作工具。

[English](README.md)

**当前已有可运行的 Electron 开发预览版。** 从本地视频、图片和音频出发，建立角色、场景、道具、声音资产，记录时间段与矩形区域标注，组织素材集合并导出加密描述。

![CutBox 桌面界面](docs/design/desktop.png)

## 启动

需要 Node.js 22.16+（推荐 Node 24 LTS）、npm，以及 PATH 中可调用的 `ffmpeg` / `ffprobe`。macOS 可执行 `brew install ffmpeg` 安装媒体工具。

```sh
npm ci
npm start
```

技术栈为 Electron、React/TypeScript、SQLite 和隔离的后台 Worker；无需云账号或 API Key。普通导入只建立本地引用，请保留原始文件位置；素材包导入会复制已校验的媒体到应用管理目录。数据保存在 Electron 应用数据目录，可通过 `CUTBOX_DATA_DIR` 指定；`CUTBOX_FFMPEG` / `CUTBOX_FFPROBE` 可指定工具路径。

## 首轮可用功能

- 素材库：本地导入、缩略图、搜索、网格/列表与播放。
- 资产页：角色、场景、道具、声音的新增编辑、标签、封面及素材关联。
- 标注与拉片：时间区间、可选矩形区域、关联资产、审核状态及观察笔记。
- 素材集合：选取成员、导出 `.cbox` 加密描述与对应媒体、校验后事务导入。
- 参考视频：真实 MP4 片段和边缘参考导出、任务进度/取消及来源描述文件。

**深度、姿态和分割模型尚未接入**，界面会显示不可用。边缘参考不等于深度图。自动跟踪、转写、音频波形、精确逐帧时间线和训练格式适配属于后续阶段。

已在 Linux 环境运行真实 Electron 与 FFmpeg 验证。macOS 是产品优先目标，但 macOS/Windows 原生验收、签名和安装包尚未完成。部分源编码无法直接在 Chromium 播放，尚未实现自动代理转码；当前秒级区间选择不保证 VFR 素材逐帧精确。

**`.cbox` 只加密描述，旁边的素材仍为明文。** 搬迁时携带整个导出目录。桌面格式 `cutbox.desktop/0.1` 与早期 Python 实验 `cutbox.prototype/0.1` 不可互换；格式仍在演进，请保留原始素材备份。

## 设计与验证

[产品目标](specs/VISION.md) · [开源调研](docs/research/RESEARCH.md) · [交互设计](docs/INTERACTION.md) · [数据模型](docs/DATA_MODEL.md) · [架构](docs/ARCHITECTURE.md) · [CBox 格式](docs/CBOX_FORMAT.md) · [路线图](docs/ROADMAP.md) · [验证记录](docs/VALIDATION.md)

[参考视频设计](docs/REFERENCE_EXPORT.md)与[角色／场景资产工作区](docs/ASSET_WORKSPACE.md)包含后续完整目标，具体可用范围以上述清单为准。

```sh
npm run check
npm run test:desktop  # 需要图形显示环境，Linux CI 可使用 Xvfb
```

`npm run dev` 仅预览渲染页面；本地文件功能需 Electron。修改界面后运行 `npm run build`，再用 `npm run desktop` 启动。早期 Python 格式实验及其测试入口见英文 README。
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
