export interface IntradayBar { time: number; open: number; high: number; low: number; close: number; volume: number; }

function tradingDateAt(time: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(time));
}

export function resolveStockExchangeTimeZone(symbol: string): string {
  const value = String(symbol || '').trim().toUpperCase();
  if (/^(HK\d{1,6}|\d{4,5}\.HK)$/.test(value) || value.endsWith('.HK')) return 'Asia/Hong_Kong';
  if (/^(SH|SZ|BJ)\d{6}$/.test(value) || /\.(SS|SZ|BJ)$/.test(value)) return 'Asia/Shanghai';
  return 'America/New_York';
}

export function filterStockBarsForTradingDate(bars: readonly IntradayBar[], date: string, timeZone: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || '')) || new Date(`${date}T00:00:00.000Z`).toISOString().slice(0, 10) !== date) throw new Error('Invalid trading date');
  try { new Intl.DateTimeFormat('en', { timeZone }).format(new Date()); } catch { throw new Error('Invalid exchange timezone'); }
  const ordered = bars.filter(bar => Number.isFinite(bar.time) && [bar.open, bar.high, bar.low, bar.close, bar.volume].every(value => Number.isFinite(Number(value)))).slice().sort((a, b) => a.time - b.time);
  const dates = [...new Set(ordered.map(bar => tradingDateAt(bar.time, timeZone)))].sort();
  const selected = ordered.filter(bar => tradingDateAt(bar.time, timeZone) === date);
  return {
    date,
    timeZone,
    bars: selected,
    ohlc: selected.length ? {
      open: selected[0].open,
      high: Math.max(...selected.map(bar => bar.high)),
      low: Math.min(...selected.map(bar => bar.low)),
      close: selected[selected.length - 1].close,
      volume: selected.reduce((sum, bar) => sum + Number(bar.volume || 0), 0),
    } : null,
    previousDate: dates.filter(item => item < date).at(-1) || null,
    nextDate: dates.find(item => item > date) || null,
    availableDateRange: dates.length ? { from: dates[0], to: dates[dates.length - 1] } : null,
  };
}
