/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { applyD1Migrations, createExecutionContext, createScheduledController, env, SELF, waitOnExecutionContext } from 'cloudflare:test';
import { beforeAll, expect, it } from 'vitest';
import worker from '../src/index';
import serverWorker from '../deploy/huoshan/entry';
import { observeD1 } from '../src/observability/d1Metrics';

beforeAll(async () => { await applyD1Migrations(env.DB, env.TEST_MIGRATIONS); });

it('默认关闭自动采集时Cloudflare定时入口零数据库访问', async () => {
  const observed=observeD1(env.DB);
  const ctx=createExecutionContext();
  await worker.scheduled(createScheduledController({cron:'0 */4 * * *'}),{...env,DB:observed.db,AUTO_SYNC_ENABLED:'false'},ctx);
  await waitOnExecutionContext(ctx);
  expect(observed.cost.queries).toBe(0);
  expect(observed.cost.rowsWritten).toBe(0);
});

it('服务器定时入口默认关闭且不能绕过独立密钥', async () => {
  const observed=observeD1(env.DB);
  const ctx=createExecutionContext();
  const serverEnv={...env,DB:observed.db,AUTO_SYNC_ENABLED:'false',SERVER_CRON_SECRET:'test-only-cron'};
  const unauthorized=await serverWorker.fetch(new Request('http://localhost/__server/cron',{method:'POST'}),serverEnv,ctx);
  expect(unauthorized.status).toBe(404);
  const disabled=await serverWorker.fetch(new Request('http://localhost/__server/cron',{method:'POST',headers:{Authorization:'Bearer test-only-cron'}}),serverEnv,ctx);
  expect(await disabled.json()).toEqual({status:'disabled',processedCount:0});
  expect(observed.cost.queries).toBe(0);
});

it('自动采集关闭时仍支持管理员推送，匿名写入继续被拒绝', async () => {
  const body=JSON.stringify({shops:[{shopId:'push-only-example',shopUrl:'https://push-only.example/',snapshot:{shopName:'推送收录测试',canonicalUrl:'https://push-only.example/',description:'',telegram:'',shopSellCount:null,salesVisible:false,depositVisible:false,depositMoney:null,items:[]}}]});
  const denied=await SELF.fetch('http://localhost/api/ingest',{method:'POST',headers:{'Content-Type':'application/json'},body});
  expect(denied.status).toBe(401);
  const accepted=await SELF.fetch('http://localhost/api/ingest',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer test-ingest-secret'},body});
  expect(accepted.status).toBe(200);
  expect(await accepted.json()).toMatchObject({processedCount:1,updatedCount:1});
});
