// Read-only official-source probe. No credentials, orders or application state.
const url = 'wss://data-stream.binance.vision/ws/btcusdt@kline_5m';
let count = 0, lastEvent = 0, finished = false;
const socket = new WebSocket(url);
const done = reason => {
  if (finished) return; finished = true; clearTimeout(timer); socket.close();
  console.log(JSON.stringify({ ok: count >= 2, source: 'Binance Spot public kline stream', validEvents: count, lastEvent: lastEvent ? new Date(lastEvent).toISOString() : null, reason }));
  process.exitCode = count >= 2 ? 0 : 1;
};
const timer = setTimeout(() => done(count >= 2 ? 'Observed through a server ping window' : 'No sufficient valid source events; use REST fallback'), 26000);
socket.addEventListener('message', event => {
  try {
    const input = JSON.parse(event.data), k = input.k, prices = [k.o, k.h, k.l, k.c].map(Number);
    if (input.e !== 'kline' || input.s !== 'BTCUSDT' || k.i !== '5m' || !prices.every(v => Number.isFinite(v) && v > 0) || input.E > Date.now() + 5000 || input.E < Date.now() - 60000) return;
    count++; lastEvent = input.E;
  } catch { /* Invalid events cannot count as acceptance evidence. */ }
});
socket.addEventListener('error', () => done('Source connection unavailable'));
