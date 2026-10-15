# 验证记录

环境：Linux 云工作区。下面分别记录保留的 Python 格式实验和新增桌面模块验证；Linux 结果不能替代 macOS 真机与安装包验收。

## 新增桌面模块验证

Node.js 24.19.0 下已执行：

- `node --test tests/domain.test.mjs`：6 项通过。覆盖 Unicode、SQLite 关闭重开、快照隔离、部分更新、引用与时间/区域校验、删除关联且不删除源文件，以及导入重映射与晚失败回滚。
- `node --test tests/backend.test.mjs`：3 项通过。使用真实 Node Worker 和 FFmpeg 合成视频，从导入/缩略图到角色、区域标注、集合、加密包导出；删除原片后在新库导入，验证托管媒体字节与 SHA-256、引用映射和重启一致性。另验证无效操作、非法语义包和错误口令不改数据库、不遗留导入目录。

最终集成验证（2026-10-15）：

- `npm run check`：TypeScript 类型检查、Vite 生产构建、Node 测试与模板检查通过。补充源文件并发变化用例后再次运行 `npm test`：**25 项全部通过，无跳过**（领域6、媒体9、包7、Worker3）。
- `.venv/bin/python -m unittest discover -s tests -v`：**23 项全部通过**。
- `npm run test:desktop`：**完整 Electron 操作流程通过**。Playwright 驱动 Electron 44.7.2，在 Xvfb 显示环境中使用真实 SQLite、FFmpeg、加密模块与合成测试视频，仅替换系统文件选择器返回值。验证导入、播放时间推进、角色新增/编辑、场景新增、关联角色的时间/区域标注、集合、真实边缘 MP4（ffprobe 检查）、加密包导出到新库导入、重启快照一致，无 renderer pageerror。
- 本云环境不支持 Electron SUID sandbox，Linux 测试驱动显式使用 `--no-sandbox`；应用本身保持 `sandbox: true`、上下文隔离与关闭 Node integration。该测试不代表发行环境沙箱或 macOS 安全机制已验收。
- 已检查生成设计稿与真实桌面截图，涵盖宽屏空库、资产表单、紧凑布局和已导入的标注页面。见 [UI 设计记录](UI_DESIGN.md)、[桌面截图](design/desktop.png)与[合成素材标注截图](design/annotation-editor.png)。

Worker 回归测试还覆盖原片同尺寸改写与导出过程中变化：拒绝错误来源绑定，清理生成文件，不发布错误 sidecar。前后散列/文件状态检查不构成操作系统原子快照。

## 保留的 Python 格式实验验证（2026-10-15）

当时环境为 Python 3.12.14、cryptography 50.0.0。

### 已执行

- 从用户指定 `cellinlab/vibecoding-bip-template` 的 `391b89ae9b6a18cb7cace852e61afd4304fc534f` 初始化独立工程；保留MIT、作者区和全部作者资产哈希。
- 新建 `.venv`，安装 `requirements.txt`；`pip check` 无依赖冲突。
- `python3 scripts/check_template.py --project` 通过。
- `.venv/bin/python -m unittest discover -s tests -v`：23项通过，无跳过。覆盖CBox往返、目录迁移、随机化密文、错误口令、header/ciphertext篡改、媒体篡改/缺失、路径穿越/符号链接、版本与selector拒绝、音频样本范围、引用与JSON校验、非覆盖写入；另覆盖模板结构和作者资产。
- 真实终端执行 `demo → pack → verify`，隐式输入测试口令，成功验证1个WAV和1条音频样本区间标注。

模板原有测试的fixture只复制模板文件，不能承载初始化后的项目文档链接。已把fixture明确还原为模板状态，并增加真实CutBox项目检查；没有跳过断言或把失败当成功。

## 尚未证明与已知限制

- macOS 真机、Apple Silicon、安装包、签名公证、Windows/Linux 发行仍未验证。
- 当前浏览器播放器采用秒级定位，未证明 VFR 精确逐帧、HEVC/HDR、旋转、多音轨同步、长片或大规模库表现。
- 深度、姿态、分割、转录模型未安装或接入；没有模型性能、质量或训练/生成效果结论。
- 拉片目前是观察/解释字段与时间范围，不包含镜头自动检测、镜头关系图、轨迹、多人说话或声画关系分析。
- 元数据编辑没有修订历史或撤销；任务列表不持久化，未实现完整崩溃恢复/备份。
- 包复制整份依赖媒体，不按标注自动裁切。参考视频单独导出，来源 sidecar 不是完整的可复现派生记录。
- SHA-256 去重保留旧源路径；旧源丢失时导入相同内容或包不会自动修复引用。托管副本与缓存清理策略仍待完善。
- Node 桌面包与 Python 实验 schema 不互通；格式测试不等于独立安全审计，也不承诺防御恶意本机并发修改。
