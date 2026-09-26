export interface ZonedDigestClock { date: string; minute: string; key: string; }

export function zonedDigestClock(value: Date | number | string, timeZone = 'Asia/Shanghai'): ZonedDigestClock {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('Invalid digest time');
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  const day = `${values.year}-${values.month}-${values.day}`;
  const minute = `${values.hour}:${values.minute}`;
  return { date: day, minute, key: `${day}:${minute}` };
}
