# 决策记录

1. 复用已建独立worktree与codex/mahoraga-v2-p0-p2分支；基线d35e803。旧dirty留在原处。
2. 按交接包使用5273/8788，仅loopback和DEMO。状态限定v2/.runtime-v2子目录；junction/父子路径绕过拒绝。
3. Supervisor直接使用锁定Miniflare 4.20260515.0 / 真workerd+D1，兼容日期2026-05-15。不用SQLite mock替代验收，不触发远端账户。保留独立Wrangler配置；只有显式bootstrap迁移，dev不自动迁移。
4. 金额6位原子单位，API整数字符串；Decimal最后一次HALF_UP。SQL CHECK guard让CAS失败回滚全部batch。数据库触发器禁止修改或删除预测/原票/原事件。
5. frozen input的同一个JSON Schema由Ajv与Python jsonschema验证；Python核对保存的canonical bytes哈希，不重新序列化猜hash。
6. 市场基准与DEMO固定适配器分开。Python只领取和回传任务，无D1或财务权限。V6/V7保持BLOCKED，报告ROI不作为测试断言。
7. P2增加最小任务fence和租约重领；完整P3调度、退避、dead-letter未实现。迟到、改期、赛后任务不能发布前瞻预测。
8. 专用DEMO场景生成合成结果证据；财务入口拒绝客户端win/pnl/余额。review/reopen/更正追加事件；负余额冻结新票但不拒绝更正。
9. 每次dev生成一次性口令，独立HttpOnly/Strict会话与服务令牌。新profile使用Windows ACL限制当前用户。
10. stop验证runId/PID/启动时间/cwd哈希，通过本次supervisor结束其持有的child handle，不按进程名批量kill。
11. Drizzle提供核心账本类型定义；审阅SQL migration为硬约束真相，附加证据/任务/会话表。无自动生成或破坏性down migration。
12. P2交付最小工作台/详情/账本，模型与系统页读取真实状态；不冒充完整P7/P9。

依据：交接包00/01/02/03/04/05/07。D1批事务语义见 https://developers.cloudflare.com/d1/worker-api/d1-database/ ，同时由真实workerd故障注入验证。

## 2026-09-28：按用户要求取消手动口令
已改为本地Web启动器自动建立会话；页面不再显示密码输入。仅接受来自5273自身页面的同源POST，启动器专用随机凭证不进入浏览器；模型服务令牌不能建立网页会话。保留HttpOnly/Strict、CSRF与Origin校验。此次用户指令覆盖原手工口令交互要求，不影响旧5173。
# 2026-09-28 研究推断切片
固定 V6 配置388 与 V7 return_partial UNBLENDED_EXPLORATORY；新适配器只含推断，不引入训练入口。原研究函数作为独立数值参考，源码/权重/样本各自固定SHA256。V6 central=null，方向缺支持保留null。V7不接受请求覆盖变体。

现有档案特征没有真实历史报价首次捕获时间，因此此次365条记录是历史数值对照，不是前瞻时间验证，也不是收益验证。时间守卫测试使用明确合成时间单列报告。当前未具备实时原始特征构造器时拒绝LOCAL_RESEARCH输入，不填0或借市场基准冒充研究模型。测试通过不会晋升模型。
