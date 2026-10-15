type Venue='us'|'cn'|'hk';
export interface SessionCalendarEvidence {venue:Venue;date:string;source:string;sourceUrl:string;publishedAt:string;closed?:boolean;regularCloseMinute?:number}
// Verified 2026-10-15 against NYSE/ICE's dated 2025-12-23 announcement.
// Facts only; not scraped business code. Cash equities only, no option late-close inference.
const NYSE_HOLIDAYS=[
  '2026-01-01','2026-01-19','2026-02-16','2026-04-03','2026-05-25','2026-06-19','2026-07-03','2026-09-07','2026-11-26','2026-12-25',
  '2027-01-01','2027-01-18','2027-02-15','2027-03-26','2027-05-31','2027-06-18','2027-07-05','2027-09-06','2027-11-25','2027-12-24',
  '2028-01-17','2028-02-21','2028-04-14','2028-05-29','2028-06-19','2028-07-04','2028-09-04','2028-11-23','2028-12-25',
];
const NYSE_EARLY=['2026-11-27','2026-12-24','2027-11-26','2028-07-03','2028-11-24'];
export function exchangeSessionContext(venue:Venue,now=Date.now(),evidence?:SessionCalendarEvidence|null){
  if(!['us','cn','hk'].includes(venue)||!Number.isFinite(now))throw Error('交易场所或时间无效');
  const timezone=venue==='us'?'America/New_York':venue==='cn'?'Asia/Shanghai':'Asia/Hong_Kong';
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now),value=(key:string)=>parts.find(row=>row.type===key)?.value||'';
  const date=`${value('year')}-${value('month')}-${value('day')}`,minute=Number(value('hour'))*60+Number(value('minute')),weekday=!['Sat','Sun'].includes(value('weekday'));
  if(evidence===undefined&&venue==='us'&&(NYSE_HOLIDAYS.includes(date)||NYSE_EARLY.includes(date))){evidence={venue,date,source:'NYSE cash equities published holiday calendar',sourceUrl:'https://ir.theice.com/press/news-details/2025/NYSE-Group-Announces-2026-2027-and-2028-Holiday-and-Early-Closings-Calendar/default.aspx',publishedAt:'2025-12-24T00:00:00Z',closed:NYSE_HOLIDAYS.includes(date),regularCloseMinute:NYSE_EARLY.includes(date)?780:undefined};}
  let validEvidence=false;try{validEvidence=Boolean(evidence&&evidence.venue===venue&&evidence.date===date&&evidence.source&&new URL(evidence.sourceUrl).protocol==='https:'&&Number.isFinite(Date.parse(evidence.publishedAt))&&Date.parse(evidence.publishedAt)<=now);}catch{}
  const normalClose=venue==='cn'?900:960,close=validEvidence&&Number.isInteger(evidence?.regularCloseMinute)&&evidence!.regularCloseMinute!>=570&&evidence!.regularCloseMinute!<=normalClose?evidence!.regularCloseMinute!:normalClose;
  const earlyClose=close<normalClose,verifiedClosed=Boolean(validEvidence&&evidence?.closed===true);
  const phase=verifiedClosed?'closed':!weekday?'outside':venue==='us'?minute>=240&&minute<570?'pre':minute>=570&&minute<close?'regular':minute>=close&&minute<1200?'post':'outside':minute>=570&&minute<close?(venue==='cn'&&minute>=690&&minute<780||venue==='hk'&&minute>=720&&minute<780?'break':'regular'):'outside';
  return {venue,timezone,date,phase,earlyClose,verifiedClosed,source:validEvidence?evidence!.source:'常规交易时段定义（非节假日证据）',sourceUrl:validEvidence?evidence!.sourceUrl:null,
    publishedAt:validEvidence?evidence!.publishedAt:null,reason:validEvidence?'来源已声明本日交易安排；行情新鲜度与连接状态另行判断':'仅显示常规时段；节假日、临时停市及早收市缺少来源证据，不据此标为休市'};
}
