## 2026-10-04 产品可用性实际验收

监测计数校正：旧监测输出successfulCycles=10实际是去重成功时点数，包含观察开始前的初始状态；恢复后90秒真正前进9次，完成任务数增加116。以下“10次”均应按10个观察到的成功时点理解，不作为10个新完成轮次。可重新计算的证据为availability-measurement.json及原19个时间快照；软件用例146和浏览器交互28的计数不受影响。

交付复查：最终实现提交 `3fafecbd5e431d60f0c274682e3a5685bb261fcc` 重启自有服务后，真实浏览器验证5273首页跳5274、策略竞技场、原票直达、独立离线DEMO；两种mode/installationId分开，实际meta.appCodeSha与该实现提交一致，退出0。证据handoff.json/.txt、handoff-arena.png。第一次复查因导航箭头进入可访问名称而使用过严exact标题匹配超时；按实际导航href复验通过，handoff-first-failure日志保留。没有据HTTP200单独宣称页面完成。

最终恢复观察：中途重启继承未到期RUNNING租约，首次90秒监测未看到成功时间前进，断言退出1（availability-restart-wait记录保留）。原lastAttempt早于新启动；180秒租约到期后自动恢复，无人工改状态或强制采集。随后新90秒19样本监测退出0、Python心跳/完成数前进，详见availability.json/.txt。之前的10次成功更新证据单独保存在availability-before-release.json/.txt。启动恢复可能等待最多3分钟，不宣称立刻刷新或后台从未报错。最终文档提交与运行实现3fafecb之间只改说明，不热替换底层核心。

完整证据副本：D:/ChatGPT/Projects/2026-09-28/2-0-codex-agents-md-00-4/outputs/product-20261004。原目录.runtime-v2/product-20261004。真实Chrome连接隔离5274，无API拦截、无合成盈利写入活动研究库。CONTRACT/DEMO的软件用例不算原模型盈利验证；本轮不改模型权重，不新增模型验证PASS。

| v2目录执行的实际命令                                                                                                                                                                                                                                                           | 退出码 | 数量/范围                                                                          | 证据                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ | ---------------------------------------------------------------------------------- | --------------------------------- |
| `npm run check`                                                                                                                                                                                                                                                                | 0      | 类型/格式/112静态边界，非模型验证                                                  | check-final.txt                   |
| `npm run test:unit`                                                                                                                                                                                                                                                            | 0      | 76通过，0失败/跳过                                                                 | unit.txt                          |
| `npm run test:integration`                                                                                                                                                                                                                                                     | 0      | 67完整D1，0失败/跳过                                                               | integration-final.txt             |
| `npx tsx --test --test-concurrency=1 tests/integration/universal.test.ts tests/integration/workspace.test.ts tests/integration/prospective-report.test.ts tests/integration/public-research.test.ts tests/integration/live-refresh.test.ts tests/integration/rotation.test.ts` | 0      | 最后读取/来源/严格资格修复后21通过，属于67的子集                                   | product-final-integration.txt     |
| `npm run test:e2e`                                                                                                                                                                                                                                                             | 0      | 3：真实浏览器→Python→D1→票→结算→冲突→更正→重启；原UI退休/导入/手机；自有runner恢复 | e2e-final.txt                     |
| `npm run build`                                                                                                                                                                                                                                                                | 0      | Worker与React生产构建，非模型验证                                                  | build-final.txt                   |
| `node scripts/product-acceptance.mjs`                                                                                                                                                                                                                                          | 0      | 28真实研究浏览器交互，0页面JS异常                                                  | browser.txt/browser.json及真实PNG |
| `python .runtime-v2/product-20261004/availability.py`                                                                                                                                                                                                                          | 0      | 90秒19样本、10次成功后台更新、Python心跳前进                                       | availability.json/.txt            |
| `python .runtime-v2/product-20261004/audit.py after`                                                                                                                                                                                                                           | 0      | 6类全部原行hash保留；quick_check=ok，FK=0；旧HEAD/dirty diff/status不变            | audit-before/after.json           |
| `npx tsx .runtime-v2/product-20261004/date-equivalence.ts`                                                                                                                                                                                                                     | 0      | 实际DST/午夜/四时区2592格式比较，非模型测试                                        | date-equivalence.json             |

软件用例唯一计数146（76+67+3）；21项针对复跑不重复相加。完整67回归后又改动读取查询，最后相关21例重新运行通过；不声称完整67在每次样式微调后全部重跑。实际截图、ROI、胜负、样本N来自真实原票和结算。娱乐二串一5张已自动生成，尚未结算，不构造赢单或ROI。无动作/无已结投入ROI=null。

查询比对在自有只读库/一致备份进行，原旧站DB不连接：冻结查询/跟踪/一般首次方向/最新方向hash保持；部分索引改法在独立备份中可执行比对，结果相同。partial-index-benchmark/tracked-benchmark.json记录1653→114ms、1426→165ms、1321→691ms。其他候选索引增益有限，未加入活动代码。该证明是读取等价和性能，非模型验证。没有以源码字符串检查、跳过用例或合成赛果当真实验证。

失败与修复保留：第一次D1 exec迁移被单独注释拒绝；新FUN策略被V1后缀误当退役；全历史MAX查询导致503和浏览器超时；首次E2E 2过/1失败因账本标题期望过时，修正后3/3。早期浏览器PASS仍有约10–15秒赛程/实验室等待，继续改读取与按需加载。一次未加索引的只读探索查询超出实用预算，仅停止身份核对的自有Python helper（非旧进程/非测试）；日志保留。瞬时后台UND_ERR_SOCKET重试后出现成功更新，不能标后台从未出错。

运行范围：旧5173 PID24644保留；新5274/8789为research-general，新5273/8788为demo-general。本轮不连接旧SQLite、不写旧数据库、不改旧进程/启动任务，不push/部署。旧dirty diff SHA256 87acee2a8239e7b8620c3b7595005d544c795e1e5e313a4cf54a87bfd6aceffa保持。活动新库原353票、353腿、85026预测、238结算事件、591账目、705档案逐行hash保留。

截图索引：arena-desktop/full/mobile/light（排名与收益），ledger-tickets/winning-ticket-cards（昨日方向及真实赢单），ledger-tickets-mobile，legacy-double-cards（原二串一两腿），entertainment-double-cards（独立娱乐新票），fixtures，match-detail，history，models/forward/historical，runtime，tools。每张都是实际浏览器PNG。

最终同一真实浏览器的页面等待（包含登录/取数/渲染，非服务器单SQL）：/strategies 0.447秒；/workbench 2.929秒；/models 2.934秒；/system 0.262秒；/history 1.370秒；/strategies 0.243秒；/strategies 0.256秒。导航：ledger 875ms；arena-warm 56ms。赛程默认今天，近期仍可读取；耗时随自动任务竞争变化，不宣称每次零等待。

## 2026-10-03 昨日战绩、原票与二串一真实验收

本轮141项软件用例：74单元、64隔离D1集成、3浏览器端到端，全通过，0跳过。另38项全站浏览器检查（21页面/3视口）和24项本轮票据交互（17+7），0浏览器异常。静态检查/build不计模型验证；本轮未改模型数学。

| v2目录执行的命令                                                                                                | 退出码 | 数量                                                   | 原始证据                                          |
| --------------------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------ | ------------------------------------------------- |
| `node scripts/verify-universal.mjs check` → `node scripts/check.mjs`                                            | 0      | 106文件静态边界，非模型测试                            | .runtime-v2/universal/check-check.json/.log       |
| `node scripts/verify-universal.mjs unit` → `tsx --test tests/unit/*.test.ts`                                    | 0      | 74                                                     | check-unit.json/.log                              |
| `node scripts/verify-universal.mjs integration` → `tsx --test --test-concurrency=1 tests/integration/*.test.ts` | 0      | 64，完成11:02:07Z                                      | check-integration.json/.log                       |
| `node scripts/verify-universal.mjs e2e` → `playwright test`                                                     | 0      | 3                                                      | check-e2e.json/.log、test-results/e2e-report.json |
| `node scripts/verify-universal.mjs build` → `node scripts/build.mjs`                                            | 0      | 构建，非模型测试                                       | check-build.json/.log                             |
| `node scripts/verify-universal.mjs browser`                                                                     | 0      | 38交互、21页面                                         | .runtime-v2/universal/browser/browser-report.json |
| `node scripts/verify-ticket-review-browser.mjs`                                                                 | 0      | 17交互、13次页面读取                                   | .runtime-v2/restore-ledger/browser.json           |
| `node scripts/verify-ticket-review-visible.mjs`                                                                 | 0      | 7交互                                                  | .runtime-v2/restore-ledger/visible-check.json     |
| `python .runtime-v2/restore-ledger/audit.py after`                                                              | 0      | 6类原事实hash、旧HEAD/diff/status；quick_check=ok/FK=0 | audit-before.json、audit-after.json               |

Wrapper JSON保存实际完整命令、UTC开始/结束、退出码、数量和log。票据脚本对现有LOCAL_RESEARCH及已导入旧票执行，没有API拦截或合成生产记录。DEMO端到端明确为合成软件链路：浏览器→Python→D1→票→结算→冲突→追加更正→重启；不算模型盈利验证。

截至2026-10-03T11:00:03Z：昨天出票168票，54赢/88输/26未结；6独立虚拟策略重复同一场，不能当作168独立比赛或实际成交。昨天实际结算93票，30赢/63输/0未结。昨天出票批次当前已知净收益−762.215428、已结风险投入2840、ROI−26.84%；按昨日结算净收益−773.190051，口径不同，未结不记假盈亏。

原双场38票。截图第一张原25单位、组合赔率3.773，两腿主−0.5@2.45/主+0.5@1.54，保存比分1—1/3—1，腿输/赢，整票输25/返还0。格式化显示3.77，审计保留原精度。旧498票/570腿0漏票/0原票变化，最新旧出票及结算9月24日。

实际载入：昨天账本1.527秒、旧二串一1.905秒、比赛详情3.976秒、历史1.918秒、通用实验室2.415秒、状态1.897秒、策略0.247秒；不是跨日性能SLA。截图目录 `.runtime-v2/restore-ledger`：

- `ledger-overview.png`、`yesterday-ticket.png`、`yesterday-winner.png`：昨日汇总及输/赢原票。
- `legacy-double-ticket.png`、`legacy-double-light.png`：旧二串一两腿/组合价/整票收益，浅深色。
- `yesterday-mobile-visible.png`、`double-mobile-visible.png`：390像素手机，无页面横向溢出。
- `schedule.png`、`match.png`、`history.png`、`models.png`、`runtime.png`、`strategies.png`、`legacy.png`：真实常用页面。

用户副本在聊天根 `outputs/restore-ledger-20261003`；不复制私有原库备份、完整原票导出、服务token或停止nonce。启动方法见PROGRESS，实际服务保持在5274/8789及5273/8788。

失败已保留：初次完整集成62/63因测试误把原“2.00”期望为“2”，修正原字符串断言，未改原票（check-history）；初次浏览器6项后错误定位无关折叠table（browser-first-failure.json）；第二次11项后详情等待60秒（browser-match-timeout.json），修复56,104比较观测重复OFFSET排序/先读全库再筛单场。分页修改遗漏offset绑定导致check退出2、针对6例4通过/2失败；改cursor绑定后6/6。最终1003观测跨1000边界与200导出页验证无漏重复、原时间顺序、共同N和截止边界；完整64/64通过。新增显式结算日期排除未结后，跨日及原工作台3/3回归也通过；其用例已包含在64项内。

保护：根据原进程persist-to确认活动D1，以mode=ro/query_only只读备份到新隔离目录。本轮确实连接旧库只读核对，不能说从未连接。旧HEAD325a5087、dirty diff SHA256 `87acee2a8239e7b8620c3b7595005d544c795e1e5e313a4cf54a87bfd6aceffa`不变，5173原PID24644保留。新库原240票/240腿/47321预测/146结算事件/386账目/705档案逐行hash保留，只有新自动预测追加。未控制旧服务、写旧库、改旧任务、push或部署。

交付后重启复查另捕获新站内部控制端口10080被Node fetch拒绝。只用原nonce/PID/启动时点/cwd hash验证后的本机控制接口关闭自有研究进程；第一次PowerShell日期自动转换导致403，保留ISO原文后200，身份校验未绕过。新启动器在随机控制端口落到10080时释放自有控制socket并重新分配；3项真实E2E复跑全通过。没有按端口杀进程或控制旧5173。

V7实时、严格资格、原三方法统一跨季输入及部分配置编辑仍见BLOCKERS；不把账本恢复宣称为全站全部完成。

## 2026-10-02 通用分析、自动纸面与可用性：旧轮验收

本节替代下方旧阶段数字。实际软件/模型可执行用例共 **145（67单元+62完整D1+3离线E2E+6原模型parity+7新模型）**，没有跳过。针对读取/来源/冻结的11例复跑属于62例的子集，不重复计数。浏览器另有 **38项检查、21页面（七页面×1440/1024/390）、30真实PNG、0页面JS异常**。不以静态边界、截图或DEMO合成赛果冒充真实模型验证。

| 验证         | 实际命令（v2目录）                                                                                                                                                                                                                                                                        | 退出码 | 数量                    | 完整证据                     |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ----------------------- | ---------------------------- |
| check        | `C:\Program Files\nodejs\node.exe scripts/check.mjs`                                                                                                                                                                                                                                      | 0      | 非模型测试              | check-check.json/.log        |
| unit         | `C:\Program Files\nodejs\node.exe node_modules/tsx/dist/cli.mjs --test tests/unit/*.test.ts`                                                                                                                                                                                              | 0      | 67                      | check-unit.json/.log         |
| integration  | `C:\Program Files\nodejs\node.exe node_modules/tsx/dist/cli.mjs --test --test-concurrency=1 tests/integration/*.test.ts`                                                                                                                                                                  | 0      | 62                      | check-integration.json/.log  |
| e2e          | `C:\Program Files\nodejs\node.exe node_modules/@playwright/test/cli.js test`                                                                                                                                                                                                              | 0      | 3                       | check-e2e.json/.log          |
| model        | `C:\Program Files\nodejs\node.exe scripts/run-python.mjs model-parity`                                                                                                                                                                                                                    | 0      | 6                       | check-model.json/.log        |
| generalModel | `C:\Program Files\nodejs\node.exe scripts/test-general-model.mjs`                                                                                                                                                                                                                         | 0      | 7                       | check-generalModel.json/.log |
| targeted     | `C:\Program Files\nodejs\node.exe node_modules/tsx/dist/cli.mjs --test --test-concurrency=1 tests/integration/live-refresh.test.ts tests/integration/public-research.test.ts tests/integration/comparison.test.ts tests/integration/rotation.test.ts tests/integration/workspace.test.ts` | 0      | 11                      | check-targeted.json/.log     |
| build        | `C:\Program Files\nodejs\node.exe scripts/build.mjs`                                                                                                                                                                                                                                      | 0      | 非模型测试              | check-build.json/.log        |
| browser      | `C:\Program Files\nodejs\node.exe scripts/verify-universal-browser.mjs`                                                                                                                                                                                                                   | 0      | 38交互 / 21页面 / 0异常 | check-browser.json/.log      |

各check JSON记录实际命令、开始/完成UTC、退出码、测试数量和日志路径；失败历史保存于check-history。证据原目录 `.runtime-v2/universal`；用户副本在聊天根 `outputs/general-20261002`。截图没有API拦截，没有往研究库塞合成赛事。

### 实际功能链路与页面

当前通用方法固定为GENERAL_FOOTBALL_RESEARCH_V2：国家队友谊赛训练4384、2024校准241、2025–2026-07-18留出427；独立重新计算LogLoss0.9668183/Brier0.5775481，原数据/权重SHA校验通过。没有历史价格，ROI=null；正式国家队赛事迁移仍未验证。俱乐部读取本赛事可核实进球/失球/积分，不借用五大联赛均值冒充其他赛事证据；女性/青年不使用男子国家队参数。MLS、NWSL、英格兰女足积分源的真实原文与SHA见standings-source-proof.json。

真实浏览器取样截止 2026-10-02T06:43:43.654Z：通用目录200场、完成53场、独立攻防49场、实际完成11类赛事；发现26类（发现不当作已预测），当前价值方向2。当时未入选不等于现实无机会，缺口/价格/窗口原因仍可在完整赛程和详情查看。开赛后首次冻结方向可跟踪，GET浏览不会改变原Prediction哈希与概率。

最后补取后07:00 UTC实际截图：205通用目录、53完成、49独立攻防、11已完成赛事类、4个国家队研究方向；报价采集更新至06:58 UTC。详见recommendation-proof.json及recommendations-1440/390.png，数量随新捕获和10分钟过期变化，不能把截图数量宣称为永久推荐数。

六策略有独立虚拟账户：广覆盖单场、精选价值、让球、最优玩法、各玩法对照、分散双场。正常自动发现→报价→冻结→Python领取→决策→参考价纸面→结果裁定→结算；暂停/恢复通过实际页面写入并在finally恢复原状态。双场当前若没有满足独立赛事/时间条件的两腿，维持0票，不造组合。

初期共同已核验5场：通用LogLoss0.7311/Brier0.4086，市场0.5922/0.3083；前两张精选已结均亏损，ROI=-100%。这些是实际观测，不是盈利证明，不以当前小样本宣布优胜，也未自动晋升。V6C388/V7/9月20日旧V2原计算文件保持原字节，parity与新模型留出验证分列。

七页面：完整赛程、冻结比赛详情、历史中心、独立纸面账本、模型实验室、数据运行、模拟策略。截图schedule/match/history/ledger/models/runtime/strategies-<宽度>.png；另有开赛跟踪和详情分析截图。实际检查日期/入口、无横向溢出、六策略控制、新账读取截止与旧档导出截止分开、局域网入口。手机尺寸和本机LAN验证不是实体手机已测。

### 失败、纠错和复验

所有失败保留日志，不计通过。早期备份出现missingWorkspace未定义，已改为完整表清单并由全量/分页备份测试验证。新增General任务后旧测试依赖固定领取顺序/任务数量、fixtures轮转索引发生变化：按真实模型ID/URL及实际优先窗口检查，保留原函数推断与保护断言。来源别名试图向严格输入加入sourceHome/sourceAway，契约真实拒绝FEATURE_SCHEMA_MISMATCH；删除多余字段，原来源名称/ID在原证据保留，11例专项重跑通过。

真实浏览器首次策略重复展示导致14卡而不是6，已去掉重复内容；手机详情418/390溢出已改独立卡片；标题竖排按实际截图修复。一次新库跟踪页60秒超时，小库测试未暴露：把相关子查询改为一次汇总；另将最新预测提前筛选再关联决策，同真实库1233行结果完全一致，原生SQLite读取0.889→0.171秒（见read-query-proof.json，不当作HTTP性能）。列表不再从D1读取全部新闻/积分/摘要盘口；详情和源证据未删除，专门测试核对原文未变且阵容/战绩完整度保留。最终HTTP延迟以latency.json实际测量为准，不宣称长期性能达标。

高EV初版还发现1X2融合概率与AH纯进球格分布不一致：初版V1停止新纸面动作，原预测/票/账不改；固定V2让同一比分格匹配中心概率，所有市场共享同一冻结分布。测试验证赔率/EV不能由客户端伪造，超过20%偏差和高赔率不当精选价值。

最后性能复验：首次工作台约10.84秒，追踪接口随后0.58秒。真实请求跟踪定位到首页同时计算全历史并行比较，阻塞工作线程约9.58秒。改为展开才请求，自动后台推断不变；最终首次打开1.18秒、跟踪0.727秒、通用0.036秒（单次本机测量，非长期SLA）。浏览器检查首页没有发出比较请求；实际展开HTTP200并显示原比较、收起后卸载停止轮询，见recommendation-proof.json。第一次收起立即数DOM断言失败1≠0，改为等待React提交后复验；失败记录capture-expand-failed.json保留。模型实验室主动打开全历史比较仍需计算等待。

持续观察还发现摘要内盘口缓存30分钟，而报价10分钟过期：修复24小时内比赛摘要5分钟主动重读，远期上下文仍30分钟；录制来源集成测试验证真实调用fetcher、采集时间更新及原冻结不变，不只是检查源码字符串。补用例首次缺fixtureId声明导致类型检查退出2，修复后check/11专项通过。实时补取结果见推荐/刷新证据，未以计算时间换旧报价时间。

补报价时不再以含null的数组非空判断已有数据；摘要盘口引用实际摘要原文快照/采集时间。录制来源→D1→原Python原函数的集成例实际检查resourceKey与quote.observedAt；该来源断言首跑误写sourceUrl字段退出1，修复为真实契约resourceKey后全11及完整62例通过。四场实际国家队报价更新至06:58–06:59 UTC，均与包含价格的真实来源快照时点相等；这四场价格来自scoreboard，不能称它们验证了live summary-only分支，后者只有录制来源软件验证。

格式检查失败（含最后读取优化）已经格式化后复跑；原日志保留。外部网络/Windows socket偶发中断在运行日志中保留并按来源退避/任务重试，不能称跨日/无人值守稳定性已经验收。

### 保护、启动与未完成

旧HEAD/dirty status/diff与本轮基线相同；五个旧任务动作相同。旧5173 PID由9036变为24644，不能说进程全程不变；没有发旧HTTP、连接旧D1、控制旧进程或修改旧任务。这是操作记录与基线比对证据，不是系统级写审计，也不禁止旧站自己的任务写库。

新库使用research-general/demo-general：来自停止自己的原安装后复制到从未运行的新目录，原自有目录没有覆盖。保护报告逐行SHA核对本轮前和多腿升级前的不可变事实全部保留；两个quick_check=ok，FK失败0。新研究票是新独立虚拟账本，不写旧票旧余额。

已运行：http://127.0.0.1:5274/workbench；同网入口http://192.168.2.130:5274/workbench。本目录 `npm run dev:research` 启动；独立DEMO `npm run dev` →5273/demo-workbench。没有登录口令，电脑重启需一次启动。没有push、部署或入口切换。

功能统计27完整/4部分/3退役。仍需V7实时输入、严格前瞻资格、原三固定方法统一跨季共同输入、全部来源/联赛/金额配置编辑；稀有国家队/部分杯赛独立攻防不足，多日稳定/实体手机未证明。见FEATURE-PARITY.md、BLOCKERS.md。

---

# 可用性恢复：实际验收报告

2026-10-01。功能代码本地提交 **9e43c07**，无push/部署/正式切换。旧阶段原报告保留在 docs/mahoraga-2/TEST-REPORT.md，其中旧任务动作全同结论已明确纠错。

## 验证口径

软件测试、录制来源测试、实际在线运行、真实原模型历史parity与前瞻/收益验证是不同证据。源码边界检查、跳过测试、合成控制样本和截图均不算实模验证。V6/V7实时必要输入未满足；全历史RETROSPECTIVE拟合不得进入实时候选；无合格动作ROI=null。

## 实际命令与结果

工作目录为 v2。每条命令的开始/结束时间、退出码、数量和完整日志在 `.runtime-v2/usability/check-<名称>.json/.log`。以下软件/模型测试没有跳过项。

| 类型                 | 实际命令                                                                                     | 退出码 | 通过/总数                       | 证据名称                                |
| -------------------- | -------------------------------------------------------------------------------------------- | ------ | ------------------------------- | --------------------------------------- |
| 类型/格式/边界       | `node scripts/check.mjs`                                                                     | 0      | 69文件边界检查；不是模型测试    | check-check                             |
| 单元/契约/数学       | `node node_modules/tsx/dist/cli.mjs --test tests/unit/*.test.ts`                             | 0      | 56/56                           | check-unit                              |
| D1集成               | `node node_modules/tsx/dist/cli.mjs --test --test-concurrency=1 tests/integration/*.test.ts` | 0      | 45/45                           | check-integration                       |
| 实际浏览器离线端到端 | `node node_modules/@playwright/test/cli.js test`                                             | 0      | 3/3                             | check-e2e；test-results/e2e-report.json |
| 原模型历史parity     | `node scripts/run-python.mjs model-parity`                                                   | 0      | 6/6                             | check-model                             |
| 补充研究软件         | `.venv/Scripts/python.exe model-runner/test_public_research.py -v`                           | 0      | 5/5                             | check-publicmodel                       |
| 生产构建             | `node scripts/build.mjs`                                                                     | 0      | Worker＋Vite真实构建            | check-build                             |
| 常用浏览器操作       | `node scripts/verify-user-journeys.mjs`                                                      | 0      | 18条交互/0页面异常              | check-journeys；user-journeys.json      |
| 响应式真实截图       | `node scripts/capture-usability-pages.mjs`                                                   | 0      | 6页面×3视口=18组                | check-browser；browser-smoke.json       |
| 自有新库重启证据     | `.venv/Scripts/python.exe scripts/verify-owned-state.py`                                     | 0      | 两个quick_check=ok、原行完整    | restart-final-proof.json                |
| 旧站保护             | `.runtime-v2/usability/protect-final.ps1`                                                    | 0      | 旧HEAD/diff/服务PID，任务3同2异 | legacy-protection-final.json            |

软件/模型检查合计115例；18条在线交互与18组截图另列，不混为模型样本数量。最终重跑结果以证据JSON的时间为准，不把正在执行的步骤算通过。

## 具体覆盖

- 新D1报告控制测试：严格资格0→1，后晋升不能追认旧预测，DEMO/RETROSPECTIVE/公开参考报价不计严格；重复捕获同场不增加N、Legacy导入不增加N。控制输出明确TEST_ONLY，只验证报表软件。
- 新D1跨日测试：当期出票投入与旧票当期结算收益分离，旧未结敞口不消失；页面柏林日与旧上海08:00账日独立。
- 公共研究D1集成：录制源→同源三项价/来源原文→真实Python子进程推断→不可变预测→决策→幂等重复采集/迁移→赛后仍为原哈希，不自动创建票。
- 原子账本、CAS、幂等重放、冲突review、追加更正、无权威客户端金额、源失败/体积限制、租约过期/真实runner进程死亡恢复、备份分页与冻结评估均在45集成例中。
- 三项离线E2E实际走浏览器→Python→D1→票→结算→更正→重启；另外验证仅重启自己的有身份校验runner。移除的手工成交页面用“不可见且正常旧账本可用”验证，后端旧声明追加事件保护继续由集成例覆盖，未跳过。
- 在线18项：5273默认进入5274、国家队未结束目录、中文搜索、1X2/AH/TOTAL、实际报价图有效坐标/键盘、返回/刷新/指定日期、全部观察、历史弹层焦点/Tab/Escape、498票旧收益分母、十策略逐日/曲线、498全量导出、失败单腿原票直达、115×3全部样本导出、共同赔率样本、真实自动队列/心跳、退役入口。
- 18截图：完整赛程、比赛详情、历史中心、账本、实验室、数据运行；1440深色、390深色、1024浅色。无页面横向溢出；手机首个赛程行顶部约696px。不是合成展示图。

## 实际模型与数据证据

V6配置388真实归档250行由原函数检查；V7固定融合真实共同115场与原predict最大误差1.1102230246251565e-16，证据 `.runtime-v2/feature-parity/fixed-candidate-parity.json`。Market/V6/V7共同115/原165覆盖69.7%，排除50场全部保留原因。V6只有逐方向压力，不算三分类LogLoss/Brier或伪校准。

固定80%市场＋20%近期比分模型的软件5例只证明计算/输入守卫，不证明收益。新neutralSite缺失保持null并拒绝该研究任务；不能填false。正常运行真实公开捕获/冻结记录、近期战绩/报价与新研究候选可在 current-workspace.json、restart-final-proof.json及真实页面核对；实时V6/V7仍BLOCKED/不适用。

65联赛×8日期520/520有实际来源请求，55格有赛事但部分输入不齐、465格为空（06:25 UTC取样）。EMPTY仅代表此来源此窗口无返回，不代表现实没有赛事。报价仍可能缺失、过期或来源更新时间未知。当前323个未开赛队名全部有中文（480场目录取样）；数量随自动采集变化。

原旧498票盈亏−365.62；风险已结投入7535.62；已结投入7615.62中的退票80不计ROI，ROI≈−4.85189%。全部投入7674.37还包括两张未结票的58.75。719历史/705原档案＋14原研究观测、570原腿保留；归档导出截止与比赛样本截止分开。

## 失败与修复记录

失败没有删除或算通过；最终通过是修复后实际执行。

| 失败阶段       | 真实结果               | 原因/修复                                                                                                  | 保存证据                                                        |
| -------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| 初始单元       | 51例49通过2失败，退出1 | 旧上海页面日/无报价NO_EDGE断言与修复目标冲突，按新页面柏林日和真实缺报价修改后重跑                         | 早先过程输出；最新56例保留对应场景                              |
| 初始浏览器详情 | 实际页面异常           | standings/news返回对象而非数组；安全读取groups/articles后重新浏览                                          | 早先页面日志，最终browser-smoke                                 |
| 集成轮转首跑   | 43例42通过1失败        | Promise.all并发请求顺序不保证，改按实际URL检查连续联赛；另一个测试时钟未越过真实捕获阈值，明确调整控制时点 | check-integration-failed-rotation-order.json/.log；测试过程输出 |
| 旧E2E首跑      | 3例2通过1失败，退出1   | 仍要求已被用户删除的手工成交表单；改验证退休入口和旧账本，后端保护仍测                                     | earlier-e2e-retired-manual-trace.zip；过程输出                  |
| 交互首轮       | 检查中断，退出1        | 自动发现新增第二场哈萨克斯坦，测试不再硬编码只有1场；按中文搜索和目标对阵验证                              | user-journeys-failed-count-assumption.json                      |
| 交互图表首轮   | 检查中断，退出1        | 新增逐日图后宽泛定位器匹配两个图注；定位到指定图容器                                                       | user-journeys-failed-selector-scope.json                        |
| 手机/桌面视觉  | 真实发现缺陷           | 历史行400px超390、更多按钮盖说明、报价ISO时间相减产生NaN；修复并加入溢出/首屏/有效坐标/应用控制台检查      | 旧截图/过程日志；最终18截图/报价曲线交互                        |
| 最后检查初跑   | 静态检查退出2          | 新增状态用例缺rowMatches导入；修复后check/unit/build退出0                                                  | check-check-failed-missing-test-import.json                     |
| 格式化尝试     | 退出1                  | Prettier没有Python解析器；未作为测试或模型验证；仅JS/TS/CSS/JSON格式化，Python由真实解释器测试             | 过程输出                                                        |
| 保护脚本初跑   | 退出1                  | 基线将采集基线自身的临时PowerShell混入旧服务列表；明确单列，不称旧站被停止                                 | legacy-protection-final.json的baselineReadProbe                 |
| 自有库hash初比 | 退出1                  | 基线散列的是行数组，新脚本先按对象散列，属序列化差异；恢复原行序列化后全部一致                             | restart-final-proof.json、既有restart-proof.json；过程输出      |

## 保护证据与限制

最后再验记录：一次全套集成在备份测试文件启动阶段异常退出，只输出 `test failed`，44个报告项中43通过1失败，退出1。该次同时启动两个新的v2服务并构建同一Worker文件，但没有足够诊断证明因果关系。独立备份测试随后实际2/2通过（TAP，退出0，15.735秒）；最终无并行新服务启动的全套重跑结果见最后 check-integration。未跳过备份例，也未因此改动旧站。失败证据保存在 check-integration-failed-backup-process.json/.log，原因仍未归因。

另一最终在线复验曾因测试等待过于宽泛的 `q=` 响应，在新筛选尚未渲染时抓住旧列表，退出1。改为等待完整中文查询及目标对阵出现后，18条交互复跑通过；证据 user-journeys-failed-response-race.json。此修正只改验证脚本，不把实际页面问题掩盖为通过。

旧HEAD325a5087f20669489b72318f918968abf5f0db7e、dirty status/diff一致；旧服务PID60544/58328/59592和5173 owner一致。基线第四PID54584是读取基线自身的临时命令，不是旧服务。

正确比较旧任务是3同2异，Health Snapshot/Odds Archive任务文件mtime均01:20:59 UTC，早于03:54 UTC可用性审查；本轮没有改这些任务，不能再称“全部相同”。旧303/304源文件与9/27基线相同，另一未跟踪旧helper早先已变，不能宣称全旧目录逐字节未变。

此可用性阶段未开旧数据库或旧HTTP；此前功能迁移仅mode=ro/query_only读取旧一致快照，新库独立。此轮自有库只读重启证明：两个quick_check=ok，原预测/档案全保持；新预测只追加，无新票/账本动作。不是系统级写审计，也不阻止旧站自身原有任务写入。

未reset/clean/stash、覆盖旧dirty、杀旧进程、改旧启动任务、push、部署或切换。新运行日志research-final/demo-final和各自run.json可核对实际新启动。长期多日稳定性未在本轮宣称通过。

## 证据交付

原始日志/截图在 .runtime-v2/usability；用户副本为聊天根 outputs/usability-20261001，包含本报告、功能清单、保护/重启/源读取/浏览器JSON、测试日志和真实PNG。不提交本地数据库、原票私有数据或运行令牌到Git。

仍未完成见 BLOCKERS.md；24完整/7部分/3退役、31审查29闭环/2部分见 FEATURE-PARITY.md。

## 固定两算法与手机入口验收（2026-10-01）

本节覆盖本轮新增代码，更新此前“实时V6仍BLOCKED”的结论。工作目录 `v2/`；机器命令逐项记录在 `.runtime-v2/parallel-models/check-*.json/.log`，包含开始/结束UTC、实际命令、退出码与数量。最终源码版本/运行身份以交付包运行证据为准，未push或部署。

| 验证                  | 实际命令                                         | 结果                                                                                           | 证据                                    |
| --------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------- | --------------------------------------- |
| TypeScript/格式/边界  | `node scripts/verify-comparison.mjs check`       | 退出0；边界源码检查不是模型验证                                                                | check-check                             |
| 单元与真实LAN代理     | `node scripts/verify-comparison.mjs unit`        | 59/59，退出0，0跳过                                                                            | check-unit                              |
| 完整D1集成            | `node scripts/verify-comparison.mjs integration` | 50/50，退出0；租约、原子、幂等、结算、更正、故障恢复等                                         | check-integration                       |
| 补充队列/来源故障     | `node scripts/verify-comparison.mjs queue`       | 2/2，退出0；其中1例与完整集成重合，另1例新增                                                   | check-queue                             |
| V6/旧V2固定函数与特征 | `node scripts/verify-comparison.mjs comparison`  | 10/10，退出0；10条真实归档特征310数值，最大误差6.023e-13；旧V2独立公式oracle与原时间窗         | check-comparison、feature-parity.json   |
| 原模型包parity        | `node scripts/verify-comparison.mjs model`       | 6/6，退出0；V6原250行、V7原115共同历史行，不是实时盈利验证                                     | check-model                             |
| 市场/近期比分研究软件 | `node scripts/verify-comparison.mjs publicmodel` | 5/5，退出0；不是V6或真实收益验证                                                               | check-publicmodel                       |
| 原离线浏览器全链路    | `node scripts/verify-comparison.mjs e2e`         | 3/3，退出0；真实Python、D1、票据、结算、更正、重启/子进程恢复，DEMO明确合成                    | check-e2e、test-results/e2e-report.json |
| 构建                  | `node scripts/verify-comparison.mjs build`       | 退出0                                                                                          | check-build                             |
| 实际研究网站浏览器    | `node scripts/verify-comparison.mjs browser`     | 13项实际检查通过，12个六页面桌面/手机尺寸检查，应用错误0；另两套V6实方向详情及真实私网会话截图 | browser-verification.json、16张真实PNG  |

共134项不同可执行测试通过（D1为完整50例加新增1例，专项重合例只计一次）。相同测试重跑不增加数量；0跳过。后续修改的比较显示字段/导出及队列分别有5例和2例针对性重跑，不用源码字符串、合成收益或截图充当原模型验证。

浏览器实际打开赛程、比赛详情、历史、账本、实验室、系统，1440/390尺寸无页面横向溢出，首页第一比赛位置检查通过；实际切换共同/各自口径、下载全部冻结记录（后台追加仍完整）、私网HTTP无口令会话/CSRF刷新200、内部接口403。实体手机未持有，不能把浏览器390或本机私网访问说成手机硬件已测。

实际公开赛事：18:48 UTC样本V6成功45场、旧V2成功30场，V6原生行动1场、旧V2两策略各30场；共同样本0、已结0、ROI null。数量继续自动更新，以最终 live-comparison.json 中截止为准，不计重复推断。真实V6方向在阿拉维斯—马德里竞技（2026-10-10）详情截图；压力值不是命中保证，报价明确为公开参考，未自动出票或晋升。

赛程传输实际测得约177KB，状态200；elapsed约3.6秒为本轮自动任务同时运行时的一次本机读取，不作为性能/长期稳定达标结论。原完整新闻/阵容/原始JSON仍在详情与D1，列表不重复传输。

### 本轮失败与修复（保留，不算通过）

| 失败                | 真实结果与原因                                               | 修复/证据                                                                                                                           |
| ------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| 初始纯函数提取/特征 | clamp提取不适配、最少3历史限制与原配方不符；初始数值测试失败 | 修正建立r1；保留 `.models-local/frozen/20261001` 失败快照及 failed-initial-assets.json；原测试过程输出，不伪造历史日志              |
| 初始格式检查        | 退出1，4文件需格式化                                         | 原失败check-check保存在check-history；修正重跑退出0                                                                                 |
| 远期发现回归        | 50例49过1败，原测试期望纯ROTATION                            | 查明远期优先可能延迟常规更新，改交替并实际测两次wide/two rotation/urgent；失败check-history完整保留                                 |
| 快照时间专项        | 6例5过1败；控制时点晚1000ms的观察不应出现在早时点            | 调整测试为早/晚两快照并验证导出上界；原过程输出，后比较5/5通过                                                                      |
| 随机端口            | 50例49过1败，Fetch bad port                                  | 本机动态TCP1024–15000含Fetch禁用端口。独立未指定端口实例用安全范围，不改系统配置；windows-dynamic-port-range.txt和失败check-history |
| 端口适配首轮        | 50例47过3败，测试仍向虚构127.0.0.1:0分派，触发Host守卫       | 测试改取真实Miniflare端点，认证/来源/Python恢复实际重跑完整50/50；未放宽Host或认证                                                  |
| 新队列故障场景      | 2例1过1败，积分来源失败时把reason放进snapshotId导致FK错误    | 修正失败写入列，保留reason、snapshotId=null和退避；队列2/2实际重跑。最初过程输出，未伪造失败日志                                    |
| 服务启动前浏览器    | 退出1，0检查，connection refused                             | 确认新服务READY后实际重跑；browser-failed-startup.json与check-history保留                                                           |

### 保存、保护与交付边界

模型/原始函数本地16资产hash与4执行文件hash封存；Git对四文件禁用换行转换以保留实际字节，代码SHA清单可审查。V7只封存。9月20日源码默认值与当晚未提交/可变参数不能等同，逐场1单位回报与旧每日组合账本不能等同。

新库迁移前独立备份；迁移后两库quick_check=ok，8679条原研究预测与4条原DEMO预测全部不变，仅追加新研究推断；核心票据/账户/结算/账目没有新增或改写。原档案另按备份逐行比对。own-database-preservation.json只证明自有2.0库，不是旧D1审计。

旧HEAD、dirty diff、5173三层PID/命令均一致；本阶段五个旧任务文件修改时点和基线动作比较均一致。相对更早基线仍3同2异（两变更在本轮之前），不抹去此前纠错。证据 legacy-before/after.json、current-phase-task-protection.json。没开旧D1、没调用旧HTTP、没写旧代码/任务、没接管旧入口；不主张阻止旧站自身原有写入或完成系统级写审计。

新证据包：聊天根 `outputs/parallel-models-20261001`，含5份持续文档、启动说明、固定清单、命令/失败历史、实际浏览器PNG与运行/保护JSON、SHA交付清单。不包含令牌、数据库或模型权重。未完成项见 BLOCKERS.md，不能声称完美、已验证盈利或自动切换完成。

## 2026-10-01：开赛后不消失与推荐跟踪（最终验收）

范围：实际旧前端/API对照、比赛生命周期导航、来源比分/分钟、冻结方向、直播优先刷新、重复赛果、人工更正后自动结算、直接阻塞页面的查询性能。保留既有核心、模型封存和旧站边界。命令在v2目录执行；本节覆盖此前本轮“验收进行中”的状态。

| 验证               | 实际命令                                                           | 最终结果                                                           | 证据（.runtime-v2/lifecycle）                                                    |
| ------------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| 类型/格式/边界     | `node scripts/verify-lifecycle.mjs check`                          | 退出0；边界字符串检查不是模型验证                                  | check-check.json/.log                                                            |
| 单元               | `node scripts/verify-lifecycle.mjs unit`                           | 63/63，退出0，0跳过                                                | check-unit.json/.log                                                             |
| 完整D1集成         | `node scripts/verify-lifecycle.mjs integration`                    | 52/52，退出0，0跳过；最后完成21:50:58 UTC                          | check-integration.json/.log                                                      |
| 最终变更专项       | `node scripts/verify-lifecycle.mjs targeted`                       | 9/9，退出0；已包含于完整D1，不重复计数                             | check-targeted.json/.log                                                         |
| 离线端到端         | `node scripts/verify-lifecycle.mjs e2e`                            | 3/3，退出0；真实Python领取/D1/票据/结算/更正/重启，数据明确DEMO    | check-e2e.json/.log                                                              |
| 封存模型历史parity | `node scripts/verify-lifecycle.mjs model`                          | 6/6，退出0；原V6 250行、V7原共同历史样本与篡改/缺输入/固定变体检查 | check-model.json/.log                                                            |
| 构建               | `node scripts/verify-lifecycle.mjs build`                          | 退出0                                                              | check-build.json/.log                                                            |
| 实际研究网站浏览器 | `node scripts/verify-lifecycle.mjs browser`                        | 14项检查通过，六页面×1440/390共12页面检查，应用错误0，退出0        | check-browser.json/.log、browser-report.json、真实PNG                            |
| 自有数据保留       | `.venv/Scripts/python.exe .runtime-v2/lifecycle/preserve.py after` | 退出0；原行hash不变、两库quick_check=ok、4封存执行文件不变         | own-preservation.json                                                            |
| 旧站连续性         | `pwsh -NoProfile -File .runtime-v2/lifecycle/protect.ps1`          | 退出1：原旧PID在机器重启后不存在；不得标PASS                       | legacy-before/after.json、resumed-environment.json、legacy-continuity-audit.json |

共124项不同软件测试通过（63+52+3+6），专项9为重复验证。14项实际浏览器检查单列，12页面不是新增单元测试。新增集成实际运行D1和Python，不以源码字符串、跳过、合成收益充当原模型验证；封存模型历史一致性不等于实时输入充分或未来盈利。

核心行为证据：开始时实际14场已开赛却被upcoming与STARTED相互过滤为0（before-live.json）；修复后显式进行中/赛果/已保存方向可达、刷新仍保留URL。D1控制时钟跨开赛/终场，原prediction id/概率/quoteAt和输出hash不变，后来的失败/无行动不抹去原方向。真实浏览器两尺寸亦核对同场冻结id；实际比分与分钟来自公开来源，不按计算时间推演。最终数量随比赛状态更新，不把截图的某一时刻数量当永久指标。

比分缺失不填0；赛前来源0不显示成直播比分；终场加时不能冒充90分钟。重复来源原始证据继续追加但不反复制造相同规范赛果；已更正的人工裁定不会被旧自动receipt覆盖，未新增错误结算/余额。直播刷新保留未变比分/时钟的首次进展时间，新采集时间不能掩盖停滞，半场使用独立容忍时间。

实际截图：schedule、match、history、ledger、models、runtime各1440/390；另有live、results、tracked及live-viewport两尺寸。全部来自实际独立研究站，无拦截模拟API或向生产库注入合成比赛。手机尺寸与本机LAN入口已测，实体手机、外网/公网、长期断网休眠恢复未验收。

### 失败记录保留

| 失败                         | 原因与处理                                                                      | 最终验证                                               |
| ---------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------ |
| 专项首轮9项2失败             | 测试错误字段outputSha256，实际为outputHash；修正字段与多余投影                  | 最终9/9；check-history保留原结果                       |
| 浏览器赛程超时               | 旧逐行相关查询拖慢真实大库；聚合读取、每场最新cutoff及覆盖索引直接修复          | 真实页面14检查通过；原slow-query证据保留               |
| 浏览器动态数量比较失败       | 比赛在两次读取间终场，跨时刻数量断言错误；改为各快照状态条件和实际渲染核对      | 实际重跑通过，动态来源失败JSON保留                     |
| 浏览器导航load超时           | 外部队徽加载/运行器同时繁忙；等待DOM及实际页面数据，不等待无关外部资源          | 实际页面截图重拍，不沿用未渲染旧页面                   |
| 两次完整集成51/52            | Windows workerd启动std::terminate、Socket other side closed；过程保留，未标全过 | 机器重启后完整52/52，最终专项9/9；长期运行稳定仍未证明 |
| 新读取索引首次bootstrap退出1 | D1.exec逐行执行，SQL注释造成失败；删除注释，不改模型或财务表                    | research及demo真实bootstrap退出0；只写独立两库         |
| 旧保护检查退出1              | 21:21:52 UTC机器重启；旧站原任务恢复PID9036，原三层PID已消失                    | 如实保留非连续结果；未操作旧进程/任务                  |

失败/重跑命令、退出码、测试数量与时间在check-history逐项保存；部分初始过程只有原工具输出，不补造日志。查询原生SQLite耗时改善不冒充HTTP长期SLO。重复检查不增加测试总数。

### 保留与交付

原12559条研究预测、5997条并行模型记录、705条研究导入档案，以及DEMO原4预测和所有原票/账目/导入记录逐行hash均不变，允许正常后台追加。保存原行hash的私有大文件不对外打包；只交小型保留结论。两库quick_check=ok，4个封存执行文件字节不变。

旧HEAD/diff/status未变；本轮前后五任务文件修改时间和相对早基线的动作比较结果未变（仍3同2异，两次动作变更早于本轮）。PID连续性明确为false，不能照搬上节PID全同的历史结论。此工作没有旧HTTP请求、旧D1连接、旧任务/进程修改、push、部署或切换。证据是源码/任务元信息比较和操作范围，没有声称系统级数据库写入审计或阻止旧站自主写入。

最终可审查包在聊天根outputs/lifecycle-20261001：本阶段文档、真实截图、当前代码/运行身份、测试与失败历史、旧保护/自有记录保留、文件SHA清单；无令牌/数据库/权重。旧功能总34，22完整、9部分、3用户主动退役，新增生命周期跟踪。本轮解决开球后不可见；自动纸面策略、完整事件/动态统计、独立直播交叉核验、V7实时、亚洲盘/大小球独立EV和成熟公平样本仍见USABILITY-GAPS.md，未完成不得宣称完美。

## 2026-10-02：推荐身份说明的显示补正

范围仅为推荐栏名称、直接可见的来源说明、严格资格“未启用”的状态说明。业务/模型/数据库/资格筛选未修改；严格候选仍为固定空占位，不能报为已实现。

`node scripts/verify-lifecycle.mjs check build` 实际退出0，类型/格式/边界及构建通过；本轮两份check JSON/log另复制到.runtime-v2/recommendation-clarity-20261002。边界源码检查不算模型验证。`node .runtime-v2/recommendation-clarity-20261002/verify.mjs` 实际退出0，真实研究浏览器桌面1440/手机390共6项检查通过、应用错误0：来源说明直接可见，严格标签为未启用且不宣称无机会，两场真实V6保存方向可达。6张截图以及browser.json保存该目录；无模拟API/注入赛程。

current.json是实际HTTP快照，00:39柏林研究候选14、V6方向2、旧V2最新方向22；数字随正常任务变化，保存方向不等于已证明有效的严格推荐。V6两场日期为10月10日与10月17日，不能冒充今日国家队推荐。此次未重跑未变核心/模型的124项套件，不复用旧通过来宣称本轮新增模型验证；源码/账本/阈值/原预测未变，原站未操作。

## 2026-10-04：模型版本切换验收（进行中）

专项首次失败保留在工具执行记录：测试对象未经过JSON传输规范化、原模块缺失值undefined与适配器null、负期望补位测试集合并未触发补位、DEMO结果测试使用错误参数形状；修正后11/11专项通过，0跳过。包含120组完整原函数候选对照、100组Poisson/DC计算对照、完整120比赛选单、原PP变更，以及真实D1事务/重复执行/更正测试。它们验证软件与保存的源规则等价，不是盈利验证，也不证明缺失运行二进制。

最终所有命令由 scripts/verify-versions.mjs 保存退出码和完整日志到 .runtime-v2/versions-20261004。当前全量单元82/82；D1回归与浏览器仍在运行，最终结果以下方验收为准。

### 本轮最终验收

工作目录：work/mahoraga-v2/v2。证据目录：.runtime-v2/versions-20261004；交付副本为聊天根outputs/versions-20261004。每条命令的真实时间、退出码和完整日志见对应latest.json与带时间戳log。

| 命令 | 退出码 | 数量与结果 | 证据 |
| --- | --- | --- | --- |
| node scripts/verify-versions.mjs check | 0 | TypeScript/格式/边界通过；不算模型验证 | check-latest.json |
| node scripts/verify-versions.mjs unit | 0 | 82/82，0跳过 | unit-latest.json、unit完整log |
| node scripts/verify-versions.mjs integration | 0 | 76/76真实D1，0跳过 | integration-2026-10-04T04-19-37.499Z.log |
| node scripts/verify-versions.mjs parity | 0 | 6/6；含V6原250行和V7原历史数据 | parity-latest.json |
| node scripts/verify-versions.mjs e2e | 0 | 3/3；浏览器→Python→D1→出票→结算→更正→重启 | e2e-latest.json |
| node scripts/verify-versions.mjs build | 0 | Worker及Vite生产构建 | build-latest.json |
| node scripts/verify-versions.mjs browser | 0 | 22真实研究检查，19截图，无应用控制台/本地HTTP错误、横向溢出 | browser-result.json、browser-latest.json |
| .venv/Scripts/python.exe scripts/verify-versions-preservation.py | 0 | 6事实表原始行哈希相同；16资产/4代码相同；旧git相同；quick_check=ok、FK错误0 | preservation-after.json、preservation-latest.json |
| .venv/Scripts/python.exe scripts/verify-versions-runtime.py | 0 | schema13、11新版本账户、真实原版预测与新票、余额恒等式0失败 | runtime-current.json |

167项不同软件测试；专项最终9例重跑不重复计数。120候选及120场整批选择、100进球模型组是实际执行封存原模块的等价性测试，控制输入明确SOFTWARE_TEST_ONLY；没有把它或DEMO称为真实模型盈利验证。浏览器不拦截/伪造API，没有注入合成赛程或收益；覆盖GENERAL/SEPTEMBER20/V6赛程、策略、账本、模型页及原版详情、运行状态、1440/390两尺寸和浅色。仅允许首次正常session探测401，其余本地HTTP失败或React控制台报错均失败。

### 真实失败及修复

- 第一轮全D1：69/74，退出1；V6镜像将"2"与"2.00"按字符串比报价，及新增任务数量旧断言。改为数值精确报价匹配，测试实际通过新Python→Node引擎并检查新不可变预测，不移除守卫。
- 第二轮全D1：73/75，退出1；新10账户数量和schema13旧断言更新。第三轮76/76退出0，日志完整保留。
- 真实自动出票：原多盘口同场串关触发核心唯一约束使整轮回滚。保留原引擎，新增不可变拒绝原建议，正常其他票提交；真实D1专项覆盖拒绝、余额与拒绝证据不可变。
- 初次浏览器：隐藏的成功状态节点被当作visible等待，退出1；改为等待已加载状态后检查实际页面。一次在新实例尚未监听前访问连接拒绝，退出1；服务就绪后实测。增加控制台验收后初次正常登录探测401被误判失败，限定只允许该路径401，再跑22项通过；React重复键与手机品牌纵排确已修复，没有过滤React错误。
- 保留脚本：在线备份比随后hash采样早17条预测，哈希序列化/完整untracked参数初次不一致退出1；改为与原采样序号及原序列化严格匹配，并另验证整个更早备份。六表原采样行和备份行均一致，不把检查失败说成旧数据库被改。runtime脚本先假设profile只一SQLite，退出1；改为核验installationId后唯一匹配，退出0。

运行观察截至04:30UTC原版63成功观测（39个fixtureRevision，重复刷新不扩大比赛N）、119张新纸面票，V6原生观测95（50个fixtureRevision）且没有假造当前原生票。数字随自动任务追加，以runtime-current.json时点为准。新版本已结数仍0，ROI为null。后台已有新成功时钟；可恢复socket重试已保留，不宣称长期零失败。

旧站5173的workerd PID24644及创建时间不变；旧HEAD325a5087、dirty diff SHA87acee2a和完整status SHA5eabb78b前后相同。没有连接旧D1、调用旧HTTP、控制旧进程、改旧任务、push/部署。旧站自身可能正常写入；这是本次操作范围和身份比较，未冒充系统级旧DB写审计。自身旧原票/预测不改，正常新结算或更正只追加。

最后运行观察追加：Node定时内部调用出现UND_ERR_SOCKET，使用新连接的同一自动接口实际返回200（1.94秒，DEGRADED来源结果如实保留）。定时调用加Connection: close；重跑端到端及实际服务/自动时钟，最终证据记录为runtime-current/restart-result及browser-latest。未承诺消除所有外部来源失败。

## 2026-10-04：完整策略记录专项

node scripts/verify-strategy-records.mjs check/build/integration/browser最终全部退出0；12个真实D1测试（0跳过），22项实装Chrome浏览器检查，7张验收截图（另保留失败截图），无API替换/合成赛事。涵盖18策略/3版本、真实全量总数、40票翻页、页二复盘、日期与策略链接、未结票、每日上限、点击定位、手机及运行状态。脚本逐次保留命令/起止时间/退出码/完整日志，路径.runtime-v2/strategy-records-20261004。检查和构建不计测试数量，也不代表模型盈利验证。

初次runtime查询不存在的tickets.status列退出1，修正只读统计后退出0；初次格式检查退出1，重格式化后0，失败check日志保留。当前scope仅UI，不重复先前167测试的统计。runtime before/after断言旧HEAD/diff/status和研究PID不变、自动成功时钟推进；没有连接旧D1。完整结果与证据索引见STRATEGY-RECORDS-20261004.md。

新增定位断言后实测发现异步载入前的滚动被列表高度变化打断，browser退出1；改为首批真实数据渲染后定位，保留browser失败日志与截图再运行完整专项。完整软件测试计数不因重跑增加。

## 2026-10-04：研究评分与双语专项

证据.runtime-v2/recommendation-scores-20261004。命令node scripts/verify-recommendation-scores.mjs check/unit/integration/build各自latest.json含实际命令、起止时间、退出码及完整日志。最终当前87/87单元、22/22真实D1，0跳过；109个不同软件测试，重跑不累加。新增覆盖双语/别名、评分边界与未知、不同盘口/模型不能合并、保留全部时点且不取最大分、冻结名字与赛后评分保持。类型/格式/构建退出0，静态边界检查不计模型验证。

真实失败：最初目标单元23/24退出1，中文档案英文回退选了简称Man United；改为已知完整别名后全单元通过（最初输出在工具记录，未伪称另有完整日志）。重复评分修复初次check退出1，四文件格式未规范，修正后0，失败check log保留。第一轮浏览器英文搜索超时退出1，实际完成4项检查但不能计整轮通过；日志browser-2026-10-04T16-30-02.211Z.log、browser-failure-first.json/png保留。前移搜索范围后重启自身研究服务，再运行含同一投注唯一突出评分断言的实际浏览器验收，结果待追加。

五表原始水位预测134582/票531/腿576/通用观测60045/版本观测23145逐行哈希前后一致；旧git HEAD/dirty diff/完整status一致，旧5173 PID24644创建时间不变。只读连接自己的installationId对应SQLite，没有打开旧D1。软件测试使用明确控制输入，不是实战盈利验证；浏览器不拦截API、不伪造比赛/收益。

后续真实失败也保留：第二轮浏览器双语三种查询与唯一评分断言通过，但推荐后台读取超时，整轮退出1；第三轮初次全量读取超时退出1，均保留各自failure-second/third.json/png及带时间日志。新增按fixture读取最后追加观测的索引与等价查询，不移除模型条件、不改原行。索引迁移初次D1共22项hook失败（0通过、退出1），原因是D1.exec将注释行当语句；移除SQL注释后22/22通过、check/build退出0，失败日志integration-2026-10-04T16-51-30.921Z.log保留。runtime脚本初次比较PowerShell5的Date序列化与PowerShell7的ISO字符串不同退出1，改为显式ISO后身份比较通过；不是旧PID改变。

### 最终功能验收

| 命令 | 退出码 | 结果 | 证据 |
| --- | --- | --- | --- |
| node scripts/verify-recommendation-scores.mjs unit | 0 | 87/87、0跳过 | unit-latest.json及完整log |
| node scripts/verify-recommendation-scores.mjs integration | 0 | 22/22实际D1、0跳过 | integration-2026-10-04T16-52-24.701Z.log |
| node scripts/verify-recommendation-scores.mjs check | 0 | 类型/格式/边界 | check-latest.json |
| node scripts/verify-recommendation-scores.mjs build | 0 | Worker/Vite生产构建 | build-latest.json |
| node scripts/verify-recommendation-scores.mjs browser | 0 | 10实站检查、9成功截图、0应用错误 | browser-2026-10-04T16-54-13.670Z.log、browser-result.json |
| .venv/Scripts/python.exe scripts/verify-recommendation-read-parity.py | 0 | 324行完全相同，1.299s→0.035s | universal-query-parity.json |
| .venv/Scripts/python.exe scripts/verify-recommendation-preservation.py after | 0 | 五事实表原行及旧git不变 | preservation-after.json |

浏览器真实读取运行站数据，无拦截/模拟API；包括GENERAL和SEPTEMBER20与保存分逐项对照、同投注唯一突出分、赛后冻结hash、三种语言/别名同10场、1440/390无溢出、V6原缺分不补数值、原票双语。只有首次正常session401探测允许，其余本地HTTP/控制台错误均失败。109个不同软件测试与10浏览器检查分别计数，不把历史函数软件parity、边界字符串检查或DEMO说成实战验证。

自身新服务PID8540/worker build hash89830468当前在5274/8789；appCodeSha3594503-dirty是启动时本轮文档未提交，API源码已在3594503提交。旧5173 PID24644及创建时间未变，交付后自身HTTP200只作为可达证据，功能由上面的真实浏览器证明。初次自动时钟推进断言退出1，因为上轮中断lease保留180秒；实际恢复结果另追加，不把手动触发称自动成功。

最终自动恢复命令.venv/Scripts/python.exe scripts/verify-recommendation-runtime.py after于16:57:44UTC退出0（runtime-after-command.json完整命令/起止时间/退出码，runtime-after.log完整输出）；同一自身PID8540、startedAt16:54:09、自动成功时钟由16:53:28自然推进到16:57:37、stage=IDLE，旧5173 PID24644创建身份相同。没有手动tick；原180秒lease正常恢复。DEGRADED/BACKOFF保留，不把来源短时恢复称长期稳定。


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
