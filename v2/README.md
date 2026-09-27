# 魔虚罗 2.0 · 独立离线 DEMO

这是 P0—P2 的工程链路，不是 V6/V7 盈利验证。所有比赛、报价、概率及结算示例均为 **DEMO 合成数据**。真实来源、真实账户、远端部署与旧站切换均关闭。

## 本机启动

PowerShell 在这个 `v2` 目录运行：

```powershell
npm ci
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r model-runner\requirements.txt
npm run doctor
npm run bootstrap:demo
npm run dev
```

浏览器打开 http://127.0.0.1:5273 。读取 `.runtime-v2/demo/login-code.txt` 中的一次性口令，在页面输入。口令不放 URL、localStorage 或日志。每次 `dev` 生成新的口令，旧的有效 HttpOnly 会话在期限内可继续使用。

端口占用时启动失败，必须先核对是谁占用；没有自动杀进程/换端口。不要把原 5173 当新站入口。

首次依赖安装需要网络；依赖就绪后运行 DEMO 不访问外部数据源。Python 无单独监听端口，只主动领取 8788 上的内部任务；API 使用真正 workerd/D1 的本地运行时。

## 演示步骤

1. 今日观察 → 创建 DEMO 观察。
2. 打开研究 → 稍后刷新预测。市场基准显示 NO_ACTION，固定 DEMO 适配器主胜显示正 EV。
3. 手工记录 25 PAPER 纸面票 → 账本余额 75。
4. DEMO 主胜结算 → 余额 125，净收益 +25。
5. 追加更正为客胜 → 余额 75，净收益 −25，原票和首次结算仍可查。
6. 注入冲突 → REVIEW；之后可追加明确的 DEMO 裁定恢复结算。
7. 在另一个终端运行 `npm run stop:v2`，再 `npm run dev`；重新打开，原票、预测和事件仍在。

原始报价超过 10 分钟或比赛已经结束时，服务端拒绝新出票；创建新 DEMO 观察继续演示，不给旧报价续命。

## 检查

```powershell
npm run check
npm run test:unit
npm run test:integration
npm run test:e2e
npm run build
npm run report:verification
```

E2E 使用全新 profile、5273/8788 和本机 Chrome，测试结束只停止自己创建的 supervisor。若常用 DEMO 已运行，先使用它的 `stop:v2` 停止本轮新服务，不能停止旧站。测试启动前要保证新端口空闲。

文档和逐项范围见 `docs/mahoraga-2`。P3—P9、真实来源、V6/V7 parity、历史账本导入和长时间负载验收尚未完成。正式切换仍需要用户另行明确确认。
