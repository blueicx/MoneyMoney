/* Shared, source-neutral viewport and trading chart interaction. No orders or generated prices. */
(function () {
  'use strict';
  const views=new WeakMap(),mounts=new WeakMap();
  function mergeHistory(current,incoming,before){
    const valid=row=>Number.isFinite(row.time)&&[row.open,row.high,row.low,row.close,row.volume].every(Number.isFinite)&&Math.min(row.open,row.high,row.low,row.close)>0&&row.volume>=0&&row.high>=Math.max(row.open,row.close,row.low)&&row.low<=Math.min(row.open,row.close,row.high);
    const page=(incoming||[]).filter(row=>valid(row)&&(before==null||row.time<before)),all=before==null?[...current,...page]:[...page,...current],byTime=new Map();
    for(const row of all)if(valid(row))byTime.set(row.time,row);
    return [...byTime.values()].sort((a,b)=>a.time-b.time).slice(-2000);
  }
  function createView(){return {count:60,follow:true,anchor:null};}
  function scalePrice(s,delta){s.priceScale=Math.max(.25,Math.min(8,(s.priceScale||1)*Math.exp(Math.max(-200,Math.min(200,delta))/150)));}
  function resetPrice(s){if(s)delete s.priceScale;}
  function priceRange(s,minP,maxP){const mid=(minP+maxP)/2,half=(maxP-minP||Math.abs(mid)*.01||1)*(s?.priceScale||1)/2;return {minP:mid-half,maxP:mid+half};}
  const intervals={'1m':60000,'3m':180000,'5m':300000,'15m':900000,'30m':1800000,'1h':3600000,'4h':14400000,'1d':86400000,'1w':604800000};
  function paperMarkersFor(markers,rows,market,instrument,interval,asOf=Infinity){
    const width=intervals[interval];if(!width)return [];
    return (markers||[]).flatMap(marker=>{
      if(!marker.orderId||!marker.signalId||!marker.snapshotId||!marker.accountId||marker.market!==market||marker.instrument!==instrument||!Number.isFinite(marker.time)||marker.time>asOf||!Number.isFinite(marker.price)||marker.price<=0)return [];
      if(market==='prediction'&&(marker.side==='SELL'? !['YES','NO'].includes(marker.outcome):!['YES','NO'].includes(marker.side)||marker.outcome!==marker.side))return [];
      const index=rows.findIndex(row=>marker.time>=row.time&&marker.time<row.time+width);
      return index<0?[]:[{...marker,index}];
    });
  }
  function verifyPaperEvidenceEnvelope(marker,body){
    const row=body?.data,fields=row?.fields;if(body?.success===false||body?.market!==marker.market||body?.instrument!==marker.instrument||row?.id!==marker.snapshotId||!/^rs_[a-f0-9]{64}$/.test(row?.id||'')||row.id!=='rs_'+row.hash||!fields||typeof fields!=='object')return false;
    const captured=Date.parse(row.at),dataAt=Date.parse(fields.dataAt);
    return Number.isFinite(captured)&&captured<=marker.time&&Number.isFinite(dataAt)&&dataAt<=marker.time+5000;
  }
  function verifyPaperExecutionEvidenceEnvelope(marker,body){
    const row=body?.data,decision=row?.decision,snapshot=row?.snapshot,fields=snapshot?.fields;
    if(body?.success===false||body?.market!==marker.market||body?.instrument!==marker.instrument||row?.market!==marker.market||row?.instrument!==marker.instrument||row?.orderId!==marker.orderId||row?.accountId!==marker.accountId||row?.signalId!==marker.signalId||row?.snapshotId!==marker.snapshotId)return false;
    const sideMatches=marker.market==='prediction'?(decision?.action==='BUY'?['YES','NO'].includes(marker.side)&&decision.side===marker.side&&marker.outcome===marker.side:marker.side==='SELL'&&['YES','NO'].includes(marker.outcome)&&decision.side===marker.outcome):decision?.action===marker.side;
    if(!marker.runnerId||decision?.id!==marker.signalId||decision.runnerId!==marker.runnerId||decision.orderId!==marker.orderId||decision.market!==marker.market||decision.instrument!==fields?.instrument||!['BUY','SELL'].includes(decision.action)||!sideMatches)return false;
    if(snapshot?.id!==marker.snapshotId||!/^rs_[a-f0-9]{64}$/.test(snapshot.id||'')||snapshot.id!=='rs_'+snapshot.hash||decision.snapshotHash!==snapshot.hash||fields?.market!==marker.market||!fields.instrument||typeof fields!=='object')return false;
    const type=({stocks:'stock',options:'option',crypto:'crypto',prediction:'prediction'})[marker.market];
    const venue=({stocks:'us',options:'us',crypto:'binance',prediction:'predictfun'})[marker.market];
    const symbol=String(fields.instrument).toUpperCase();
    if(!type||marker.instrument!==`${type}:${venue}:${symbol}`)return false;
    const fillAt=Number(marker.time),decisionAt=Date.parse(decision.at),snapshotAt=Date.parse(snapshot.at),dataAt=Date.parse(fields.dataAt);
    if(!Number.isFinite(fillAt)||!Number.isFinite(decisionAt)||!Number.isFinite(snapshotAt)||!Number.isFinite(dataAt)||decisionAt>fillAt||snapshotAt>fillAt||dataAt>fillAt+5000)return false;
    const notAfterFill=value=>value==null||value===''||(Number.isFinite(Date.parse(String(value)))&&Date.parse(String(value))<=fillAt+5000);
    if(!notAfterFill(fields.quote?.fetchedAt))return false;
    for(const list of [fields.evidence,decision.evidence])if(Array.isArray(list)&&list.some(item=>!notAfterFill(item?.dataAt)||!notAfterFill(item?.retrievedAt)))return false;
    return Array.isArray(decision.riskChecks)&&Array.isArray(decision.signals);
  }
  function formatPaperExecutionEvidence(marker,body){
    const row=body.data,decision=row.decision,fields=row.snapshot.fields,quote=fields.quote||{};
    const lines=['成交决策：'+decision.action+' · '+String(decision.reason||'未记录原因').slice(0,500),'策略版本：'+String(decision.strategyVersion||'未关联'),'信号：'+(decision.signals.length?decision.signals.slice(0,10).map(item=>String(item).slice(0,240)).join('；'):'无独立信号说明'),
      '风控检查：'+(decision.riskChecks.length?decision.riskChecks.slice(0,12).map(item=>`${String(item.name)} ${item.passed===true?'通过':'未通过'}${item.reason?'：'+String(item.reason).slice(0,240):''}`).join('；'):'未记录'),
      '来源：'+String(fields.source||decision.source||'未知'),'状态：'+String(fields.status||decision.dataStatus||'未知'),'数据时间：'+String(fields.dataAt),'决策/快照时间：'+String(decision.at)+' / '+String(row.snapshot.at),'成交时参考价：'+fmt(Number(fields.price))];
    const bid=Number(quote.bestBid),ask=Number(quote.bestAsk);if(Number.isFinite(bid)||Number.isFinite(ask))lines.push('盘口：买一 '+fmt(bid)+' · 卖一 '+fmt(ask));
    if(Number.isFinite(Number(fields.rsi14)))lines.push('RSI14：'+fmt(Number(fields.rsi14)));
    if(Number.isFinite(Number(fields.sma10)))lines.push('SMA10：'+fmt(Number(fields.sma10)));
    if(Array.isArray(decision.evidence)&&decision.evidence.length)lines.push('决策来源明细：'+decision.evidence.slice(0,10).map(item=>`${String(item.dataset)} · ${String(item.source)} · ${String(item.status)} · 数据 ${String(item.dataAt||'未知')} · 抓取 ${String(item.retrievedAt||'未知')}${item.reason?' · '+String(item.reason).slice(0,180):''}`).join('\n'));
    lines.push('快照 SHA-256：'+String(row.snapshot.hash));return lines.join('\n');
  }
  function abortPaperEvidence(p){for(const controller of p?.evidenceControllers||[])controller.abort();if(p)p.evidenceControllers=new Set();}
  function statusFor(info,bar,now){
    const source=Number(info.sourceTime),age=now-source,ttl=info.staleAfterMs??60000;
    const freshness=Number.isFinite(source)&&source>0&&age>=-5000?(age>ttl?'stale':'fresh'):'unknown';
    const evidence=info.sessionEvidence;
    const closed=evidence?.state==='closed'&&typeof evidence.source==='string'&&evidence.source.length>0&&Number.isFinite(evidence.at)&&Math.abs(now-evidence.at)<=ttl;
    return {connection:info.connection||'snapshot',freshness,candle:!info.interactive?'historical':bar?.closed===true?'completed':!intervals[info.interval]?'unknown':bar?.time+intervals[info.interval]<=now?'completed':'forming',session:closed?'closed':'waiting'};
  }
  function restoreView(input){
    const s=createView();if(!input||typeof input!=='object')return s;
    if(Number.isFinite(input.count))s.count=Math.max(15,Math.min(300,Math.round(input.count)));
    if(input.follow===false&&Number.isFinite(input.anchor)){s.follow=false;s.anchor=input.anchor;}
    s.timeZone='local';if(input.timeZone==='exchange')s.timeZone='exchange';else if(typeof input.timeZone==='string'&&input.timeZone!=='local'){try{new Intl.DateTimeFormat('zh-CN',{timeZone:input.timeZone});s.timeZone=input.timeZone;}catch{}}
    return s;
  }
  function persist(s){try{if(s?.key)window.sessionStorage?.setItem('mm-chart-view:'+s.key,JSON.stringify({count:s.count,follow:s.follow,anchor:s.anchor,timeZone:s.timeZone||'local'}));}catch{}}
  function scheduleFrame(m,fn,hidden,request){if(hidden()||m.framePending)return;m.framePending=true;request(()=>{m.framePending=false;if(!hidden())fn();});}
  function queuePaint(m,redraw){m.needsRedraw=m.needsRedraw||redraw;scheduleFrame(m,()=>{const full=m.needsRedraw;m.needsRedraw=false;if(full)m.info?.redraw();else paint(m);},()=>document.hidden||!m.host.getClientRects().length,requestAnimationFrame);}
  function timeLabel(time,i,s){const zone=s?.timeZone==='exchange'?i.exchangeTimeZone:s?.timeZone;try{return new Date(time).toLocaleString('zh-CN',zone&&zone!=='local'?{timeZone:zone}:undefined);}catch{return new Date(time).toLocaleString();}}
  function windowFor(rows,s){let end=rows.length;if(!s.follow && s.anchor!=null){const i=rows.findIndex(r=>r.time>s.anchor);end=i<0?rows.length:i;}const start=Math.max(0,end-s.count);return {start,rows:rows.slice(start,end)};}
  function pan(rows,s,n){const w=windowFor(rows,s),end=Math.max(Math.min(rows.length,s.count),Math.min(rows.length,w.start+w.rows.length-Math.round(n)));s.follow=false;s.anchor=rows[end-1]?.time??null;}
  function latest(s){s.follow=true;s.anchor=null;}
  function zoom(s,d){s.count=Math.max(15,Math.min(300,s.count+Math.sign(d)*10));}
  function countdown(bar,interval,now){const ms={'1m':60000,'5m':300000,'15m':900000,'30m':1800000,'1h':3600000}[interval];if(!ms)return '周期非短线';const left=Math.ceil((bar.time+ms-now)/1000);if(left<=0)return '等待新数据';return String(Math.floor(left/60)).padStart(2,'0')+':'+String(left%60).padStart(2,'0');}
  function select(canvas,rows,key){let s=views.get(canvas);if(!s || s.key!==key){persist(s);let saved;try{saved=JSON.parse(window.sessionStorage?.getItem('mm-chart-view:'+key)||'null');}catch{}s=Object.assign(restoreView(saved),{key});views.set(canvas,s);}return {...windowFor(rows,s),state:s};}
  const fmt=n=>Number.isFinite(n)?n.toLocaleString(undefined,{maximumFractionDigits:6}):'—';
  function decorate(canvas,info){
    if(!info.rows.length){clear(canvas);return;}
    if(info.identity)select(canvas,info.full,info.identity);
    let m=mounts.get(canvas);
    if(!m){
      const host=document.createElement('div'),head=document.createElement('div'),layer=document.createElement('canvas'),button=document.createElement('button');
      host.className='mm-trading-chart';head.className='mm-trading-readout';layer.className='mm-trading-crosshair';button.type='button';button.className='btn mm-trading-latest';button.textContent='回到最新';
      const status=document.createElement('div'),clock=document.createElement('span'),zone=document.createElement('button');status.className='mm-trading-status';clock.className='mm-trading-countdown';zone.type='button';zone.className='btn mm-trading-zone';zone.textContent='本地时区';zone.title='切换本地/来源交易所时区';
      const auto=document.createElement('button');auto.type='button';auto.className='btn mm-trading-zone';auto.textContent='自动价格轴';auto.title='恢复价格轴自动缩放';
      canvas.before(host);host.append(status,head,canvas,layer,button);status.append(clock,zone,auto);m={host,head,layer,button,status,clock,zone,auto,info:null,hover:null,drag:null,readoutKey:null,pointers:new Map()};mounts.set(canvas,m);
      const earlier=document.createElement('button'),historyNote=document.createElement('span');earlier.type='button';earlier.className='btn mm-trading-zone';earlier.dataset.chartHistory='';earlier.textContent='加载更早K线';earlier.hidden=true;historyNote.setAttribute('aria-live','polite');status.append(earlier,historyNote);m.history={earlier,note:historyNote,key:null,controller:null,pending:false};
      earlier.addEventListener('click',async()=>{
        if(!m.info?.loadEarlier||m.history.pending||document.hidden)return;const key=m.info.identity,load=m.info.loadEarlier,h=m.history,controller=new AbortController();h.pending=true;h.controller=controller;earlier.disabled=true;historyNote.textContent='正在读取更早的真实记录…';const s=views.get(canvas);if(s.follow){s.follow=false;s.anchor=m.info.full.at(-1).time;persist(s);}
        const current=()=>!controller.signal.aborted&&h.controller===controller&&m.info?.identity===key;
        try{const reason=await load(controller.signal);if(current())historyNote.textContent=reason||'请求已取消或上下文已变化；未载入历史';}catch(error){if(error.name!=='AbortError'&&current())historyNote.textContent='更早记录不可用：'+error.message;}finally{if(current()){h.pending=false;earlier.disabled=false;}}
      });
      auto.addEventListener('click',()=>{resetPrice(views.get(canvas));queuePaint(m,true);});
      if(window.mm_isLoggedIn===true&&window.mm_isGuest!==true){
        const label=document.createElement('label'),toggle=document.createElement('input'),details=document.createElement('details'),summary=document.createElement('summary'),list=document.createElement('div');
        toggle.type='checkbox';toggle.dataset.paperChartLayer='';label.append(toggle,' 模拟成交');status.append(label);summary.textContent='模拟成交与关联证据';details.append(summary,list);details.hidden=true;host.append(details);m.paper={toggle,details,list,markers:[],controller:null,key:null,evidenceControllers:new Set()};
        toggle.addEventListener('change',()=>{if(toggle.checked)loadPaper(m);else{m.paper.controller?.abort();abortPaperEvidence(m.paper);m.paper.key=null;m.paper.markers=[];details.hidden=true;queuePaint(m);}});
      }
      zone.addEventListener('click',()=>{const s=views.get(canvas);if(!m.info.exchangeTimeZone)return;s.timeZone=s.timeZone==='exchange'?'local':'exchange';persist(s);m.readoutKey=null;m.info.redraw();});
      if(typeof ResizeObserver==='function'){let width=host.clientWidth;new ResizeObserver(()=>{if(host.clientWidth!==width){width=host.clientWidth;if(m.info && width>0)requestAnimationFrame(()=>m.info?.redraw());}}).observe(host);}
      button.addEventListener('click',()=>{latest(views.get(canvas));persist(views.get(canvas));m.hover=null;m.info.redraw();});
      layer.addEventListener('wheel',e=>{if(!m.info.interactive)return;e.preventDefault();zoom(views.get(canvas),e.deltaY>0?1:-1);persist(views.get(canvas));queuePaint(m,true);},{passive:false});
      layer.addEventListener('click',e=>{if(!m.moved)canvas.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:e.clientX,clientY:e.clientY}));});
      layer.addEventListener('pointerdown',e=>{if(!m.info.interactive)return;m.pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});if(m.pointers.size>2)return;layer.setPointerCapture(e.pointerId);if(m.pointers.size===2){const [a,b]=[...m.pointers.values()];m.pinch={distance:Math.hypot(a.x-b.x,a.y-b.y),count:views.get(canvas).count};m.drag=null;m.moved=true;return;}m.moved=false;const r=layer.getBoundingClientRect();m.drag={id:e.pointerId,x:e.clientX,y:e.clientY,axis:e.clientX-r.left>=m.info.geometry.W-m.info.geometry.padR,state:{...views.get(canvas)}};});
      const release=e=>{m.pointers.delete(e.pointerId);m.drag=null;m.pinch=null;};layer.addEventListener('pointerup',release);layer.addEventListener('pointercancel',release);layer.addEventListener('lostpointercapture',release);
      layer.addEventListener('pointermove',e=>{
        const r=layer.getBoundingClientRect(),g=m.info.geometry,x=e.clientX-r.left;
        if(m.pointers.has(e.pointerId))m.pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
        if(m.pinch&&m.pointers.size===2){const [a,b]=[...m.pointers.values()],distance=Math.hypot(a.x-b.x,a.y-b.y);if(distance>=8&&m.pinch.distance>=8){views.get(canvas).count=Math.max(15,Math.min(300,Math.round(m.pinch.count*m.pinch.distance/distance)));persist(views.get(canvas));queuePaint(m,true);}return;}
        if(m.drag){if(m.drag.id!==e.pointerId)return;if(Math.abs((m.drag.axis?e.clientY-m.drag.y:e.clientX-m.drag.x))<4 && !m.moved)return;m.moved=true;Object.assign(views.get(canvas),m.drag.state);if(m.drag.axis)scalePrice(views.get(canvas),e.clientY-m.drag.y);else pan(m.info.full,views.get(canvas),(e.clientX-m.drag.x)/( (g.W-g.padL-g.padR)/m.info.rows.length));persist(views.get(canvas));queuePaint(m,true);return;}
        m.hover=Math.max(0,Math.min(m.info.rows.length-1,Math.floor((x-g.padL)/(g.W-g.padL-g.padR)*m.info.rows.length)));m.crossY=Math.max(g.padT,Math.min(g.padT+g.priceH,e.clientY-r.top));queuePaint(m);
      });
      layer.addEventListener('pointerleave',()=>{if(!m.drag){m.hover=null;queuePaint(m);}});
    }
    if(m.info?.identity!==info.identity){m.history.controller?.abort();m.history.pending=false;m.history.note.textContent='';m.history.earlier.disabled=false;}
    m.info=info;m.history.earlier.hidden=!info.interactive||typeof info.loadEarlier!=='function';
    if(info.adjustment){if(!m.adjustment){const label=document.createElement('label'),control=document.createElement('select');control.dataset.chartAdjustment='';control.className='mm-trading-zone';control.innerHTML='<option value="source">来源口径</option><option value="forward" disabled>前复权（不可用）</option><option value="backward" disabled>后复权（不可用）</option>';label.append('价格口径 ',control);m.status.append(label);m.adjustment=control;}
      m.adjustment.hidden=false;m.adjustment.title=info.adjustment.reason||'未进行复权转换';m.adjustment.options[0].textContent='来源口径 · '+({unknown:'未声明',unadjusted:'未复权',mixed:'混合'}[info.adjustment.actual]||info.adjustment.actual);
    }else if(m.adjustment)m.adjustment.hidden=true;
    if(m.paper?.toggle.checked&&m.paper.key!==[document.getElementById('market-workspace-shell')?.dataset.marketScope,document.getElementById('market-workspace-shell')?.dataset.instrument,info.identity].join('|'))loadPaper(m);canvas.dataset.tradingMode=info.interactive?'latest':'historical';m.layer.hidden=false;m.host.style.setProperty('--chart-height',info.geometry.H+'px');paint(m);m.layer.style.top=canvas.offsetTop+'px';
  }
  async function loadPaper(m){
    const shell=document.getElementById('market-workspace-shell'),market=shell?.dataset.marketScope,instrument=shell?.dataset.instrument,p=m.paper,key=[market,instrument,m.info.identity].join('|');
    if(!instrument||!['stocks','crypto','options','prediction'].includes(market)||p.key===key)return;
    p.controller?.abort();abortPaperEvidence(p);p.evidenceControllers=new Set();p.controller=new AbortController();p.key=key;p.markers=[];p.unlinked=null;p.detailsKey=null;p.reason=null;p.details.hidden=false;p.list.textContent='正在读取当前标的模拟账本…';
    try{const response=await fetch('/api/paper/chart-markers?'+new URLSearchParams({market,instrument}),{signal:p.controller.signal}),body=await response.json();
      if(p.key!==key)return;
      if(!p.toggle.checked||!m.host.isConnected||shell.dataset.marketScope!==market||shell.dataset.instrument!==instrument){p.key=null;p.markers=[];p.details.hidden=true;return;}if(!response.ok||!body.success)throw Error(body.reason||'模拟账本请求失败');
      p.market=body.market;p.instrument=body.instrument;p.markers=body.data.markers;p.unlinked=body.data.unlinked;p.reason=body.reason;p.detailsKey=null;paperDetails(m);queuePaint(m);
    }catch(error){if(error.name!=='AbortError'&&p.key===key){p.key=null;p.list.textContent=error.message;}}
  }
  function paperDetails(m){const p=m.paper;if(!p?.toggle.checked||!p.unlinked)return;
    const cutoff=m.info.interactive?Infinity:m.info.full.at(-1).time,key=p.key+'|'+cutoff;if(p.detailsKey===key)return;abortPaperEvidence(p);p.detailsKey=key;p.list.replaceChildren();
    for(const row of p.markers.filter(row=>row.time<=cutoff)){const item=document.createElement('div'),text=document.createElement('p'),button=document.createElement('button'),evidence=document.createElement('pre');item.className='mm-paper-marker-detail';text.textContent=row.side+' '+fmt(row.price)+' · 账户 '+row.accountId+' · 订单 '+row.orderId+' · 信号 '+row.signalId+' · 快照 '+row.snapshotId+' · 费用 '+fmt(row.feeUsd)+' · 滑点 '+fmt(row.slippageUsd)+' · 实现盈亏 '+fmt(row.pnlUsd);button.type='button';button.className='btn mm-trading-zone';button.dataset.paperEvidence='';button.textContent='查看成交证据';evidence.dataset.paperEvidenceDetails='';evidence.hidden=true;button.addEventListener('click',()=>loadPaperEvidence(m,row,button,evidence));item.append(text,button,evidence);p.list.append(item);}
    if(m.info.interactive)for(const row of p.unlinked){const text=document.createElement('p');text.textContent=(row.orderId||'旧订单')+' · '+row.reason;p.list.append(text);}
    if(!p.list.childNodes.length)p.list.textContent=m.info.interactive?(p.reason||'暂无已关联模拟成交'):'当前回放时点暂无已关联模拟成交；旧记录时间未核验，不显示';
  }
  async function loadPaperEvidence(m,marker,button,view){
    const p=m.paper,key=p.key,controller=new AbortController();p.evidenceControllers||=new Set();p.evidenceControllers.add(controller);button.disabled=true;view.hidden=false;view.textContent='正在读取成交时证据…';
    try{const query=new URLSearchParams({market:marker.market,instrument:marker.instrument,accountId:marker.accountId,orderId:marker.orderId,signalId:marker.signalId,snapshotId:marker.snapshotId}),response=await fetch('/api/paper/execution-evidence?'+query,{signal:controller.signal}),body=await response.json();if(!response.ok||!verifyPaperExecutionEvidenceEnvelope(marker,body))throw Error(body?.reason||'成交、决策、账户或时点快照未通过核验');if(p.key!==key||controller.signal.aborted||!view.isConnected)return;view.textContent=formatPaperExecutionEvidence(marker,body);
    }catch(error){if(error.name!=='AbortError'&&p.key===key&&view.isConnected)view.textContent='证据不可用：'+error.message;}
    finally{p.evidenceControllers.delete(controller);if(p.key===key&&button.isConnected)button.disabled=false;}
  }
  function paint(m){
    const i=m.info;if(!i||document.hidden||!m.host.getClientRects().length)return;const g=i.geometry,dpr=window.devicePixelRatio||1,c=m.layer;c.width=g.W*dpr;c.height=g.H*dpr;c.style.width=g.W+'px';c.style.height=g.H+'px';const ctx=c.getContext('2d');ctx.scale(dpr,dpr);
    paperDetails(m);
    if(m.hover!=null)m.hover=Math.min(m.hover,i.rows.length-1);
    const text=getComputedStyle(m.host).getPropertyValue('--text-secondary').trim()||'#a6adbf',bar=i.rows[m.hover??i.rows.length-1],last=i.full.at(-1);
    const pct=(bar.close/bar.open-1)*100;
    const readoutKey=JSON.stringify([bar.time,bar.open,bar.high,bar.low,bar.close,bar.volume,i.volumeUnit,i.ma,i.maColors,views.get(i.canvas)?.timeZone,i.exchangeTimeZone,i.full.slice(Math.max(0,i.full.findIndex(r=>r.time===bar.time)-60),i.full.findIndex(r=>r.time===bar.time)+1).map(r=>r.close)]);
    if(m.readoutKey!==readoutKey){m.readoutKey=readoutKey;m.head.textContent=timeLabel(bar.time,i,views.get(i.canvas))+'  开 '+fmt(bar.open)+'  高 '+fmt(bar.high)+'  低 '+fmt(bar.low)+'  收 '+fmt(bar.close)+'  '+pct.toFixed(2)+'%  成交量 '+fmt(bar.volume)+(i.volumeUnit?' '+i.volumeUnit:'');
    const original=i.full.findIndex(r=>r.time===bar.time);
    (i.ma||[5,10,20]).forEach((n,j)=>{if(original>=n-1){const value=i.full.slice(original-n+1,original+1).reduce((sum,r)=>sum+r.close,0)/n;const span=document.createElement('span');span.style.color=(i.maColors || ['#ffad00','#a778ff','#29b6f6'])[j];span.textContent=' MA'+n+': '+fmt(value);m.head.append(span);}});}
    const y=v=>g.padT+(g.maxP-v)/(g.maxP-g.minP||1)*g.priceH;
    const py=Math.max(g.padT,Math.min(g.padT+g.priceH,y(last.close)));
    if(m.paper?.toggle.checked){for(const marker of paperMarkersFor(m.paper.markers,i.rows,m.paper.market,m.paper.instrument,i.interval,i.interactive?Infinity:last.time)){
      const x=g.padL+(marker.index+.5)*(g.W-g.padL-g.padR)/i.rows.length,pointY=y(marker.price);if(pointY<g.padT||pointY>g.padT+g.priceH)continue;
      ctx.fillStyle=getComputedStyle(m.host).getPropertyValue('--purple').trim()||'#a778ff';ctx.font='11px system-ui';const label=marker.market==='prediction'?(marker.side==='SELL'?`▼ 模拟退出 ${marker.outcome||''}`:`▲ 模拟入场 ${marker.side}`):marker.side==='SELL'?'▼ 模拟退出':'▲ 模拟入场';ctx.fillText(label,x,pointY-6);
    }}
    ctx.strokeStyle=last.close>=last.open?'#18bf78':'#ef5350';if(last.close>=g.minP && last.close<=g.maxP){ctx.setLineDash([5,4]);ctx.beginPath();ctx.moveTo(g.padL,py);ctx.lineTo(g.W-g.padR,py);ctx.stroke();ctx.setLineDash([]);}ctx.fillStyle=ctx.strokeStyle;ctx.fillRect(g.W-g.padR,py-12,g.padR,24);ctx.fillStyle='#fff';ctx.font='11px system-ui';ctx.fillText((last.close>g.maxP?'↑':last.close<g.minP?'↓':'')+fmt(last.close),g.W-g.padR+3,py+1);
    if(m.hover!=null){const x=g.padL+(m.hover+.5)*(g.W-g.padL-g.padR)/i.rows.length,crossY=m.crossY??y(bar.close);ctx.strokeStyle=text;ctx.setLineDash([3,3]);ctx.beginPath();ctx.moveTo(x,g.padT);ctx.lineTo(x,g.H-25);ctx.moveTo(g.padL,crossY);ctx.lineTo(g.W-g.padR,crossY);ctx.stroke();ctx.setLineDash([]);ctx.fillStyle=getComputedStyle(m.host).getPropertyValue('--bg-secondary').trim()||'#162034';ctx.fillRect(g.W-g.padR,crossY-11,g.padR,22);const label=timeLabel(bar.time,i,views.get(i.canvas)),width=Math.min(g.W,ctx.measureText(label).width+10),left=Math.max(0,Math.min(g.W-width,x-width/2));ctx.fillRect(left,g.H-25,width,23);ctx.fillStyle=text;ctx.fillText(fmt(g.maxP-(crossY-g.padT)/g.priceH*(g.maxP-g.minP)),g.W-g.padR+3,crossY+4);ctx.fillText(label,left+5,g.H-9);}
    updateClock(m);
    m.button.hidden=!i.interactive || views.get(i.canvas)?.follow!==false;
  }
  function updateClock(m){const i=m.info;if(!i||document.hidden||!m.host.getClientRects().length)return;const now=Date.now(),s=statusFor(i,i.full.at(-1),now),value=(i.interactive?countdown(i.full.at(-1),i.interval,now):'历史数据')+' · 连接：'+({snapshot:'来源快照',live:'已连接',disconnected:'断线',connecting:'连接中'}[s.connection]||s.connection)+' · 时效：'+({fresh:'新鲜',stale:'来源过期',unknown:'源时间未知'}[s.freshness])+' · 蜡烛：'+({forming:'形成中',completed:'已完成',historical:'历史模式'}[s.candle])+(s.session==='closed'?' · 休市（来源证明）':'');if(m.clock.textContent!==value)m.clock.textContent=value;m.zone.disabled=!i.exchangeTimeZone;m.zone.textContent=views.get(i.canvas)?.timeZone==='exchange'?'交易所时区':'本地时区';}
  function clear(canvas){const m=mounts.get(canvas);if(m){m.history.controller?.abort();m.history.pending=false;m.history.earlier.hidden=true;m.history.note.textContent='';m.paper?.controller?.abort();abortPaperEvidence(m.paper);if(m.paper){m.paper.key=null;m.paper.markers=[];m.paper.details.hidden=true;}m.info=null;m.readoutKey=null;m.head.textContent='';m.clock.textContent='';m.zone.disabled=true;m.layer.hidden=true;m.layer.getContext('2d').clearRect(0,0,m.layer.width,m.layer.height);m.button.hidden=true;}}
  function render(canvas,full,options){
    if(document.hidden)return;
    if(!full.length){clear(canvas);return;}
    const selected=select(canvas,full,options.identity),rows=selected.rows,W=Math.max(280,canvas.parentElement.clientWidth),H=canvas.closest('.mm-contract-chart')?.matches(':fullscreen,.mm-trading-fullscreen')?Math.max(440,window.innerHeight-200):440,padL=52,padR=88,padT=20,priceH=(H-60)*.74,dpr=window.devicePixelRatio||1;
    canvas.width=W*dpr;canvas.height=H*dpr;canvas.style.width='100%';canvas.style.height=H+'px';const c=canvas.getContext('2d');c.scale(dpr,dpr);
    let minP=Math.min(...rows.map(r=>r.low)),maxP=Math.max(...rows.map(r=>r.high));const gap=(maxP-minP||maxP*.01)*.08;minP-=gap;maxP+=gap;
    ({minP,maxP}=priceRange(selected.state,minP,maxP));
    const y=p=>padT+(maxP-p)/(maxP-minP)*priceH,cw=(W-padL-padR)/rows.length,maxV=Math.max(1,...rows.map(r=>r.volume||0));
    c.font='11px system-ui';c.fillStyle=getComputedStyle(canvas).getPropertyValue('--text-secondary').trim()||'#a6adbf';c.strokeStyle=getComputedStyle(canvas).getPropertyValue('--border').trim()||'#30394a';
    for(let j=0;j<5;j++){const p=minP+(maxP-minP)*j/4;c.beginPath();c.moveTo(padL,y(p));c.lineTo(W-padR,y(p));c.stroke();c.fillText(fmt(p),2,y(p));}
    rows.forEach((r,j)=>{const x=padL+(j+.5)*cw;c.strokeStyle=c.fillStyle=r.close>=r.open?'#18bf78':'#ef5350';c.beginPath();c.moveTo(x,y(r.high));c.lineTo(x,y(r.low));c.stroke();c.fillRect(x-cw*.3,Math.min(y(r.open),y(r.close)),Math.max(1,cw*.6),Math.max(1,Math.abs(y(r.open)-y(r.close))));if(options.showVolume!==false){c.globalAlpha=.65;const volumeHeight=(H-priceH-70)*(r.volume||0)/maxV;c.fillRect(x-cw*.3,H-40-volumeHeight,Math.max(1,cw*.6),volumeHeight);c.globalAlpha=1;}if(j%Math.max(1,Math.floor(rows.length/5))===0){c.fillStyle=getComputedStyle(canvas).getPropertyValue('--text-secondary').trim()||'#9da9bc';c.fillText(new Date(r.time).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}),x-18,H-15);}});
    [5,10,30,60].forEach((n,j)=>{c.strokeStyle=['#ffad00','#18bf78','#29b6f6','#a778ff'][j];c.beginPath();let started=false;rows.forEach((r,k)=>{const index=selected.start+k;if(index<n-1)return;const avg=full.slice(index-n+1,index+1).reduce((s,b)=>s+b.close,0)/n,x=padL+(k+.5)*cw;if(!started){c.moveTo(x,y(avg));started=true;}else c.lineTo(x,y(avg));});c.stroke();});
    decorate(canvas,{...options,canvas,full,rows,interval:options.interval,volumeUnit:options.volumeUnit,ma:[5,10,30,60],maColors:['#ffad00','#18bf78','#29b6f6','#a778ff'],interactive:true,geometry:{W,H,padL,padR,padT,priceH,minP,maxP},redraw:()=>render(canvas,full,options)});
    options.onViewport?.({rows,geometry:{W,H,padL,padR,padT,priceH,minP,maxP}});
  }
  window.MoneyTradingChart={createView,windowFor,pan,latest,zoom,countdown,select,decorate,clear,render,statusFor,restoreView,scheduleFrame,scalePrice,resetPrice,priceRange,paperMarkersFor,mergeHistory,verifyPaperEvidenceEnvelope,verifyPaperExecutionEvidenceEnvelope,formatPaperExecutionEvidence};
  window.MoneyTradingChart.redraw=canvas=>mounts.get(canvas)?.info?.redraw();
  document.addEventListener('DOMContentLoaded',()=>{const css=document.createElement('style');css.textContent='.mm-contract-chart:fullscreen,.mm-trading-fullscreen{background:var(--bg-secondary);padding:16px;overflow:auto}.mm-trading-fullscreen{position:fixed;inset:0;z-index:10000}';document.head.append(css);document.addEventListener('keydown',event=>{if(event.key==='Escape')document.querySelectorAll('.mm-trading-fullscreen').forEach(host=>{host.classList.remove('mm-trading-fullscreen');host.querySelector('[data-contract-fullscreen]').textContent='全屏';window.MoneyTradingChart.redraw(host.querySelector('canvas'));});});});
  document.addEventListener('DOMContentLoaded',()=>{const style=document.createElement('style');style.textContent='.mm-trading-chart{position:relative;min-width:0}.mm-trading-status{display:flex;flex-wrap:wrap;align-items:center;gap:8px;font-size:11px;color:var(--text-secondary);font-variant-numeric:tabular-nums}.mm-trading-zone{font-size:11px;padding:4px 8px;border:1px solid var(--border);border-radius:8px;background:var(--bg-secondary);color:var(--text-primary)}.mm-trading-readout{min-height:44px;font-size:12px;line-height:1.8;color:var(--text-secondary);font-variant-numeric:tabular-nums;padding:8px 4px}.mm-trading-readout span{color:var(--purple)}.mm-trading-crosshair{position:absolute;left:0;touch-action:pan-y;cursor:crosshair}.mm-trading-latest{position:absolute;right:94px;bottom:24px;background:var(--bg-secondary);color:var(--text-primary);border:1px solid var(--border);border-radius:8px;padding:8px}.mm-trading-latest[hidden]{display:none}.mm-paper-marker-detail{padding:8px;margin:6px 0;border:1px solid var(--border);border-radius:9px;background:var(--bg-secondary);color:var(--text-primary)}.mm-paper-marker-detail p{margin:0 0 6px;line-height:1.55;overflow-wrap:anywhere}.mm-paper-marker-detail [data-paper-evidence-details]{margin:6px 0 0;padding:8px;border:1px solid var(--border);border-radius:8px;background:var(--bg-primary);color:var(--text-primary);font:11px/1.6 ui-monospace,monospace;white-space:pre-wrap;overflow-wrap:anywhere}.mm-paper-marker-detail [data-paper-evidence-details][hidden]{display:none}';document.head.append(style);const each=fn=>document.querySelectorAll('.mm-trading-chart canvas:not(.mm-trading-crosshair)').forEach(canvas=>{const m=mounts.get(canvas);if(m?.info && canvas.getClientRects().length && !document.hidden)fn(m);});new MutationObserver(()=>each(m=>queuePaint(m,true))).observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});document.addEventListener('visibilitychange',()=>{if(!document.hidden)each(m=>queuePaint(m));});setInterval(()=>each(updateClock),1000);});
})();
