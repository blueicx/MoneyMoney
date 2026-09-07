const assert = require('node:assert/strict');
const fs = require('node:fs');

const server = fs.readFileSync('src/web/server.ts', 'utf8');

// Verify Stocks is added to the market list in server.ts for /strategies start
assert.match(server, /'Binance' \| 'Predict\.fun' \| 'Stocks'/);
assert.match(server, /\['Binance', 'Predict\.fun', 'Stocks'\]/);
// Verify the usage message mentions Stocks AAPL 100
assert.match(server, /strategies start \[Stocks\|Binance\|Predict\.fun\] \[代码\] \[预算\] \(例如: \/strategies start Stocks AAPL 100\)/);

console.log('Telegram AI runner market parity: all assertions passed');
