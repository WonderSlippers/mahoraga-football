import { spawn } from 'node:child_process';
const child = spawn(process.execPath, ['scripts/runtime.mjs', process.argv[2] || 'dev'], {
  stdio: 'inherit', windowsHide: true,
  env: { ...process.env, V2_MODE: 'LOCAL_RESEARCH', V2_PROFILE: 'research' },
});
child.on('exit', code => { process.exitCode = code ?? 1; });
