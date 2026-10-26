const test=require('node:test'),assert=require('node:assert/strict');
const {allowedRead}=require('./helpers/read-only-soak-guard.cjs');
test('public source reads are allowed while order, model and notification calls are blocked',()=>{
 assert.equal(allowedRead('https://query1.finance.yahoo.com/v8/finance/chart/AAPL','GET'),true);
 assert.equal(allowedRead('https://api.binance.com/api/v3/klines','GET'),true);
 assert.equal(allowedRead('https://api.binance.com/api/v3/order','POST'),false);
 assert.equal(allowedRead('https://api.binance.com/api/v3/account','GET'),false);
 assert.equal(allowedRead('https://api.openai.com/v1/chat/completions','POST'),false);
 assert.equal(allowedRead('https://api.telegram.org/botSECRET/getUpdates','GET'),false);
 assert.equal(allowedRead('http://127.0.0.1:3207/api/health/live','GET'),true);
});

test('only explicit public market and financial research hosts pass GET/HEAD',()=>{
 for(const host of [
  'query2.finance.yahoo.com','hq.sinajs.cn','api.nasdaq.com','api.eastmoney.com','data-api.binance.vision',
  'fapi.binance.com','api.gateio.ws','api.coinbase.com','www.deribit.com','cdn.cboe.com',
  'api.elections.kalshi.com','demo-api.kalshi.co','gamma-api.polymarket.com','api.manifold.markets',
  'www.metaculus.com','www.goodjudgment.com','www.gjopen.com','data.sec.gov','qt.gtimg.cn','smartbox.gtimg.cn'
 ]) assert.equal(allowedRead(`https://${host}/public/market-data`,'GET'),true,host);
 for(const host of [
  'fanyi.sogou.com','aidemo.youdao.com','api.mymemory.translated.net','example.com','www.google.com',
  'query1.finance.yahoo.com.attacker.example','evil-yahoo.com','api.qq.com','www.gtimg.cn'
 ]) assert.equal(allowedRead(`https://${host}/public/market-data`,'GET'),false,host);
 assert.equal(allowedRead('http://query1.finance.yahoo.com/v8/finance/chart/AAPL','GET'),false);
 assert.equal(allowedRead('https://query1.finance.yahoo.com/v8/finance/chart/AAPL','HEAD'),true);
 assert.equal(allowedRead('http://localhost:3207/api/health/live','GET'),true);
 assert.equal(allowedRead('http://[::1]:3207/api/health/live','HEAD'),true);
 assert.equal(allowedRead('https://127.0.0.1:3207/api/health/live','GET'),true);
 assert.equal(allowedRead('http://127.0.0.2:3207/api/health/live','GET'),true);
 assert.equal(allowedRead('http://192.168.1.2:3207/api/health/live','GET'),false);
});

test('private read endpoints remain blocked on otherwise allowed market hosts',()=>{
 for(const path of [
  '/api/v3/account','/api/v3/openOrders','/api/v3/allOrders','/api/v3/myTrades',
  '/api/v3/userDataStream','/api/v3/trades','/api/v2/private/get_account_summary',
  '/api/v2/private/get_positions','/api/v1/wallet/balance','/api/v1/wallets',
  '/api/v1/balance'
 ]) assert.equal(allowedRead(`https://api.binance.com${path}`,'GET'),false,path);
 assert.equal(allowedRead('https://www.deribit.com/api/v2/private/get_account_summary','GET'),false);
 assert.equal(allowedRead('https://api.binance.com/api/v3/%6fpenOrders','GET'),false);
});
