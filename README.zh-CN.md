<!-- bip:project:start -->
# CutBox

本地优先的影视素材标注、制作参考准备与可复用数据集工具。

[English](README.md)

**当前为 Electron 0.3 开发预览版。** 从本地影音素材建立证据、人物与场景档案，整理镜头需求和参考资料，导回生成候选，制作互动故事或经过审核的数据集。

![CutBox 桌面界面](docs/design/desktop.png)

## 启动

需要 Node.js 22.16+（推荐 Node 24 LTS）、npm，以及 PATH 中可调用的 `ffmpeg` / `ffprobe`。macOS 可执行 `brew install ffmpeg` 安装媒体工具。

```sh
npm ci
npm start
```

技术栈为 Electron、React/TypeScript、SQLite 与后台 Node Worker；媒体和可选推理运行在子进程。无需云账号或 API Key。普通导入只建立原文件引用，素材包导入复制已校验媒体到托管目录。数据默认在 Electron 应用数据目录，可通过 `CUTBOX_DATA_DIR` 指定；`CUTBOX_FFMPEG` / `CUTBOX_FFPROBE` 可指定工具路径。

## 0.3 可用工作流

- **素材与标注**：角色／演员／场景／道具／声音、类型化字段、观察／解释／创作、未知置信度与审核、矩形／多边形、关键帧、逐词时间和姿态点。
- **创作准备**：项目、镜头、连续性要求、基于证据整理提示词；多次生成候选分别绑定导入媒体，单独选用结果。可安装摄影、服化、场景、声音表演、来源与用途五套模板。
- **制作交接**：导出人物／场景等设定集、镜头 CSV、提示词、带来源的图片／音频及可选片段、参考总览图、候选输出和文件摘要清单。详见 [AIGC 工作流](docs/AIGC_WORKFLOW.md)。
- **数据集准备**：质量与筛选检查，按来源／剧集／实体成组划分训练、验证、测试集；保存原始标注与导出重基准标注、来源锚点、报告和数据集卡。详见[数据集准备](docs/DATASET_PREPARATION.md)。
- **检索与审阅**：SQLite FTS5 分页检索、结构化条件、短词子串回退；视觉相似候选、原片时间跳转、帧时间索引、多轨时间线和循环。
- **本地分析**：镜头切分、波形、UTF-8 SRT／WebVTT 导入、OCR、HOG 人体检测、光流跟踪；字幕导入后为待审核，置信度未知。
- **参考工坊**：片段、边缘、固定／跟随裁切、PNG 帧、WAV 音频、整批导出，以及可选深度／姿态／蒙版模型。共用音画时间原点，保留支持场景中的延迟音频关系。
- **故事游戏化**：事件、关系、状态、变量、条件和原子效果；分支地图、试玩、结构诊断与 JSON／RenPy／Godot 叙事交换。
- **交换与恢复**：完整／裁剪 `.cbox`、JSONL／SRT／COCO、源文件重新定位、代理、备份恢复、跨重启撤销重做与任务记录。

Seedance／SeeDance、LibTV、TapNow 当前是**人工交接目标标签**。应用不会自动上传参考、调用它们的生成 API，也不承诺其最新模型参数与限制。[制作流程调研](docs/research/PRODUCTION_PIPELINE.md)与 [AIGC 工作流](docs/AIGC_WORKFLOW.md)明确区分已读取的一手资料和本次无法访问的平台资料。OTIO、OpenAssetIO、USD、OCIO、IMF 仍为研究参考，并非已实现集成。

## 模型、格式与边界

模型需独立 Python 环境与本地权重，见[本地模型安装](docs/LOCAL_MODELS.md)。推理不会静默下载权重，缺失依赖会明确报错。当前尚未验证 faster-whisper 的真实语音推理和 Depth Anything 权重路径；已实测深度使用 MiDaS。相似度、检测与跟踪均为候选，不能自动证明人物身份。

**`.cbox` 只加密描述，外部素材保持明文。** 桌面格式 `cutbox.desktop/0.3` 可读取桌面 0.1／0.2／0.3，与早期 Python 实验格式不同。传递时携带完整目录。制作资料包、备份和数据集均为明文；RenPy／Godot 适配器导出叙事逻辑，媒体需另行连接。

已在 Linux 运行桌面与部分 CPU 模型验证。macOS 是首要目标，macOS／Windows 真机、安装包、签名与公证尚未完成。共用时间原点修复了特定音画偏移问题；浏览器 seek、重编码、VFR、旋转、HDR 与多音轨仍没有统一逐帧精确保证。

FTS5 分页和 Map 引用查找优化了检索及图校验，**整个应用仍会把完整图快照交给界面**。写入仍校验快照，撤销默认保存 30 次完整元数据快照，搜索缓存失效后从快照重建。10,000 条合成标注测试不能代表长片或百万数据规模。完整派生谱系、自动身份重识别、多说话人分离和深度时序质量仍有边界，详见[验证记录](docs/VALIDATION.md)。

## 设计与验证

[产品目标](specs/VISION.md) · [开源调研](docs/research/RESEARCH.md) · [制作流程](docs/research/PRODUCTION_PIPELINE.md) · [AIGC 工作流](docs/AIGC_WORKFLOW.md) · [数据集准备](docs/DATASET_PREPARATION.md) · [交互](docs/INTERACTION.md) · [数据模型](docs/DATA_MODEL.md) · [架构](docs/ARCHITECTURE.md) · [CBox 格式](docs/CBOX_FORMAT.md) · [路线图](docs/ROADMAP.md)

```sh
npm run check
npm run test:desktop:all  # 需要图形显示环境，Linux CI 可使用 Xvfb
```

`npm run dev` 仅预览渲染页面；本地文件功能需要 Electron。修改界面后运行 `npm run build`，再用 `npm run desktop` 启动。早期 Python 格式实验入口见英文 README。数据集准备不执行模型训练，也不自动证明数据适合任意任务。
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
