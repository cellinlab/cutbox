# CutBox 开源调研与独立判断

核验日期：2026-10-15。材料为项目官方仓库 README 与许可证；固定 commit/URL/摘要见 [来源账本](sources.json)。本轮没有安装、运行或基准测试这些完整产品，功能表是官方资料声明，不能当作实测性能。滚动 README 没有可靠发布日期时不猜测发布时间。

## 工作问题与最强替代方案

目标：本地整理影视素材，把人物、穿着、姿态、场景、对白与声音精确标注，保留拉片分析，导出可复用集合。问题不是“哪个标注工具功能最多”，而是“什么共享数据模型能让观看、理解、检索和复用不重复劳动”。

最强替代方案是直接使用 LabelU/CVAT 做标注、FiftyOne 做数据管理、单独拉片笔记做电影分析，再写导出脚本。这能更快开始训练数据生产。如果目标只是一个固定框标任务，应优先采用它，而不是开发新产品。CutBox 成立的条件是：声画对象、电影分析与可迁移素材集合确实需要共用来源和修订；下面的统一对象模型与离线桌面闭环能减少切换和信息损失。这个收益尚需真实用户任务验证。

## 直接相关的参考

| 项目 | 官方资料支持什么 | 可迁移机制 | 不采用/失效条件 | 许可证据 |
| --- | --- | --- | --- | --- |
| [拉片笔记](https://github.com/bkingfilm/lapian-notes) | 本地抽帧、字幕、AI分析包/回导、剧情泳道、结构树、播放器联动；本地版可选API | 分析条目跳回原片、分段深化、人工精修 | 每秒一帧不能支持精确对象轨迹；情绪曲线和创作意图不能变成客观训练标签；本地存储不等于把分析包交给外部AI时也不出机 | MIT，LICENSE 已读 |
| [VIAN](https://github.com/FilmColors/VIAN) | Visual Film Annotation Beta，电影标注、分析与色彩可视化，Python/Conda桌面安装路径 | 电影分析视角、时间与视觉特征结合 | 不从简短README推断完备音频/训练能力；Beta说明不等于维护或稳定性结论 | GPLv3文本已读；借鉴机制不复制代码进MIT项目 |
| [LabelU](https://github.com/opendatalab/labelU) | 图像框/线/关键点、视频与音频分段/分类、预标注编辑、多格式导出、模型服务接口 | 多模态工具组合、建议后修正、可配置本体；LabelU-Kit值得单独适配试验 | 平台任务模型不等于电影对象关系；具体模型的显存声明不是macOS保证；不能自动继承所有子包/模型许可 | Apache-2.0 已读 |
| [CVAT](https://github.com/cvat-ai/cvat) | 视频/图像/3D标注、模型辅助、任务与审核管理 | 对象标注、审核、任务拆分、自动结果回审 | 服务端/团队任务架构与本地个人素材库目标不同；不引入整套部署作为默认依赖 | 核心 MIT 已读；部分serverless资产/依赖另有许可 |
| [Label Studio](https://github.com/HumanSignal/label-studio) | 音频、文字、图片、视频、时间序列标注与训练格式导出 | 类型化标注配置、跨模态任务表达 | 不直接把任务结果JSON当CutBox领域模型；社区版与商业功能应逐项核验 | 官方develop LICENSE Apache-2.0；最初README的master URL为滚动链接 |
| [FiftyOne](https://github.com/voxel51/fiftyone) | 数据集浏览、筛选、标注工具连接、质量与错误分析 | 集合视图、质量驱动的数据筛选与训练导出 | 不因支持视频数据集就推断完整逐帧电影工作台；完整应用不作为桌面内嵌依赖 | Apache-2.0 已读 |
| [BeaverDam](https://github.com/antingshen/BeaverDam) | 视频框标、关键帧调度、附加属性；明确不支持语义分割；Django/MTurk路线 | 用关键帧降低人工框标成本 | 框标历史实现不能覆盖mask、声画关系与现代桌面部署；需要专门验证依赖兼容 | BSD-2-Clause 文本已读 |
| [VARS旧版](https://github.com/hohonuuli/vars) | 受控、可检索视频注释；README明确 deprecated 并指向M3/VARS | 受控词汇、观测与检索的长期一致性 | 不选已弃用旧版为底座；[新M3入口](https://github.com/mbari-media-management/m3-quickstart)仅作为后续调查线索，未实测 | LGPL-2.1文本已读；新系统许可另查 |
| [Emulsion](https://github.com/dennisonbertram/emulsion) | Three.js拍摄预演、对象/相机关键帧、带时间的注释、参考视频导出 | “对象ID+时刻”的操作目标、镜头与资产分开、版本化导出 | 它生成拍摄预演，不是解析已有影视；full-state last-writer-wins不能直接用于异步模型覆盖人工标注 | MIT 已读 |
| [video-shotcraft](https://github.com/Vincentwei1021/video-shotcraft) | Agent/Remotion宣传片制作、镜头配方、可编辑交付 | 可复用配方的描述与适用条件、素材交付可重开 | 生成动画配方不等于来源片段证据；不把它的镜头库当普适电影本体 | Apache-2.0 已读；底层工具另有条款 |

## 可作为适配器或实现参考的组件

| 项目 | 用途与证据 | CutBox采用上限 | 许可/风险 |
| --- | --- | --- | --- |
| [PySceneDetect](https://github.com/Breakthrough/PySceneDetect) | Content/Adaptive/Threshold检测，切片依赖FFmpeg/mkvmerge | 产生候选镜头边界，允许合并/拆分；算法的scene不等于剧情场景 | BSD-3-Clause 已读；闪光、快速运动、叠化需样本评估 |
| [whisper.cpp](https://github.com/ggml-org/whisper.cpp) | README明确Apple Silicon、Metal/Core ML路径 | macOS本地ASR首选试验；不承诺准确率或本机实时 | README声明MIT；权重与转换过程独立核验 |
| [WhisperX](https://github.com/m-bain/whisperX) | ASR+音素对齐+pyannote说话者分段 | 词级对齐适配器候选，不直接把speaker ID当角色 | 当前固定commit LICENSE为 **BSD-2-Clause**；不沿用旧记忆中的许可结论；模型许可分开 |
| [pyannote.audio](https://github.com/pyannote/pyannote-audio) | 说话者分段；community-1需接受模型条件，文档示例需token | 可选diarization，不把云premium接口设为默认 | 代码MIT已读；权重、模型下载条件和性能另查 |
| [SAM 2](https://github.com/facebookresearch/sam2) | 点/区域提示的视频mask传播，多对象支持 | 用户修正关键帧后的候选分割；不能识别衣服名称、角色身份或剧情 | Apache-2.0代码已读；README CUDA安装路线不能证明MPS可用；checkpoint/数据条款另查 |
| [LosslessCut](https://github.com/mifi/lossless-cut) | FFmpeg桌面音视频切割/轨道/快照 | 范围选择、无损快切与精确切片的取舍 | GPLv2文本已读；不复制其实现；“无损”不保证任意帧边界 |
| [Shotcut](https://github.com/mltframework/shotcut) | 跨平台视频编辑器及媒体依赖路线 | 研究桌面媒体工作流和格式兼容 | GPLv3文本已读；CutBox不扩张为完整NLE |
| [mpv](https://github.com/mpv-player/mpv) | 原生广格式播放，硬解需配置 | 播放引擎候选；必须实测WebView覆盖层/原生窗口嵌入 | README声明默认GPLv2+，`-Dgpl=false`为LGPLv2.1+；最终构建核验 |
| [FFmpeg](https://github.com/FFmpeg/FFmpeg/blob/master/LICENSE.md) | 探测、解码、代理、派生媒体的基础；许可文档明确build选项影响许可 | 独立受控进程，不执行导入包传入的任意命令 | 默认多数LGPLv2.1+；enable-gpl及外部库改变条件；分发清单按实际构建 |
| [Tauri](https://github.com/tauri-apps/tauri) | Rust应用框架，系统WebView，macOS/Windows/Linux | 桌面壳候选，不据框架README承诺视频帧精度 | README声明MIT/Apache-2.0；依赖与发行包另查 |
| [OpenTimelineIO](https://github.com/AcademySoftwareFoundation/OpenTimelineIO) | 剪辑时间线交换项目 | 后续NLE互通研究对象；不把它当全套对象/声音标注schema | 本轮未核验LICENSE和具体adapter，未引入 |

## 主张—证据与反证

**C1：没有一个已核验项目能直接证明覆盖全部CutBox目标（provisional）。** 支持：上表各项目自述的任务范围差异；不能证明市场不存在此类产品。反例：LabelU已覆盖多模态、CVAT+FiftyOne可以完成许多训练任务。因此不以“市场空白”作为立项依据，以统一来源/修订/声画关系和本地交互的实际收益作为验证目标。

**C2：语义镜头分析与客观标注应共享证据但分开保存（design decision）。** 支持：拉片笔记侧重剧情与解释，CVAT/LabelU侧重任务标注；不能证明某种数据库schema天然更好。反例：纯个人笔记只用自由文本更轻便。因此保留自由备注，仅把可查询/训练字段结构化，不强迫每句话进入复杂本体。

**C3：不能用抽样截图替代细粒度时空证据（supported with scope）。** 支持：拉片笔记README说明1秒抽帧，CV工具围绕帧/区域，媒体编码存在不同时间基；短于采样间隔的动作可遗漏。边界：剧情浏览可能只需稀疏图。改变设计：双路径，浏览用低成本缩略图，标注与导出用真实PTS/样本。

**C4：macOS本地AI可行但不能照搬CUDA方案（provisional）。** 支持：whisper.cpp提供Apple Silicon路径；SAM2/WhisperX文档包含CUDA相关依赖。不能证明全部模型在同一设备上流畅协作。改变设计：人工闭环先完成，模型独立安装、按任务运行并有资源预算；Tauri与播放器先做小原型。

**C5：加密JSON+哈希可实现描述保密与素材一致性（tested only for prototype subset）。** 支持：仓库格式实验的往返、错口令、篡改、搬迁、缺件与路径拒绝测试。不能证明生产级安全、来源作者真实性、全媒体保密或完整视频锚点有效。改变设计：明确外部媒体明文，稳定格式前做安全评审及跨语言测试。

## 原创与许可边界

本轮架构从素材复用的必要条件推导：证据anchor → 对象/属性/关系 → 审核与修订 → 可查询集合 → 用途适配导出。未复制上述项目的源码、UI资产、镜头配方或私有数据；仅引用官方功能描述并迁移通用机制。实际复制的底座是用户指定的 MIT BIP 模板，原版权、作者素材及配置哈希保留。

开源代码许可、模型权重许可、训练数据许可、影片/人物声音使用授权分别记录。MIT应用可以调用其他许可工具，不等于所有链接/打包方式自动兼容。发行时按实际包含的二进制、模型和素材生成第三方清单。

## 未验证与收束条件

这些参考尚未进行本轮交互实测，不能给UI好坏/易用性分数；未宣称star数量、维护活跃度或速度排名。ELAN/ANVIL未取得可靠原始仓库资料，未纳入结论。公开star查询只是发现线索，不代表已完整读取个人star列表；云工作区没有此前clone的其他项目。

下一项高价值工作不是继续堆参考项目，而是在macOS完成P1的一条精确定位→标注→导出→回读路径，再用真实素材决定播放器、索引和自动标注优先级。
