import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { describeWorkflow, parseArgs } from '../local-sync/sync.mjs';

test('说明模式不访问网络和密钥并准确说明删除条件', () => {
  const result = spawnSync(process.execPath, ['local-sync/sync.mjs', '--explain'], { cwd: process.cwd(), env: { PATH: process.env.PATH, INGEST_SECRET: 'private-test-value' }, encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.doesNotMatch(result.stdout, /private-test-value/);
  const data = JSON.parse(result.stdout);
  assert.match(data.destinations.delete, /店铺不存在/);
  assert.match(data.destinations.delete, /delete-unavailable/);
  assert.match(data.deletion, /单次响应/);
  assert.equal(parseArgs(['--explain']).explain, true);
  assert.match(describeWorkflow().credentials, /不向店铺源站发送/);
});
