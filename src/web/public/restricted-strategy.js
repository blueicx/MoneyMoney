(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.MoneyRestrictedStrategy=api;})(typeof window!=='undefined'?window:globalThis,function(){
 'use strict';
 const version='restricted-conditions-v1',markets=['stocks','options','crypto','prediction'];
 const intervals={'1m':60000,'5m':300000,'15m':900000,'1h':3600000,'1d':86400000};
 const fields=['open','high','low','close','volume'],operators=['gt','gte','lt','lte','crossAbove','crossBelow'];
 function object(v,keys){if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!keys.includes(k)))throw Error('仅允许注册字段，不能提交代码、SQL或未知属性');}
 function number(v,min,max,label){if(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max)throw Error(label+'无效');return v;}
 function integer(v,min,max){number(v,min,max,'整数参数');if(!Number.isInteger(v))throw Error('需要整数参数');return v;}
 function expression(v){
  if(v&&Object.hasOwn(v,'value')){object(v,['value']);return {value:number(v.value,-1e9,1e9,'比较数值')};}
  object(v,['field','indicator','period','lag']);if(!fields.includes(v.field))throw Error('指标字段不支持');const lag=integer(v.lag??0,0,250);
  if(v.indicator!==undefined){if(!['sma','rsi'].includes(v.indicator)||v.indicator==='rsi'&&v.field!=='close')throw Error('未注册指标');return {indicator:v.indicator,field:v.field,period:integer(v.period,2,200),lag};}
  if(v.period!==undefined)throw Error('非指标表达式不能设置周期');return {field:v.field,lag};
 }
 function validate(input){
  object(input,['name','market','timeframe','entry','filter','exit','position','costs']);
  if(typeof input.name!=='string'||!input.name.trim()||input.name.length>100)throw Error('策略名称需1–100字');if(!markets.includes(input.market)||!intervals[input.timeframe])throw Error('市场或周期不支持');
  let nodes=0;function condition(v,depth=0){if(++nodes>64||depth>6)throw Error('条件节点或深度超过上限');if(v?.op==='all'||v?.op==='any'){object(v,['op','children']);if(!Array.isArray(v.children)||!v.children.length||v.children.length>8)throw Error('条件组需1–8项');return {op:v.op,children:v.children.map(c=>condition(c,depth+1))};}if(v?.op==='not'){object(v,['op','child']);return {op:v.op,child:condition(v.child,depth+1)};}object(v,['op','left','right']);if(!operators.includes(v.op))throw Error('比较操作不支持');return {op:v.op,left:expression(v.left),right:expression(v.right)};}
  object(input.position,['maxAllocationPct']);object(input.costs,['feeBps','slippageBps']);
  return {name:input.name.trim(),market:input.market,timeframe:input.timeframe,entry:condition(input.entry),...(Object.hasOwn(input,'filter')?{filter:condition(input.filter)}:{}),exit:condition(input.exit),position:{maxAllocationPct:number(input.position.maxAllocationPct,0.01,100,'资金比例')},costs:{feeBps:number(input.costs.feeBps,0,10000,'手续费'),slippageBps:number(input.costs.slippageBps,0,10000,'滑点')}};
 }
 function evaluate(input,bars,asOf){
  const d=validate(input),interval=intervals[d.timeframe];number(asOf,0,8.64e15,'时点');if(!Array.isArray(bars)||bars.length>5000)throw Error('仅允许最多5000根已归档K线');
  let previous=-Infinity;for(const b of bars){if(!b||!Number.isFinite(b.time)||b.time<=previous)throw Error('K线时间必须严格递增');previous=b.time;if(['open','high','low','close'].some(k=>!Number.isFinite(b[k])||b[k]<=0)||b.high<Math.max(b.open,b.close,b.low)||b.low>Math.min(b.open,b.close,b.high))throw Error('OHLC无效');if(b.volume!==undefined&&(!Number.isFinite(b.volume)||b.volume<0))throw Error('成交量无效');}
  const data=bars.filter(b=>b.time+interval<=asOf&&b.closed!==false),observations=[],points=[];
  // Daily observations follow trading days; intraday gaps must restart warm-up.
  const starts=data.map((b,i)=>i===0?0:null);for(let i=1;i<data.length;i++)starts[i]=interval<86400000&&data[i].time-data[i-1].time!==interval?i:starts[i-1];
  function value(expr,index){
   if(Object.hasOwn(expr,'value'))return expr.value;const end=index-expr.lag;if(end<0)return null;
   if(!expr.indicator)return Number.isFinite(data[end]?.[expr.field])?data[end][expr.field]:null;
   if(expr.indicator==='sma'){if(end-starts[end]+1<expr.period)return null;let sum=0;for(let j=end-expr.period+1;j<=end;j++){const v=data[j]?.[expr.field];if(!Number.isFinite(v))return null;sum+=v;}return sum/expr.period;}
   const start=starts[end];if(end-start<expr.period)return null;let gain=0,loss=0;for(let j=start+1;j<=end;j++){const diff=data[j].close-data[j-1].close,g=Math.max(0,diff),l=Math.max(0,-diff);if(j-start<=expr.period){gain+=g/expr.period;loss+=l/expr.period;}else{gain=(gain*(expr.period-1)+g)/expr.period;loss=(loss*(expr.period-1)+l)/expr.period;}}return gain===0&&loss===0?50:loss===0?100:100-100/(1+gain/loss);
  }
  function inspect(c,index){
   if(c.children){const children=c.children.map(v=>inspect(v,index));return {op:c.op,state:children.some(v=>v.state==='insufficient')?'insufficient':(c.op==='all'?children.every(v=>v.state==='met'):children.some(v=>v.state==='met'))?'met':'not-met',children,reason:children.some(v=>v.state==='insufficient')?'必要数据不足，禁止产生信号':null};}
   if(c.op==='not'){const child=inspect(c.child,index);return {op:c.op,state:child.state==='insufficient'?'insufficient':child.state==='met'?'not-met':'met',child,reason:child.state==='insufficient'?'必要数据不足，NOT不反转未知状态':null};}
   const left=value(c.left,index),right=value(c.right,index),beforeLeft=c.op.startsWith('cross')?value(c.left,index-1):0,beforeRight=c.op.startsWith('cross')?value(c.right,index-1):0;
   if([left,right,beforeLeft,beforeRight].some(v=>v===null)||c.op.startsWith('cross')&&(index===0||starts[index]===index))return {op:c.op,state:'insufficient',left,right,reason:'所需历史或字段不足，或存在日内缺口'};
   const met=c.op==='gt'?left>right:c.op==='gte'?left>=right:c.op==='lt'?left<right:c.op==='lte'?left<=right:c.op==='crossAbove'?left>right&&beforeLeft<=beforeRight:left<right&&beforeLeft>=beforeRight;
   return {op:c.op,state:met?'met':'not-met',left,right,reason:null};
  }
  for(let i=0;i<data.length;i++){const entry=inspect(d.entry,i),exit=inspect(d.exit,i),filter=d.filter?inspect(d.filter,i):{state:'met',reason:null},complete=[entry,exit,filter].every(v=>v.state!=='insufficient'),conflict=entry.state==='met'&&exit.state==='met';const row={index:i,time:data[i].time,price:data[i].close,entry,filter,exit,reason:!complete?'必要数据不足，禁止产生信号':conflict?'入场与退出同时满足，不产生可执行信号':null};observations.push(row);if(complete&&!conflict&&((entry.state==='met'&&filter.state==='met')||exit.state==='met'))points.push({time:row.time,price:row.price,index:i,direction:exit.state==='met'?'sell':'buy',confirmed:true,interpreterVersion:version,reason:'已完成K线条件满足；仅研究标记，不创建订单'});}
  return {interpreterVersion:version,observations,points,latest:observations.at(-1)||null,reason:data.length?null:'没有在所选时点完成的K线'};
 }
 return Object.freeze({version,validate,evaluate,capabilities:Object.freeze({markets,intervals,fields,operators,indicators:['sma','rsi'],logic:['all','any','not'],maxNodes:64,maxDepth:6,maxBars:5000})});
});
