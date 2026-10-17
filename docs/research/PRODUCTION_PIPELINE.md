# 影视制作流程与 CutBox 的位置

调研日期：2026-10-17。本文区分**已读取的一手资料**与**面向 CutBox 的设计建议**，不代表下述标准已经接入产品。具体功能与测试结果以 [验证记录](../VALIDATION.md) 为准。生成工具的交接方式见 [AIGC 工作流](../AIGC_WORKFLOW.md)。

## 从交付物理解制作流程

影视项目通常可以按开发、前期、制作、后期、交付与归档组织，但这不是一条只能前进的流水线。剪辑会反馈补拍，预演会反馈剧本，视效与声音会并行推进。下表是针对真人拍摄、动画和 AIGC 混合项目的工作分解，**不是声称所有好莱坞制作公司遵循同一套流程**。

| 阶段 | 主要问题与参与者 | 可审阅交付物 | CutBox 应保存的连接 |
| --- | --- | --- | --- |
| 开发 Development | 编剧、导演、制片明确作品目的、人物、世界规则、受众和范围 | 创作说明、剧本版本、世界设定、研究材料 | 作品／项目 → 剧本段落 → 叙事事件；原片观察、解释与新创作分别标识 |
| 前期 Pre-production | 剧本拆解、选角、场景／道具／服装设计；分镜、预演、声音规划 | 资产设定集、镜头表、分镜、animatic、拍摄或生成计划 | 叙事人物 → 对应演员／声音／视觉形态；镜头需求 → 参考证据与版本 |
| 制作 Production | 摄影、录音、表演、美术、动画或生成模型实现计划 | 拍摄 take、音轨、动画缓存、生成候选、现场与连续性记录 | 镜头 → 多次尝试 → 实际媒体；相机／任务／模型参数；拍摄／生成时间与故事时间分离 |
| 后期 Post-production | 剪辑、视效、合成、对白编辑、音乐音效、调色和字幕 | 剪辑版本、视效版本、混音、字幕、审片批注 | 候选与最终选用版本；缺陷所在帧／区间；修改要求 → 新版本 → 再审阅 |
| 交付 Delivery | 按实际接收方规格准备成片、声音与辅助材料 | 成片母版、字幕、音轨、交付清单、技术 QC 报告 | 规格版本、文件摘要、所用资产版本、验证结果与尚未确认项 |
| 归档与复用 Archival | 保存未来重制、重剪、参考和数据集所需材料 | 源素材、选用版本、项目／说明文件、依赖与使用记录 | 稳定身份、派生链、可定位媒体、保留策略、用途范围；避免只剩最终视频 |

对 CutBox 最有价值的不是复制制片管理软件的全部功能，而是保住每次交接中的信息：**这份文件是什么、用来做什么、由哪些证据和版本产生、为什么被选中、下一步如何使用。**

## 一手资料支持的架构判断

### 叙事对象、生产对象和文件不是同一层

MovieLabs OMC 明确区分 Narrative 和 Production：剧本中的人物、地点、道具，与实际演员、拍摄场地、布景和物理道具分别建模，再建立关联。[S1] 例如，一场叙事中的电话对话可能在两个实际地点、不同日期完成。

其 Depiction／Portrayal 机制进一步说明：一个角色可以由演员、替身、配音者和 CG 模型共同表现，并在特定场次中使用不同服装或道具。[S2]

对应 CutBox 的设计应为：

- **实体**记录“是谁／是什么”；**出现记录**记录某素材、镜头、时间和造型；**生产资产**记录被选来实现它的具体资料或版本。
- “角色 A”不应等于某一张参考图，也不应等于某个演员、某条声音或一个提示词。
- 某次生成中的服装、姿态、关系和持有物属于该镜头的状态，不能无条件覆盖整个角色设定。
- 声音资产应区分对白内容、声音表现、录音／合成文件及其对应人物；未确认的说话人保持未知。

### 身份、用途与存储位置分开

OMC 的资产说明区分元数据与实际内容（essence）、结构特征与功能用途，并使用不同身份标识资产及其具体内容。[S3] OpenAssetIO 同样强调通过稳定的 Entity Reference 解析数据，而不把当前文件路径当成身份。[S5]

这支持 CutBox 已采用的媒体摘要与语义 ID 分离，也意味着：同一张图可同时作为人物身份参考、服装说明和构图参考；这些用途需要独立标注。文件重新定位不改变身份，内容被修改则产生新的内容版本。导出说明中必须保留原始 ID、内容摘要、引用范围与用途。

### 五种“版本”必须说清楚

MovieLabs 把版本进一步区分为以下五种语义；其文档提供机制，不规定每家制作方的版本政策。[S4]

| 概念 | CutBox 中的例子 | 不能混淆的情况 |
| --- | --- | --- |
| Revision 修订 | 对同一角色设定或同一镜头修正细节 | 不应把“最新”自动当作“已选用” |
| Variant 变体 | 同一人物雨天服装、受伤状态或不同年龄形态 | 不应覆盖其他场次仍需要的状态 |
| Derivation 派生 | 原片裁剪、深度图、姿态参考、分离音轨 | 原始标注不能未经检查自动变成派生结果的真值 |
| Representation 表示 | 原片的播放代理、缩略图、技术格式转换 | 代理不是新故事内容，也不替代母版身份 |
| Alternative 候选方案 | 同一镜头的多次生成、两套概念设计 | 选中一份不意味着其他候选和拒绝原因可以丢弃 |

因此，`outputMediaId` 可以表示一个镜头当前选用的结果，**但单个指针不是完整的 takes 历史**。本轮 0.3 契约增加 `takes[]` 与每个候选的媒体关联；完整设计还需要父版本、参考输入快照、审阅记录以及版本依赖。修改镜头提示词后，既有输出的生成记录必须保留原来的提示词快照。

### 不同开放工具解决不同交接问题

| 一手项目 | 已核实的职责 | 对 CutBox 的启发与边界 |
| --- | --- | --- |
| OpenTimelineIO | 剪辑顺序、时长和外部媒体引用；Timeline、Track、Clip、Gap、Transition；时间使用 value／rate [S6] | 镜头清单可映射到剪辑交换；单独 `.otio` 不是素材包。必须说明支持的结构和媒体交接方式，不能写几个 JSON 字段就宣称 NLE 互通 |
| OpenUSD | 在图形应用间创建、读取、流式传递带时间采样的场景描述 [S7] | 可作为将来 3D 场景和资产变体交接的目标；二维标注库不是自动生成完整 USD 场景的系统 |
| OpenColorIO | 跨内容创作应用的一致色彩管理；兼容 ACES [S8] | 记录源色彩信息、参考显示变换和输出用途。对色彩敏感的参考必须区分原始像素和显示结果；本轮不宣称 OCIO／HDR 全链路实现 |
| OpenCue | 将复杂渲染任务拆成任务并分配计算资源 [S9] | 本地分析／参考生成也需要任务依赖、取消、失败和结果身份；有任务列表不等于实现了渲染农场 |
| Netflix Photon | 解析、解释和验证 IMF 包的 AssetMap、PackingList、CPL 与 Track Files [S10] | 技术交付格式检查与创意审阅是两类 QC；`.cbox` 不是 IMF，也不保证任何发行平台验收 |
| OpenAssetIO-MediaCreation | 图像、模型、版本与代理关系等 traits；README 标明 beta [S11] | 借鉴概念和身份分层，接入前验证具体版本；不能因为“开放标准”就假定接口永不变化 |

OTIO 的结构文档特别指出，一些范围与转场约束留给下游应用处理。[S6] CutBox 自己的导出器仍需验证范围、时基和实际媒体，不能把“序列化成功”当成“可用交付”。

## 面向 AIGC 的闭环

```mermaid
flowchart LR
  E[原片证据与人工审核] --> B[资产设定集与版本]
  B --> S[镜头需求与连续性约束]
  E --> R[按用途导出的参考]
  S --> P[提示词与参考清单快照]
  R --> P
  P --> T[外部生成或本地制作候选]
  T --> Q[技术检查与创意审阅]
  Q -->|返工说明| P
  Q -->|选用| D[剪辑与交付]
  Q -->|适用且已审核| A[参考资产或任务数据集]
  D --> H[依赖与来源归档]
```

这条链中的关键验收问题是：从最终选用镜头能否回到它实际使用的设定集版本、参考文件、提示词和生成结果；从一条原片证据能否看到它影响了哪些镜头。当来源或设定更新时，旧结果应显示需要复核，而不是悄悄替换。

## 来源与访问记录

以下资料均于 **2026-10-17** 通过各项目 GitHub／raw 官方仓库读取，HTTP 200。链接使用当日分支内容，后续可能更新；本文不依赖未读取的站外链接来断言功能。

| 编号 | 已读取资料 | 用于支持的判断 |
| --- | --- | --- |
| S1 | [MovieLabs OMC · Narrative & Production](https://github.com/MovieLabs/OMC/blob/main/OMC-JSON/Docs/Tech-Notes/NarrativeProduction.md) | 叙事与生产对象分离、剧本拆解与场次关系 |
| S2 | [MovieLabs OMC · Depictions and Portrayals](https://github.com/MovieLabs/OMC/blob/main/OMC-JSON/Docs/Tech-Notes/DepictionPortrayal.md) | 角色与演员、声音、CG、场次上下文 |
| S3 | [MovieLabs OMC · Assets](https://github.com/MovieLabs/OMC/blob/main/OMC-JSON/Docs/Tech-Notes/Assets.md) | 资产、内容、用途、结构与身份 |
| S4 | [MovieLabs OMC · Version](https://github.com/MovieLabs/OMC/blob/main/OMC-JSON/Docs/Tech-Notes/Version.md) | 五种版本语义 |
| S5 | [OpenAssetIO README](https://github.com/OpenAssetIO/OpenAssetIO/blob/main/README.md) | 稳定引用与按需解析；DCC 与资产管理职责分离 |
| S6 | [OTIO README](https://github.com/AcademySoftwareFoundation/OpenTimelineIO/blob/main/README.md)、[Timeline Structure](https://github.com/AcademySoftwareFoundation/OpenTimelineIO/blob/main/docs/tutorials/otio-timeline-structure.md) | 剪辑交换、媒体引用、时基与范围边界 |
| S7 | [OpenUSD README](https://github.com/PixarAnimationStudios/OpenUSD/blob/release/README.md) | 带时间采样的场景描述与交换 |
| S8 | [OpenColorIO README](https://github.com/AcademySoftwareFoundation/OpenColorIO/blob/main/README.md) | 色彩管理职责 |
| S9 | [OpenCue README](https://github.com/AcademySoftwareFoundation/OpenCue/blob/master/README.md) | 任务拆解与计算资源调度 |
| S10 | [Netflix Photon README](https://github.com/Netflix/photon/blob/master/README.md) | IMF 组成与技术校验职责 |
| S11 | [OpenAssetIO-MediaCreation README](https://github.com/OpenAssetIO/OpenAssetIO-MediaCreation/blob/main/README.md) | 版本／代理特征与 beta 状态 |
