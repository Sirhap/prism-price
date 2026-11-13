import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => {
  const migrationsPath = path.join(import.meta.dirname, "migrations");
  const migrations = await readD1Migrations(migrationsPath);

  return {
    test: { include: ["tests/**/*.test.ts"] },
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          d1Databases: { LEGACY_DB: "legacy-schema-reads", LEGACY_WRITE_DB: "legacy-schema-writes" },
          bindings: {
            INGEST_SECRET: "test-ingest-secret",
            TEST_MIGRATIONS: migrations,
          },
        },
      }),
    ],
  };
});
