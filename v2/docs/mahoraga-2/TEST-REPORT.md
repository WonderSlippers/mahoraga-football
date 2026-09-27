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

实际网络命令 `node scripts/live-source-smoke.mjs` 最终退出0，HTTP200，306场规范化，DEGRADED=QUOTE_AND_XG_NOT_PROVIDED，截图research-desktop/mobile.png；无pageerror，无390px横向溢出。完整捕获JSON保留在.runtime-v2/source-probes/capture-2026-09-27T20-30-58.894Z.json（具体文件以目录实际时间为准），snapshotId fa4db4ec-3a15-44c0-8ceb-10093568f747。

初次真实Worker采集FAILED：workerd不支持请求redirect:error，修为manual且出站桥禁止重定向。中间重试收到SOURCE_BACKOFF，未绕过退避；后续正常成功。增加Worker HTTP→出站桥测试防止仅service测试漏掉运行时差异。失败记录仍保存在独立研究库。
