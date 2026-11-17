# 本机验证记录

日期：2026-11-17（Asia/Shanghai）。入口 http://127.0.0.1:3101 。详细任务时间、运行 ID、事件数、产物 SHA-256 和消息见 [delivery-evidence.json](delivery-evidence.json)。本文件随交付更新，不以离线演示代替真实模型证据。

## 已完成验证

- Docker Desktop 4.99.0，Linux/amd64 容器，Node v24.22.3，官方 Codex CLI 0.114.0。
- Docker Compose 构建、启动成功，服务 healthy；容器 UID 1000、cap_drop ALL、no-new-privileges，无宿主 Codex 挂载，镜像不含 .env。
- 容器内 workspace-write 沙箱验证：本工作目录可写，应用目录拒绝写入。
- 真实 API 经应用调用 Codex，完成单文件待办 index.html 和 README.md，83 个 CLI 事件，运行 ID 55d2e82c-2e01-4721-8dca-f397df294ea7。
- 浏览器实际验证真实生成网页的新增、完成、删除功能；预览提示存储隔离。
- 主机与独立 Docker 测试容器分别运行 8 项自动化检查：8 通过、0 失败。独立测试容器不传 API 密钥，不挂载会话数据，禁用网络。
- 测试覆盖：CSV 引号/BOM/换行、后续修改、材料上传/统计/下载、取消/409/429/失败恢复、路径校验/跨站请求、重启中断恢复、缺少真实凭据不回退、预览 CSP。

## 真实运行兼容性与限制

- 新版 0.169.0 的 bubblewrap 在本机 Docker 默认权限下失败，固定为已验证的 0.114.0；未关闭沙箱或增加特权。
- 平台最初拒绝服务端 web_search 工具，适配器禁用该工具后，真实 CLI 开发任务成功。
- 第二轮主题修改出现平台 max_output_tokens 截断，自动重试仍未产生产物，已通过应用取消；该记录保留在 attempt-theme-cancelled.json。后续更小的代码修改请求成功：title/h1 改为“我的行动清单”，README 增加快捷键说明（16 个 CLI 事件）。
- 真实 CSV 分析成功（18 个 CLI 事件），后续修改成一页销售管理摘要成功（28 个 CLI 事件），保留地区汇总与数据局限。
- 独立复算虚构 CSV：8 条、79 件、107000 元；华南 41000、华东 38000、华北 28000，报告逐项命中。
- 两个真实会话的后续任务同时运行成功；容器重启后校验 2 个会话的全部消息、运行次数及 4 个产物 SHA-256 全部一致。container-evidence.json 记录重启后 healthy、镜像 ID、端口、数据卷和权限。
- 四轮成功任务与一次取消分别记录，不把被取消的主题任务算作通过。runtime-evidence.json 提供成功流程索引，delivery-evidence.json 包含真实日志和完整消息。
- 产物快照位于 demo-output/，来自容器工作目录，通过应用文件接口获取，不是预制演示文件。
- 正式演示视频尚未制作。演示材料与复现步骤见 [DEMO.md](DEMO.md)。
