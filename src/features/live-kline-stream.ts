const intervals = new Set(['1m', '3m', '5m', '15m', '30m', '1h', '4h', '1d', '1w']);
type Socket = EventTarget & { close(): void };
type Listener = (event: Record<string, unknown>) => void;
export function liveKlineScope(market: string, instrument: string, interval: string) {
  const symbol = instrument.replace(/^crypto:binance:/, '').replace(/^binance:/, '');
  if (market !== 'crypto' || !/^[A-Z0-9]{5,24}$/.test(symbol) || !intervals.has(interval)) throw Error('当前市场、交易场所或周期不支持实时推流');
  return { symbol, interval, instrument: `crypto:binance:${symbol}` };
}
export function parseLiveKline(input: any, symbol: string, interval: string, now = Date.now()) {
  const k = input?.k;
  if (input?.e !== 'kline' || input.s !== symbol || k?.s !== symbol || k.i !== interval) return null;
  const [time, end, eventTime, open, high, low, close, volume] = [k.t, k.T, input.E, k.o, k.h, k.l, k.c, k.v].map(Number);
  if (![time, end, eventTime, open, high, low, close, volume].every(Number.isFinite) ||
      !Number.isInteger(time) || time <= 0 || end < time || time > eventTime || eventTime > now + 5000 || eventTime < now - 60000 ||
      Math.min(open, high, low, close) <= 0 || volume < 0 || high < Math.max(open, close, low) || low > Math.min(open, close) || typeof k.x !== 'boolean') return null;
  return { bar: { time, open, high, low, close, volume, closed: k.x }, eventTime };
}
type Channel = { scope: ReturnType<typeof liveKlineScope>; listeners: Set<Listener>; socket?: Socket; retry?: NodeJS.Timeout; watchdog?: NodeJS.Timeout; lastAt: number; lastEvent: number; lastBar: number; closedBar: boolean; failures: number };
export class LiveKlineHub {
  private channels = new Map<string, Channel>();
  constructor(private options: { socket?: (url: string) => Socket; enabled?: boolean } = {}) {}
  get size() { return this.channels.size; }
  subscribe(market: string, instrument: string, interval: string, listener: Listener) {
    const scope = liveKlineScope(market, instrument, interval), key = `${scope.symbol}:${interval}`;
    let channel = this.channels.get(key);
    if (!channel) {
      if (this.size >= 8) throw Error('实时通道已达到上限');
      channel = { scope, listeners: new Set(), lastAt: Date.now(), lastEvent: 0, lastBar: 0, closedBar: false, failures: 0 };
      this.channels.set(key, channel);
    }
    channel.listeners.add(listener);
    listener(this.state(channel, 'connecting', '等待有效行情；形成中的蜡烛不是已确认信号'));
    if (!channel.socket && !channel.retry) this.connect(key, channel);
    return () => { channel!.listeners.delete(listener); if (!channel!.listeners.size) this.release(key, channel!); };
  }
  private state(c: Channel, connection: string, reason: string) {
    return { type: 'status', market: 'crypto', instrument: c.scope.instrument, timeframe: c.scope.interval, source: 'Binance Spot Kline WebSocket', connection, dataStatus: connection === 'live' ? 'live' : 'unavailable', updatedAt: c.lastEvent ? new Date(c.lastEvent).toISOString() : null, reason };
  }
  private emit(c: Channel, event: Record<string, unknown>) { for (const listener of [...c.listeners]) { try { listener(event); } catch { /* A disconnected client cannot break other subscribers. */ } } }
  private connect(key: string, c: Channel) {
    if (this.channels.get(key) !== c || !c.listeners.size) return;
    if (this.options.enabled === false) { this.emit(c, this.state(c, 'disabled', '实时推流已关闭，使用 REST 快照')); return; }
    try {
      const socket = (this.options.socket || ((url: string) => new WebSocket(url)))(`wss://data-stream.binance.vision/ws/${c.scope.symbol.toLowerCase()}@kline_${c.scope.interval}`);
      c.socket = socket; c.lastAt = Date.now();
      const lost = () => {
        if (c.socket !== socket || this.channels.get(key) !== c) return;
        c.socket = undefined; clearInterval(c.watchdog); socket.close();
        this.emit(c, this.state(c, 'reconnecting', '推流中断；保留最后快照，REST 降级并等待重连'));
        c.retry = setTimeout(() => { c.retry = undefined; this.connect(key, c); }, Math.min(60000, 2000 * 2 ** Math.min(c.failures++, 5)));
        c.retry.unref();
      };
      socket.addEventListener('message', (message: Event) => {
        if (c.socket !== socket) return;
        const raw = (message as MessageEvent).data;
        if (typeof raw !== 'string' || raw.length > 16384) return;
        let parsed; try { parsed = parseLiveKline(JSON.parse(raw), c.scope.symbol, c.scope.interval); } catch { return; }
        if (!parsed || parsed.eventTime <= c.lastEvent || parsed.bar.time < c.lastBar || (c.closedBar && parsed.bar.time === c.lastBar && !parsed.bar.closed)) return;
        c.lastAt = Date.now(); c.lastEvent = parsed.eventTime; c.lastBar = parsed.bar.time; c.closedBar = parsed.bar.closed; c.failures = 0;
        this.emit(c, { ...this.state(c, 'live', ''), type: 'bar', ...parsed });
      });
      socket.addEventListener('close', lost); socket.addEventListener('error', lost);
      c.watchdog = setInterval(() => { if (Date.now() - c.lastAt >= 60000) lost(); }, 10000); c.watchdog.unref();
    } catch { this.emit(c, this.state(c, 'unavailable', 'WebSocket 来源不可用，使用 REST 快照')); c.retry = setTimeout(() => { c.retry = undefined; this.connect(key, c); }, 60000); c.retry.unref(); }
  }
  private release(key: string, c: Channel) { if (this.channels.get(key) !== c) return; this.channels.delete(key); clearTimeout(c.retry); clearInterval(c.watchdog); const socket = c.socket; c.socket = undefined; socket?.close(); }
  close() { for (const [key, c] of [...this.channels]) { this.emit(c, { type: 'end', reason: '服务正在关闭' }); this.release(key, c); } }
}
