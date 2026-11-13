#!/usr/bin/env node
import fs from 'node:fs';
import { loadConfig } from '../local-sync/sync.mjs';

/** 指定名单逐店触发已部署的 16688 适配器；无名单时不执行。 */
async function main() {
  const args=process.argv.slice(2);
  if (args.includes('--help')) { console.log('用法: node scripts/sync-16688.mjs --ids=文件 [--apply] [--resume]；文件为店铺 ID 字符串数组'); return; }
  const pathArg=args.find(a=>a.startsWith('--ids='));
  if (!pathArg || args.some(a=>!a.startsWith('--ids=') && a!=='--apply' && a!=='--resume')) throw new Error('请提供 --ids=文件；未知参数不被接受');
  const ids=JSON.parse(fs.readFileSync(pathArg.slice(6),'utf8'));
  if (!Array.isArray(ids) || !ids.length || ids.some(x=>typeof x!=='string'||!x.trim())) throw new Error('店铺名单必须为非空 ID 字符串数组');
  const unique=[...new Set(ids)];const apply=args.includes('--apply'), resume=args.includes('--resume');
  if (resume&&!apply) throw new Error('--resume 需要 --apply');
  const checkpoint='output/sync-16688-checkpoint.json';
  const cfg=loadConfig(); if (apply&&!cfg.secret) throw new Error('缺少 INGEST_SECRET');
  let done={};if(resume){const saved=JSON.parse(fs.readFileSync(checkpoint,'utf8'));if(saved.apiBase!==cfg.apiBase||JSON.stringify(saved.ids)!==JSON.stringify(unique)) throw new Error('断点目标或名单不匹配');done=saved.done;}
  let updated=0,skipped=0,failed=0;console.log(`[16688] ${apply?'正式同步':'预览名单'}：${unique.length} 家`);
  if(!apply)return;
  fs.mkdirSync('output',{recursive:true});
  for (const id of unique) {
    if(done[id]){skipped++;continue;}
    try {
      const res=await fetch(cfg.apiBase.replace(/\/+$/,'')+'/api/sync',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${cfg.secret}`},body:JSON.stringify({shopId:id}),signal:AbortSignal.timeout(45000),redirect:'error'});
      if(!res.ok) throw new Error(`HTTP ${res.status}`);
      const result=await res.json();const outcome=result.outcomes?.find(x=>x.shopId===id);
      if(!outcome||!['updated','unchanged'].includes(outcome.status))throw new Error(outcome?.error || '目标未确认成功');
      done[id]=true;fs.writeFileSync(checkpoint+'.tmp',JSON.stringify({apiBase:cfg.apiBase,ids:unique,done},null,2),{mode:0o600});fs.renameSync(checkpoint+'.tmp',checkpoint);
      updated++;console.log(`[16688] ${id}: ${outcome.status} 商品 ${outcome.itemCount}`);
    }catch(e){failed++;console.warn(`[16688] ${id}: ${e.message}`);if(/HTTP (401|403|429)/.test(e.message))break;}
    await new Promise(r=>setTimeout(r,2000+Math.floor(Math.random()*2001)));
  }
  console.log(JSON.stringify({total:unique.length,processed:updated,resumed:skipped,failed}));if(failed)process.exitCode=1;
}
main().catch(e=>{console.error(`[16688] ${e.message}`);process.exitCode=1;});
