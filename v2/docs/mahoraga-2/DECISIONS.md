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
# 真实来源隔离与兼容
LOCAL_RESEARCH必须使用独立profile（research）、独立installation/D1、5274/8789和独立cookie；旧5173与DEMO5273各自保留。既有DEMO数据库mode不可转换；0001仅对新空库允许两种mode，既有窄DEMO约束保留。0002只追加来源表，schemaVersion升2，不重建原票或旧表。研究模式当前只允许采集写入，不允许财务命令。

采集只允许固定OpenLigaDB HTTPS路径、拒绝重定向；完整原文和UTF8字节hash先原子持久化，再规范化。失败保留原证据。没有时区的来源更新时间保留null。仅After90Minutes可作为常规赛果，AET/PEN不能替代。ESPN备用入口返回陈旧日期且无报价，不能因HTTP200判成功；football-data说明其赛前赔率按周收集，不能冒充实时十分钟内报价。

## 本轮新增决定
- 历史导入只发布到 archive_records。旧 portfolio/原票/多腿/未知金额保留，历史报价 CSV 以精确原文件作为档案，不重新包装成新鲜报价。
- USER_REPORTED 是用户声明事件，不是客户端指定 PAPER 输赢的入口；更正追加且币种不可变。
- 评估以固定 asOf 和原始 predictionId 集合先定样本后分页；之后的赛果更正不能修改已发布报告。
- 导出创建时原子固定不可变事实表的高水位；Python领取后台分页步骤，逐块哈希和链哈希，下载按流输出。导出不是数据库恢复备份。
- 只对新 v2 的 dependency lock 升级。Miniflare维持稳定4系列，对其同主版本undici与sharp安全修复作显式override；不自动改成5 alpha。完整回归将验证兼容性。
- 首轮负载脚本仅检查总时间，遗漏睡眠/调度停顿。保留原 exit 0 日志，同时用 acceptance-review.json 推翻 A82 PASS，新增样本间隔和最少样本守卫后重跑。
- 纸面确认框显示冻结赔率、方向、predictionId和25 PAPER投入；取消与Esc归还焦点。该确认属于产品内手工记票，不是请求用户授权继续开发。

## 2026-10-01 功能恢复决定

- 保持现有技术栈和权威核心。UI读取服务端派生统计；客户端不决定输赢、盈亏或余额。
- 所有已知赛程都保留，默认按最近未来赛事再最近过去排序。空候选不隐藏比赛。旧票/报价衍生赛程明确LEGACY_NON_PROSPECTIVE，不创建预测或新票。
- 迁移使用已核对的旧静态导出和活动库只读一致快照。重复原票不重复计入；冲突仍隔离，不覆盖原档案。完整报价源文件保留哈希，详情只显示有界窗口（最近8组1X2、12组大小球），可下载完整原文件。
- V7固定quote-weighted候选是独立变体，不替换raw适配器；115共同历史样本与原predict真实比较，没有训练。V6逐方向压力不归一化，三分类LogLoss/Brier不适用。
- 自动运行由新进程内独立任务推进，Python继续主动领取已有冻结任务；不阻塞领取心跳。原始来源先保存，数据空/失败/缺价分别记录。官方JFA公告只确认赛程。ESPN仅明确STATUS_FULL_TIME且不处于加时阶段可形成90分钟证据，其余review。
- 已有纸面票无冲突裁定/结算自动且幂等；不自动新出票、不操作真实账户。强制刷新也不能绕过运行中的租约。
- 账本按已结投入计算ROI；未知状态不当作已结。缺金额、混币种禁用相关总计/ROI/曲线，未行动ROI=null。
- 新任务不改旧Windows启动任务。旧未跟踪local-hidden-task.vbs相对9/27基线的差异不归因给任何人，不覆盖；保护证据存在此限制。


### D-20261001-OBSERVATIONS

旧reviews和marketReviews为14条完全相同的已保存研究观测。自动导入workspace元数据时按原内容SHA256去重，保留两处集合名，历史中心从不可变导入生成只读投影，不注册为2.0 Prediction、不重算旧概率、不产生权威票据。日期使用原evidence.calculatedAt并明确其不是报价时间；历史ALL保留无日期档案，日期筛选排除无日期项。


## 2026-10-01 用户指定头像

头像采用用户上传黑白魔虚罗原图，直接复制而不生成/裁切/重绘；加资源版本参数避免旧缓存。


## 2026-10-05：默认优先显示高分

赛程使用所选模型在卡片中突出显示的最高方向分排序；同一投注方向的策略或时点副本依然使用首条冻结记录。当前候选与其旧记录同方向时，以当前突出评分排序，不用隐藏的历史分抬高顺序。0分是有效分，未知/非法分排后；V6没有原分不补造。全部日期/联赛/球队筛选后、分页前排序。此修改只影响呈现，不更改选单、参数、预测或原票。
