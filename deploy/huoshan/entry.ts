import worker from "../../src/index";
import { runSyncBatch } from "../../src/collector/scheduler";

type ServerEnv = Env & { SERVER_CRON_SECRET: string };

/** Self-hosted cron calls await completion so systemd can track failures and overlap. */
export default {
  async fetch(request: Request, env: ServerEnv, ctx: ExecutionContext): Promise<Response> {
    if (new URL(request.url).pathname === "/__server/cron") {
      if (request.method !== "POST" ||
          request.headers.get("Authorization") !== `Bearer ${env.SERVER_CRON_SECRET}`) {
        return new Response("Not found", { status: 404 });
      }
      if (String(env.AUTO_SYNC_ENABLED).toLowerCase() !== "true") {
        return Response.json({ status: "disabled", processedCount: 0 }, { headers: { "Cache-Control": "no-store" } });
      }
      try {
        return Response.json(await runSyncBatch(env, "cron"));
      } catch (error) {
        console.error("server_cron_failed", error);
        return Response.json({ error: "Scheduled sync failed" }, { status: 500 });
      }
    }
    return worker.fetch(request, env, ctx);
  },
};
