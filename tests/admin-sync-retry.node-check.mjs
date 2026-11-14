import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../public/admin/admin.js',import.meta.url),'utf8');
function setup(initial,collect){
 const part=source.slice(source.indexOf('// Browser-local checkpoint:')).replace("await import('/browser-shop-preview.mjs')","await loadMock()");
 const entries=new Map();
 const element=id=>{if(!entries.has(id))entries.set(id,{value:id==='#syncMin'?'0.1':id==='#syncMax'?'0.1':'',hidden:false,disabled:false,textContent:'',addEventListener(){},replaceChildren(){},append(){}});return entries.get(id)};
 const storage=new Map([['prism_admin_browser_sync_v1',JSON.stringify(initial)]]);
 const ctx=vm.createContext({$:element,localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},document:{createElement:()=>({textContent:''})},navigator:{locks:{request:async(_name,_opt,cb)=>cb({})}},message(){},api(){throw Error('重试不应获取完整店铺列表')},loadMock:async()=>({syncShopFromBrowser:collect}),fetch(){},setTimeout,URL,Date,Math,console});
 vm.runInContext(part,ctx);return {ctx,entries,read:()=>JSON.parse(storage.get('prism_admin_browser_sync_v1'))};
}
test('后台仅重试失败店铺并记录成功和再次失败',async()=>{
 const success={id:'success',name:'成功店',url:'https://wzyp.cn/shop/success'},a={id:'a',name:'失败甲',url:'https://wzyp.cn/shop/a'},b={id:'b',name:'失败乙',url:'https://wzyp.cn/shop/b'};
 const original={shops:[success,a,b],index:3,success:1,failed:2,unsupported:0,elapsed:1,min:.1,max:.1,logs:['历史记录'],failures:[{shop:a},{shop:b}]};const visited=[];
 const t=setup(original,async(id)=>{visited.push(id);if(id==='b')throw Error('连接源站超时');return {result:{itemCount:3}}});
 await t.ctx.runSync('retry');const state=t.read();assert.deepEqual(visited,['a','b']);assert.equal(state.index,2);assert.equal(state.success,1);assert.equal(state.failed,1);assert.equal(state.failures[0].shop.id,'b');assert.equal(state.failures[0].kind,'网络超时');assert.ok(state.logs.includes('历史记录'));assert.match(state.logs.at(-1),/失败乙/);assert.equal(t.entries.get('#syncRetryFailed').hidden,false);
});
test('无失败项不能发起重试，也不会覆盖原断点',async()=>{
 const initial={shops:[],index:0,success:0,failed:0,unsupported:0,elapsed:0,min:1,max:2,logs:['保留'],failures:[]};let calls=0;const t=setup(initial,async()=>{calls++});await t.ctx.runSync('retry');assert.equal(calls,0);assert.deepEqual(t.read(),initial);
});
