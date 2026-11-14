import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
test('首页访问统计在三十分钟内去重，跨日和失败后可重试',async()=>{
 const start=source.indexOf('// 同一浏览器 30 分钟内只计一次访问');const end=source.indexOf('/** 首页内的开店引导',start);assert.ok(start>=0&&end>start);const code=source.slice(start,end);
 let now=Date.UTC(2026,0,1),calls=0,ok=true;const map=new Map();const localStorage={getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v)};
 const FakeDate=class extends Date {static now(){return now;}};
 const context=vm.createContext({Date:FakeDate,localStorage,fetch:async()=>{calls++;return {ok};}});
 const run=async()=>{vm.runInContext(code,context);await new Promise(resolve=>setImmediate(resolve));};
 await run();await run();assert.equal(calls,1);now+=1800001;ok=false;await run();await run();assert.equal(calls,3);ok=true;await run();now+=86400000;await run();assert.equal(calls,5);
});
test('复制对接码成功才通知引导，失败不误报',async()=>{
 const start=source.indexOf('async function copyTextWithFeedback(');const end=source.indexOf('/** 生成与店铺名称绑定',start);assert.ok(start>=0&&end>start);const code=source.slice(start,end);
 const events=[],toasts=[];let fails=false;const ctx=vm.createContext({navigator:{clipboard:{writeText:async()=>{if(fails)throw Error('denied');}}},showToast:x=>toasts.push(x),document:{dispatchEvent:e=>events.push(e.type)},CustomEvent:class{constructor(type){this.type=type}}});
 vm.runInContext(code,ctx);await ctx.copyTextWithFeedback('A','对接码');assert.deepEqual(events,['integration-code-copied']);fails=true;await ctx.copyTextWithFeedback('A','对接码');assert.equal(events.length,1);assert.match(toasts.at(-1),/失败/);
});
