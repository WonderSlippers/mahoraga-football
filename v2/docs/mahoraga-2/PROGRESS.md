# 实施进度

2026-09-28，第一轮P0—P2离线DEMO工程链路。

|任务|状态|已完成及证据|
|---|---|---|
|T00 环境盘点|DONE|ENVIRONMENT-INVENTORY.md，旧源码/进程/任务机器清单|
|T01 隔离工作区|DONE|独立worktree、安装ID、5273/8788、路径/模式/端口guard实际测试|
|T02 来源模型登记|DONE|source-manifest.json；3 ZIP共294成员，只读安全检查、无包内执行|
|T03 应用基础|DONE|独立锁文件、React/Vite、TS Worker、D1、Python venv；bootstrap/doctor/build|
|T04 契约与数值|DONE|共享JSON Schema TS/Python矩阵、Decimal/金额/日期/概率测试|
|T05 迁移仓储|DONE|真实D1约束、迁移重跑、immutable触发器、10万票meta有界检查|
|T06 本地鉴权启动|DONE|cookie/Origin/CSRF/Host/服务令牌、受限新目录、停止身份校验|
|T07 合成输入数学|DONE|原始证据、同源报价、15个结算金标准、AH/大小球/推盘数学|
|T08 冻结预测|DONE|Python主动claim、两独立适配器、bundle/hash/fence、冻结期望和决策|
|T09 原子纸面账本|DONE|100次并发重放、逐语句故障、CAS、守恒、review/reopen、负余额更正|
|T10 浏览器链路|DONE|真实UI→API→Python→D1→票→结算→更正→重启；三视口截图|

当前功能仅DEMO；T00—T10的DONE不代表全84项/P3—P9完成。A03未进行旧库备份，只验证拒绝冒充备份；A65真实历史导入未做，模型包登记没有代替导入验收。Drizzle核心类型和SQL migration共同维护；完整来源采集、长期压力、分页、模型parity见BLOCKERS。

验证汇总：26 unit + 16 D1 integration + 1 browser E2E，全部通过、0跳过。首次失败及后续复验日志均保留。命令/退出码/证据见TEST-REPORT和verification.json。

首次只读盘点提交2403b5b；本次阶段提交见Git历史。本轮不push，不接管旧5173，不写旧D1。

## 2026-09-28：按用户要求取消手动口令
已改为本地Web启动器自动建立会话；页面不再显示密码输入。仅接受来自5273自身页面的同源POST，启动器专用随机凭证不进入浏览器；模型服务令牌不能建立网页会话。保留HttpOnly/Strict、CSRF与Origin校验。此次用户指令覆盖原手工口令交互要求，不影响旧5173。

## 后续实施：研究推断切片
T15—T18 IN_PROGRESS：新 inference-only V6/V7 适配器已实现，固定哈希的研究原函数实际参与对照。V6 250条、V7全部115条2026合格历史记录覆盖五联赛，6项Python测试全通过。缺输入/错变体/训练时间/压力语义守卫已实现。实时原始历史 feature builder 与 API 研究任务接入仍未完成，不能因此记整个P4 DONE。
