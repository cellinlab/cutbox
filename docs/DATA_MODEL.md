# 领域模型与标注本体

文档同时记录当前模型与长期目标；未明确列入「当前实现」的本体、关系和锚点仍是设计。数据库行号不作为公开对象 ID。

## 当前实现：schema v1

`desktop/domain.mjs` 使用 SQLite 的 `media`、`entities`、`annotations`、`collections` 四张表，每行是 `id + JSON`，`PRAGMA user_version=1`。所有写入经过后端校验与事务，当前没有关系表外键、历史表或全文索引。

| 对象 | 已持久化字段 |
| --- | --- |
| Media | UUID、名称、video/audio/image 类型、绝对路径、SHA-256、大小、秒级时长、可选宽高/缩略图、创建时间 |
| Entity | UUID、character/scene/prop/sound 类型、名称、描述、字符串标签、mediaIds、可选 coverMediaId、创建/更新时间 |
| Annotation | UUID、mediaId、可选 entityId、浮点秒 start/end、label、notes、reviewState、可选归一化矩形 region、创建/更新时间 |
| Collection | UUID、名称、描述、mediaIds/entityIds/annotationIds、创建/更新时间 |

`region` 为 `{x,y,width,height}`，原点左上角，范围在 0–1 内且面积非零；音频不允许画面区域。当前标注满足 `0 ≤ start ≤ end ≤ duration`；图片时长为 0。相等边界可以存储为点标记，但参考视频导出要求正时长。没有源 PTS、音频样本锚点、多音轨选择或区域轨迹，因此不保证 VFR 逐帧准确。

审核状态只有 `suggested/accepted/needs_review`；尚无 rejected、审核历史或模型来源。拉片视图使用同一 Annotation，以 label 记录观察、notes 记录解释，不等于独立的 Interpretation/Relation 模型。

省略 ID 创建，已有 ID 更新；未知更新 ID 拒绝。所有引用必须存在，封面必须属于实体的 mediaIds。删除实体只移除标注 entityId 和集合中的实体引用，保留标注、素材及原文件；删除标注同步移除集合引用。编辑覆盖当前值，尚无撤销历史。

`importSnapshot` 一次事务导入完整依赖图，内部引用重映射，语义对象一律创建新 UUID，不覆盖既有实体；媒体按 SHA-256 去重。任一无效字段或缺失引用使数据库整体回滚。去重沿用旧路径，旧源丢失时重新导入同一内容不能自动修复；需要未来重新关联工作流。

桌面包 schema 为 `cutbox.desktop/0.1`，只导出白名单字段和相对素材路径；导入先验证包与文件再写库。早期 Python 实验 schema 不等同于桌面 schema，不承诺跨版本互通。

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

早期 Python CLI 仍覆盖素材相对路径/大小/SHA-256、描述列表、音频样本锚点、schema 检查、加密 JSON 与完整性回读。桌面采用上文四类对象的独立 schema；两个实验不应混用。时序区域、完整关系图和训练适配器仍未实现。

## 资产卡与派生参考扩展

角色/场景/道具/声音资产卡以Entity身份聚合来源、状态版本和展示信息，Asset仍指影音文件。实体包需要entities、relations、成员与依赖闭包及冲突导入策略，见[资产工作区](ASSET_WORKSPACE.md)。参考输出由Derivation连接源anchor与输出Asset，记录时间/坐标映射、模型和深度/pose/palette等编码语义，见[参考导出](REFERENCE_EXPORT.md)。当前桌面 schema 仅实现资产卡与来源、标注引用；relations、完整 Derivation 与模型编码元数据仍需版本化升级。
