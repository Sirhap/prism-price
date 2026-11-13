const response = await fetch("http://127.0.0.1:8787/__server/cron", {
  method: "POST",
  headers: { Authorization: `Bearer ${process.env.SERVER_CRON_SECRET}` },
  signal: AbortSignal.timeout(10 * 60 * 1000),
});
if (!response.ok) throw new Error(`Sync failed: ${response.status} ${await response.text()}`);
console.log(await response.text());
