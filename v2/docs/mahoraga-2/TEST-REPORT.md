# 功能对齐与可用性恢复：实际验收报告

日期：2026-10-01。工作区：独立worktree `work/mahoraga-v2/v2`。旧5173未接管。测试全部由真实进程执行；静态边界检查、历史模型对照、DEMO财务链及真实来源浏览器分别列出。

## 最终命令与数量

下列命令在v2目录执行。证据目录为 `.runtime-v2/feature-parity/`；交付副本在聊天目录 `outputs/feature-parity-20261001/`。退出码均为实际执行结果0。

|命令|退出码|通过 / 失败 / 跳过|证据|证明范围|
|---|---:|---|---|---|
|`npm run check`|0|类型/格式/边界检查|check.log|不是模型验证|
|`npm run test:unit`|0|46 / 0 / 0|unit.log|契约、市场/账本数学、日期/八状态/缺额/混币/官方公告解析|
|`npm run test:integration`|0|41 / 0 / 0|integration.log|真实D1、冻结/原子/幂等/导入/恢复/自动裁定，包含新功能测试|
|`node node_modules/tsx/dist/cli.mjs --test tests/unit/workspace.test.ts tests/integration/workspace.test.ts`|0|8 / 0 / 0|functional-tests.log|上述全集的子集，不重复累计；研究观测不计入资金、无日期ALL、CAS任务租约、冲突/重放|
|`node node_modules/tsx/dist/cli.mjs --test tests/integration/backup.test.ts`|0|2 / 0 / 0|backup-tests.log|上述全集的子集；schema7分页恢复到schema8，301报价不丢失|
|`npm run test:e2e`|0|3 / 0 / 0|e2e.log|实际Chrome→API→Python→D1→票→结算→更正→重启；实际自有runner恢复|
|`npm run test:model-parity`|0|6 / 0 / 0|model-parity.log|V6原函数250历史行、V7原函数115合格历史行及哈希/语义守卫|
|`.venv/Scripts/python.exe model-runner/build_workspace_study.py`|0|115行固定V7实际数值对照|fixed-candidate.log、fixed-candidate-parity.json|与原包predict对照，最大误差1.1102230246251565e-16；不训练、不证明前瞻|
|`npm run build`|0|生产构建成功|build.log|React/Vite及Worker构建|
|`node scripts/verify-workspace-browser.mjs`|0|31 / 0 / 0|browser-functional.log、browser-functional-report.json|当前运行5274真实浏览器功能/过滤/分页/原证据/自动推进/响应式/双主题，无pageerror|

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

protection-check-20261001.json核对本轮开始/结束旧HEAD、dirty patch/status、PID59592、任务动作一致。活动旧D1仅SQLite URI mode=ro和query_only=ON读取，一致backup写入v2自有目录；quick_check=ok。snapshot-proof.json与snapshot-export-proof.json记录原票/报价/模型逐字段一致及旧元数据变化；不是声明旧站自身期间完全无写入。新DEMO与research独立installationId、端口与状态目录。未push、部署、正式切换或修改旧数据库。

旧303/304文件与9/27基线一致；未跟踪local-hidden-task.vbs不同且mtime在本轮内，没有本轮前独立内容hash，差异时点/来源无法确定。本轮没有写该路径的命令，也不覆盖它。不能宣称所有旧文件逐字节未变。保护证明仅覆盖已记录范围，不是系统级写入审计。

9/28旧60分钟真实API负载报告已完成退出0，RSS末窗口比1.21534；不能代替本轮新增自动来源流程的长测。此前历史验收报告见Git中本轮之前版本。


## 2026-10-01 用户指定头像

头像专项：原文件与站点响应SHA256一致；favicon路径及M伪元素移除验证；5273/5274×390/1440×深/浅8组实际浏览器检查全部通过，无pageerror或横向溢出。证据 .runtime-v2/avatar/browser-report.json 与8张PNG。本次为展示资源变更，未重复运行无关财务/模型测试。
