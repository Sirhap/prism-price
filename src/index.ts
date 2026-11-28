import { handleCatalogSeo } from "./routes/catalogSeo";
import {
  handleLlmsFullTxt,
  handleLlmsTxt,
  handleShardedSitemapXml,
  handleSitemapXml,
} from "./routes/seoAssets";
import { withPublicResponseCache, isDailyD1Limit, quotaUnavailable } from "./cache/publicResponseCache";
import { observeD1 } from "./observability/d1Metrics";
import { runSyncBatch } from "./collector/scheduler";
import { handleApiRequest, isSyncCatalogRead, rejectProductListRequest, verifyAdminSecret } from "./routes/api";
import { handleAdminRoute } from "./routes/admin";
import { checkCrawlerAccess } from "./routes/crawlerAccess";
import { checkProductVerification, type ProductVerificationEnv } from "./routes/productVerification";
import { handleSponsorPublic } from "./routes/sponsors";
import { handleAiRequest } from "./routes/ai";
import { applyHtmlLocale, handleLocaleApi, isLocalizedHtmlPath, resolveRequestLocale } from "./i18n/locale";

const HOME_ASSET_PRELOADS = [
  '</styles.css?v=product-verification>; rel=preload; as=style',
  '</i18n.js?v=ai-assistant-2>; rel=preload; as=script',
  '</select-picker.js?v=20261119-dropdowns>; rel=preload; as=script',
  '</app.js?v=product-verification>; rel=preload; as=script',
].join(", ");

/** Only preload list requests that match the exact default URL built by app.js. */
function homePreloads(url: URL): string {
  for (const key of url.searchParams.keys()) {
    if (key !== "lang" && key !== "mode" && !key.startsWith("utm_")) return HOME_ASSET_PRELOADS;
  }
  const data = url.searchParams.get("mode") === "shop"
    ? "/api/shops?page=1&pageSize=6"
    : "/api/products?hideRecentOutOfStock=1&sort=relevance&page=1&pageSize=6";
  return `${HOME_ASSET_PRELOADS}, <${data}>; rel=preload; as=fetch; crossorigin=anonymous`;
}

export default {
  /**
   * HTTP 请求入口：接管 /api/*、/catalog/*、动态 Sitemap 与 llms.txt，其余静态资源由 Workers Static Assets 分发
   */
  async fetch(request: Request, env: Env & ProductVerificationEnv, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    try {
      const productListRejection = rejectProductListRequest(request, url);
      if (productListRejection) return productListRejection;
      // The full catalog route below independently enforces Bearer authentication.
      const verification = await checkProductVerification(request, url, env, true);
      if (verification) return verification;
      const syncReadWithCredentials = isSyncCatalogRead(request, url) && /^Bearer\s+\S/i.test(request.headers.get("Authorization") || "");
      const crawlerResponse = await checkCrawlerAccess(request, url.pathname, env.DB, ctx,
        syncReadWithCredentials ? async () => (await verifyAdminSecret(request, env)).ok : undefined);
      if (crawlerResponse) return crawlerResponse;
      if (url.pathname === '/go/open-store') return (await handleAdminRoute(request, env)) ?? new Response('Not found', {status:404});
      if (url.pathname === '/admin') return Response.redirect(new URL('/admin/', url).href, 302);
      if (url.pathname.startsWith('/admin/')) {
        const response = await env.ASSETS.fetch(request);
        const headers = new Headers(response.headers);
        headers.set('Cache-Control', 'no-store');
        headers.set('X-Robots-Tag', 'noindex, nofollow');
        return new Response(response.body, {status:response.status,headers});
      }
      if (url.pathname === "/catalog" || url.pathname.startsWith("/catalog/")) {
        if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method Not Allowed", { status: 405 });
        return await withPublicResponseCache(request, () => handleCatalogSeo(url, env));
      }
      if (url.pathname === "/sitemap.xml") {
        if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method Not Allowed", { status: 405 });
        return await withPublicResponseCache(request, () => handleSitemapXml(url, env));
      }
      if (url.pathname === "/sitemap-shops.xml") {
        if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method Not Allowed", { status: 405 });
        return await withPublicResponseCache(request, () => handleShardedSitemapXml("shops", url, env));
      }
      if (url.pathname === "/sitemap-products.xml") {
        if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method Not Allowed", { status: 405 });
        return await withPublicResponseCache(request, () => handleShardedSitemapXml("products", url, env));
      }
      if (url.pathname === "/llms.txt") {
        if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method Not Allowed", { status: 405 });
        return await withPublicResponseCache(request, async () => handleLlmsTxt());
      }
      if (url.pathname === "/llms-full.txt") {
        if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method Not Allowed", { status: 405 });
        return await withPublicResponseCache(request, () => handleLlmsFullTxt(url, env));
      }
      if (url.pathname === "/api/locale") {
        return await handleLocaleApi(request);
      }
      if (url.pathname === "/api/sponsors" || url.pathname.startsWith("/api/sponsors/")) {
        return (await handleSponsorPublic(request, env.DB)) ?? new Response(null, { status: 404 });
      }
      if (url.pathname === "/api/ai") {
        return await handleAiRequest(request, env);
      }
      if (url.pathname.startsWith("/api/")) {
        return await withPublicResponseCache(request, async () => {
          const observed = observeD1(env.DB);
          const startedAt = Date.now();
          let complete = false;
          try {
            const response = await handleApiRequest(request, { ...env, DB: observed.db });
            complete = true;
            const headers = new Headers(response.headers);
            if (syncReadWithCredentials) headers.set("Cache-Control", "private, no-store");
            headers.set("X-D1-Rows-Read", String(observed.cost.rowsRead));
            headers.set("X-D1-Queries", String(observed.cost.queries));
            return new Response(response.body, { status: response.status, headers });
          } finally {
            console.log(JSON.stringify({ event: "d1_request_cost", path: url.pathname,
              complete, queries: observed.cost.queries, rowsRead: observed.cost.rowsRead, rowsWritten: observed.cost.rowsWritten,
              durationMs: Date.now() - startedAt }));
          }
        });
      }
      const assetResponse = await env.ASSETS.fetch(request);
      if ((request.method === "GET" || request.method === "HEAD") && isLocalizedHtmlPath(url.pathname)) {
        const resolved = await resolveRequestLocale(request, { lookupPublicIp: false });
        const preload = url.pathname === "/" && request.method === "GET" ? homePreloads(url) : undefined;
        return applyHtmlLocale(assetResponse, url.pathname, resolved, preload);
      }
      return assetResponse;
    } catch (error) {
      if (isDailyD1Limit(error)) return quotaUnavailable();
      const message = error instanceof Error ? error.message : "Internal server error";
      console.error(
        JSON.stringify({
          event: "unhandled_http_error",
          method: request.method,
          path: url.pathname,
          error: message,
        }),
      );
      return Response.json({ error: message }, { status: 500 });
    }
  },

  /**
   * 自动采集默认关闭，仅在维护人员显式启用后执行定时任务。
   */
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    if (String(env.AUTO_SYNC_ENABLED).toLowerCase() !== "true") {
      console.log(JSON.stringify({ event: "automatic_sync_disabled" }));
      return;
    }
    console.log(
      JSON.stringify({
        event: "cron_triggered",
        cron: controller.cron,
        scheduledTime: new Date(controller.scheduledTime).toISOString(),
      }),
    );
    ctx.waitUntil(runSyncBatch(env, "cron"));
  },
} satisfies ExportedHandler<Env>;
