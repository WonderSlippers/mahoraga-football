import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import crypto from "node:crypto";
// @ts-ignore runtime gateway
import { privateIPv4, startLanGateway } from "../../scripts/lan-gateway.mjs";
test("LAN gateway recognizes only private IPv4 networks", () => {
  for (const address of [
    "10.1.2.3",
    "172.16.1.1",
    "172.31.255.255",
    "192.168.2.123",
    "::ffff:192.168.1.1",
  ])
    assert.equal(privateIPv4(address), true);
  for (const address of [
    "127.0.0.1",
    "8.8.8.8",
    "172.32.1.1",
    "192.168.2.999",
    "::1",
    "192.168.2",
    "192.168.2.1.evil",
  ])
    assert.equal(privateIPv4(address), false);
});
test("real LAN proxy rejects foreign origins, host spoofing and internal routes and only forwards validated requests", async () => {
  const server = http.createServer((req, res) =>
    res.end(
      JSON.stringify({
        host: req.headers.host,
        origin: req.headers.origin,
        capability: req.headers["x-v2-local-capability"] || null,
      }),
    ),
  );
  await new Promise<void>((resolve) =>
    server.listen(crypto.randomInt(20000, 30000), "127.0.0.1", resolve),
  );
  const port = (server.address() as any).port;
  const gateway = await startLanGateway(port);
  assert.ok(
    gateway.origin,
    "A private LAN interface is required for this runtime test",
  );
  try {
    const response = await fetch(gateway.origin + "/api/test", {
      method: "POST",
      headers: {
        Origin: gateway.origin,
        "X-V2-Local-Capability": "never-forward",
      },
      body: "{}",
    });
    assert.equal(response.status, 200);
    const forwarded: any = await response.json();
    assert.equal(forwarded.host, "127.0.0.1:" + port);
    assert.equal(forwarded.origin, "http://127.0.0.1:" + port);
    assert.equal(forwarded.capability, null);
    for (const path of [
      "http://evil.example/api/test",
      "//evil.example/api/test",
    ]) {
      const status = await new Promise<number>((resolve, reject) => {
        const request = http.request(gateway.origin, { path }, (response) => {
          response.resume();
          resolve(response.statusCode!);
        });
        request.on("error", reject);
        request.end();
      });
      assert.equal(status, 403);
    }
    for (const [url, options] of [
      [gateway.origin + "/internal/v2/model-jobs/claim", {}],
      [gateway.origin + "/api/test", { method: "POST" }],
      [
        gateway.origin + "/api/test",
        { headers: { Origin: "https://evil.example" } },
      ],
      [gateway.origin + "/api/test", { headers: { Host: "evil.example" } }],
    ] as any[])
      if (options.headers?.Host) {
        const status = await new Promise<number>((resolve, reject) => {
          const request = http.request(url, options, (response) => {
            response.resume();
            resolve(response.statusCode!);
          });
          request.on("error", reject);
          request.end();
        });
        assert.equal(status, 403);
      } else
        assert.equal(
          (await fetch(url, options)).status,
          403,
          JSON.stringify({ url, options }),
        );
  } finally {
    await gateway.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
