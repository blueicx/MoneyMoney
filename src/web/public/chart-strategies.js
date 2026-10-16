(function attach(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MoneyChartStrategies = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  const period = (label, value) => ({ label, default: value, min: 2, max: 250, step: 1 });
  const ratio = (label, value, min = .1, max = 10) => ({ label, default: value, min, max, step: .1 });
  const STRATEGY_CATALOG = [
    { id:'macdCross', label:'MACD 金叉/死叉', description:'SMA 初始化 EMA；MACD 与信号线交叉。', parameters:{fast:period('快线',12),slow:period('慢线',26),signal:period('信号线',9)} },
    { id:'emaPullback', label:'EMA 趋势回踩', description:'快慢 EMA 顺序与快线斜率同向，收盘重新穿越快线。', parameters:{fast:period('快线',20),slow:period('慢线',50)} },
    { id:'donchianBreakout', label:'唐奇安通道突破', description:'收盘严格突破此前 N 根最高价或最低价，不包含当前根。', parameters:{lookback:period('区间根数',20)} },
    { id:'bollingerSqueeze', label:'布林收窄突破', description:'上一根带宽不超过设定百分比，收盘突破上一根布林轨道。', parameters:{lookback:period('周期',20),multiplier:ratio('标准差倍数',2),maxWidthPct:ratio('最大带宽 %',4,.1,50)} },
    { id:'stochasticReversal', label:'随机指标反转', description:'原始 %K 与 SMA(%K) 交叉，前一根 %K 位于超卖/超买区。', parameters:{lookback:period('%K 周期',14),smooth:period('%D 平滑',3),lower:ratio('超卖',20,1,49),upper:ratio('超买',80,51,99)} },
    { id:'cciReversal', label:'CCI 反转', description:'典型价 CCI 从负阈值下方收复，或从正阈值上方跌破。', parameters:{lookback:period('周期',20),threshold:ratio('阈值',100,10,300)} },
    { id:'obvConfirmation', label:'OBV 量价确认', description:'价格突破此前高低点，同时 OBV 突破此前区间极值。', parameters:{lookback:period('区间根数',20)} },
    { id:'atrBreakout', label:'ATR 通道突破', description:'收盘突破上一根 EMA ± 倍数×Wilder ATR；当前冲击不改变阈值。', parameters:{emaPeriod:period('EMA',20),atrPeriod:period('ATR',14),multiplier:ratio('ATR 倍数',2)} },
    { id:'sessionVwap', label:'日内 VWAP 收复/跌破', description:'成交量加权典型价；须覆盖声明的会话起点，按交易所日期重置，不以截断数据补起点。', parameters:{minimumBars:period('最少会话根数',3)} },
    { id:'volumeBreakoutV2', label:'严格放量突破 v2', description:'收盘突破此前 N 根高低点，且成交量达到此前均量倍数；与旧版分开。', parameters:{lookback:period('区间根数',20),volumeMultiple:ratio('放量倍数',1.5,1,10)} },
  ].map(row => Object.freeze({ ...row, version:row.id==='volumeBreakoutV2'?'volume-breakout-v2':'chart-'+row.id+'-v1', parameters:Object.freeze(Object.fromEntries(Object.entries(row.parameters).map(([key,value])=>[key,Object.freeze(value)]))) }));
  Object.freeze(STRATEGY_CATALOG);

  function normalizeParameters(id, input = {}) {
    const entry = STRATEGY_CATALOG.find(row => row.id === id);
    if (!entry || !input || typeof input !== 'object' || Array.isArray(input)) return { valid:false, reason:'策略或参数无效' };
    const parameters = {};
    for (const [key, spec] of Object.entries(entry.parameters)) {
      const value = input[key] === undefined ? spec.default : Number(input[key]);
      if (input[key] === null || input[key] === '' || !Number.isFinite(value) || value < spec.min || value > spec.max || (spec.step === 1 && !Number.isInteger(value))) {
        return { valid:false, reason:`参数 ${spec.label} 必须在 ${spec.min}–${spec.max} 之间${spec.step===1?'且为整数':''}` };
      }
      parameters[key] = value;
    }
    if (parameters.fast >= parameters.slow || parameters.lower >= parameters.upper) return { valid:false, reason:'参数快线必须小于慢线，超卖必须小于超买' };
    return { valid:true, parameters };
  }

  function ema(values, size) {
    const output = Array(values.length).fill(null), factor = 2/(size+1);
    let previous = null;
    for(let i=size-1;i<values.length;i++){
      previous = previous === null ? values.slice(0,size).reduce((s,v)=>s+v,0)/size : previous+factor*(values[i]-previous);
      output[i]=previous;
    }
    return output;
  }
  const mean = values => values.reduce((sum,value)=>sum+value,0)/values.length;
  const up = (a,b,c,d) => [a,b,c,d].every(Number.isFinite)&&a<=b&&c>d;
  const down = (a,b,c,d) => [a,b,c,d].every(Number.isFinite)&&a>=b&&c<d;
  const display = value => Number(value).toLocaleString('en-US',{maximumFractionDigits:6,useGrouping:false});

  function evaluateStrategies(input = [], enabled = {}, context = {}) {
    const signals=[], statuses={};
    const entries=STRATEGY_CATALOG.filter(row=>enabled[row.id]===true);
    if(!entries.length)return {signals,statuses};
    const bars=Array.isArray(input)?input:[];
    const valid=bars.every((bar,index)=>bar && !bar.gap && ['time','open','high','low','close'].every(key=>typeof bar[key]==='number'&&Number.isFinite(bar[key]))
      && Math.abs(bar.time)<=8640000000000000 && bar.low>0 && bar.low<=Math.min(bar.open,bar.close) && bar.high>=Math.max(bar.open,bar.close) && (!index||bar.time>bars[index-1].time));
    const volumeValid=bars.every(bar=>typeof bar?.volume==='number'&&Number.isFinite(bar.volume)&&bar.volume>=0);
    const closes=bars.map(bar=>bar?.close);
    for(const entry of entries){
      const id=entry.id, normalized=normalizeParameters(id,context.parameters?.[id] ?? {});
      const fail=(reason,state='unavailable')=>{statuses[id]={state,reason,version:entry.version};};
      if(!normalized.valid){fail(normalized.reason,'invalid');continue;}
      if(!valid){fail('OHLC 或时间无效/重复，未计算信号');continue;}
      const p=normalized.parameters, lookback=p.lookback;
      const version=entry.version+':'+Object.entries(p).map(([key,value])=>key+'='+value).join(',')+(id==='sessionVwap'?':zone='+context.exchangeTimeZone+',anchor='+context.sessionStartMinutes:'');
      const add=(index,side,reason)=>signals.push({index,time:bars[index].time,price:bars[index].close,side,strategy:id,strategyVersion:version,parameters:{...p},label:entry.label+(side==='buy'?'买入':'卖出'),reason});
      const required=id==='macdCross'?p.slow+p.signal:id==='emaPullback'?p.slow+1:id==='atrBreakout'?Math.max(p.emaPeriod,p.atrPeriod+1)+1:id==='stochasticReversal'?p.lookback+p.smooth:lookback?lookback+1:p.minimumBars;
      if(bars.length<required){fail(`历史数据不足：至少 ${required} 根有效 K 线`,'insufficient');continue;}
      if(['obvConfirmation','sessionVwap','volumeBreakoutV2'].includes(id)&&!volumeValid){fail('成交量字段缺失或无效，不能计算量价策略');continue;}
      statuses[id]={state:'ready',reason:'当前已加载数据中未触发；不是收益保证',version,parameters:{...p}};
      if(id==='macdCross'){
        const fast=ema(closes,p.fast),slow=ema(closes,p.slow),line=closes.map((_,i)=>slow[i]===null?null:fast[i]-slow[i]);
        const compact=ema(line.slice(p.slow-1),p.signal),signal=Array(p.slow-1).fill(null).concat(compact);
        for(let i=1;i<bars.length;i++){
          if(up(line[i-1],signal[i-1],line[i],signal[i]))add(i,'buy',`MACD ${display(line[i])} 上穿信号线 ${display(signal[i])}`);
          if(down(line[i-1],signal[i-1],line[i],signal[i]))add(i,'sell',`MACD ${display(line[i])} 下穿信号线 ${display(signal[i])}`);
        }
      }else if(id==='emaPullback'){
        const fast=ema(closes,p.fast),slow=ema(closes,p.slow);
        for(let i=p.slow;i<bars.length;i++){
          if(fast[i]>slow[i]&&fast[i]>fast[i-1]&&up(closes[i-1],fast[i-1],closes[i],fast[i]))add(i,'buy',`上行 EMA${p.fast} ${display(fast[i])} 高于 EMA${p.slow} ${display(slow[i])}，收盘重新站回快线`);
          if(fast[i]<slow[i]&&fast[i]<fast[i-1]&&down(closes[i-1],fast[i-1],closes[i],fast[i]))add(i,'sell',`下行 EMA${p.fast} ${display(fast[i])} 低于 EMA${p.slow} ${display(slow[i])}，收盘重新跌回快线下方`);
        }
      }else if(['donchianBreakout','volumeBreakoutV2','obvConfirmation'].includes(id)){
        const obv=[0];for(let i=1;i<bars.length;i++)obv[i]=obv[i-1]+Math.sign(closes[i]-closes[i-1])*bars[i].volume;
        for(let i=lookback;i<bars.length;i++){
          const prior=bars.slice(i-lookback,i),high=Math.max(...prior.map(b=>b.high)),low=Math.min(...prior.map(b=>b.low));
          const average=mean(prior.map(b=>b.volume));
          if(id==='volumeBreakoutV2'&&(!(average>0)||bars[i].volume<average*p.volumeMultiple))continue;
          const priorObv=obv.slice(i-lookback,i);
          const extra=id==='volumeBreakoutV2'?`；量比 ${display(bars[i].volume/average)} ≥ ${p.volumeMultiple}`:id==='obvConfirmation'?`；OBV ${display(obv[i])} 同向突破`:'';
          if(closes[i]>high&&(id!=='obvConfirmation'||obv[i]>Math.max(...priorObv)))add(i,'buy',`收盘 ${display(closes[i])} 突破此前 ${lookback} 根最高价 ${display(high)}`+extra);
          if(closes[i]<low&&(id!=='obvConfirmation'||obv[i]<Math.min(...priorObv)))add(i,'sell',`收盘 ${display(closes[i])} 跌破此前 ${lookback} 根最低价 ${display(low)}`+extra);
        }
      }else if(id==='bollingerSqueeze'){
        for(let i=lookback;i<bars.length;i++){
          const values=closes.slice(i-lookback,i),mid=mean(values),deviation=Math.sqrt(mean(values.map(v=>(v-mid)**2))),upper=mid+p.multiplier*deviation,lower=mid-p.multiplier*deviation,width=100*(upper-lower)/mid;
          if(width>p.maxWidthPct)continue;
          if(up(closes[i-1],upper,closes[i],upper))add(i,'buy',`此前带宽 ${display(width)}% ≤ ${p.maxWidthPct}%；突破上轨 ${display(upper)}`);
          if(down(closes[i-1],lower,closes[i],lower))add(i,'sell',`此前带宽 ${display(width)}% ≤ ${p.maxWidthPct}%；跌破下轨 ${display(lower)}`);
        }
      }else if(id==='stochasticReversal'){
        const k=bars.map((bar,i)=>{if(i<lookback-1)return null;const window=bars.slice(i-lookback+1,i+1),high=Math.max(...window.map(b=>b.high)),low=Math.min(...window.map(b=>b.low));return high===low?null:100*(bar.close-low)/(high-low);});
        const d=k.map((_,i)=>{const values=k.slice(i-p.smooth+1,i+1);return i>=p.smooth-1&&values.every(Number.isFinite)?mean(values):null;});
        for(let i=1;i<bars.length;i++){
          if(k[i-1]<=p.lower&&up(k[i-1],d[i-1],k[i],d[i]))add(i,'buy',`%K ${display(k[i])} 上穿 %D ${display(d[i])}，上一根处于 ${p.lower} 以下`);
          if(k[i-1]>=p.upper&&down(k[i-1],d[i-1],k[i],d[i]))add(i,'sell',`%K ${display(k[i])} 下穿 %D ${display(d[i])}，上一根处于 ${p.upper} 以上`);
        }
      }else if(id==='cciReversal'){
        const typical=bars.map(b=>(b.high+b.low+b.close)/3),cci=typical.map((value,i)=>{if(i<lookback-1)return null;const values=typical.slice(i-lookback+1,i+1),middle=mean(values),deviation=mean(values.map(v=>Math.abs(v-middle)));return deviation>0?(value-middle)/(.015*deviation):null;});
        for(let i=1;i<bars.length;i++){
          if(up(cci[i-1],-p.threshold,cci[i],-p.threshold))add(i,'buy',`CCI ${display(cci[i])} 收复 -${p.threshold}`);
          if(down(cci[i-1],p.threshold,cci[i],p.threshold))add(i,'sell',`CCI ${display(cci[i])} 跌破 ${p.threshold}`);
        }
      }else if(id==='atrBreakout'){
        const center=ema(closes,p.emaPeriod),atr=Array(bars.length).fill(null);
        const tr=bars.map((bar,i)=>i?Math.max(bar.high-bar.low,Math.abs(bar.high-closes[i-1]),Math.abs(bar.low-closes[i-1])):null);
        for(let i=p.atrPeriod;i<bars.length;i++)atr[i]=i===p.atrPeriod?mean(tr.slice(1,i+1)):(atr[i-1]*(p.atrPeriod-1)+tr[i])/p.atrPeriod;
        for(let i=1;i<bars.length;i++){
          if(!Number.isFinite(center[i-1])||!Number.isFinite(atr[i-1]))continue;
          const upper=center[i-1]+p.multiplier*atr[i-1],lower=center[i-1]-p.multiplier*atr[i-1];
          if(up(closes[i-1],upper,closes[i],upper))add(i,'buy',`突破前一根 ATR 通道上界 ${display(upper)}；ATR ${display(atr[i-1])}`);
          if(down(closes[i-1],lower,closes[i],lower))add(i,'sell',`跌破前一根 ATR 通道下界 ${display(lower)}；ATR ${display(atr[i-1])}`);
        }
      }else if(id==='sessionVwap'){
        if(!['1m','5m','15m','1h'].includes(context.timeframe)){fail('仅支持日内周期，日线不能计算日内 VWAP','unsupported');continue;}
        if(typeof context.sessionStartMinutes!=='number'||context.sessionStartMinutes<0||context.sessionStartMinutes>=1440){fail('会话起点未声明，不能猜测起点');continue;}
        let formatter;
        try{if(!context.exchangeTimeZone)throw Error();formatter=new Intl.DateTimeFormat('en-CA',{timeZone:context.exchangeTimeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});}catch{fail('交易所时区缺失或无效');continue;}
        const intervalMs={'1m':60000,'5m':300000,'15m':900000,'1h':3600000}[context.timeframe];
        let day='',anchored=false,count=0,total=0,weighted=0,previous=null,gap=false;
        for(let i=0;i<bars.length;i++){
          const parts=Object.fromEntries(formatter.formatToParts(new Date(bars[i].time)).map(part=>[part.type,part.value]));
          const currentDay=parts.year+'-'+parts.month+'-'+parts.day,minute=Number(parts.hour)*60+Number(parts.minute);
          if(day!==currentDay){day=currentDay;anchored=false;count=0;total=0;weighted=0;previous=null;gap=false;}
          if(minute===context.sessionStartMinutes){anchored=true;count=0;total=0;weighted=0;previous=null;}
          if(!anchored||minute<context.sessionStartMinutes)continue;
          if(previous&&bars[i].time-previous.time!==intervalMs){anchored=false;previous=null;gap=true;continue;}
          const b=bars[i];total+=b.volume;weighted+=(b.high+b.low+b.close)/3*b.volume;count++;
          const vwap=total>0?weighted/total:null;
          if(count>=p.minimumBars&&previous){
            if(up(previous.close,previous.vwap,b.close,vwap))add(i,'buy',`收复会话 VWAP ${display(vwap)}；${context.exchangeTimeZone} 起点后 ${count} 根，累计成交量 ${display(total)}`);
            if(down(previous.close,previous.vwap,b.close,vwap))add(i,'sell',`跌破会话 VWAP ${display(vwap)}；${context.exchangeTimeZone} 起点后 ${count} 根，累计成交量 ${display(total)}`);
          }
          previous={close:b.close,vwap,time:b.time};
        }
        if(gap)fail('当前会话存在数据缺口，已停止累计 VWAP；不会插值补齐','insufficient');
        else if(!anchored)fail('数据未覆盖当前会话声明的起点，不能从截断区间伪造 VWAP','insufficient');
        else if(!(total>0))fail('会话成交量为零，VWAP 不可用');
        else if(count<p.minimumBars)fail(`当前会话数据不足 ${p.minimumBars} 根`,'insufficient');
      }
      const count=signals.filter(s=>s.strategy===id).length;
      if(count&&statuses[id].state==='ready')statuses[id].reason=`当前已加载数据触发 ${count} 个研究点位，不构成交易指令`;
    }
    signals.sort((a,b)=>a.index-b.index||a.strategy.localeCompare(b.strategy));
    return {signals,statuses};
  }
  return {STRATEGY_CATALOG,normalizeParameters,evaluateStrategies};
});
