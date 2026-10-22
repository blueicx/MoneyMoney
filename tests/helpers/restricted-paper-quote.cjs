// Explicit isolated browser preload only. Not imported by production code.
const fs=require('node:fs'),path=require('node:path'),file=process.env.MONEYMONEY_TEST_CLOCK_FILE;
if(!file||path.basename(file)!=='clock.json'||!/^mm-restricted-forward-browser-[A-Za-z0-9]+$/.test(path.basename(path.dirname(file)))||!fs.existsSync(file))throw Error('Paper quote fixture requires the isolated forward harness');
const guarded=globalThis.fetch;
globalThis.fetch=(input,options)=>{
 const url=String(input);
 if(url==='https://api.nasdaq.com/api/quote/AAPL/info?assetclass=stocks')return Promise.resolve(new Response(JSON.stringify({data:{symbol:'AAPL',primaryData:{lastSalePrice:'12.10',percentageChange:'0',lastTradeTimestamp:new Date(Date.now()).toISOString(),bidPrice:'12.00',askPrice:'12.20',isRealTime:true}}}),{status:200,headers:{'content-type':'application/json','x-fixture':'isolated-only-not-market-data'}}));
 return guarded(input,options);
};
