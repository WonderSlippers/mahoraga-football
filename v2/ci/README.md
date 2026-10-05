# 检查入口与执行边界

Windows 本机已实际执行 `npm run report:verification`，日志含各命令、退出码、测试数和失败项。`test:import` 是已有 unit/integration 的子集，不重复计入总数。

`github-actions.yml` 是待放置于仓库 CI 目录的审阅模板。按本次“新代码只在 v2/”的约束保留在这里，没有 push 或触发远端任务。固定的三项 actions SHA 已通过各官方仓库 tag 核对。当前机器没有 WSL 发行版或 Docker，Linux 执行状态是 NOT_RUN；模板存在不算通过 CI。

干净环境的核心验证：

```text
npm ci
node scripts/setup-python.mjs --python=<本机Python3.12可执行文件>
npm run bootstrap:demo
npm run report:verification -- --core
```

Linux 还需安装当前锁定 Playwright 对应 Chromium：`npx playwright install --with-deps chromium`。Windows 使用本机 Chrome，或通过 `CHROME_PATH` 指定可执行文件。安装依赖阶段需要包源，安装完成后的 DEMO 不需要外部网络。

完整本地研究环境另行使用 `node scripts/setup-python.mjs --research` 和已核对哈希的私有模型材料；不能把缺失 parity 的 core 结果写成模型通过。

`npm run test:load` 实际生成十万票、百万报价集合并运行一小时。采样间隔超过十五秒或样本不足会失败，机器休眠不算稳定运行。`node node_modules/tsx/dist/cli.mjs scripts/capacity.ts` 补充完整票据关联、余额和真实 Worker 路由的容量测量。两者均是明确标注的合成性能数据。
