# CutBox

CutBox 是一个本地优先的影视素材标注、拉片与素材集合制作工具。用户已确认名称 CutBox，以及 macOS 优先、架构兼容 Windows/Linux。设计基线：2026-10-15。

## 从目的推导

人真正需要的是：再次找到有用的瞬间，理解它为什么有用，把它连同来源和描述交给下一个创作或训练流程。文件夹不能表达人物跨镜头出现、衣服随时间变化、画外音与画面的关系；单一标签表也不能表达证据、推断和用途。

因此核心单位是「可以精确回到原素材的证据对象」，而非文件或 AI 对话。素材不因一次标注而被裁掉；同一对象可参与多个集合，集合导出时才物化。

价值函数：有效可复用素材数 × 检索成功率 × 标注可信度 ÷ 人工时间、计算与存储成本。“尽可能细”是模型可表达且按需可加深，不是导入时对所有帧运行所有模型。

## 用户与场景

- 影视创作者：按构图、调度、光线、剪辑、声音关系拉片，构建可回看的参考。
- 素材整理者：标人物、服装、姿态、物体、空间、对白、环境声；跨作品查找并组集。
- AI 创作者：导出有上下文和用途说明的参考片段、提示描述与音频素材。
- 数据集制作者：按明确任务定义标注本体、审核、切分与导出，保留来源与变换链。

## 最小成功条件

以自制或获授权的短片为验收材料。完成导入、校正镜头边界、人物轨迹与服装区间标注、对白片段修正、跨模态检索、加入集合、加密描述导出、换目录重新导入并定位来源。

覆盖至少：可变帧率、多人重叠讲话、画外音、遮挡后重现、人物换衣、竖屏旋转、不同音轨与采样率。不能因用户没有下载模型而无法手工完成闭环。

## 本轮交付与状态

本轮是研究与架构设计、模板初始化及 `.cbox` 格式实验。仓库包含研究证据、交互、数据模型、技术决策、路线图与可执行的加密封装原型；没有声称桌面软件已经实现。原型只处理 JSON 描述与已有素材文件的完整性验证，不做视频切片、自动标注或训练。

后续桌面方案：Tauri 2 + TypeScript/React，Rust 领域服务 + SQLite，FFmpeg/ffprobe 媒体工作进程，可选独立推理适配器。最终播放器选型必须通过 macOS 精确定位试验，详见 [架构](../docs/ARCHITECTURE.md)。

## 当前本地运行

Python 3.12+；安装原型依赖后：

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python -m unittest discover -s tests -v
.venv/bin/python scripts/cbox.py demo /tmp/cutbox-demo
.venv/bin/python scripts/cbox.py pack /tmp/cutbox-demo/manifest.json /tmp/cutbox-demo/media /tmp/cutbox-demo/collection.cbox
.venv/bin/python scripts/cbox.py verify /tmp/cutbox-demo/collection.cbox /tmp/cutbox-demo/media
```

pack / verify 在终端隐式输入口令，不把口令放命令行参数或版本库。demo 为合成正弦音，不是人声或影视样本。不要用这个实验格式存放唯一一份数据。

## 非目标与维护

首版不替代 NLE，不做音视频生成或模型训练，不上传源片，不承诺全自动理解所有人物和镜头含义。暂不做多人同步、云资产库、移动端和插件市场。

无需服务部署。macOS 签名、公证、安装包、GPU 推理和跨平台验收属于后续实现；没有下载地址或发行承诺。
