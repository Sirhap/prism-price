const $ = (s) => document.querySelector(s);
const notice = $('#notice');
let noticeTimer, settingsDirty = false;
const panelMeta = { overview:['工作台','全站运行指标一览'],sync:['商品同步','使用当前网络，更新店铺商品'],ranking:['店铺管理','查看同步状态、管理店铺与排名'],settings:['站点设置','管理收藏、收录与开店入口'],security:['安全设置','管理密码与同步凭据'] };
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
function formatBjTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
}
function fillRecentDays(days, todayStr) {
  const map = new Map((days || []).map(item => [item.day, Number(item.pageViews ?? item.page_views ?? 0)]));
  const base = todayStr ? new Date(`${todayStr}T00:00:00Z`) : new Date(Date.now() + 8 * 3600000);
  const list = [];
  for (let i = 29; i >= 0; i--) {
    const day = new Date(base.getTime() - i * 86400000).toISOString().slice(0, 10);
    list.push({ day, pageViews: map.get(day) || 0, isToday: day === todayStr });
  }
  return list;
}
function jumpToRanking({ filter = 'all', sync = 'all', stock = 'all', system = 'all' } = {}) {
  if ($('#searchInput')) $('#searchInput').value = '';
  query = '';
  if ($('#rankFilter')) $('#rankFilter').value = filter;
  if ($('#rankSyncFilter')) $('#rankSyncFilter').value = sync;
  if ($('#rankStockFilter')) $('#rankStockFilter').value = stock;
  if ($('#rankSystemFilter')) $('#rankSystemFilter').value = system;
  page = 1;
  selectPanel('ranking');
  loadShops().catch(err => message(err.message, true));
}
function renderVisitLogs(logs) {
  const wrap = $('#visitRecentLogs');
  if (!wrap) return;
  wrap.replaceChildren();
  if (!logs || !logs.length) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.textContent = '暂无访问明细记录（有前台访问产生后将实时记录 IP、地区与设备）';
    wrap.append(empty);
    return;
  }
  const table = document.createElement('table');
  table.className = 'visit-logs-table';
  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  for (const title of ['访问时间（北京时间）', 'IP 地址', '地区', '设备终端']) {
    const th = document.createElement('th');
    th.textContent = title;
    headRow.append(th);
  }
  thead.append(headRow);
  const tbody = document.createElement('tbody');
  for (const log of logs) {
    const tr = document.createElement('tr');
    const tdTime = document.createElement('td');
    tdTime.textContent = formatBjTime(log.visitedAt);
    const tdIp = document.createElement('td');
    const code = document.createElement('code');
    code.textContent = log.ip || 'unknown';
    tdIp.append(code);
    const tdLoc = document.createElement('td');
    tdLoc.textContent = log.location || '未知地区';
    const tdDev = document.createElement('td');
    tdDev.textContent = [log.device, log.os, log.browser].filter(Boolean).join(' · ') || '未知设备';
    tr.append(tdTime, tdIp, tdLoc, tdDev);
    tbody.append(tr);
  }
  table.append(thead, tbody);
  wrap.append(table);
}
function renderBreakdownRow({ label, countText, ratio, tone = 'indigo', subText = '', onClick }) {
  const row = document.createElement(onClick ? 'button' : 'div');
  if (onClick) row.type = 'button';
  row.className = `breakdown-row tone-${tone}${onClick ? ' is-clickable' : ''}`;
  const head = document.createElement('div');
  head.className = 'breakdown-head';
  const nameEl = document.createElement('span');
  nameEl.className = 'breakdown-label';
  nameEl.textContent = label;
  const valEl = document.createElement('strong');
  valEl.className = 'breakdown-value';
  valEl.textContent = countText;
  head.append(nameEl, valEl);
  const track = document.createElement('div');
  track.className = 'breakdown-track';
  const fill = document.createElement('span');
  fill.className = 'breakdown-fill';
  fill.style.width = `${Math.max(ratio > 0 ? 3 : 0, Math.min(100, ratio))}%`;
  track.append(fill);
  row.append(head, track);
  if (subText) {
    const sub = document.createElement('small');
    sub.className = 'breakdown-sub';
    sub.textContent = subText;
    row.append(sub);
  }
  if (onClick) row.addEventListener('click', onClick);
  return row;
}
function renderOverviewVisits(visits) {
  const todayViews = Number(visits?.todayViews || 0);
  const yesterdayViews = Number(visits?.yesterdayViews || 0);
  const last7 = Number(visits?.last7DaysViews || 0);
  const last30 = Number(visits?.last30DaysViews || 0);
  const avg = Number(visits?.avgDailyViews || 0);
  const diff = todayViews - yesterdayViews;
  const diffText = diff === 0 ? '与昨日持平' : (diff > 0 ? `较昨日 +${diff.toLocaleString()}` : `较昨日 ${diff.toLocaleString()}`);

  $('#metricVisits').textContent = todayViews.toLocaleString();
  if ($('#metricVisitsSub')) $('#metricVisitsSub').textContent = `昨日 ${yesterdayViews.toLocaleString()} 次 · ${diffText}`;
  if ($('#metricVisits30d')) $('#metricVisits30d').textContent = last30.toLocaleString();
  if ($('#metricVisits30dSub')) {
    const peakText = visits?.peakDay ? `峰值 ${visits.peakDay.day.slice(5)} (${Number(visits.peakDay.pageViews).toLocaleString()})` : '近 7 天暂无记录';
    $('#metricVisits30dSub').textContent = `近 7 天 ${last7.toLocaleString()} · ${peakText}`;
  }

  const summaryEl = $('#visitSummaryStats');
  if (summaryEl) {
    summaryEl.replaceChildren();
    for (const [label, value] of [
      ['今日', `${todayViews.toLocaleString()} 次`],
      ['近 7 天', `${last7.toLocaleString()} 次`],
      ['近 30 天', `${last30.toLocaleString()} 次`],
      ['有记录日均', `${avg.toLocaleString()} 次`],
    ]) {
      const chip = document.createElement('div');
      chip.className = 'mini-stat';
      const k = document.createElement('small');
      k.textContent = label;
      const v = document.createElement('strong');
      v.textContent = value;
      chip.append(k, v);
      summaryEl.append(chip);
    }
  }

  const chart = $('#visitTrendChart');
  if (chart) {
    chart.replaceChildren();
    const series = fillRecentDays(visits?.days || [], visits?.today);
    const maxViews = Math.max(1, ...series.map(item => item.pageViews));
    for (const item of series) {
      const barWrap = document.createElement('div');
      barWrap.className = `trend-bar${item.isToday ? ' is-today' : ''}${item.pageViews === 0 ? ' is-zero' : ''}`;
      barWrap.title = `${item.day}：${item.pageViews.toLocaleString()} 次访问`;
      barWrap.setAttribute('aria-label', `${item.day} ${item.pageViews} 次访问`);
      const bar = document.createElement('span');
      bar.className = 'trend-bar-fill';
      const pct = item.pageViews > 0 ? Math.max(8, Math.round((item.pageViews / maxViews) * 100)) : 4;
      bar.style.height = `${pct}%`;
      const dayLabel = document.createElement('small');
      dayLabel.textContent = item.isToday ? '今' : item.day.slice(8);
      barWrap.append(bar, dayLabel);
      chart.append(barWrap);
    }
  }

  renderVisitLogs(visits?.recentLogs || []);

  const list = $('#visitHistory');
  list.replaceChildren();
  const rawDays = visits?.days || [];
  if (!rawDays.length) {
    list.textContent = '暂无按日访问计数';
    return;
  }
  for (const item of rawDays) {
    const row = document.createElement('div');
    row.className = 'visit-row';
    const day = document.createElement('span');
    day.textContent = item.day;
    const count = document.createElement('strong');
    count.textContent = `${Number(item.pageViews ?? item.page_views ?? 0).toLocaleString()} 次`;
    row.append(day, count);
    list.append(row);
  }
}
function renderOverview(data) {
  renderOverviewVisits(data.visits || {});

  const shops = data.shops || {};
  const totalShops = Number(shops.total || 0);
  const catalog = data.catalog || {};
  const ops = data.operations || {};

  $('#metricShops').textContent = totalShops.toLocaleString();
  if ($('#metricShopsSub')) {
    $('#metricShopsSub').textContent = `有货 ${Number(shops.inStock || 0).toLocaleString()} 家 · 近7日 +${Number(shops.added7d || 0)} ↗`;
  }
  if ($('#metricGroups')) {
    $('#metricGroups').textContent = `${Number(catalog.groupCount || 0).toLocaleString()} 组`;
  }
  if ($('#metricGroupsSub')) {
    const minP = catalog.minPrice != null ? `最低 ¥${catalog.minPrice}` : '暂无价格';
    $('#metricGroupsSub').textContent = `${Number(catalog.offerCount || 0).toLocaleString()} 报价 · ${minP}`;
  }
  if ($('#metricSyncHealth')) {
    $('#metricSyncHealth').textContent = `${Number(shops.healthRate || 0)}%`;
  }
  if ($('#metricSyncHealthSub')) {
    $('#metricSyncHealthSub').textContent = `异常 ${Number(shops.error || 0)} · 24h同步 ${Number(shops.synced24h || 0)} ↗`;
  }
  if ($('#metricIntegrationCodes')) {
    const withCode = Number(shops.withCode || 0);
    const pct = totalShops > 0 ? Math.round((withCode / totalShops) * 1000) / 10 : 0;
    $('#metricIntegrationCodes').textContent = `${withCode.toLocaleString()} 家`;
    if ($('#metricIntegrationCodesSub')) $('#metricIntegrationCodesSub').textContent = `占比 ${pct}% · 点此筛选 ↗`;
  }
  if ($('#metricFavoritesSub')) {
    $('#metricFavoritesSub').textContent = `收藏 ${Number(ops.totalFavorites || 0).toLocaleString()} · 置顶 ${Number(ops.manualRankedCount || 0)} 家 ↗`;
  }
  if ($('#metricSubmissionsSub')) {
    const keyStatus = ops.ingestConfigured ? '密钥正常' : '密钥未配';
    $('#metricSubmissionsSub').textContent = `${Number(ops.openStoreUrlCount || 0)} 平台入口 · ${keyStatus} ↗`;
  }

  const syncEl = $('#syncBreakdown');
  if (syncEl) {
    syncEl.replaceChildren();
    const denom = Math.max(1, totalShops);
    const states = [
      { key: 'ready', label: '同步正常', count: Number(shops.ready || 0), tone: 'emerald' },
      { key: 'pending', label: '待同步', count: Number(shops.pending || 0), tone: 'amber' },
      { key: 'error', label: '同步异常', count: Number(shops.error || 0), tone: 'rose' },
      { key: 'manual', label: '待适配 / 人工', count: Number(shops.manual || 0), tone: 'slate' },
      { key: 'never', label: '从未同步过', count: Number(shops.neverSynced || 0), tone: 'amber' },
    ];
    for (const item of states) {
      const pct = totalShops > 0 ? Math.round((item.count / denom) * 1000) / 10 : 0;
      syncEl.append(renderBreakdownRow({
        label: item.label,
        countText: `${item.count.toLocaleString()} 家 (${pct}%)`,
        ratio: pct,
        tone: item.tone,
        onClick: () => jumpToRanking({ sync: item.key }),
      }));
    }
  }

  const stockEl = $('#stockBreakdown');
  if (stockEl) {
    stockEl.replaceChildren();
    const chips = [
      { label: `有在售商品 ${Number(shops.inStock || 0)} 家`, onClick: () => jumpToRanking({ stock: 'in-stock' }), tone: 'emerald' },
      { label: `空店（0 商品）${Number(shops.empty || 0)} 家`, onClick: () => jumpToRanking({ stock: 'empty' }), tone: 'rose' },
      { label: `自动采集支持 ${Number(shops.syncSupported || 0)} 家`, tone: 'indigo' },
      { label: `累计店铺商品 ${Number(shops.totalShopProducts || 0)} 件`, tone: 'slate' },
    ];
    for (const chip of chips) {
      const btn = document.createElement(chip.onClick ? 'button' : 'span');
      if (chip.onClick) {
        btn.type = 'button';
        btn.addEventListener('click', chip.onClick);
      }
      btn.className = `sub-chip tone-${chip.tone}${chip.onClick ? ' is-clickable' : ''}`;
      btn.textContent = chip.label;
      stockEl.append(btn);
    }
  }

  const systemEl = $('#systemBreakdown');
  if (systemEl) {
    systemEl.replaceChildren();
    const systems = data.systems || [];
    if (!systems.length) {
      systemEl.textContent = '暂无平台分布数据';
    } else {
      const denom = Math.max(1, totalShops);
      for (const sys of systems) {
        const pct = totalShops > 0 ? Math.round((sys.shopCount / denom) * 1000) / 10 : 0;
        systemEl.append(renderBreakdownRow({
          label: sys.label || sys.systemType,
          countText: `${Number(sys.shopCount || 0).toLocaleString()} 家 (${pct}%)`,
          ratio: pct,
          tone: 'indigo',
          subText: `有货 ${Number(sys.inStockCount || 0)} 家 · 商品 ${Number(sys.productCount || 0).toLocaleString()} 件`,
          onClick: () => jumpToRanking({ system: sys.systemType }),
        }));
      }
    }
  }

  const brandEl = $('#brandBreakdown');
  if (brandEl) {
    brandEl.replaceChildren();
    const brands = catalog.brands || [];
    if (!brands.length) {
      brandEl.textContent = '暂无已聚合商品品牌数据';
    } else {
      const maxOffers = Math.max(1, ...brands.map(b => Number(b.offerCount || 0)));
      for (const b of brands) {
        const ratio = Math.round((Number(b.offerCount || 0) / maxOffers) * 100);
        const priceTip = b.minPrice != null ? ` · 最低 ¥${b.minPrice}` : '';
        brandEl.append(renderBreakdownRow({
          label: b.brand,
          countText: `${Number(b.offerCount || 0).toLocaleString()} 条报价`,
          ratio,
          tone: 'emerald',
          subText: `${Number(b.groupCount || 0).toLocaleString()} 个规格组${priceTip}`,
        }));
      }
    }
  }

  const runsEl = $('#recentSyncRuns');
  if (runsEl) {
    runsEl.replaceChildren();
    const runs = data.recentSyncs || [];
    if (!runs.length) {
      runsEl.textContent = '暂无服务端采集批次记录（可使用「商品同步」在浏览器中执行同步）';
    } else {
      for (const run of runs) {
        const item = document.createElement('div');
        item.className = 'sync-run-item';
        const left = document.createElement('div');
        const title = document.createElement('strong');
        title.textContent = `${run.triggerSource === 'cron' ? '定时调度' : '手动触发'} · ${formatBjTime(run.createdAt)}`;
        const detail = document.createElement('small');
        detail.textContent = `处理 ${run.processedCount} 家 · 未变更跳过 ${run.skippedUnchanged} · 更新 ${run.updatedCount} · 失败 ${run.failedCount}`;
        left.append(title, detail);
        const badge = document.createElement('span');
        badge.className = `run-badge ${run.failedCount > 0 ? 'has-error' : 'is-ok'}`;
        badge.textContent = `写入 ~${Number(run.estimatedD1Writes || 0).toLocaleString()} 行`;
        item.append(left, badge);
        runsEl.append(item);
      }
    }
  }
}
async function loadOverview() {
  try {
    const data = await api('/api/control/overview');
    renderOverview(data);
  } catch {
    $('#metricVisits').textContent = '暂不可用';
    $('#visitHistory').textContent = '工作台统计加载失败，请稍后重试';
  }
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
async function showDashboard() {$('#loginPanel').hidden=true;$('#dashboard').hidden=false;$('#logout').hidden=false;selectPanel(location.hash.slice(1));try{await Promise.all([loadSettings(),loadShops(),loadOverview()]);}catch(err){message(err.message,true);}}
submitForm('#loginForm',async f=>{await api('/api/control/login',{password:f.elements.password.value});f.reset();notice.hidden=true;await showDashboard();});
submitForm('#settingsForm',async f=>{const data={favoritesEnabled:f.elements.favoritesEnabled.checked,manualRankEnabled:f.elements.manualRankEnabled.checked,submissionsEnabled:f.elements.submissionsEnabled.checked,openStoreUrl:f.elements.openStoreUrl.value,openStoreUrls:Object.fromEntries(['catfk','16688','acg-faka','dujiaoka','other','unknown'].map(key=>[key,f.elements[`store_${key}`].value.trim()]))};await api('/api/control/settings',data);setDirty(false);updateMetrics(data);message('站点设置已保存');await Promise.all([loadShops(),loadOverview()]);});
submitForm('#secretForm',async f=>{await api('/api/control/ingest-secret',{secret:f.elements.secret.value});f.reset();message('同步密钥已更新，请更新同步工具配置');await loadOverview();});
submitForm('#passwordForm',async f=>{await api('/api/control/password',{oldPassword:f.elements.oldPassword.value,newPassword:f.elements.newPassword.value});f.reset();$('#dashboard').hidden=true;$('#loginPanel').hidden=false;$('#logout').hidden=true;message('密码已修改，请重新登录');});
$('#logout').addEventListener('click',async()=>{try{await api('/api/control/logout',{});settingsDirty=false;location.reload();}catch(err){message(err.message,true);}});
submitForm('#searchForm',async()=>{query=$('#searchInput').value.trim();page=1;await loadShops();});
for(const sel of ['#rankSort','#rankFilter','#rankSyncFilter','#rankStockFilter','#rankSystemFilter'])$(sel)?.addEventListener('change',()=>{page=1;loadShops().catch(err=>message(err.message,true));});
$('#rankResetFilters')?.addEventListener('click',()=>{$('#searchInput').value='';query='';for(const sel of ['#rankFilter','#rankSyncFilter','#rankStockFilter','#rankSystemFilter'])if($(sel))$(sel).value='all';page=1;loadShops().catch(err=>message(err.message,true));});
$('#refreshOverview')?.addEventListener('click',async()=>{const btn=$('#refreshOverview');if(!btn||btn.disabled)return;btn.disabled=true;btn.textContent='刷新中…';try{await loadOverview();message('工作台指标已刷新');}finally{btn.disabled=false;btn.textContent='↻ 刷新指标';}});
document.addEventListener('click',e=>{const el=e.target.closest('[data-jump-sync],[data-jump-stock],[data-jump-filter]');if(!el)return;jumpToRanking({sync:el.dataset.jumpSync||'all',stock:el.dataset.jumpStock||'all',filter:el.dataset.jumpFilter||'all'});});
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
  if ($('#overviewSync')) $('#overviewSync').textContent=state ? `${syncRunning?'同步中':done<total?'上次暂停':'上轮完成'} · ${done} / ${total} 家，点击查看进度` : '从当前网络更新商品，支持断点续跑';
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
