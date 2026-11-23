import { execFile } from 'node:child_process';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const cli = fileURLToPath(new URL('../scripts/sync-from-qizhang.mjs', import.meta.url));
const run = promisify(execFile);

test('Qizhang 导入读取目标清单中断时报告页码和状态，并且不写入', async () => {
  const requests = [];
  const server = createServer((req, res) => {
    requests.push([req.method, req.url, req.headers.authorization]);
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/upstream/shops') {
      return res.end(JSON.stringify({ shops: [{
        id: 'fixture-shop', shopName: 'Fixture Shop', shopUrl: 'https://catfk.com/shop/fixture-shop',
      }] }));
    }
    if (req.url === '/api/shops?page=1&pageSize=100') {
      return res.end(JSON.stringify({ shops: [], totalPages: 2 }));
    }
    if (req.url === '/api/shops?page=2&pageSize=100') {
      res.statusCode = 500;
      return res.end('{}');
    }
    res.end('{"upserted":1}');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const apiBase = `http://127.0.0.1:${server.address().port}`;
    await assert.rejects(run(process.execPath, [cli], {
      env: { ...process.env, API_BASE: apiBase, UPSTREAM_SHOPS_URL: `${apiBase}/upstream/shops`, INGEST_SECRET: 'test-secret' },
      timeout: 5000,
    }), { code: 1, stderr: /第 2 页失败：HTTP 500/ });
    assert.deepEqual(requests, [
      ['GET', '/upstream/shops', undefined],
      ['GET', '/api/shops?page=1&pageSize=100', 'Bearer test-secret'],
      ['GET', '/api/shops?page=2&pageSize=100', 'Bearer test-secret'],
    ]);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
