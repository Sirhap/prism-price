import { handleCatalogSeo } from "./routes/catalogSeo";
import { withPublicResponseCache, isDailyD1Limit, quotaUnavailable } from "./cache/publicResponseCache";
import { observeD1 } from "./observability/d1Metrics";
import { runSyncBatch } from "./collector/scheduler";
import { handleApiRequest } from "./routes/api";

export default {
  /**
   * HTTP 请求入口：仅接管 /api/*，静态页面资源由 Workers Static Assets 直接分发
   */
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    try {
      if (url.pathname.startsWith("/catalog/")) {
        if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method Not Allowed", { status: 405 });
        return await withPublicResponseCache(request, () => handleCatalogSeo(url, env));
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
      return await env.ASSETS.fetch(request);
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
