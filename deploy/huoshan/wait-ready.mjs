import { setTimeout as delay } from "node:timers/promises";

/** systemd Type=simple is active before workerd has opened its HTTP socket. */
for (let attempt = 0; attempt < 60; attempt += 1) {
  try {
    const response = await fetch("http://127.0.0.1:8787/", { signal: AbortSignal.timeout(1000) });
    await response.body?.cancel();
    if (response.ok) process.exit(0);
  } catch {
    // Only the readiness probe is retried; collection itself is executed once.
  }
  await delay(500);
}
throw new Error("LDXP HTTP service did not become ready");
