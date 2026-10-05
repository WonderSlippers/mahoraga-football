import fs from "node:fs";
import path from "node:path";
import { root } from "./safety.mjs";
// Only the loopback web server holds this capability; never send it to JS.
export function localSessionPlugin(config) {
  return {
    name: "v2-local-session",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.url === "/api/v2/device-access" && req.method === "GET") {
          res.setHeader("Content-Type", "application/json");
          res.setHeader("Cache-Control", "no-store");
          let featureStatus = null;
          try {
            featureStatus = JSON.parse(
              fs.readFileSync(
                path.join(root, ".runtime-v2/research/features/status.json"),
                "utf8",
              ),
            );
          } catch {}
          res.end(
            JSON.stringify({
              data: { lanOrigin: config.lanOrigin || null, featureStatus },
            }),
          );
          return;
        }
        if (req.url !== "/api/v2/session/local") return next();
        if (
          req.method !== "POST" ||
          req.headers.host !== new URL(config.webOrigin).host ||
          req.headers.origin !== config.webOrigin ||
          req.headers["sec-fetch-site"] !== "same-origin" ||
          req.headers["x-v2-local-session"] !== "1" ||
          !["127.0.0.1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress)
        ) {
          res.writeHead(403, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: { code: "LOCAL_SESSION_DENIED" } }));
          return;
        }
        req.resume();
        try {
          const response = await fetch(
            `http://127.0.0.1:${config.apiPort || 8788}/api/v2/session/local`,
            {
              method: "POST",
              headers: {
                Origin: config.webOrigin,
                "Content-Type": "application/json",
                "X-V2-Local-Capability": config.localSessionToken,
              },
              body: "{}",
              signal: AbortSignal.timeout(5000),
            },
          );
          res.statusCode = response.status;
          res.setHeader("Content-Type", "application/json");
          res.setHeader("Cache-Control", "no-store");
          const cookie = response.headers.get("set-cookie");
          if (cookie) res.setHeader("Set-Cookie", cookie);
          res.end(await response.text());
        } catch {
          res.writeHead(503, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: { code: "LOCAL_API_UNAVAILABLE" } }));
        }
      });
    },
  };
}
