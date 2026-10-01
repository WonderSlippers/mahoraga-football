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

| 验证 | 实际命令 | 结果 | 证据 |
| --- | --- | --- | --- |
| TypeScript/格式/边界 | `node scripts/verify-comparison.mjs check` | 退出0；边界源码检查不是模型验证 | check-check |
| 单元与真实LAN代理 | `node scripts/verify-comparison.mjs unit` | 59/59，退出0，0跳过 | check-unit |
| 完整D1集成 | `node scripts/verify-comparison.mjs integration` | 50/50，退出0；租约、原子、幂等、结算、更正、故障恢复等 | check-integration |
| 补充队列/来源故障 | `node scripts/verify-comparison.mjs queue` | 2/2，退出0；其中1例与完整集成重合，另1例新增 | check-queue |
| V6/旧V2固定函数与特征 | `node scripts/verify-comparison.mjs comparison` | 10/10，退出0；10条真实归档特征310数值，最大误差6.023e-13；旧V2独立公式oracle与原时间窗 | check-comparison、feature-parity.json |
| 原模型包parity | `node scripts/verify-comparison.mjs model` | 6/6，退出0；V6原250行、V7原115共同历史行，不是实时盈利验证 | check-model |
| 市场/近期比分研究软件 | `node scripts/verify-comparison.mjs publicmodel` | 5/5，退出0；不是V6或真实收益验证 | check-publicmodel |
| 原离线浏览器全链路 | `node scripts/verify-comparison.mjs e2e` | 3/3，退出0；真实Python、D1、票据、结算、更正、重启/子进程恢复，DEMO明确合成 | check-e2e、test-results/e2e-report.json |
| 构建 | `node scripts/verify-comparison.mjs build` | 退出0 | check-build |
| 实际研究网站浏览器 | `node scripts/verify-comparison.mjs browser` | 13项实际检查通过，12个六页面桌面/手机尺寸检查，应用错误0；另两套V6实方向详情及真实私网会话截图 | browser-verification.json、16张真实PNG |

共134项不同可执行测试通过（D1为完整50例加新增1例，专项重合例只计一次）。相同测试重跑不增加数量；0跳过。后续修改的比较显示字段/导出及队列分别有5例和2例针对性重跑，不用源码字符串、合成收益或截图充当原模型验证。

浏览器实际打开赛程、比赛详情、历史、账本、实验室、系统，1440/390尺寸无页面横向溢出，首页第一比赛位置检查通过；实际切换共同/各自口径、下载全部冻结记录（后台追加仍完整）、私网HTTP无口令会话/CSRF刷新200、内部接口403。实体手机未持有，不能把浏览器390或本机私网访问说成手机硬件已测。

实际公开赛事：18:48 UTC样本V6成功45场、旧V2成功30场，V6原生行动1场、旧V2两策略各30场；共同样本0、已结0、ROI null。数量继续自动更新，以最终 live-comparison.json 中截止为准，不计重复推断。真实V6方向在阿拉维斯—马德里竞技（2026-10-10）详情截图；压力值不是命中保证，报价明确为公开参考，未自动出票或晋升。

赛程传输实际测得约177KB，状态200；elapsed约3.6秒为本轮自动任务同时运行时的一次本机读取，不作为性能/长期稳定达标结论。原完整新闻/阵容/原始JSON仍在详情与D1，列表不重复传输。

### 本轮失败与修复（保留，不算通过）

| 失败 | 真实结果与原因 | 修复/证据 |
| --- | --- | --- |
| 初始纯函数提取/特征 | clamp提取不适配、最少3历史限制与原配方不符；初始数值测试失败 | 修正建立r1；保留 `.models-local/frozen/20261001` 失败快照及 failed-initial-assets.json；原测试过程输出，不伪造历史日志 |
| 初始格式检查 | 退出1，4文件需格式化 | 原失败check-check保存在check-history；修正重跑退出0 |
| 远期发现回归 | 50例49过1败，原测试期望纯ROTATION | 查明远期优先可能延迟常规更新，改交替并实际测两次wide/two rotation/urgent；失败check-history完整保留 |
| 快照时间专项 | 6例5过1败；控制时点晚1000ms的观察不应出现在早时点 | 调整测试为早/晚两快照并验证导出上界；原过程输出，后比较5/5通过 |
| 随机端口 | 50例49过1败，Fetch bad port | 本机动态TCP1024–15000含Fetch禁用端口。独立未指定端口实例用安全范围，不改系统配置；windows-dynamic-port-range.txt和失败check-history |
| 端口适配首轮 | 50例47过3败，测试仍向虚构127.0.0.1:0分派，触发Host守卫 | 测试改取真实Miniflare端点，认证/来源/Python恢复实际重跑完整50/50；未放宽Host或认证 |
| 新队列故障场景 | 2例1过1败，积分来源失败时把reason放进snapshotId导致FK错误 | 修正失败写入列，保留reason、snapshotId=null和退避；队列2/2实际重跑。最初过程输出，未伪造失败日志 |
| 服务启动前浏览器 | 退出1，0检查，connection refused | 确认新服务READY后实际重跑；browser-failed-startup.json与check-history保留 |

### 保存、保护与交付边界

模型/原始函数本地16资产hash与4执行文件hash封存；Git对四文件禁用换行转换以保留实际字节，代码SHA清单可审查。V7只封存。9月20日源码默认值与当晚未提交/可变参数不能等同，逐场1单位回报与旧每日组合账本不能等同。

新库迁移前独立备份；迁移后两库quick_check=ok，8679条原研究预测与4条原DEMO预测全部不变，仅追加新研究推断；核心票据/账户/结算/账目没有新增或改写。原档案另按备份逐行比对。own-database-preservation.json只证明自有2.0库，不是旧D1审计。

旧HEAD、dirty diff、5173三层PID/命令均一致；本阶段五个旧任务文件修改时点和基线动作比较均一致。相对更早基线仍3同2异（两变更在本轮之前），不抹去此前纠错。证据 legacy-before/after.json、current-phase-task-protection.json。没开旧D1、没调用旧HTTP、没写旧代码/任务、没接管旧入口；不主张阻止旧站自身原有写入或完成系统级写审计。

新证据包：聊天根 `outputs/parallel-models-20261001`，含5份持续文档、启动说明、固定清单、命令/失败历史、实际浏览器PNG与运行/保护JSON、SHA交付清单。不包含令牌、数据库或模型权重。未完成项见 BLOCKERS.md，不能声称完美、已验证盈利或自动切换完成。
