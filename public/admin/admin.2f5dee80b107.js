const $ = (s) => document.querySelector(s);
const notice = $('#notice');
let noticeTimer, settingsDirty = false;
const panelMeta = { overview:['工作台','快速掌握站点状态，继续常用操作'],sync:['商品同步','使用当前网络，更新店铺商品'],ranking:['店铺管理','查看同步状态、管理店铺与排名'],productPreview:['商品排序','查看商品推荐排序效果'],settings:['站点设置','管理收藏、收录与开店入口'],security:['安全设置','管理密码与同步凭据'] };
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
 const row=document.createElement('article'); row.className='rank-row';
 const main=document.createElement('div'); main.className='shop-manage-main';
 const identity=document.createElement('div'); identity.className='shop-manage-identity';
 const avatar=document.createElement('span'); avatar.className='shop-manage-avatar'; avatar.textContent=(shop.shopName || '店').trim().slice(0,1);
 const info=document.createElement('div'); info.className='rank-row-info';
 const name=document.createElement('strong'); name.textContent=shop.shopName;
 const stats=document.createElement('div'); stats.className='shop-manage-stats';
 const sysLabel=({ldxp:'联动小铺',catfk:'云猫寄售','16688':'16688','acg-faka':'二次元发卡',dujiaoka:'独角数卡',other:'其它平台',unknown:'自建站'})[shop.systemType];
 const chips=[`前台 #${shop.rank||'—'}`,...(shop.manualRank?[`人工 #${shop.manualRank}`]:[]),`★ ${shop.favoriteCount||0} 收藏`,`${shop.productCount||0} 件商品`,...(shop.integrationCode?[`对接码 ${shop.integrationCode}`]:[]),...(sysLabel?[sysLabel]:[])];
 for(const text of chips){const item=document.createElement('span');item.textContent=text;stats.append(item);}
 const date=shop.lastSyncedAt?new Date(shop.lastSyncedAt):null;const sync=document.createElement('small');sync.textContent=`最近同步 ${date&&!Number.isNaN(date.getTime())?date.toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'尚未同步'} · ${({ready:'正常',pending:'待同步',error:'同步异常',manual:'待适配'})[shop.syncState]||'未知'}`;
 info.append(name,stats,sync);identity.append(avatar,info);
 const actions=document.createElement('div');actions.className='shop-manage-actions';
 const open=document.createElement('a');try{const u=new URL(shop.shopUrl);if(['http:','https:'].includes(u.protocol)){open.href=u.href;open.target='_blank';open.rel='noopener noreferrer';open.textContent='访问店铺 ↗';actions.append(open);}}catch{}
 const edit=document.createElement('button');edit.type='button';edit.className='shop-edit-trigger';edit.textContent='管理';edit.setAttribute('aria-label',`管理${shop.shopName}`);actions.append(edit);
 const panel=document.createElement('div');panel.className='shop-editor';panel.hidden=true;
 const title=document.createElement('div');title.className='shop-editor-title';title.textContent='店铺设置';
 const form=document.createElement('form');form.className='shop-editor-form';
 function field(label,type,value,placeholder){const wrap=document.createElement('label');wrap.textContent=label;const input=document.createElement('input');input.type=type;input.value=value;input.placeholder=placeholder||'';wrap.append(input);return [wrap,input];}
 const [rankLabel,rank]=field('人工排名','number',shop.manualRank??'','自然排名');rank.min='1';rank.max='1000000';
 const [codeLabel,code]=field('分销码 / 对接码','text',shop.integrationCode||'','未填写');code.maxLength=128;
 const [countLabel,count]=field('收藏数量','number',shop.favoriteCount??0,'');count.min='0';count.max='1000000000';count.required=true;
 const help=document.createElement('p');help.className='shop-editor-help';help.textContent='排名数字越小越靠前；店名或简介公开标注的对接码优先。';
 const buttons=document.createElement('div');buttons.className='shop-editor-footer';const cancel=document.createElement('button');cancel.type='button';cancel.className='btn btn-secondary';cancel.textContent='取消';const save=document.createElement('button');save.type='submit';save.className='btn btn-primary';save.textContent='保存修改';buttons.append(cancel,save);
 form.append(rankLabel,codeLabel,countLabel,help,buttons);panel.append(title,form);
 edit.addEventListener('click',()=>{panel.hidden=!panel.hidden;edit.setAttribute('aria-expanded',String(!panel.hidden));if(!panel.hidden)rank.focus();});edit.setAttribute('aria-expanded','false');
 cancel.addEventListener('click',()=>{rank.value=shop.manualRank??'';code.value=shop.integrationCode||'';count.value=shop.favoriteCount??0;panel.hidden=true;edit.setAttribute('aria-expanded','false');edit.focus();});
 form.addEventListener('submit',async e=>{e.preventDefault();save.disabled=true;save.textContent='保存中…';try{await api('/api/control/shop-details',{shopId:shop.id,integrationCode:code.value.trim(),favoriteCount:Number(count.value),manualRank:rank.value?Number(rank.value):null});message('店铺设置已保存');await loadShops();}catch(err){message(`保存未完成：${err.message}，请重试`,true);save.disabled=false;save.textContent='重试保存';}});
 const more=document.createElement('div');more.className='shop-manage-more';
 const copy=document.createElement('button');copy.type='button';copy.textContent='复制网址';copy.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(shop.shopUrl);message('店铺网址已复制');}catch{message('复制失败，请手动复制网址',true);}});more.append(copy);
 if(browserSupported(shop.shopUrl)){const syncButton=document.createElement('button');syncButton.type='button';syncButton.textContent='同步此店';syncButton.addEventListener('click',async()=>{syncButton.disabled=true;syncButton.textContent='同步中…';try{const {syncShopFromBrowser}=await import('/browser-shop-preview.mjs');const result=await syncShopFromBrowser(shop.id,shop.shopUrl);message(`同步完成：${result.result.itemCount} 件商品`);await loadShops();}catch(err){message(`同步失败：${err.message}`,true);syncButton.disabled=false;syncButton.textContent='重试同步';}});more.append(syncButton);}
 const remove=document.createElement('button');remove.type='button';remove.className='danger-link';remove.textContent='删除店铺';remove.addEventListener('click',async()=>{if(!confirm(`确定删除“${shop.shopName}”？该操作会删除店铺、商品和历史记录。`))return;remove.disabled=true;try{await api('/api/control/delete-shop',{shopId:shop.id});message('店铺已删除');await loadShops();}catch(err){message(err.message,true);remove.disabled=false;}});more.append(remove);panel.append(more);
 main.append(identity,actions);row.append(main,panel);return row;
}
async function loadShops() {
 const ticket=++listRequest,list=$('#shopResults');list.setAttribute('aria-busy','true');list.style.opacity='.5';
 const filter=$('#rankFilter')?.value||'all',sync=$('#rankSyncFilter')?.value||'all',stock=$('#rankStockFilter')?.value||'all',system=$('#rankSystemFilter')?.value||'all';
 const filtered=Boolean(query||filter!=='all'||sync!=='all'||stock!=='all'||system!=='all');
 if($('#rankResetFilters'))$('#rankResetFilters').hidden=!filtered;
 try{const data=await api(`/api/control/rank-shops?${new URLSearchParams({q:query,page:String(page),sort:$('#rankSort').value,filter,sync,stock,system})}`);if(ticket!==listRequest)return;pages=data.totalPages||1;list.replaceChildren();for(const shop of data.shops)list.append(shopRow(shop));if(!data.shops.length)list.textContent='没有找到符合条件的店铺，试试调整筛选项或关键词';$('#pageInfo').textContent=`第 ${page} / ${pages} 页 · ${data.total} 家店铺`;$('#previousPage').disabled=page<=1;$('#nextPage').disabled=page>=pages;if(!filtered)$('#metricShops').textContent=data.total.toLocaleString();}
 finally{if(ticket===listRequest){list.removeAttribute('aria-busy');list.style.opacity='1';}}
}
async function showDashboard() {$('#loginPanel').hidden=true;$('#dashboard').hidden=false;$('#logout').hidden=false;selectPanel(location.hash.slice(1));try{await Promise.all([loadSettings(),loadShops(),loadVisits()]);}catch(err){message(err.message,true);}}
submitForm('#loginForm',async f=>{await api('/api/control/login',{password:f.elements.password.value});f.reset();notice.hidden=true;await showDashboard();});
submitForm('#settingsForm',async f=>{const data={favoritesEnabled:f.elements.favoritesEnabled.checked,manualRankEnabled:f.elements.manualRankEnabled.checked,submissionsEnabled:f.elements.submissionsEnabled.checked,openStoreUrl:f.elements.openStoreUrl.value,openStoreUrls:Object.fromEntries(['catfk','16688','acg-faka','dujiaoka','other','unknown'].map(key=>[key,f.elements[`store_${key}`].value.trim()]))};await api('/api/control/settings',data);setDirty(false);updateMetrics(data);message('站点设置已保存');await loadShops();});
submitForm('#secretForm',async f=>{await api('/api/control/ingest-secret',{secret:f.elements.secret.value});f.reset();message('同步密钥已更新，请更新同步工具配置');});
submitForm('#passwordForm',async f=>{await api('/api/control/password',{oldPassword:f.elements.oldPassword.value,newPassword:f.elements.newPassword.value});f.reset();$('#dashboard').hidden=true;$('#loginPanel').hidden=false;$('#logout').hidden=true;message('密码已修改，请重新登录');});
$('#logout').addEventListener('click',async()=>{try{await api('/api/control/logout',{});settingsDirty=false;location.reload();}catch(err){message(err.message,true);}});
submitForm('#searchForm',async()=>{query=$('#searchInput').value.trim();page=1;await loadShops();});
submitForm('#productPreviewForm',async()=>{
 const query=$('#productPreviewQuery').value.trim();if(!query)throw new Error('请输入商品搜索词');
 const list=$('#productPreviewResults');list.textContent='正在比较排序…';
 try {const data=await api(`/api/control/product-ranking-preview?${new URLSearchParams({q:query})}`);list.replaceChildren();
 if(!data.items.length){list.textContent='没有找到商品';return;}
 for(const item of data.items){const row=document.createElement('div');row.className='preview-row';const name=document.createElement('strong');name.textContent=`${item.rank}. ${item.name}`;const detail=document.createElement('small');const change=item.previousRank===null?'原排序前 30 名以外':`原第 ${item.previousRank} 名`;detail.textContent=`${change} · 搜索相关度 ${item.textScore ?? "—"} · ${item.shopCount} 家报价 · 推荐加分 ${item.shopBonus ?? 0} · 最低 ¥${item.minPrice}`;row.append(name,detail);list.append(row);}
 } catch(error){list.textContent='预览失败，请重试';throw error;}
});
for(const sel of ['#rankSort','#rankFilter','#rankSyncFilter','#rankStockFilter','#rankSystemFilter'])$(sel)?.addEventListener('change',()=>{page=1;loadShops().catch(err=>message(err.message,true));});
$('#rankResetFilters')?.addEventListener('click',()=>{$('#searchInput').value='';query='';for(const sel of ['#rankFilter','#rankSyncFilter','#rankStockFilter','#rankSystemFilter'])if($(sel))$(sel).value='all';page=1;loadShops().catch(err=>message(err.message,true));});
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
  $('#syncStart').disabled=syncRunning || !!(state && done<total); $('#syncResume').hidden=syncRunning || !state || done>=total; $('#syncStop').hidden=!syncRunning; $('#syncRetryFailed').hidden=syncRunning || !state || done<total || !state.failures?.length;
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
function failureKind(error) {
  const msg=String(error?.message || error);
  if (/403|429|风控|频繁|限流|验证页面|浏览器验证|非.?json/i.test(msg)) return '源站限制或验证';
  if (/超时|timeout|aborted/i.test(msg)) return '网络超时';
  if (/跨域|无法连接|fetch failed|network/i.test(msg)) return '网络或跨域';
  if (/不完整|缺少标识|字段|分页/i.test(msg)) return '数据不完整';
  if (/没有可回传|列表为空/i.test(msg)) return '空商品列表';
  return '其他错误';
}
async function runSync(mode) {
  if(syncRunning) return;
  const start=async () => {
    syncRunning=true; syncPaused=false; renderSync();
    let state=mode === 'resume' ? syncRead() : null;
    const previous=mode === 'retry' ? syncRead() : null;
    try {
      const range=intervals();
      if(!state) { const shops=previous ? (previous.failures || []).map(f=>f.shop) : await listSyncShops(); if(!shops.length) throw new Error('没有可重试的失败店铺'); state={shops,index:0,success:0,failed:0,unsupported:0,elapsed:0,logs:previous ? [...previous.logs,`${new Date().toLocaleString()} · 手动重试失败店铺`] : [],failures:[],...range}; syncSave(state); }
      else { Object.assign(state,range); state.failures ||= []; syncSave(state); }
      const {syncShopFromBrowser}=await import('/browser-shop-preview.mjs');
      let lastRequest=0, lastDelay=0;
      const pacedFetch=async (...args) => { const remaining=lastRequest+lastDelay-Date.now(); if(remaining>0) await new Promise(r=>setTimeout(r,remaining)); if(syncPaused) throw new Error('已暂停'); lastRequest=Date.now(); lastDelay=(state.min+Math.random()*(state.max-state.min))*1000; return fetch(...args); };
      while(state.index<state.shops.length && !syncPaused) {
        const shop=state.shops[state.index], started=Date.now(); let outcome;
        if(!browserSupported(shop.url)) { state.unsupported++; outcome='不支持浏览器同步'; }
        else try { const result=await syncShopFromBrowser(shop.id,shop.url,{fetcher:pacedFetch,wait:async()=>{}}); state.success++; outcome=`成功 · ${result.result.itemCount} 件`; }
        catch(err) { if(syncPaused) break; state.failed++; const kind=failureKind(err); const reason=String(err.message || err).slice(0,200); state.failures.push({shop,kind,reason}); outcome=`失败 · ${kind} · ${reason}`; }
        state.elapsed+=Date.now()-started; state.index++; state.logs.push(`${new Date().toLocaleString()} · ${shop.name} · ${outcome}`); syncSave(state); renderSync();
      }
      if(state.index>=state.shops.length) message('本轮同步完成，请查看记录');
    } catch(err) { message(`同步暂停：${err.message}`,true); }
    finally { syncRunning=false; renderSync(); }
  };
  if (!navigator.locks) { message('当前浏览器不支持同步锁，请使用新版 Chrome 或 Edge',true); return; }
  await navigator.locks.request('prism-browser-sync',{ifAvailable:true},async lock=>{ if(!lock) { message('另一个页面正在同步',true); return; } await start(); });
}
$('#syncStart').addEventListener('click',()=>runSync('new'));
$('#syncResume').addEventListener('click',()=>runSync('resume'));
$('#syncRetryFailed').addEventListener('click',()=>runSync('retry'));
$('#syncStop').addEventListener('click',()=>{syncPaused=true; message('正在暂停当前店铺');});
renderSync();
