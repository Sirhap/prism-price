import { normalizeCrawlerIp } from "./crawlerAccess";

export interface ProductVerificationEnv {
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
  TURNSTILE_ORIGIN?: string;
}

const ACTION = "prism_product_query";
const COOKIE = "__Host-prism_product_pass";
const WINDOW_MS = 10_000;
const MAX_REQUESTS = 12;
const CHALLENGE_MS = 5 * 60_000;
const PASS_SECONDS = 600;
const MAX_CLIENTS = 10_000;
const encoder = new TextEncoder();
const privateResponse = { "Cache-Control": "private, no-store" };

interface ClientWindow {
  requests: number[];
  challengeUntil: number;
  attempts: number[];
}

function signingKey(secret: string, origin: string) {
  return crypto.subtle.importKey("raw", encoder.encode(`${ACTION}\0${origin}\0${secret}`),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

function cookieValue(request: Request) {
  const prefix = COOKIE + "=";
  return request.headers.get("Cookie")?.split(";").map(part => part.trim())
    .find(part => part.startsWith(prefix))?.slice(prefix.length) || "";
}

async function hasProductPass(request: Request, origin: string, ip: string, secret: string, now: number) {
  const value = cookieValue(request);
  const match = /^(\d{10})\.([A-Za-z0-9+/]{43}=)$/.exec(value);
  if (!match) return false;
  const expiry = Number(match[1]);
  const seconds = Math.floor(now / 1000);
  if (expiry <= seconds || expiry > seconds + PASS_SECONDS) return false;
  const signature = Uint8Array.from(atob(match[2]), character => character.charCodeAt(0));
  return crypto.subtle.verify("HMAC", await signingKey(secret, origin), signature, encoder.encode(`${ip}\0${expiry}`));
}

async function issueProductPass(origin: string, ip: string, secret: string, now: number) {
  const expiry = Math.floor(now / 1000) + PASS_SECONDS;
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", await signingKey(secret, origin), encoder.encode(`${ip}\0${expiry}`)));
  const value = expiry + "." + btoa(String.fromCharCode(...signature));
  return `${COOKIE}=${value}; Path=/; Max-Age=${PASS_SECONDS}; Secure; HttpOnly; SameSite=Lax`;
}

async function readToken(request: Request): Promise<string | null> {
  if (!/^text\/plain(?:\s*;|$)/i.test(request.headers.get("Content-Type") || "") || !request.body) return null;
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let token = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > 2048) {
      await reader.cancel();
      return null;
    }
    token += decoder.decode(value, { stream: true });
  }
  token = (token + decoder.decode()).trim();
  return token || null;
}

/** The origin keeps only bounded per-IP counters. Cookie verification works across process restarts. */
export function createProductVerification({
  now = Date.now,
  siteverify = (request: Request) => fetch(request),
} = {}) {
  const clients = new Map<string, ClientWindow>();
  let verifying = 0;

  return async function productVerification(
    request: Request, url: URL, env: ProductVerificationEnv, authenticatedFullCatalog = false,
  ): Promise<Response | null> {
    const verify = request.method === "POST" && url.pathname === "/api/product-verification";
    const productRead = request.method === "GET" && url.pathname === "/api/products" &&
      !(authenticatedFullCatalog && url.searchParams.get("full") === "1");
    if (!verify && !productRead) return null;
    const siteKey = env.TURNSTILE_SITE_KEY?.trim();
    const secret = env.TURNSTILE_SECRET_KEY?.trim();
    if (!siteKey || !secret) return null;
    // The self-hosted listener is loopback-only and OpenResty overwrites this header.
    const expectedOrigin = env.TURNSTILE_ORIGIN;
    if (expectedOrigin && url.origin !== expectedOrigin &&
        !(url.protocol === "http:" && request.headers.get("X-Forwarded-Proto") === "https" &&
          `https://${url.host}` === expectedOrigin)) return null;
    const origin = expectedOrigin ?? url.origin;
    if (!origin.startsWith("https://")) return null;

    const ip = normalizeCrawlerIp(request.headers.get("CF-Connecting-IP") || "");
    const time = now();
    const key = origin + "|" + ip;
    const existing = clients.get(key);

    if (verify) {
      if (!ip || request.headers.get("Origin") !== origin || !existing || existing.challengeUntil <= time) {
        return Response.json({ code: "PRODUCT_VERIFICATION_NOT_PENDING" }, { status: 403, headers: privateResponse });
      }
      existing.attempts = existing.attempts.filter(at => at > time - 60_000);
      if (existing.attempts.length >= 4 || verifying >= 8) {
        return Response.json({ code: "PRODUCT_VERIFICATION_BUSY" }, { status: 429, headers: privateResponse });
      }
      existing.attempts.push(time);
      verifying++;
      try {
        const token = await readToken(request);
        if (!token) return Response.json({ code: "PRODUCT_VERIFICATION_INVALID" }, { status: 400, headers: privateResponse });
        const result = await siteverify(new Request("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ secret, response: token, remoteip: ip }),
          signal: AbortSignal.timeout(5000),
        }));
        if (!result.ok) throw new Error("Siteverify unavailable");
        const data = await result.json<{ success?: boolean; hostname?: string; action?: string }>();
        if (data.success !== true || data.hostname !== url.hostname || data.action !== ACTION) {
          return Response.json({ code: "PRODUCT_VERIFICATION_INVALID" }, { status: 403, headers: privateResponse });
        }
        return new Response(null, { status: 204, headers: {
          ...privateResponse, "Set-Cookie": await issueProductPass(origin, ip, secret, now()),
        } });
      } catch {
        console.warn(JSON.stringify({ event: "product_turnstile_unavailable" }));
        return Response.json({ code: "PRODUCT_VERIFICATION_UNAVAILABLE" }, { status: 503, headers: privateResponse });
      } finally {
        verifying--;
      }
    }

    if (!ip || await hasProductPass(request, origin, ip, secret, time)) return null;
    // Resolve the counter after the asynchronous cookie check so simultaneous requests share it.
    const client = clients.get(key) ?? { requests: [], challengeUntil: 0, attempts: [] };
    clients.delete(key);
    clients.set(key, client);
    if (clients.size > MAX_CLIENTS) {
      const oldest = clients.keys().next().value;
      if (oldest) clients.delete(oldest);
    }
    if (client.challengeUntil <= time) {
      client.requests = client.requests.filter(at => at > time - WINDOW_MS);
      if (client.requests.length < MAX_REQUESTS) {
        client.requests.push(time);
        return null;
      }
      client.challengeUntil = time + CHALLENGE_MS;
    }
    return Response.json({ code: "PRODUCT_VERIFICATION_REQUIRED", siteKey, action: ACTION }, {
      status: 429, headers: { ...privateResponse, "X-Prism-Verification": "required" },
    });
  };
}

export const checkProductVerification = createProductVerification();
