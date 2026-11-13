#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ldxp-sync-kit-'));
const kit = path.join(temp, 'ldxp-sync-kit');
const files = [
  'local-sync/sync.mjs', 'local-sync/README.md', 'local-sync/config.example.env',
  'local-sync/build-kit.mjs', 'scripts/local-sync.mjs', 'scripts/push-sync.mjs',
  'scripts/lib/snapshotHash.mjs', 'scripts/lib/shopApiHelpers.mjs',
  'src/config/brand-rules.json', '.agents/skills/ldxp-local-sync/SKILL.md',
  '.agents/skills/ldxp-local-sync/agents/openai.yaml',
  'tests/local-sync.node-check.mjs', 'tests/risk-retry.node-check.mjs', 'tests/workflow.node-check.mjs',
];
try {
  for (const relative of files) {
    const dest = path.join(kit, relative);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(root, relative), dest);
  }
  fs.copyFileSync(path.join(root, 'local-sync/README.md'), path.join(kit, 'README.md'));
  if (fs.existsSync(path.join(root, 'LICENSE'))) fs.copyFileSync(path.join(root, 'LICENSE'), path.join(kit, 'LICENSE'));
  fs.writeFileSync(path.join(kit, 'package.json'), JSON.stringify({ name: 'ldxp-sync-kit', private: true, type: 'module', scripts: { 'sync:local': 'node scripts/local-sync.mjs', test: 'node --test tests/*.node-check.mjs' } }, null, 2) + '\n');
  fs.writeFileSync(path.join(kit, '.gitignore'), 'local-sync/config.env\n.dev.vars\noutput/\n');
  fs.mkdirSync(path.join(root, 'output'), { recursive: true });
  const archive = path.join(root, 'output', 'ldxp-sync-kit.tar.gz');
  execFileSync('tar', ['-czf', archive, '-C', temp, 'ldxp-sync-kit']);
  console.log(`同步包已生成：${archive}（不包含配置和密钥）`);
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
