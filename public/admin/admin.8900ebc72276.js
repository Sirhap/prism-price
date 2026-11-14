const $ = (s) => document.querySelector(s);
const notice = $('#notice');
let noticeTimer, settingsDirty = false;
const panelMeta = { overview:['工作台','快速掌握站点状态，继续常用操作'],sync:['商品同步','使用当前网络，更新店铺商品'],ranking:['店铺排名','管理人工推荐与自然排名'],settings:['站点设置','管理收藏、收录与开店入口'],security:['安全设置','管理密码与同步凭据'] };
function message(text, error = false) { clearTimeout(noticeTimer); notice.textContent=text;notice.dataset.error=String(error);notice.hidden=false; if(!error) noticeTimer=setTimeout(()=>notice.hidden=true,4500); }
function selectPanel(key) {
  if(!panelMeta[key]) key='overview';
  document.querySelectorAll('.admin-panel').forEach(panel=>panel.hidden=panel.id!==`panel-${key}`);
  document.querySelectorAll('.admin-nav-item').forEach(button=>{ if(button.dataset.panel===key)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current'); });
  $('#panelTitle').textContent=panelMeta[key][0];$('#panelDescription').textContent=panelMeta[key][1];
  history.replaceState(null,'',`#${key}`);
}
document.addEventListener('click',e=>{const button=e.target.closest('[data-panel]');if(button)selectPanel(button.dataset.panel);});
window.addEventListener('hashchange',()=>selectPanel(location.hash.slice(1)));
async function api(path,data) {
  const res=await fetch(path,data===undefined?{cache:'no-store'}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data),cache:'no-store'});
  const result=await res.json();if(!res.ok)throw new Error(result.error||'请求失败');return result;
}
function submitForm(selector,action) {
  $(selector).addEventListener('submit',async e=>{e.preventDefault();const form=e.currentTarget,button=form.querySelector('button[type=submit]');if(button.disabled)return;const label=button.textContent;button.disabled=true;button.textContent='处理中…';form.setAttribute('aria-busy','true');try{await action(form);}catch(err){message(err.message,true);}finally{button.textContent=label;button.disabled=false;form.removeAttribute('aria-busy');}});
}
let page=1,pages=1,query='',listRequest=0;
function setDirty(value) {settingsDirty=value;$('#settingsSaveHint').textContent=value?'有未保存的修改':'设置已与服务器同步';}
async function loadSettings() {
  const data=await api('/api/control/settings'), f=$('#settingsForm');
  for(const k of ['favoritesEnabled','manualRankEnabled','submissionsEnabled'])f.elements[k].checked=data[k];
  f.elements.openStoreUrl.value=data.openStoreUrl; for(const key of ['catfk','16688','acg-faka','dujiaoka','other','unknown'])f.elements[`store_${key}`].value=data.openStoreUrls?.[key] || '';setDirty(false);updateMetrics(data);
}
async function loadVisits() {
  try {
    const data=await api('/api/control/visits'); $('#metricVisits').textContent=Number(data.todayViews).toLocaleString();
    const list=$('#visitHistory'); list.replaceChildren();
    if(!data.days.length){list.textContent='暂无访问记录';return;}
    for(const item of data.days){const row=document.createElement('div');row.className='visit-row';const day=document.createElement('span');day.textContent=item.day;const count=document.createElement('strong');count.textContent=`${Number(item.page_views).toLocaleString()} 次`;row.append(day,count);list.append(row);}
  } catch { $('#metricVisits').textContent='暂不可用';$('#visitHistory').textContent='访问统计暂不可用'; }
}
function updateMetrics(data) {$('#metricFavorites').textContent=data.favoritesEnabled?'已开启':'已关闭';$('#metricSubmissions').textContent=data.submissionsEnabled?'接受提交':'暂停收录';}
$('#settingsForm').addEventListener('input',()=>setDirty(true));
window.addEventListener('beforeunload',e=>{if(settingsDirty){e.preventDefault();e.returnValue='';}});
function shopRow(shop) {
 const row=document.createElement('div');row.className='rank-row';
 const info=document.createElement('div');info.className='rank-row-info';
 const name=document.createElement('strong');name.textContent=shop.shopName;
 const details=document.createElement('small');details.textContent=`前台 #${shop.rank||'—'} · ${shop.favoriteCount||0} 收藏 · ${shop.productCount||0} 件商品`;
 const url=document.createElement('small');url.textContent=shop.shopUrl;info.append(name,details,url);
 const edit=document.createElement('form');edit.className='rank-edit';
 const input=document.createElement('input');input.type='number';input.min='1';input.max='1000000';input.placeholder='自然排名';input.setAttribute('aria-label',`${shop.shopName}人工排名`);input.value=shop.manualRank??'';
 const save=document.createElement('button');save.type='submit';save.className='btn btn-secondary';save.textContent='保存';save.disabled=true;
 input.addEventListener('input',()=>save.disabled=input.value===String(shop.manualRank??''));
 edit.append(input,save);edit.addEventListener('submit',async e=>{e.preventDefault();if(save.disabled)return;save.disabled=true;save.textContent='保存中…';try{await api('/api/control/rank',{shopId:shop.id,rank:input.value?Number(input.value):null});message('排名已保存');await loadShops();}catch(err){message(err.message,true);save.textContent='重试';save.disabled=false;}});row.append(info,edit);return row;
}
async function loadShops() {
 const ticket=++listRequest,list=$('#shopResults');list.setAttribute('aria-busy','true');list.style.opacity='.5';
 try{const data=await api(`/api/control/rank-shops?${new URLSearchParams({q:query,page:String(page),sort:$('#rankSort').value})}`);if(ticket!==listRequest)return;pages=data.totalPages||1;list.replaceChildren();for(const shop of data.shops)list.append(shopRow(shop));if(!data.shops.length)list.textContent='没有找到店铺，试试其他名称或网址';$('#pageInfo').textContent=`第 ${page} / ${pages} 页 · ${data.total} 家店铺`;$('#previousPage').disabled=page<=1;$('#nextPage').disabled=page>=pages;if(!query)$('#metricShops').textContent=data.total.toLocaleString();}
 finally{if(ticket===listRequest){list.removeAttribute('aria-busy');list.style.opacity='1';}}
}
async function showDashboard() {$('#loginPanel').hidden=true;$('#dashboard').hidden=false;$('#logout').hidden=false;selectPanel(location.hash.slice(1));try{await Promise.all([loadSettings(),loadShops(),loadVisits()]);}catch(err){message(err.message,true);}}
submitForm('#loginForm',async f=>{await api('/api/control/login',{password:f.elements.password.value});f.reset();notice.hidden=true;await showDashboard();});
submitForm('#settingsForm',async f=>{const data={favoritesEnabled:f.elements.favoritesEnabled.checked,manualRankEnabled:f.elements.manualRankEnabled.checked,submissionsEnabled:f.elements.submissionsEnabled.checked,openStoreUrl:f.elements.openStoreUrl.value,openStoreUrls:Object.fromEntries(['catfk','16688','acg-faka','dujiaoka','other','unknown'].map(key=>[key,f.elements[`store_${key}`].value.trim()]))};await api('/api/control/settings',data);setDirty(false);updateMetrics(data);message('站点设置已保存');await loadShops();});
submitForm('#secretForm',async f=>{await api('/api/control/ingest-secret',{secret:f.elements.secret.value});f.reset();message('同步密钥已更新，请更新同步工具配置');});
submitForm('#passwordForm',async f=>{await api('/api/control/password',{oldPassword:f.elements.oldPassword.value,newPassword:f.elements.newPassword.value});f.reset();$('#dashboard').hidden=true;$('#loginPanel').hidden=false;$('#logout').hidden=true;message('密码已修改，请重新登录');});
$('#logout').addEventListener('click',async()=>{try{await api('/api/control/logout',{});settingsDirty=false;location.reload();}catch(err){message(err.message,true);}});
submitForm('#searchForm',async()=>{query=$('#searchInput').value.trim();page=1;await loadShops();});
$('#rankSort').addEventListener('change',()=>{page=1;loadShops().catch(err=>message(err.message,true));});
$('#previousPage').addEventListener('click',()=>{if(page>1){page--;loadShops().catch(err=>message(err.message,true));}});
$('#nextPage').addEventListener('click',()=>{if(page<pages){page++;loadShops().catch(err=>message(err.message,true));}});
api('/api/control/session').then(showDashboard).catch(()=>{});

// Browser-local checkpoint: no credentials or product snapshots are retained.
const syncKey = 'prism_admin_browser_sync_v1';
let syncRunning = false, syncPaused = false;
const syncRead = () => { try { return JSON.parse(localStorage.getItem(syncKey) || 'null'); } catch { return null; } };
const syncSave = (state) => localStorage.setItem(syncKey, JSON.stringify(state));
const elapsed = ms => { const s=Math.floor(ms/1000); return `${Math.floor(s/3600)}时${Math.floor(s%3600/60)}分${s%60}秒`; };
function renderSync() {
  const state=syncRead(); const done=state?.index || 0, total=state?.shops?.length || 0;
  $('#syncProgress').max=Math.max(total,1); $('#syncProgress').value=done;
  $('#syncStatus').textContent=state ? `${syncRunning?'正在同步':done<total?'已暂停':'已完成'} · ${done} / ${total} 家 · 成功 ${state.success} · 失败 ${state.failed} · 不支持 ${state.unsupported} · 耗时 ${elapsed(state.elapsed || 0)}` : '尚未开始';
  $('#overviewSync').textContent=state ? `${syncRunning?'同步中':done<total?'上次暂停':'上轮完成'} · ${done} / ${total} 家，点击查看进度` : '从当前网络更新商品，支持断点续跑';
  $('#syncMin').disabled=syncRunning; $('#syncMax').disabled=syncRunning;
  $('#syncStart').disabled=syncRunning || !!(state && done<total); $('#syncResume').hidden=syncRunning || !state || done>=total; $('#syncStop').hidden=!syncRunning;
  const list=$('#syncLog'); list.replaceChildren(); for (const line of [...(state?.logs || [])].reverse()) { const li=document.createElement('li'); li.textContent=line; list.append(li); }
  if(state && !syncRunning) { $('#syncMin').value=state.min; $('#syncMax').value=state.max; }
}
function intervals() {
  const min=Number($('#syncMin').value), max=Number($('#syncMax').value);
  if (!Number.isFinite(min)||!Number.isFinite(max)||min<0.1||max>60||min>max) throw new Error('间隔须为 0.1～60 秒，且最小值不能大于最大值');
  return {min,max};
}
async function listSyncShops() {
  const data=await api('/api/control/sync-shops');
  return data.shops;
}
function browserSupported(url) { try { const u=new URL(url); return ['wzyp.cn','pay.ldxp.cn','catfk.com','www.catfk.com'].includes(u.hostname.toLowerCase()) && /^\/shop\/[a-zA-Z0-9_-]+\/?$/.test(u.pathname); } catch { return false; } }
async function runSync(resume) {
  if(syncRunning) return;
  const start=async () => {
    syncRunning=true; syncPaused=false; renderSync();
    let state=resume ? syncRead() : null;
    try {
      const range=intervals();
      if(!state) { state={shops:await listSyncShops(),index:0,success:0,failed:0,unsupported:0,elapsed:0,logs:[],...range}; syncSave(state); }
      else { Object.assign(state,range); syncSave(state); }
      const {syncShopFromBrowser}=await import('/browser-shop-preview.mjs');
      let lastRequest=0, lastDelay=0;
      const pacedFetch=async (...args) => { const remaining=lastRequest+lastDelay-Date.now(); if(remaining>0) await new Promise(r=>setTimeout(r,remaining)); if(syncPaused) throw new Error('已暂停'); lastRequest=Date.now(); lastDelay=(state.min+Math.random()*(state.max-state.min))*1000; return fetch(...args); };
      while(state.index<state.shops.length && !syncPaused) {
        const shop=state.shops[state.index], started=Date.now(); let outcome;
        if(!browserSupported(shop.url)) { state.unsupported++; outcome='不支持浏览器同步'; }
        else try { const result=await syncShopFromBrowser(shop.id,shop.url,{fetcher:pacedFetch,wait:async()=>{}}); state.success++; outcome=`成功 · ${result.result.itemCount} 件`; }
        catch(err) { if(syncPaused) break; state.failed++; outcome=`失败 · ${String(err.message || err).slice(0,200)}`; }
        state.elapsed+=Date.now()-started; state.index++; state.logs.push(`${new Date().toLocaleString()} · ${shop.name} · ${outcome}`); syncSave(state); renderSync();
      }
      if(state.index>=state.shops.length) message('本轮同步完成，请查看记录');
    } catch(err) { message(`同步暂停：${err.message}`,true); }
    finally { syncRunning=false; renderSync(); }
  };
  if (!navigator.locks) { message('当前浏览器不支持同步锁，请使用新版 Chrome 或 Edge',true); return; }
  await navigator.locks.request('prism-browser-sync',{ifAvailable:true},async lock=>{ if(!lock) { message('另一个页面正在同步',true); return; } await start(); });
}
$('#syncStart').addEventListener('click',()=>runSync(false));
$('#syncResume').addEventListener('click',()=>runSync(true));
$('#syncStop').addEventListener('click',()=>{syncPaused=true; message('正在暂停当前店铺');});
renderSync();
