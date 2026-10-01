import http from "node:http";
import os from "node:os";

export function privateIPv4(address) {
  if (
    !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(String(address).replace(/^::ffff:/, ""))
  )
    return false;
  const v = String(address)
    .replace(/^::ffff:/, "")
    .split(".")
    .map(Number);
  return (
    v.length === 4 &&
    v.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) &&
    (v[0] === 10 ||
      (v[0] === 172 && v[1] >= 16 && v[1] <= 31) ||
      (v[0] === 192 && v[1] === 168))
  );
}

export async function startLanGateway(port, address) {
  const host =
    address ||
    Object.values(os.networkInterfaces())
      .flat()
      .find(
        (i) =>
          i && !i.internal && i.family === "IPv4" && privateIPv4(i.address),
      )?.address;
  if (!host) return { origin: null, close: async () => {} };
  if (!privateIPv4(host)) throw Error("PRIVATE_LAN_ADDRESS_REQUIRED");
  const origin = `http://${host}:${port}`,
    localOrigin = `http://127.0.0.1:${port}`;
  const allowed = (req) => {
    if (!req.url.startsWith("/") || req.url.startsWith("//")) return false;
    if (
      !privateIPv4(req.socket.remoteAddress) ||
      req.headers.host !== `${host}:${port}`
    )
      return false;
    let path;
    try {
      path = decodeURIComponent(new URL(req.url, origin).pathname);
    } catch {
      return false;
    }
    if (path.startsWith("/internal") || path.includes("\\")) return false;
    if (req.headers.origin && req.headers.origin !== origin) return false;
    if (!["GET", "HEAD"].includes(req.method) && req.headers.origin !== origin)
      return false;
    return true;
  };
  const headers = (req) => {
    const h = { ...req.headers, host: `127.0.0.1:${port}` };
    if (h.origin) h.origin = localOrigin;
    delete h["x-v2-local-capability"];
    // Browsers omit Sec-Fetch headers on private HTTP. Origin and Host were checked above.
    if (req.url === "/api/v2/session/local")
      h["sec-fetch-site"] = "same-origin";
    return h;
  };
  const sockets = new Set();
  const server = http.createServer((req, res) => {
    if (!allowed(req)) {
      res.writeHead(403).end("LAN_REQUEST_DENIED");
      return;
    }
    const proxy = http.request(
      localOrigin + req.url,
      { method: req.method, headers: headers(req) },
      (response) => {
        res.writeHead(response.statusCode, response.headers);
        response.pipe(res);
      },
    );
    proxy.setTimeout(65000, () => proxy.destroy());
    proxy.on("error", () => {
      if (!res.headersSent) res.writeHead(503);
      res.end("LOCAL_SITE_UNAVAILABLE");
    });
    req.pipe(proxy);
  });
  server.on("connection", (s) => {
    sockets.add(s);
    s.on("close", () => sockets.delete(s));
  });
  server.on("upgrade", (req, socket, head) => {
    if (
      !allowed(req) ||
      req.headers.origin !== origin ||
      req.headers["sec-websocket-protocol"] !== "vite-hmr"
    ) {
      socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
      return;
    }
    const proxy = http.request(localOrigin + req.url, {
      headers: headers(req),
    });
    proxy.on("upgrade", (response, upstream, rest) => {
      sockets.add(upstream);
      upstream.on("close", () => sockets.delete(upstream));
      socket.write(
        "HTTP/1.1 101 Switching Protocols\r\n" +
          Object.entries(response.headers)
            .map(([k, v]) => `${k}: ${v}`)
            .join("\r\n") +
          "\r\n\r\n",
      );
      if (rest.length) socket.write(rest);
      if (head.length) upstream.write(head);
      socket.pipe(upstream);
      upstream.pipe(socket);
      socket.on("error", () => upstream.destroy());
      upstream.on("error", () => socket.destroy());
    });
    proxy.on("error", () => socket.destroy());
    proxy.end();
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });
  return {
    origin,
    close: () =>
      new Promise((resolve) => {
        server.close(resolve);
        for (const s of sockets) s.destroy();
        server.closeAllConnections();
      }),
  };
}
