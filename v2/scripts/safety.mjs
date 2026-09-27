import fs from "node:fs";
import path from "node:path";
import net from "node:net";
export const root = fs.realpathSync(new URL("..", import.meta.url));
export function safeState(candidate, allowed = path.join(root, ".runtime-v2")) {
  const target = path.resolve(candidate),
    base = path.resolve(allowed);
  if (target === base || !target.startsWith(base + path.sep))
    throw Error("LIVE_PATH_PROTECTED");
  let current = target;
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) throw Error("LIVE_PATH_PROTECTED");
    current = parent;
  }
  const actual = fs.realpathSync(current);
  if (actual.toLowerCase() !== current.toLowerCase())
    throw Error("LIVE_PATH_PROTECTED");
  return target;
}
export async function freePort(port) {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once("error", () => reject(Error("PORT_OCCUPIED " + port)));
    s.listen(port, "127.0.0.1", () => s.close(() => resolve(true)));
  });
}
export function modeGuard(mode, host) {
  if (mode !== "DEMO" || host !== "127.0.0.1") throw Error("NETWORK_DISABLED");
}
export function backupGuard() {
  throw Error("CONSISTENT_EXPORT_REQUIRED");
}
