# 功能对齐与可用性恢复：实际验收报告

日期：2026-10-01。工作区：独立worktree `work/mahoraga-v2/v2`。旧5173未接管。测试全部由真实进程执行；静态边界检查、历史模型对照、DEMO财务链及真实来源浏览器分别列出。

## 最终命令与数量

下列命令在v2目录执行。证据目录为 `.runtime-v2/feature-parity/`；交付副本在聊天目录 `outputs/feature-parity-20261001/`。退出码均为实际执行结果0。

| 命令                                                                                                         | 退出码 | 通过 / 失败 / 跳过      | 证据                                                   | 证明范围                                                                          |
| ------------------------------------------------------------------------------------------------------------ | -----: | ----------------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------- |
| `npm run check`                                                                                              |      0 | 类型/格式/边界检查      | check.log                                              | 不是模型验证                                                                      |
| `npm run test:unit`                                                                                          |      0 | 46 / 0 / 0              | unit.log                                               | 契约、市场/账本数学、日期/八状态/缺额/混币/官方公告解析                           |
| `npm run test:integration`                                                                                   |      0 | 41 / 0 / 0              | integration.log                                        | 真实D1、冻结/原子/幂等/导入/恢复/自动裁定，包含新功能测试                         |
| `node node_modules/tsx/dist/cli.mjs --test tests/unit/workspace.test.ts tests/integration/workspace.test.ts` |      0 | 8 / 0 / 0               | functional-tests.log                                   | 上述全集的子集，不重复累计；研究观测不计入资金、无日期ALL、CAS任务租约、冲突/重放 |
| `node node_modules/tsx/dist/cli.mjs --test tests/integration/backup.test.ts`                                 |      0 | 2 / 0 / 0               | backup-tests.log                                       | 上述全集的子集；schema7分页恢复到schema8，301报价不丢失                           |
| `npm run test:e2e`                                                                                           |      0 | 3 / 0 / 0               | e2e.log                                                | 实际Chrome→API→Python→D1→票→结算→更正→重启；实际自有runner恢复                    |
| `npm run test:model-parity`                                                                                  |      0 | 6 / 0 / 0               | model-parity.log                                       | V6原函数250历史行、V7原函数115合格历史行及哈希/语义守卫                           |
| `.venv/Scripts/python.exe model-runner/build_workspace_study.py`                                             |      0 | 115行固定V7实际数值对照 | fixed-candidate.log、fixed-candidate-parity.json       | 与原包predict对照，最大误差1.1102230246251565e-16；不训练、不证明前瞻             |
| `npm run build`                                                                                              |      0 | 生产构建成功            | build.log                                              | React/Vite及Worker构建                                                            |
| `node scripts/verify-workspace-browser.mjs`                                                                  |      0 | 31 / 0 / 0              | browser-functional.log、browser-functional-report.json | 当前运行5274真实浏览器功能/过滤/分页/原证据/自动推进/响应式/双主题，无pageerror   |

单元46、D1集成41、核心E2E3与研究网站浏览器31分别统计；子集8与2不叠加。Python6中守卫用例不是额外真实模型样本。115行固定研究比较与原历史parity分开说明，不能把历史样本当作当时已捕获的前瞻记录。

## 实际页面与数据

- 17张真实PNG：完整赛程、历史比赛详情、已保存1X2/大小球市场详情、历史中心、账本、模型实验室、运行状态、Legacy、官方杯赛、六页手机、平板和浅色主题。截图来自Chrome，非合成。
- 浏览器实际719项历史记录（705原档案+14原研究观测）、498旧票/570腿；65联赛设置与十策略自动读取。74058行1X2、2075行大小球保留原文件/时间。已知赛程626场的快照数量随自动发现变化，所有非候选仍存在。
- 策略/联赛/模型/市场/日期筛选及账本赔率/评分/币种/五时间范围有实际检查；翻页不改变完整集合统计；今日无投入时ROI=null。
- Market/V6配置388/V7固定quote-weighted：共同历史范围115行，分季/联赛/赔率/校准与逐场证据；V6压力值不归一化，三分类LogLoss/Brier不适用。严格前瞻N=0、ROI=null。
- 来源自动cursor无人工点击推进；当日65联赛均已尝试，EMPTY/FAILED/DEGRADED留痕。真实JFA公告HTTP200解析16场，保留原文。仅明确90分钟无歧义结果进入既有自动裁定/纸面结算；未知比分不补0，重复运行无资金影响。
- 视觉实检1440×1000、1024宽、390×844：排版/留白/层级、forest/lime颜色、轻动效/焦点/悬停、reduced-motion、桌面和手机无横向溢出、浅深主题。没有宣称获得设计奖项。

## 失败与修复

本轮初次发现旧票缺pick导致VALUE_INVALID，改为显式null；初版测试ISO时间与数字比较、自动状态object/array假设已修正；启动器尚未READY时浏览器ERR_CONNECTION_REFUSED，保存browser-before-ready-failure.json，确认READY后完整重跑；历史ALL原先过滤了无日期档案，已修复并增加单元与真实UI719数量断言；旧研究观测遗漏已补自动读取与原解释展示。最终0失败/0跳过。原错误过程没有被包装为PASS。

## 模型与自动链边界

实时V6/V7所需同一feature builder、xG/滚动历史及完整报价时间证据不足；亚洲盘双边价缺失；旧专用报价曲线/研究排序和部分AFC专题未完全移植。公开参考价不是可成交/合格实时报价。当前自动流程没有完成“合格quote→live features→V6/V7新冻结任务→严格决策”的完整研究链，不自动晋升或新出票。旧专题与实时功能按FEATURE-PARITY列为部分，共34项：完整22、部分12、尚无入口0。

需手动：Windows重启后启动新程序；确认新纸面票；登记实际记录；解决冲突赛果。没有修改旧任务，亦未建立新Windows自启任务。Linux CI、新增来源的60分钟长测及正式切换未验收。

## 保护证据与限制

protection-check-20261001.json核对旧HEAD、dirty patch/status、PID59592。其“任务动作全部一致”字段后续审查发现CIM序列化比较错误，已作废：正确解码为3项一致、2项不同，后两项任务文件mtime为2026-10-01 01:20:59 UTC，早于03:54 UTC开始的可用性审查；修改来源未归因，不回改或接管。当前权威证据为 .runtime-v2/usability/legacy-protection-final.json。活动旧D1此前仅SQLite URI mode=ro和query_only=ON读取，一致backup写入v2自有目录；quick_check=ok。snapshot-proof.json与snapshot-export-proof.json记录原票/报价/模型逐字段一致及旧元数据变化；不是声明旧站自身期间完全无写入。新DEMO与research独立installationId、端口与状态目录。未push、部署、正式切换或修改旧数据库。

旧303/304文件与9/27基线一致；未跟踪local-hidden-task.vbs不同且mtime在本轮内，没有本轮前独立内容hash，差异时点/来源无法确定。本轮没有写该路径的命令，也不覆盖它。不能宣称所有旧文件逐字节未变。保护证明仅覆盖已记录范围，不是系统级写入审计。

9/28旧60分钟真实API负载报告已完成退出0，RSS末窗口比1.21534；不能代替本轮新增自动来源流程的长测。此前历史验收报告见Git中本轮之前版本。

## 2026-10-01 用户指定头像

头像专项：原文件与站点响应SHA256一致；favicon路径及M伪元素移除验证；5273/5274×390/1440×深/浅8组实际浏览器检查全部通过，无pageerror或横向溢出。证据 .runtime-v2/avatar/browser-report.json 与8张PNG。本次为展示资源变更，未重复运行无关财务/模型测试。


## 2026-10-05：评分降序验收

证据：.runtime-v2/score-order-20261005。check（node scripts/check.mjs）退出0；针对性unit（tsx --test tests/unit/recommendation-display.test.ts tests/unit/workspace.test.ts）17项/17通过/0跳过；integration（tsx --test --test-concurrency=1 tests/integration/workspace.test.ts）3项/3通过/0跳过；build退出0。共20项不同软件测试，不是完整测试套件，也不是模型盈利验证。每条命令与退出码、耗时保存为*-command.json及*.log。

只读保护检查前后5事实表原水位行哈希一致：predictions151249、tickets573、ticket_legs618、universal_observations64627、version_observations30679；旧HEAD/diff/status哈希一致。启动时发现此前2.0进程已不在监听，核对旧5173当前PID11220/创建时间后仅启动自身新PID7396；未发旧站HTTP/DB/任务写入、停止、push或部署。不能把上个被中断阶段记录的旧PID24644称为现在同一进程。

Chrome首次启动失败退出1（browser.log）；首轮Edge读取超时退出1（browser-edge.log及failed.png），不是PASS。全历史重试进行中；真实截图与最终检查随后追加。

最终真实Edge命令 V2_BROWSER_PATH="C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" node scripts/verify-score-order-browser.mjs 退出0：8检查/4截图/0页面脚本错误。browser.json保存各页实际评分序列；browser-edge-retry-command.json保存浏览器路径、命令、退出码和耗时。旧5173当前PID11220/创建时间在自身启动前后相同（legacy-process-start/after.json）；前述水位事实哈希保护检查退出0。输出副本将放在聊天根outputs/score-order-20261005。未跳过V6、模型切换或分页；没有把软件排序测试称为真实模型验证。

追加截图探针（node .runtime-v2/score-order-20261005/highest-first.mjs）退出0：完整推荐跟踪首页40行，首行92分，评分逐行降序；最高分置顶截图highest-first.png。最初临时探针将隐藏的加载状态等待为可见，退出1，是探针错误；改为attached后实际通过，不计为站点故障或新增模型验证。


## 2026-10-05：评分下注表现验收

证据`.runtime-v2/score-review-20261005`，命令/退出码/分类见commands.json。npm run test:unit退出0：92/92，0跳过。tsx --test --test-concurrency=1 tests/integration/universal.test.ts tests/integration/versions.test.ts tests/integration/ticket-date-cohort.test.ts退出0：23/23，0跳过。115个不同软件测试；21针对性单元是子集，重跑不重复计数。npm run check和npm run build退出0，边界检查不是模型验证。

node scripts/verify-score-review-browser.mjs最终退出0：8实站检查、5实际截图、0页面脚本错误。通用421票、原版199票、历史498票各档计数/净收益/赢输与实际API一致；评级点击和逐分点击筛票，统计覆盖分页全量；390px无横溢出；V6零票不补造表现。使用本机Edge，未拦截API或插入模拟生产数据。首轮退出1的手机横溢出保留browser-first-failed.log/browser-failed.json/failed.png；修复后完整重验通过。

保护检查before/after退出0：5事实表水位原行（152448/652/702/64945/31224）哈希相同，旧HEAD/diff/status相同；旧5173 PID11220创建时间/执行路径相同。仅自身研究supervisor认证停止/重启，最终PID28268、5274/8789。未写旧D1、改旧任务、push或部署。详见SCORE-REVIEW-20261005.md。


## 2026-10-05：原版A级稀少与D级集中成因核对

本轮是只读成因分析，不新增模型验证或测试通过数。使用前轮实际API导出10月4日PLACED cohort及新库只读SQLite，校验安装ID；查询70份原版冻结输出、逐策略计数，冻结engine SHA256与pin一致。原版193票A5/D166、134张1X2单场中D130/A0；广覆盖D56+强制D53。70份预测researchPresent=0、goalPresent=34。命令退出0，证据grade-distribution-causes.json；未执行训练、修改参数/评分、写旧D1或重启服务。


## 2026-10-05：两版收益与实际选单直接比较

只读比较命令node .runtime-v2/model-comparison-20261005/read.mjs退出0，实站返回通用421票、原版199票；Python compare.py及逐对一致性核查退出0。核查21个完全同价同方向的已结单场，stake/PnL逐对一致；去重保留最早原票，未选最佳赔率或结果。导出截止UTC23:49:21/22；各日期范围、计数、收益、共享/独有方向与实例见comparison.json及两份真实API导出。无新增软件测试/模型验证PASS，未模拟下注或改模型/数据库/服务。


## 2026-10-05：自动运行与参数反馈核验

本轮只读代码与新库状态检查退出0，不增加软件/模型验证测试数。runtime cwd和manifest安装ID核实；version_state revision16、modelW0.8、marginShift−0.02，种子0.2/+0.02；最近revision13–16权重0.65→0.70→0.75→0.8。通用无version_state记录；固定50%由实际Python配方确认。自动任务明确调用versionPaperStep，参数更新原子写入version_state和追加events。未触发手动tick/训练/改参数，证据parameter-adjustment.json。

## 2026-10-05：通用后台自动校准

本次真实执行：npm run check、npm run build退出0；npm run test:unit 97/97；tsx --test --test-concurrency=1 general-adaptation/universal/public-research/versions四个D1套件34/34；Python test_adaptation 4/4；固定通用7/7；npm run test:model-parity 6/6，均无跳过。Edge真实浏览器7项通过、4截图（工作台、账本、手机账本、数据状态）。首次Python中性参数grid二次对齐浮点扰动1失败已修复为中性直接保留原grid；schema回归预期13与新0014冲突1失败已修正预期14并保留数据/FK/不可变检查；失败日志保留。D1测试数据明确CONTRACT_ONLY，测试成功不是新校准盈利验证。实际后台97场自动候选VALIDATING，尚无真实新参数应用/收益改善结论。日志/命令/保护证据位于outputs/general-adaptation-20261005。

最终运行核验：新校准变体已通过真实来源生成DONE预测，并保存参数revision0；同一真实输入的中性参数central/grid与原固定配方逐值一致。独立2.0真实重启后97场未决候选、训练hash、参数均完整恢复。新库quick_check=ok；7个事实表既有水位内逐行hash未变；旧源码HEAD/dirty/status与5173 PID11220创建时间未变，未打开旧D1。新Web5274/API8789可用，supervisor PID16856，runner PID10836。证据runtime.json/live-inference.json/preservation-{before,after}.json/availability-after.json。

## 2026-10-05：竞技场直接显示比赛开赛时间

范围：仅TicketCards前端时间呈现及样式；读取冻结fixture revision kickoffAt，不重算模型或写账本。npm run check退出0；npm run build退出0；node scripts/verify-arena-kickoff-browser.mjs最终退出0，13项检查、238次已保存开赛时间逐项对照真实API响应，0最终失败、0浏览器错误；5张真实Edge截图包含桌面预览/精选单场/二串一和手机单场/二串一。通用全部7策略、原版真实票据和V6空状态已检查；通用价值二串一当前0票，V6当前0票，不能据此称其真实串关/模型表现验证通过。V7不在现有全局版本入口，本次没有测试该版本票据。无模拟响应、合成票据或真实投注操作。

首次日志目录未创建造成重定向失败，命令未执行，不计通过。浏览器第一轮因假设V6已有票失败；第二轮因假设全局有V7选项超时失败（均退出1）；保留browser-first-failed及browser-second-failed原始日志/JSON。最终脚本读取实际入口选项，严格区分真实票据与空状态。证据outputs/arena-kickoff-20261005/{commands.json,browser.json,*.png,check.log,build.log,before.json,after.json}。未启动、停止或重启服务；旧5173进程与新5274进程身份核对见before/after；未打开旧数据库。
