# 架构与技术决策

状态：Electron 0.2 开发版本已实现下列模块。当前验证环境是 Linux 云工作区；功能测试与本地模型运行不能代替 macOS 安装包、Apple Silicon 性能或跨平台发行验收。

## 当前实际实现

| 模块 | 文件 | 已实现边界 |
| --- | --- | --- |
| 桌面主进程 | `desktop/main.mjs`、`desktop/preload.cjs` | 原生文件选择、窄 IPC、按已入库媒体 ID 提供源文件/代理文件流；渲染器 sandbox/contextIsolation，关闭 Node 集成，禁止任意导航和新窗口 |
| 界面 | `src/` | 素材与角色/演员/场景/道具/声音资产、模板与属性、标注工作台、矩形/多边形绘制、关键帧、时间线、集合、关系/事件与分支故事、工具和会话任务 |
| 后台协调 | `desktop/backend-worker.mjs` | Node Worker 持有领域数据库，协调媒体/模型子进程、包与数据集；长任务可取消，退出时等待活动任务收尾 |
| 领域存储 | `desktop/domain.mjs` | SQLite WAL、schema v2；八类对象 JSON 行、引用与类型校验、事务、v1 迁移、持久有界 undo/redo/revisions |
| 基础媒体 | `desktop/media.mjs` | 探测、完整哈希、缩略图；FFmpeg 片段、边缘、裁剪、PNG 帧、WAV 音频输出；外部 FFmpeg/ffprobe 需可用 |
| 媒体分析 | `desktop/media-tools.mjs` | 镜头切分建议、波形、帧时间戳查询、代理视频；使用真实 FFmpeg/ffprobe 输出 |
| 本地推理 | `desktop/models.mjs`、Python worker | `modelStatus`、`analyzeMedia`、`exportModelReference`；深度、姿态、分割、OCR、检测/跟踪及可配置转录适配器；缺少依赖或权重明确报错 |
| 检索 | `desktop/search.mjs` | `searchAnnotations` 组合结构化条件，`findSimilar` 提供相似参考候选；候选不是角色身份或语义等价证明 |
| 故事 | `desktop/story.mjs` | 纯数据图校验、类型化条件/效果、可丢弃的分支模拟、外部交换；无 eval，不改写原始观察 |
| 交换与数据集 | `desktop/packages.mjs`、`desktop/portable.mjs` | 0.2 加密图结构、0.1 导入、依赖选择、完整/裁剪媒体、托管导入；JSONL/COCO/SRT 明文数据集 |
| 可靠性 | `desktop/reliability.mjs` | 素材缺失/摘要检查、包含媒体的可验证快照备份、恢复、新路径发布与模型配置；领域服务校验重新关联文件身份 |

播放仍使用 Chromium `<video>/<audio>`，可引用已生成的代理；帧时间戳查询不等于完整精确帧播放服务。时间锚点仍为浮点秒，没有跨源/代理的整数 PTS 映射。画面矩形、多边形和关键帧已可编辑；算法跟踪结果仍需审核，遮挡后的角色身份不会自动被证明。

本地数据默认放在 Electron `userData`。普通导入引用原文件，托管包导入复制媒体；数据库和协调任务在后台 Node Worker，FFmpeg 与 Python 推理运行于独立子进程。Worker 仍与 Electron 属于同一应用进程，不是数据库进程级隔离。模型为可选配置，不要求手工标注用户先安装全部模型。

本轮实际验证了 MiDaS 深度、MediaPipe 自带姿态/分割模型，以及 OCR、HOG 检测和光流跟踪。Whisper 适配器已安装但没有转录模型权重，**未宣称完成真实语音推理**。模型可用性以当前机器 `modelStatus` 为准；这些验证不承诺影视长片质量、实时性或 macOS GPU 性能。

领域 `updateMedia` 重新关联需要完整 SHA-256/大小匹配；同内容重新导入可修复已失效的源路径。`checkMedia` 报告缺失和变更。备份保存经验证的领域快照与媒体，恢复通过 `replaceSnapshot` 事务校验；不是裸拷正在使用的 SQLite WAL 文件。缓存/托管副本的自动垃圾清理仍未实现。

当前仍没有 FTS5/向量索引、持久任务队列和大库分页协议。界面接收完整快照，结构化检索与相似候选不代表百万标注规模已验收。撤销历史默认保留 30 条操作（可配置 1–200），不是永久审计账本。全图导出保留八类对象；Python 早期实验与桌面应用使用不同 JSON schema。

### 实际服务接口

- 领域：`createDomain({directory})`、`validateSnapshot`；八类对象 CRUD、`updateMedia`、`importSnapshot`、`replaceSnapshot`、`undo`、`redo`、`history`。
- 媒体：`importMedia`、`probeMedia`、`exportReference`；`detectScenes`、`waveform`、`frameTimestamps`、`createProxy`。
- 模型：`modelStatus({config})`、`analyzeMedia({inputPath,task,...})`、`exportModelReference({inputPath,outputPath,mode,...})`。
- 交换：`exportBundle({directory,password,snapshot,profile,...})`、`importBundle({path,password,directory})`、`exportDataset({directory,snapshot,format,profile,...})`。
- 恢复：`backupProject({directory,snapshot})`、`readBackup({path,directory})`，随后由领域 `replaceSnapshot` 恢复。

上述文件路径参数属于后端服务，渲染器通过原生对话框与媒体 ID 工作，不获得任意文件系统或 shell 权限。详细序列化边界见[数据模型](DATA_MODEL.md)与[CBox 格式](CBOX_FORMAT.md)。

以下是不应与当前完成状态混淆的长期架构目标。

## 目标不变量

1. 原片只读，来源身份由完整内容哈希标识；文件路径只是位置。
2. 标注与解释分离，人工确认与模型建议分离。
3. 任一裁切、重采样、分离、转录、翻译与嵌入都有输入版本、工具版本、参数、输出哈希。
4. 时间、坐标和音轨必须可还原；搜索结果、导出、重新导入引用同一领域对象。
5. 无模型、无网络时仍能导入、手工标注、组集和导出。
6. 加密不能替代来源可信度、使用许可或质量审核。

## 目标组件边界

```mermaid
flowchart LR
  UI[桌面工作台 / React] --> IPC[Electron preload / typed IPC]
  CLI[未来 CLI / Agent 接口] --> Domain[独立领域服务]
  IPC --> Domain
  Domain --> DB[(SQLite / FTS5)]
  Domain --> Store[原片引用 / 内容寻址派生缓存]
  Domain --> Jobs[持久任务队列]
  Jobs --> Media[FFmpeg / ffprobe 进程]
  Jobs --> Models[可选模型适配器]
  Domain --> Export[集合快照 / 导出计划 / CBox]
```

领域服务唯一拥有数据库写权限。前端只发送类型化命令、订阅修订事件；模型 worker 只提交候选，不能直接改人工标注。所有路径与进程启动由后端验证，前端没有任意 shell 权限。当前媒体访问限定为已入库记录所引用的文件，路径来自本机文件选择或验证后的包导入；服务不监听公网。

## 后续技术路线与替代方案

| 层 | 首选 | 原因与代价 | 何时换方案 |
| --- | --- | --- | --- |
| 桌面壳 | Electron（用户已选择） | Chromium行为一致、前端开发与调试工具成熟；包体积与基础资源占用较高 | 先验证媒体闭环；Tauri仅保留为备选，不在首版同时维护两套壳 |
| UI | TypeScript + React + Vite，虚拟化列表，Canvas/WebGL 覆盖层 | 时间线、轨迹和波形大量可见元素；领域状态通过修订号协调 | 不引入完整视频编辑器框架；复杂状态可用 reducer/state machine |
| 数据 | SQLite WAL + FTS5，类型化迁移 | 本地事务、关系查询、备份与全文检索足够；图用节点与边表表达 | 向量规模实际测量后再用 sqlite-vec / 独立索引；初期不部署图数据库或向量服务 |
| 媒体 | FFmpeg / ffprobe，隔离进程 | 探测、代理、抽帧、音轨拆分、精确导出；记录构建信息 | 硬解、HDR与复杂播放需求驱动原生播放器扩展 |
| 播放 | 首版代理视频播放 + 后端精确帧预览 | 快速建立界面；播放不是时间真源。逐帧选择使用解码出的源 PTS 和帧图像，不能从 `currentTime * fps` 算帧号 | macOS AVFoundation 桥接作为精确播放候选；libmpv 提供跨平台候选，需渲染嵌入和许可试验 |
| 推理 | 独立 Python/原生进程适配器，按功能安装 | 不把 PyTorch、模型与 CUDA 打包成每个用户必装项；崩溃/OOM不带走主界面 | 常用模型经测量再移植 ONNX/Core ML；不假设 MPS 可运行所有 CUDA 项目 |
| 转录 | macOS 优先评估 whisper.cpp；WhisperX 为对齐适配器候选 | 前者有 Apple Silicon 支持资料；后者提供对齐和 diarization 组合 | 需自有中英混说、配乐、电影对白样本；README 速度不是本机承诺 |
| 封装 | 独立协议模块（语言待验证）；已有 Python 协议实验与 Node 桌面协议实现（schema 不互通） | AEAD 认证加密、标准库路径与哈希检查；协议跨语言 | 正式版本冻结前做双实现测试向量和安全评审 |

SwiftUI + AVFoundation 能更深使用 macOS 媒体能力，但 Windows/Linux UI 重做成本高。PySide6 + libmpv 利于 Python 推理开发，但发布体积、依赖隔离和复杂 UI 维护需要验证。Electron 的运行时一致性有价值，却不能自动解决 H.265/HDR、精确求帧和本机模型部署。用户已选择首版使用Electron；媒体与推理性能仍需单独验证。

## 尚待完成的精确时间与空间模型

- 每个 stream 保存容器 stream index、time_base 分子分母、start_pts、duration、旋转矩阵、像素宽高、SAR/DAR、色彩信息。
- 源时间保存整数 PTS + 有理 time_base，音频区间保存 sample_start/sample_end 与采样率。半开区间 `[start,end)`；不得把显示时间码作为唯一键。
- 切片输出的新时间轴通过 transform 记录回源映射；音频预滚、编解码延迟、重采样和视频旋转都要记录。
- 代理视频附 source↔proxy PTS 映射。VFR、重帧、丢帧时不能假定恒定 fps；镜头索引与解码帧索引是不同概念。
- 坐标存于定义好的原始显示方向画布，归一化矩形/多边形、关键点或外部 mask blob；明确 pixel aspect、裁切、缩放的转换矩阵。
- “无损快切”和“精确切片”是两个导出模式。流拷贝受关键帧限制，显示实际边界；精确切片重新编码并验证首尾帧和音频采样。

## 后续数据布局与性能目标

库目录建议包含 `library.sqlite`、`blobs/sha256/`、`cache/`、`jobs/`、`backups/`；源片默认引用，用户可选择托管拷贝。移盘后按大小、候选路径及完整哈希重新关联，不因同名文件自动绑定。

导入先探测并可浏览；完整哈希、代理、波形、镜头建议渐进执行。哈希未完成的对象标 provisional，不允许正式组集快照。大文件流式处理，模型按镜头/窗口执行；缓存按源哈希、模型版本、参数摘要寻址。UI 不加载全片所有 mask；只加载当前可见时间窗和缩略图层级。

任务状态 queued/running/cancel_requested/succeeded/failed/interrupted。幂等键包含输入修订；断点与临时输出独立，成功后原子替换。取消终止子进程组，失败保留诊断；重启识别中断任务，不以文件存在判成功。GPU任务默认单并发，CPU预算可调。下载模型前显示大小、来源、许可证和磁盘预算，校验摘要。

## 后续编辑与恢复目标

领域命令以事务写入当前对象与审计记录；长期目标是让撤销也可永久审计；当前 undo/redo 移动有界历史游标，新分支会丢弃 redo 记录。当前已采用 SQLite 当前表 + 有界 revision log；永久审计和长任务修订冲突检测仍是后续目标，不建立全量 event-sourcing 系统。长任务完成时检查输入修订，过时结果保留为建议而不覆盖人工修改。备份使用 SQLite backup API，不裸拷正在写入的 WAL 数据库。

导出先生成不可变 collection snapshot，再计算物化计划：成员、源范围、派生策略、预计体积、未审标注、授权缺口、去重关系、目标任务。全部完成并核对哈希才发布最终文件名。磁盘不足或取消只留下明确的 staging，不产生看似可用的集合。

## 需要试验才能决定的事

1. 60分钟 VFR、HEVC、旋转手机素材的定位正确性、内存和首次可用时间。
2. 原生 AVFoundation 与代理+精确帧通道的键盘逐帧体验，跨音轨同步。
3. Apple Silicon 16 GB 上 ASR、检测、分割的峰值内存、实际速度和取消恢复；并不预填“实时”。
4. 10万对象与100万标注的分页查询、时间线交互与备份；公开测量数据后设产品性能承诺。
5. FFmpeg 与播放器最终构建的编解码器、动态链接方式和许可，macOS 签名、公证与模型 worker 启动。

## Electron进程边界

Renderer启用sandbox与contextIsolation、关闭nodeIntegration；preload仅暴露窄类型化API，校验IPC发送者、参数和权限。主进程处理窗口与授权，当前数据库在后台 Node Worker，媒体运行于子进程；推理使用独立 Python 子进程。禁止任意shell、远程页面获得Node权限；限制导航、外链与文件协议访问。SQLite单写入者，协议与领域逻辑可由CLI复用。原生模块按Electron ABI与目标架构打包验证。

新增需求见[参考视频导出](REFERENCE_EXPORT.md)和[资产工作区](ASSET_WORKSPACE.md)。
