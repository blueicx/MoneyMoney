const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('src/web/public/index.html', 'utf8');
const server = fs.readFileSync('src/web/server.ts', 'utf8');

assert.match(html, /<option value="Predict\.fun">[^<]*Predict\.fun/);
assert.doesNotMatch(html, /<option value="Predict\.fun" disabled>/);
assert.match(server, /runner\.venue === 'Predict\.fun'/);
assert.match(server, /modelProbability|yesPrice/);
assert.match(server, /getCachedPredictionRadarSlice\('', 240\)/);
assert.match(server, /runnerOpenPosition\(runner\.id, price, qty, 'YES'/);

console.log('AI runner market selection: all assertions passed');
