# P0 环境盘点（2026-09-28）

- 活动源码：`D:/ChatGPT/Projects/2026-09-15/ge/work/site-remote-open-129`。
- 活动源码 HEAD：`325a5087f20669489b72318f918968abf5f0db7e`；main；43 tracked 修改；304 个 tracked/untracked 静态源码文件已留 SHA256 清单。dirty 内容未进入新 worktree。
- 精确参考提交 `d35e80384ea710a2ea402a602c9751eb4b13a499` 在活动仓库不存在，在本机独立公开发布副本 `2026-09-24/d-chatgpt-projects-2026-09-15/outputs/mahoraga-football` 存在；该副本创建 worktree 前 clean。
- 新 worktree：本聊天 `work/mahoraga-v2`，分支 `codex/mahoraga-v2-p0-p2`。沿用首轮已创建分支名，未强制重命名。
- 旧进程链：40660 launcher → 27316/27368 Wrangler → 24672 workerd；另有 42956 workerd。旧监听 `127.0.0.1:5173`，PID 24672。
- 运行构建：`site-remote-open-129/dist-next-56/server/wrangler.json`；compatibility_date `2026-05-15`，DB binding `DB`，database_name `site-creator-d1`。
- 活动 D1：`D:/ChatGPT/Projects/2026-09-15/ge/work/football-live-site/.wrangler/state`，由实际进程 `--persist-to` 确认。schema version：UNKNOWN（未连接活动数据库）。
- 5 个既有 Football 任务已保存 actions；未修改、停止或手工触发它们。
- Node 24.14.0 / npm 11.9.0 / Python 3.12.3；Windows 原生。新 Python 依赖仅安装在 `v2/.venv`。
- 新端口：Web 5273 / API 8788。第一次盘点曾预选 5274，读取交接包后改为规格默认 8788；启动时检查占用，不杀进程。
- 新状态：`v2/.runtime-v2/<profile>/d1`；每 profile 独立 installationId 和凭证。不存在旧数据复制、旧 SQLite 连接、远端 D1 或部署命令。
- 三个包都位于 `D:/ChatGPT/Projects`：handoff 25 文件、V6 141 文件、V7 128 文件。全部 ZIP 和成员 SHA256 见 source-manifest.json。未执行任何包内脚本，未加载 pickle/joblib，未训练。
- 用户历史导出存在旧交接记录；本轮未读取私人票据导出、未导入。当前旧账本余额/票数 UNKNOWN，不使用旧聊天数字冒充当前核验。

机器证据保存在本聊天 outputs：inventory-before.json、old-status-before.txt、old-dirty-before.patch、protection-check.json。数据库自身可被原进程更新；文件时间变化不能归因于本次实现。
