<!-- bip:project:start -->
# CutBox

本地优先的影视素材标注、拉片与素材集合制作工具。

[English](README.md)

把影视中的人物、衣着、姿态、场景、对白、声音事件和镜头关系，组织为可定位、可审核、可复用的素材。以 `.cbox` 加密描述与标注清单，配合对应素材集合，为创作参考和特定训练任务提供可追溯输入。

**当前交付：研究、架构和格式实验；桌面软件尚未实现或发行。** 首先面向 macOS，架构为 Windows/Linux 保留适配空间。

## 阅读与运行

从 [产品目标](specs/VISION.md)、[开源调研](docs/research/RESEARCH.md)、[交互设计](docs/INTERACTION.md) 开始；继续看 [数据模型](docs/DATA_MODEL.md)、[技术架构](docs/ARCHITECTURE.md)、[CBox 格式](docs/CBOX_FORMAT.md) 与 [路线图](docs/ROADMAP.md)。

[英文入口的运行命令](README.md#run-the-format-experiment) 可生成自制合成音、加密清单，并验证素材。Python 3.12+，无 API Key；口令在终端隐式输入。实验只支持全素材与 WAV 样本区间标注，不进行视频裁切、自动标注或模型训练。

**`.cbox` 只加密描述，旁边的素材仍是明文。** 搬迁集合时同时携带素材目录；实验格式不能作为唯一备份，也不代表任意影视素材都可用于训练。模型建议与人工审核、观察与拉片解释均明确区分。

贡献建议以一条实际用户任务为单位，附输入、失败条件与验证，不以新增标签数量代替可用性。
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
