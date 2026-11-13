// 兼容旧入口；实际实现和配置位于 local-sync。
export * from '../local-sync/sync.mjs';
import { main } from '../local-sync/sync.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(`[local-sync] ${error.message}`); process.exitCode = 1; });
}
