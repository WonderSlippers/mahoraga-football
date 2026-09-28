# 测试报告

## 执行环境与结论
Windows / Node24.14.0 / Python3.12.3 / Chrome / Miniflare4.20260515.0（真正workerd+D1）。测试输入均为DEMO，不是模型盈利证明。

2026-09-28上海时间03:03—03:05汇总运行：

|命令|退出码|测试数|失败/跳过|
|---|---|---|---|
|npm run doctor|0|环境检查|0|
|npm run check|0|TypeScript|0|
|npm run test:unit|0|26|0/0|
|npm run test:integration|0|16|0/0|
|npm run test:e2e|0|1|0/0|
|npm run build|0|Worker+Vite产物|0|

机器报告：.runtime-v2/verification/2026-09-27T19-03-35.575Z/verification.json；每条命令的起止UTC、退出码和原始日志在同目录。UTC时间不是模型报价时间。

## 行为证据
- 15条原包数学golden逐条核验金额；严格null/空串/概率/时间、跨语言Schema和canonical bytes哈希。
- D1实际FK/CHECK/UNIQUE/append-only触发器；重复migration不丢数据。
- 同key同payload 100个并发调用只有一张票；换payload报409语义错误；不同key同businessKey不重票。
- 出票7个注入点、结算6个注入点全部在真实D1整批回滚；非源码字符串检查。
- CAS冲突、余额竞争、赢→输、reopen/void、负余额更正与独立ledger SUM重放。
- 模型完成重复回传哈希冲突、租约接管、迟到/改期/赛后拒绝、冻结原票/概率不变。
- 无会话/伪旧身份/跨站/CSRF/内部权限拒绝；浏览器真的登录、观察、出票、结算、更正、停止重启。
- 100000张合成票下meta所用jobs聚合查询rows_read不增加；不声称百万报价列表或60分钟稳定性达标。
- 截图：test-results/01-frozen-research-1440.png 至 06-restart-restored.png。已人工查看手机截图，无横向溢出；自动化核验390px scrollWidth。
- e2e-persistence.json：predictionsUnchanged=true，ticketsUnchanged=true，browserErrors=[]，restarted=true。

## 失败和修复记录
首次tsc发现响应JSON类型及共享脚本声明缺失，修复后重跑通过。首次Vite生产构建向上加载旧PostCSS依赖失败，添加新目录独立PostCSS配置后通过。汇总首次运行在check退出2，原日志保留在19-03-18.856Z目录；后续全量运行通过。未删除失败项伪造通过。

## 未运行
原根测试集；历史导入恢复；100万报价/完整列表延迟；60分钟稳定性与跨平台CI。研究模型parity的后续实际结果见下，不代表P4全链完成。以上未运行项不算通过，不宣称84项全过。

## 保护
未连接旧数据库，未发旧站HTTP请求，未停止原进程，未运行旧启动器/修改计划任务。304个静态源码文件前后SHA核对、旧PID/命令行及任务actions核对见outputs/protection-check.json。未执行旧库逐行审计，不能声称旧站自身期间没有写入。

## 免口令入口复验
2026-09-28：npm run check 退出0；npm run test:e2e 退出0（1通过、0跳过），覆盖无会话自动进入、第二个全新浏览器会话、跨站403、模型令牌直接建会话401，以及原有出票/结算/更正/重启链路；npm run build退出0。

## 研究原函数数值对照（2026-09-28）
`npm run test:model-parity`：退出0，6项通过，0失败/错误/跳过。日志 `.runtime-v2/model-parity/test.log`，机器报告同目录 `report.json`。
V6：250条真实档案输入，五联赛；21条动作、229条NO_ACTION，所选压力EV最大误差0。V7：全部115条2026合格档案输入，五联赛；中心概率最大绝对误差1.1102230246251565e-16。raw与混合版本最大差0.10767742851596951，固定使用raw。树边界及缺失/时间/变体/hash否定测试实际执行。

首次运行退出1：6项中5通过，V7样本断言失败。原因是错误假设每联赛至少50条2026记录；实际20/29/18/18/30共115条。改为全量115条，未补造数据、未用更早训练期冒充2026。复验6项全部通过。此修正没有放宽100条总量门槛。原始历史缺捕获时间仍列限制，不用合成守卫数据冒充原模型数值对照。
# 真实来源切片验证（2026-09-28）
`npm run check`退出0；`npm run test:unit`32通过/0失败/0跳过；`npm run test:integration`21通过/0失败/0跳过，随后新增出站桥测试单独1通过；`npm run test:e2e`1通过/0跳过；build退出0。

实际网络命令 `node scripts/live-source-smoke.mjs` 最终退出0，HTTP200，306场规范化，DEGRADED=QUOTE_AND_XG_NOT_PROVIDED，截图research-desktop/mobile.png；无pageerror，无390px横向溢出。完整捕获JSON保留在.runtime-v2/source-probes/capture-2026-09-27T20-30-58.889Z.json，snapshotId fa4db4ec-3a15-44c0-8ceb-10093568f747。

初次真实Worker采集FAILED：workerd不支持请求redirect:error，修为manual且出站桥禁止重定向。中间重试收到SOURCE_BACKOFF，未绕过退避；后续正常成功。增加Worker HTTP→出站桥测试防止仅service测试漏掉运行时差异。失败记录仍保存在独立研究库。

## 后续验收与审查记录
- 最新完整汇总 `.runtime-v2/verification/2026-09-28T00-04-38.850Z/verification.json`：doctor/check/build退出0；40 unit、39 integration、3 browser E2E、6 Python parity全部通过，0失败/0跳过。12项import为重复子集。逐命令前后源码摘要均为 `0917e4d26ab526800db30ec47369bdecda61035854ebe315889d33ed6c4661b2`。
- 浏览器证据位于 `test-results/`：真实纸面确认、冻结、结算、更正、重启及6页面390px截图；本轮截图等待实际数据加载完成。runner进程恢复测试证据为 `supervisor-recovery.json`，实际Python租约恢复证据为 `.runtime-v2/fault-evidence/runner-recovery.json`。
- 旧资源复核 `outputs/protected-resources-2026-09-28.json`（聊天交付目录）：304文件哈希、HEAD、默认short未提交清单、原5进程命令与5任务动作均相同。此前 `-uall` 展开未跟踪目录导致清单行数差异；用与盘点相同的参数复核后无差异，未修改旧资源。
- `.runtime-v2/verification/2026-09-27T23-55-02.506Z`：doctor/check/build退出0；40 unit、38 integration、3 browser E2E、6 Python parity全部通过，0跳过；test:import重复子集12通过，不加到总数。随后针对重复业务结算幂等键新增1项测试实际通过，待最终总入口合并。
- 前一汇总 `2026-09-27T23-46-54.656Z` 有1个导出测试文件进程异常退出，未给出内部断言失败。原日志保留；单独TAP复跑通过，另连续5次均退出0，之后全套38项通过。未伪称已确定异常退出根因。
- 公共参考原50个测试文件：复制公开提交到新.runtime-v2/legacy-baseline后执行，161通过、0失败、0跳过，退出0。采用新v2依赖；不是旧活动dirty工作区的测试结论。其中原有源码检查保持“旧回归检查”的性质，不算模型验证。
- 新research完整有界备份：40表/3537行，全部哈希一致；恢复身份9c576c60-ebb8-4cb8-a9b2-a465c34eede0，重启复验通过。证据`.runtime-v2/backup-2026-09-27T23-43-54.288Z/restore-test.json`。
- 新demo备份：40表/50行，恢复身份bc98deeb-3d02-486d-afe8-a6cb6c98fa0b，哈希与重启通过。此为新DEMO自身备份，不是旧站账本。
- API容量测量 `.runtime-v2/capacity-74ac3117-aed5-4c3b-b4f1-f1465506690a/report.json`：10万票具有实际腿/状态/ledger关联，百万合成quoteSet；100次meta p95=15.83ms，100次票页p95=14.98ms，2页无重漏，账本汇总一致。百万quoteSet只是索引容量测试，不是百万条具有完整证据的市场观测。
- 原D1代理循环报告有长停顿，`acceptance-review.json`明确不接受A82。原exit0保留，不覆盖。实际Worker API长测独立进行；短时10000请求内存诊断不替代60分钟验收。
- 原始模型对照、来源采集、合成财务/性能测试分开统计。新`report:verification`逐命令保存源码哈希前后值，运行中改源码不能记为同一版本通过。
