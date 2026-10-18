const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');require('ts-node/register/transpile-only');
const input={market:'stocks',instrument:'stock:us:AAPL',timeframe:'5m',name:'财报后观察',note:'反证：成交量未确认',at:Date.parse('2026-10-15T15:00:00Z'),view:{count:42,follow:false,anchor:Date.parse('2026-10-15T16:00:00Z'),timeZone:'exchange',priceScale:1.2},chartConfig:{strategies:{maCross:true},indicators:{ma:true},patterns:false},asOf:null};
function api(){assert.ok(fs.existsSync('src/features/chart-bookmarks.ts'),'chart bookmark integration missing');return require('../src/features/chart-bookmarks');}
test('chart bookmarks reuse private SavedWorkspace records with bounded date/view/layer notes and no unrelated state',()=>{
 const {createChartBookmark}=api(),a=createChartBookmark(input),b=createChartBookmark(input);assert.notEqual(a.id,b.id);assert.equal(a.visibility,'private');assert.equal(a.workspace,'stock-quotes');assert.equal(a.filters.chartBookmark.note,input.note);assert.equal(a.filters.chartBookmark.view.count,42);assert.equal(a.filters.chartBookmark.view.priceScale,1.2);assert.equal(a.filters.chartBookmark.at,input.at);
 for(const value of [{market:'crypto'},{view:{...input.view,count:10000}},{note:'x'.repeat(4001)},{asOf:Date.now()+60000},{chartConfig:{token:'SECRET'}},{instrument:'AAPL'}])assert.throws(()=>createChartBookmark({...input,...value}));
 const historical=createChartBookmark({...input,view:null,asOf:input.at});assert.equal(historical.filters.chartBookmark.view,null);assert.match(historical.filters.chartBookmark.viewReason,/视窗|历史/);
});

test('private bookmark APIs reuse workspace storage and reject another market before returning a note',async()=>{
 assert.ok(fs.existsSync('src/web/chart-bookmark-routes.ts'),'bookmark routes missing');const express=require('express'),{createChartBookmarkRouter}=require('../src/web/chart-bookmark-routes'),rows=[];
 const app=express();app.use(express.json());app.use((req,res,next)=>{req.user={role:req.headers['x-role']};next();});app.use(createChartBookmarkRouter({list:market=>rows.filter(r=>!market||r.market===market),get:id=>rows.find(r=>r.id===id)||null,save:row=>rows.push(row)}));const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
 try{assert.equal((await fetch(base+'?market=stocks&instrument=stock:us:AAPL&timeframe=5m')).status,403);const response=await fetch(base,{method:'POST',headers:{'x-role':'admin','content-type':'application/json'},body:JSON.stringify(input)});assert.equal(response.status,201);const saved=(await response.json()).data;assert.equal(saved.filters.chartBookmark.note,input.note);assert.equal(rows.length,1);
 const found=await fetch(base+'?market=stocks&instrument=stock:us:AAPL&timeframe=5m',{headers:{'x-role':'admin'}});assert.match(found.headers.get('cache-control'),/no-store/);assert.equal((await found.json()).data.length,1);
 assert.equal((await fetch(base+'/'+saved.id)).status,403);assert.equal((await fetch(base+'?market=crypto&instrument=stock:us:AAPL&timeframe=5m',{headers:{'x-role':'admin'}})).status,400);
 }finally{await new Promise(r=>server.close(r));}
});
test('bookmark links require public HTTPS and market-exact private records, never exposing notes or accepting local credentials',()=>{
 const {createChartBookmark,chartBookmarkLink}=api(),row=createChartBookmark(input),href=chartBookmarkLink('https://example.com',row);assert.ok(href);const u=new URL(href);assert.equal(u.searchParams.get('bookmark'),row.id);assert.equal(u.searchParams.get('instrument'),input.instrument);assert.equal(href.includes(encodeURIComponent(input.note)),false);
 for(const base of ['http://example.com','https://localhost','https://127.0.0.1','https://[::1]','https://10.0.0.1','https://user:secret@example.com'])assert.equal(chartBookmarkLink(base,row),null);
 assert.equal(chartBookmarkLink('https://example.com',{...row,market:'crypto'}),null);
});
test('stored bookmarks validate again because generic workspaces accept arbitrary filters',()=>{
 const {createChartBookmark,readChartBookmark}=api(),row=createChartBookmark(input);
 assert.equal(typeof readChartBookmark,'function');assert.equal(readChartBookmark(row).id,row.id);
 for(const changed of [{visibility:'public'},{workspace:'stock-guru'},{market:'crypto'},{filters:{chartBookmark:{...row.filters.chartBookmark,chartConfig:{token:'secret'}}}},{filters:{chartBookmark:{...row.filters.chartBookmark,view:{count:9999}}}}])assert.equal(readChartBookmark({...row,...changed}),null);
});
