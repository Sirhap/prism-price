/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { applyD1Migrations, env, type D1Migration } from "cloudflare:test";

declare global {
  namespace Cloudflare {
    interface Env {
      LEGACY_DB: D1Database;
      LEGACY_WRITE_DB: D1Database;
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}

/** 独立旧库绑定，不删除或修改其他测试所使用的新 schema 数据库。 */
export async function setupLegacyDatabase(
  database: D1Database = env.LEGACY_DB,
  beforeMigration = "0004",
): Promise<Env> {
  await applyD1Migrations(
    database,
    env.TEST_MIGRATIONS.filter((migration) => migration.name < beforeMigration),
  );
  return { ...env, DB: database };
}
