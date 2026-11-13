import { Miniflare, Log, LogLevel, convertV4MiniflareOptions } from "miniflare";
import { resolve } from "node:path";
import { mkdir } from "node:fs/promises";

const root = resolve(import.meta.dirname, "../..");
const state = resolve(process.env.STATE_DIR || resolve(root, "state"));
if (!process.env.INGEST_SECRET || !process.env.SERVER_CRON_SECRET) {
  throw new Error("INGEST_SECRET and SERVER_CRON_SECRET are required");
}
await mkdir(state, { recursive: true });
const mf = new Miniflare(convertV4MiniflareOptions({
  log: new Log(LogLevel.INFO),
  host: process.env.HOST || "127.0.0.1",
  port: Number(process.env.PORT || 8787),
  cf: false,
  resourcePersistencePath: state,
  workers: [{
    name: "ldxp",
    modules: true,
    scriptPath: resolve(import.meta.dirname, "worker.mjs"),
    compatibilityDate: "2026-08-22",
    compatibilityFlags: ["nodejs_compat"],
    d1Databases: { DB: "ldxp-self-hosted" },
    bindings: {
      INGEST_SECRET: process.env.INGEST_SECRET,
      SERVER_CRON_SECRET: process.env.SERVER_CRON_SECRET,
      SYNC_BATCH_SIZE: process.env.SYNC_BATCH_SIZE || "3",
      AUTO_SYNC_ENABLED: process.env.AUTO_SYNC_ENABLED || "false",
      STALE_DAYS_THRESHOLD: "30",
    },
    assets: {
      directory: resolve(root, "public"),
      binding: "ASSETS",
      run_worker_first: true,
      routerConfig: { has_user_worker: true },
    },
  }],
}));
await mf.ready;
// Materialize the D1 SQLite file before the offline import on first installation.
await (await mf.getD1Database("DB")).prepare("SELECT 1").all();
console.log("ldxp_ready", String(await mf.ready));
if (process.env.INIT_ONLY === "1") {
  await mf.dispose();
  process.exit(0);
}
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await mf.dispose();
  process.exit(0);
}
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
