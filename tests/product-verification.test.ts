import { applyD1Migrations, createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { expect, it, vi } from "vitest";
import worker from "../src/index";
import { createProductVerification } from "../src/routes/productVerification";
import { observeD1 } from "../src/observability/d1Metrics";

const origin = "https://verification.example";
const clientIp = "192.0.2.11";
const keys = { TURNSTILE_SITE_KEY: "widget", TURNSTILE_SECRET_KEY: "test-key" };

function request(path: string, init?: RequestInit, ip = clientIp) {
  const headers = new Headers(init?.headers);
  headers.set("CF-Connecting-IP", ip);
  return new Request(origin + path, { ...init, headers });
}

it("仅高频公开商品请求触发，旧访问窗口自动过期", async () => {
  let time = 1_800_000_000_000;
  const gate = createProductVerification({ now: () => time });
  const evaluate = (req: Request, config = keys) => gate(req, new URL(req.url), config, true);
  for (let i = 0; i < 12; i++) expect(await evaluate(request("/api/products"))).toBeNull();
  time += 10_001;
  for (let i = 0; i < 12; i++) expect(await evaluate(request("/api/products"))).toBeNull();
  const result = await evaluate(request("/api/products?offerKey=one"));
  expect(result?.status).toBe(429);
  expect(result?.headers.get("Cache-Control")).toBe("private, no-store");
  expect(await result?.json()).toMatchObject({ code: "PRODUCT_VERIFICATION_REQUIRED", siteKey: "widget", action: "prism_product_query" });
  for (const path of ["/api/products?full=1", "/api/shops?fields=sync", "/api/shops/one/products", "/"]) {
    expect(await evaluate(request(path))).toBeNull();
  }
  expect(await evaluate(request("/api/ingest", { method: "POST" }))).toBeNull();
  expect(await evaluate(request("/api/products", undefined, "192.0.2.12"))).toBeNull();
  expect(await evaluate(request("/api/products"), { ...keys, TURNSTILE_SECRET_KEY: "" })).toBeNull();
});

it("校验来源、限流和服务端结果，短期通行仅对同一 IP 有效", async () => {
  let time = 1_800_000_000_000;
  const verify = vi.fn(async (req: Request) => {
    const data = await req.json<{ remoteip: string; secret: string; response: string }>();
    expect(data.remoteip).toBe(clientIp);
    expect(data.secret).toBe(keys.TURNSTILE_SECRET_KEY);
    return Response.json({ success: true, hostname: "verification.example",
      action: data.response === "valid" ? "prism_product_query" : "different_action" });
  });
  const gate = createProductVerification({ now: () => time, siteverify: verify });
  const read = (headers?: HeadersInit, ip = clientIp) => gate(request("/api/products", { headers }, ip), new URL(origin + "/api/products"), keys);
  const submit = (token: string, from = origin) => {
    const path = "/api/product-verification";
    return gate(request(path, { method: "POST", body: token, headers: { Origin: from, "Content-Type": "text/plain" } }),
      new URL(origin + path), keys);
  };
  expect((await submit("valid"))?.status).toBe(403);
  for (let i = 0; i < 13; i++) await read();
  expect((await submit("valid", "https://other.example"))?.status).toBe(403);
  expect((await submit("x".repeat(2049)))?.status).toBe(400);
  expect((await submit("wrong-action"))?.status).toBe(403);
  const pass = await submit("valid");
  expect(pass?.status).toBe(204);
  const cookie = pass?.headers.get("Set-Cookie") ?? "";
  expect(cookie).toMatch(/^__Host-prism_product_pass=.*; Path=\/; Max-Age=600; Secure; HttpOnly; SameSite=Lax$/);
  const credential = { Cookie: cookie.split(";", 1)[0] };
  expect(await read(credential)).toBeNull();
  expect((await read({ Cookie: credential.Cookie.replace(/.=$/, "x=") }))?.status).toBe(429);
  for (let i = 0; i < 12; i++) expect(await read(credential, "192.0.2.12")).toBeNull();
  expect((await read(credential, "192.0.2.12"))?.status).toBe(429);
  expect((await submit("wrong-action"))?.status).toBe(403);
  expect((await submit("valid"))?.status).toBe(429);
  expect(verify).toHaveBeenCalledTimes(3);
  time += 600_001;
  for (let i = 0; i < 12; i++) expect(await read(credential)).toBeNull();
  expect((await read(credential))?.status).toBe(429);
});

it("Worker 在查询数据库前拒绝高频公开请求", async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  const req = request("/api/products?pageSize=1&facets=0", undefined, "192.0.2.36");
  for (let i = 0; i < 12; i++) {
    const ctx = createExecutionContext();
    expect((await worker.fetch(req, { ...env, ...keys }, ctx)).status).toBe(200);
    await waitOnExecutionContext(ctx);
  }
  const observed = observeD1(env.DB);
  const response = await worker.fetch(req, { ...env, ...keys, DB: observed.db }, createExecutionContext());
  expect(response.headers.get("X-Prism-Verification")).toBe("required");
  expect(observed.cost.queries).toBe(0);
});

it("火山反代以正式 HTTPS 地址校验来源，普通查询参数不能绕过验证", async () => {
  const testOrigin = "https://parity.sirhao.top";
  const config = { ...keys, TURNSTILE_ORIGIN: testOrigin };
  const gate = createProductVerification({
    siteverify: async () => Response.json({ success: true, hostname: "parity.sirhao.top", action: "prism_product_query" }),
  });
  const url = new URL("http://parity.sirhao.top/api/products?full=1");
  const headers = { "CF-Connecting-IP": clientIp, "X-Forwarded-Proto": "https" };
  const product = new Request(url, { headers });
  for (let i = 0; i < 12; i++) expect(await gate(product, url, config)).toBeNull();
  expect((await gate(product, url, config))?.headers.get("X-Prism-Verification")).toBe("required");
  expect(await gate(new Request(url, { headers: { "CF-Connecting-IP": clientIp } }), url, config)).toBeNull();
  const other = new URL("http://other.example/api/products?full=1");
  expect(await gate(new Request(other, { headers }), other, config)).toBeNull();

  const verify = new URL("http://parity.sirhao.top/api/product-verification");
  const post = (origin: string) => new Request(verify, {
    method: "POST", body: "fixture", headers: { ...headers, Origin: origin, "Content-Type": "text/plain" },
  });
  expect((await gate(post("http://parity.sirhao.top"), verify, config))?.status).toBe(403);
  const pass = await gate(post(testOrigin), verify, config);
  expect(pass?.status).toBe(204);
  expect(await gate(new Request(url, {
    headers: { ...headers, Cookie: pass?.headers.get("Set-Cookie")?.split(";", 1)[0] ?? "" },
  }), url, config)).toBeNull();
});
