# 验证报告

当前仅为只读前置盘点，不是 P0—P2 验收。

| 命令/检查 | 结果 |
| --- | --- |
| git rev-parse HEAD / status --short（活动源码） | 成功；HEAD 325a508，43 tracked 修改 |
| git cat-file -t d35e803…（活动源码） | 失败：对象不存在；随后在独立发布副本找到精确提交 |
| git rev-parse HEAD / status --short（独立发布副本） | 成功；d35e803，clean |
| git worktree add -b codex/mahoraga-v2-p0-p2 … d35e803… | 退出码 0 |
| PowerShell 前后源码 SHA256 核对 | 退出码 0；304 文件、0 差异 |
| Get-CimInstance Win32_Process | 原 5 个相关 PID 与命令行一致 |
| Get-ScheduledTask 只读比较 | 5 个相关任务 actions 不变 |
| Get-NetTCPConnection | 5173 仍 PID 24672；5273/5274 未占用 |

业务测试数量：0；未运行，不能计为通过或跳过验收。端到端截图：0。真实模型验证：未执行。
未连接旧 D1、未发送旧站 HTTP 请求，未启动新服务。未做数据库逐行前后核对，因此不声称数据库内容在其他旧任务运行期间保持静止。
证据位于本聊天 outputs/inventory-before.json 与 protection-check.json。
