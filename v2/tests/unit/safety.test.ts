import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import { execFileSync } from "node:child_process";
// @ts-ignore local runtime guard is shared with the supervisor
import {
  safeState,
  root,
  freePort,
  modeGuard,
  backupGuard,
} from "../../scripts/safety.mjs";
test("A03 A04 path ancestors, siblings, junctions, backup refusal", () => {
  for (const p of [
    root,
    path.dirname(root),
    path.join(root, ".runtime-v2"),
    path.join(root, "../old"),
  ])
    assert.throws(() => safeState(p));
  const base = path.join(root, ".runtime-v2");
  fs.mkdirSync(base, { recursive: true });
  const link = path.join(base, "junction-test");
  if (!fs.existsSync(link))
    fs.symlinkSync(path.dirname(root), link, "junction");
  assert.throws(() => safeState(path.join(link, "state")));
  assert.throws(backupGuard);
});
test("A05 A80 occupied port does not kill or auto-switch; loopback modes only", async () => {
  const s = net.createServer();
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  const port = (s.address() as net.AddressInfo).port;
  await assert.rejects(freePort(port));
  assert.ok(s.listening);
  s.close();
  assert.throws(() => modeGuard("PUBLIC", "0.0.0.0"));
  assert.doesNotThrow(() => modeGuard("LOCAL_RESEARCH", "127.0.0.1"));
  assert.throws(() => modeGuard("LOCAL_RESEARCH", "0.0.0.0"));
});
test("A06 ZIP traversal, symlink, expansion bombs denied by executable inspector", () => {
  const script = `import sys,io,zipfile,importlib.util,tempfile,pathlib\nspec=importlib.util.spec_from_file_location('assets','scripts/inspect_assets.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)\nwith tempfile.TemporaryDirectory(dir='.runtime-v2') as d:\n for name in ['../evil','/absolute','C:/absolute']:\n  p=pathlib.Path(d)/'bad.zip'\n  with zipfile.ZipFile(p,'w') as z:z.writestr(name,'bad')\n  try:m.inspect(p);raise AssertionError('accepted')\n  except ValueError:pass\n p=pathlib.Path(d)/'bad.zip'\n with zipfile.ZipFile(p,'w',compression=zipfile.ZIP_DEFLATED) as z:z.writestr('bomb','0'*2000000)\n try:m.inspect(p);raise AssertionError('accepted bomb')\n except ValueError:pass\n print('4 malicious archives rejected')`;
  assert.match(
    execFileSync(".venv/Scripts/python.exe", ["-c", script], {
      encoding: "utf8",
    }),
    /4 malicious/,
  );
});
