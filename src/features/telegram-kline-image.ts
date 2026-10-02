import { deflateSync } from 'node:zlib';
interface Bar { open: number; high: number; low: number; close: number; }
function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const label = Buffer.from(type), length = Buffer.alloc(4), crc = Buffer.alloc(4);
  length.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([label, data])));
  return Buffer.concat([length, label, data, crc]);
}
/** Bounded raster rendering of observed candles, without external browser or synthetic bars. */
export function renderTelegramKline(input: Bar[]): { png: Buffer; ma5: number | null; ma10: number | null; ma20: number | null } {
  const bars = input.slice(-80);
  for (const b of bars) if (![b.open, b.high, b.low, b.close].every(Number.isFinite) || b.low <= 0 || b.high < Math.max(b.open, b.close, b.low) || b.low > Math.min(b.open, b.close)) throw new Error('OHLC 校验失败，不能绘图');
  if (bars.length < 2) throw new Error('K线数据不足，不能绘图');
  const width = 960, height = 480, stride = width * 3 + 1, pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { const i = y * stride + 1 + x * 3; pixels[i] = 15; pixels[i + 1] = 23; pixels[i + 2] = 42; }
  const set = (x: number, y: number, color: number[]) => { x = Math.round(x); y = Math.round(y); if (x < 0 || x >= width || y < 0 || y >= height) return; const i = y * stride + 1 + x * 3; for (let c = 0; c < 3; c++) pixels[i + c] = color[c]; };
  const line = (x1: number, y1: number, x2: number, y2: number, color: number[]) => { const n = Math.ceil(Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1))); for (let i = 0; i <= n; i++) set(x1 + (x2 - x1) * i / (n || 1), y1 + (y2 - y1) * i / (n || 1), color); };
  const low = Math.min(...bars.map(b => b.low)), high = Math.max(...bars.map(b => b.high)), span = Math.max(high - low, high * 0.01);
  const y = (price: number) => 440 - (price - low) / span * 400, x = (i: number) => 30 + i * 900 / bars.length;
  for (let i = 0; i <= 5; i++) line(20, 40 + i * 80, 940, 40 + i * 80, [40, 52, 73]);
  bars.forEach((b, i) => { const color = b.close >= b.open ? [34, 197, 94] : [239, 68, 68]; line(x(i), y(b.low), x(i), y(b.high), color); const half = Math.max(1, Math.floor(300 / bars.length)); for (let dx = -half; dx <= half; dx++) line(x(i) + dx, y(b.open), x(i) + dx, y(b.close), color); });
  const ma = (period: number) => bars.length < period ? null : bars.slice(-period).reduce((sum, b) => sum + b.close, 0) / period;
  for (const [period, color] of [[5, [245, 158, 11]], [10, [168, 85, 247]], [20, [14, 165, 233]]] as Array<[number, number[]]>) {
    let previous: number | null = null;
    for (let i = period - 1; i < bars.length; i++) { const value = bars.slice(i - period + 1, i + 1).reduce((sum, b) => sum + b.close, 0) / period; if (previous !== null) line(x(i - 1), y(previous), x(i), y(value), color); previous = value; }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  return { png: Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]), ma5: ma(5), ma10: ma(10), ma20: ma(20) };
}
