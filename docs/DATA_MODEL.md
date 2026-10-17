# 领域模型与标注本体

文档同时记录当前模型与长期目标；未明确列入「当前实现」的本体、关系和锚点仍是设计。数据库行号不作为公开对象 ID。

## 当前实现：schema v2

`desktop/domain.mjs` 使用 SQLite `media`、`entities`、`annotations`、`collections`、`templates`、`events`、`relations`、`stories` 八张对象表，每行是 `id + JSON`，`PRAGMA user_version=2`。另有 `revisions` 保存操作前后快照，`domain_meta` 保存撤销游标。v1 数据迁移保留原 ID 和关联。引用完整性由 `validateSnapshot` 和事务保证；当前没有关系型外键、FTS5 或向量索引。

| 对象 | 已持久化字段 |
| --- | --- |
| Media | UUID、名称、video/audio/image、绝对路径、SHA-256、大小、秒级时长、可选宽高/缩略图/代理、series/episode、创建时间、可选 sourceAnchor |
| Entity | character/actor/scene/prop/sound、名称、描述、标签、mediaIds、封面、标量 attributes、可选 actorEntityId、时间戳 |
| Annotation | mediaId、可选 entityId、start/end、label/notes、reviewState、category、epistemic、confidence、tags、templateId/values、trackId、region/polygon/keyframes、words/keypoints、sourceAnchor、时间戳 |
| Collection | 名称、描述、mediaIds/entityIds/annotationIds、时间戳 |
| Template | 名称、描述、fields；字段 key/label/type/required/options/unit，类型为 text/number/boolean/select |
| Event | 名称、描述、entityIds、annotationIds、sceneId、storyTime、epistemic/confidence、changes（entityId/key/before/after） |
| Relation | fromEntityId、toEntityId、type、description、evidenceAnnotationIds、epistemic/confidence |
| Story | 名称、描述、类型化 variables、startNodeId、nodes；节点引用媒体区间/事件，choices 包含条件与原子效果 |

`region` 为归一化 `{x,y,width,height}`，原点左上，范围与面积校验。`polygon` 至少三个点且非零面积；`keyframes` 时间递增、唯一并位于标注范围，保存矩形。音频不接受画面几何。当前满足 `0 ≤ start ≤ end ≤ duration`；图片时长为 0，相等边界可用于点标记，视频输出要求正时长。仍没有源 PTS、样本级音频锚点或多音轨引用，不保证 VFR 逐帧准确。

审核状态为 `suggested/accepted/needs_review`；认识状态独立为 `observed/interpreted/invented`，置信度为 0–1。两者不等同：接受一条分析不使它成为客观事实。模板值必须满足字段类型、必填和枚举约束；修改模板不能静默使已有标注失效。关系目前连接实体，事件因果顺序可用故事图表达，尚非任意对象关系本体。

省略 ID 创建，已有 ID 更新，未知更新 ID 拒绝。引用必须存在，封面属于实体 mediaIds，角色的 actorEntityId 只能引用 actor。删除操作按依赖校验或显式清理引用，不留下悬空关系；有事件、关系等依赖时可能拒绝删除。所有写入和批量标注是事务，undo/redo 支持跨重启恢复。默认最多保存 30 次操作，可配置 1–200；分支编辑丢弃 redo，不能把有限修订记录视为永久审计。

`importSnapshot` 先校验完整图再事务导入，八类对象 ID 按映射重建；模板值、演员、事件证据、故事媒体/事件引用全部重映射。媒体按 SHA-256 去重，已失效的旧路径可由相同内容的新文件修复；重新关联必须通过完整摘要与大小校验。任一无效字段或缺失引用让数据库整体回滚。`replaceSnapshot` 用于校验后整体恢复并保留快照 ID，与合并导入不同。

桌面包使用 `cutbox.desktop/0.2`，兼容读取 0.1 的四类对象，新增数组默认为空。导出仅含白名单字段、相对素材路径，导入先验证密文、大小、哈希与依赖，再由领域服务完整校验入库。文件复制与数据库事务不是同一原子事务，调用方负责失败副本清理。

裁剪配置保留媒体和标注的 `sourceAnchor`，这里的 mediaId 是外部直接来源标识，不参与包内 ID 重映射。它保存上一步输入的区间和摘要，不是无限追溯的派生链；二次裁剪不会自动保留全部更早变换。源标注与故事时间重基准，奇数尺寸补边时几何重新归一化，详见[CBox 格式](CBOX_FORMAT.md)。

## 以下为长期领域模型

## 从证据到解释

| 对象 | 含义 | 例子 |
| --- | --- | --- |
| Asset / Stream | 不可变源文件与流 | 影片A、视频流0、国语流1 |
| Anchor | 证据位置：全源、时间、帧、区域、轨迹、样本区间 | 第120–160个显示帧中的人物框 |
| Entity | 跨片段被引用的对象身份 | 角色A、演员B、蓝色外套、地点C |
| Observation | 谁在何处观察到什么 | 轨迹T在该区间穿蓝外套；可见而非确定性格 |
| Interpretation | 对证据的分析判断 | 低机位强化压迫感；附理由和比较片段 |
| Relation | 带时间与证据的关联 | wears、speaks、looks_at、same_as_candidate、sound_bridge |
| Derivation | 派生素材的可复现变换 | 原声→声部分离→重采样→裁剪 |
| Collection | 可复用成员与用途 | “雨夜低语”集合，固定修订或保存查询 |
| Review / Provenance | 谁如何产生、如何审核 | model-X@hash 建议，用户修正与接受 |
| Rights / UsePolicy | 使用声明及其依据 | 自录，允许播客剪辑；训练用途待确认 |

Entity≠Track：同一角色可有多个演员、同演员可演多个角色，轨迹可被切断。声源聚类≠角色身份：配音、画外音、电话、歌唱和背景电视都可能打破映射。身份合并必须可撤销，不能把模型相似度直接写为已证实身份。

## Anchor 类型

- `asset`：全源描述；`frame`：PTS+stream；`time_range`：同流有理时钟的半开区间。
- `audio_samples`：指定流和采样率的样本区间。
- `region`：某帧矩形/多边形/关键点；`track`：时序关键帧+插值方法+遮挡状态。
- `mask`：外部内容寻址 blob，存分辨率、编码、变换；不向一个 JSON 塞数百万点。
- `text_span`：关联 transcript revision 的字符/词范围，同时回指音频锚点。
- 不确定边界可给 estimate + lower/upper bounds；不确定值≠未标注≠不适用≠明确不存在。

## 可扩展本体：小核心 + 版本化领域包

| 包 | 典型字段 | 注意事项 |
| --- | --- | --- |
| 人物与服装 | garment category、层次、颜色、材质、图案、配饰、持物 | 服装属性附出现区间，不附永恒人物身份 |
| 姿态与动作 | 关键点、朝向、表情观察、动作阶段、接触对象 | 遮挡/缺点显式标记；动作标签有开始结束与角色 |
| 场景与物体 | 室内外、地点、空间关系、天气、时间感、道具、光源 | 场景语义跨镜头；镜头切换不等于场景切换 |
| 电影语言 | 景别、角度、运镜、构图、焦点、景深、光色、调度、剪辑关系 | 焦距等无可靠元数据时是估计；主观分析独立保存 |
| 声音 | 对白、说话者、语言、词级时间、语气观察、环境声、拟音、音乐、静默 | 画内/画外、同步/异步、重叠、配乐污染和声道都可标 |
| 复用 | 用途、描述、质量、背景污染、技术参数、来源与授权依据 | 适合“参考”不等于适合“训练”或声音克隆 |

每个字段定义稳定 ID、类型、单位、枚举版本、作用 anchor、允许的空值与升级迁移。项目可以新增自定义命名空间；不同本体间显式映射，不自动把近义词合并。查询同时支持受控词和自由备注。

Annotation 至少保存 subject、anchor、predicate、value、作者/模型版本、created_at、输入修订、evidence、review_state。模型 confidence 按模型/任务解释，跨模型不能直接排序成统一“可信度”。人工审核状态为 suggested/accepted/rejected/needs_review；观察可靠性另设，不把 accepted 等同真理。

## 核心关系表（草案）

`assets`、`streams`、`anchors`、`entities`、`tracks`、`observations`、`interpretations`、`relations`、`derivations`、`ontology_versions`、`revisions`、`reviews`、`collections`、`collection_members`、`rights`、`jobs`。

热查询字段（asset、stream、start/end、entity、predicate、review_state）建索引；扩展值用有 schema 的 JSON。FTS5 索引备注、转录和描述。向量索引只做候选召回，结果必须回到 anchor，并记录 encoder/version。未来跨模态自然语言查询先转为用户可见的筛选条件，不隐式执行模糊条件的训练导出。

## 拉片与素材化共用数据

在镜头A→镜头B之间标 `match_cut`，关系连接两段证据；在声音先于画面进入时标 J-cut 的声音范围与画面范围。镜头卡可以组成分析序列，附观察与论证；素材集合可以引用相同锚点但指定不同派生策略。分析卡不复制原文件，分析文本可不进入训练导出。

查询例：已审核、夜间室外、角色A、蓝外套、侧面行走、无对白的2–5秒片段；结果展示命中的实际证据与缺失字段。筛选中“无对白”需要显式证据或可靠检测并经确认，不能把没有转录当静默。

## 训练适配与质量

CBox 是统一证据交换层，不是所有模型的训练输入。任务适配器将集合冻结成 COCO/YOLO、音频+transcript JSONL、说话者片段或 WebDataset 等，并报告丢失的字段与关系。训练/验证/测试按作品、身份或录制会话成组切分，避免同一电影相邻帧泄漏；记录近重复检查与切分规则。模型生成建议不能不经说明就当 ground truth。

播客使用有三种不同产物：可直接剪辑的授权音频；供生成的风格/内容参考描述；带明确同意和目标许可的声音训练素材。分离人声产生的是派生估计，可能有音乐残留、混响与失真，不应标为原始干净人声。

## 保留的 Python 格式实验

早期 Python CLI 仍覆盖素材相对路径/大小/SHA-256、描述列表、音频样本锚点、schema 检查、加密 JSON 与完整性回读。桌面采用上文八类对象的独立 schema；两个实验不应混用。桌面已有关键帧、实体关系、事件/故事和 JSONL/COCO/SRT 适配；完整流级锚点、任意本体关系及任务划分协议仍待实现。

## 资产卡与派生参考扩展

角色/场景/道具/声音资产卡以Entity身份聚合来源、状态版本和展示信息，Asset仍指影音文件。实体包需要entities、relations、成员与依赖闭包及冲突导入策略，见[资产工作区](ASSET_WORKSPACE.md)。参考输出由Derivation连接源anchor与输出Asset，记录时间/坐标映射、模型和深度/pose/palette等编码语义，见[参考导出](REFERENCE_EXPORT.md)。当前桌面 schema 已实现资产卡、实体关系、事件和故事引用；完整 Derivation 链、模型编码语义和逐帧变换映射仍需版本化升级。
