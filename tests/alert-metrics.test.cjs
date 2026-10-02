const test=require('node:test');const assert=require('node:assert/strict');const {completedBarMetrics}=require('../dist/features/alert-metrics.js');
test('technical alert metrics use completed bars only and reject invalid OHLC/volume',()=>{
 const now=Date.parse('2026-10-02T00:00:00Z');const bars=Array.from({length:16},(_,i)=>({time:now-(17-i)*86400000,open:100+i,high:102+i,low:99+i,close:101+i,volume:200}));
 bars.push({time:now-86400000,open:100,high:90,low:110,close:105,volume:-1});bars.push({time:now,open:1,high:999,low:1,close:999,volume:999});
 const result=completedBarMetrics(bars,now);assert.equal(result.metrics.volume,200);assert.equal(result.metrics.rsi,100);assert.equal(result.barAt,new Date(now-2*86400000).toISOString());
 assert.match(completedBarMetrics([],now).reason,/缺少/);
});
