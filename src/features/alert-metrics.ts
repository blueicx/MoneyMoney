export function completedBarMetrics(input: Array<Record<string, any>>, now=Date.now()) {
  const bars=input.filter(row=>Number.isFinite(Number(row.time)) && Number(row.time)+86_400_000<=now && ['open','high','low','close'].every(field=>typeof row[field]==='number' && Number.isFinite(row[field]) && row[field]>0) && row.high>=Math.max(row.open,row.close,row.low) && row.low<=Math.min(row.open,row.close,row.high) && (row.volume==null || typeof row.volume==='number' && Number.isFinite(row.volume) && row.volume>=0)).sort((a,b)=>a.time-b.time);
  const last=bars.at(-1), before=bars.at(-2);
  const metrics: Record<string,number|string>={};
  if(!last || now-(last.time+86_400_000)>4*86_400_000) return {metrics,reason:'缺少最近已完成日线，技术条件不可用'};
  if(typeof last.volume==='number' && Number.isFinite(last.volume)) metrics.volume=last.volume;
  if(bars.length>=15) {let gain=0,loss=0;for(let i=bars.length-14;i<bars.length;i++){const delta=bars[i].close-bars[i-1].close;gain+=Math.max(0,delta);loss+=Math.max(0,-delta);}metrics.rsi=loss===0 ? gain===0 ? 50:100 : 100-100/(1+gain/loss);}
  const body=Math.abs(last.close-last.open),range=last.high-last.low;
  if(range>0 && body<=range*.1) metrics.pattern='doji';
  else if(body>0 && Math.min(last.open,last.close)-last.low>=body*2 && last.high-Math.max(last.open,last.close)<=body) metrics.pattern='hammer';
  else if(before && before.close<before.open && last.close>last.open && last.open<=before.close && last.close>=before.open) metrics.pattern='bullish-engulfing';
  else if(before && before.close>before.open && last.close<last.open && last.open>=before.close && last.close<=before.open) metrics.pattern='bearish-engulfing';
  else metrics.pattern='none';
  return {metrics,barAt:new Date(last.time).toISOString(),reason:null};
}
