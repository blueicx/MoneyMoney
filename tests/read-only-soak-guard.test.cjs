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
