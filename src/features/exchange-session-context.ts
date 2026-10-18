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
const formatters=new Map<string,Intl.DateTimeFormat>();
export function exchangeSessionContext(venue:Venue,now=Date.now(),evidence?:SessionCalendarEvidence|null){
  if(!['us','cn','hk'].includes(venue)||!Number.isFinite(now))throw Error('交易场所或时间无效');
  const timezone=venue==='us'?'America/New_York':venue==='cn'?'Asia/Shanghai':'Asia/Hong_Kong';
  if(!formatters.has(timezone))formatters.set(timezone,new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}));
  const parts=formatters.get(timezone)!.formatToParts(now),value=(key:string)=>parts.find(row=>row.type===key)?.value||'';
  const date=`${value('year')}-${value('month')}-${value('day')}`,minute=Number(value('hour'))*60+Number(value('minute')),weekday=!['Sat','Sun'].includes(value('weekday'));
  if(evidence===undefined&&venue==='us'&&(NYSE_HOLIDAYS.includes(date)||NYSE_EARLY.includes(date))){evidence={venue,date,source:'NYSE cash equities published holiday calendar',sourceUrl:'https://ir.theice.com/press/news-details/2025/NYSE-Group-Announces-2026-2027-and-2028-Holiday-and-Early-Closings-Calendar/default.aspx',publishedAt:'2025-12-24T00:00:00Z',closed:NYSE_HOLIDAYS.includes(date),regularCloseMinute:NYSE_EARLY.includes(date)?780:undefined};}
  let validEvidence=false;try{validEvidence=Boolean(evidence&&evidence.venue===venue&&evidence.date===date&&evidence.source&&new URL(evidence.sourceUrl).protocol==='https:'&&Number.isFinite(Date.parse(evidence.publishedAt))&&Date.parse(evidence.publishedAt)<=now);}catch{}
  const normalClose=venue==='cn'?900:960,close=validEvidence&&Number.isInteger(evidence?.regularCloseMinute)&&evidence!.regularCloseMinute!>=570&&evidence!.regularCloseMinute!<=normalClose?evidence!.regularCloseMinute!:normalClose;
  const earlyClose=close<normalClose,verifiedClosed=Boolean(validEvidence&&evidence?.closed===true);
  const phase=verifiedClosed?'closed':!weekday?'outside':venue==='us'?minute>=240&&minute<570?'pre':minute>=570&&minute<close?'regular':minute>=close&&minute<1200?'post':'outside':minute>=570&&minute<close?(venue==='cn'&&minute>=690&&minute<780||venue==='hk'&&minute>=720&&minute<780?'break':'regular'):'outside';
  return {venue,timezone,date,phase,earlyClose,verifiedClosed,source:validEvidence?evidence!.source:'常规交易时段定义（非节假日证据）',sourceUrl:validEvidence?evidence!.sourceUrl:null,
    publishedAt:validEvidence?evidence!.publishedAt:null,reason:validEvidence?'来源已声明本日交易安排；行情新鲜度与连接状态另行判断':'仅显示常规时段；节假日、临时停市及早收市缺少来源证据，不据此标为休市'};
}

/** Read-only interval classification. Nominal session slots never prove a halt or missing candles. */
export function auditStockSessionGaps(input:{market:string;instrument:string;timeframe:string;asOf?:number|null;gaps:Array<{from:number;to:number}>},now=Date.now()){
  const identity=/^stock:(us|cn|hk):[A-Za-z0-9.]{1,20}$/.exec(input.instrument||'');
  if(input.market!=='stocks'||!identity)throw Error('股票交易场所或标的身份无效');
  const step=({'1m':60000,'5m':300000,'15m':900000,'1h':3600000,'1d':86400000} as Record<string,number>)[input.timeframe];
  if(!step)throw Error('当前周期不支持日历间隔检查');
  if(!Array.isArray(input.gaps)||input.gaps.length>32)throw Error('每次最多检查32个间隔');
  const cut=input.asOf??now;
  if(!Number.isFinite(cut)||cut>now)throw Error('历史时点无效或晚于当前时间');
  let work=0;
  for(const gap of input.gaps){
    if(!gap||![gap.from,gap.to].every(Number.isFinite)||gap.from<0||gap.to<=gap.from||gap.to>cut||gap.to-gap.from>31*86400000)throw Error('间隔范围无效、超过31天或超出历史时点');
    work+=Math.max(0,Math.ceil((gap.to-gap.from)/step)-1);
  }
  if(work>10000)throw Error('日历检查超过10000个周期预算，请缩小区间');
  const venue=identity[1] as Venue;
  const gaps=input.gaps.map(gap=>{
    let regularSlots=0,nominalOutsideSlots=0,verifiedClosedSlots=0;const sources=new Set<string>();
    for(let t=gap.from+step;t<gap.to;t+=step){
      const session=exchangeSessionContext(venue,t);
      if(session.sourceUrl)sources.add(session.sourceUrl);
      if(session.verifiedClosed)verifiedClosedSlots++;
      else if(session.phase==='regular')regularSlots++;
      else nominalOutsideSlots++;
    }
    const slots=regularSlots+nominalOutsideSlots+verifiedClosedSlots;
    const verification=slots>0&&verifiedClosedSlots===slots?'calendar-closure':slots>0&&regularSlots===0?'outside-regular-session':'unverified-trading-gap';
    return {...gap,verification,regularSlots,nominalOutsideSlots,verifiedClosedSlots,missingBars:null,
      sourceUrl:sources.size===1?[...sources][0]:null,
      reason:verification==='calendar-closure'?'区间内名义周期均有已发布休市证据，不列为缺失K线':verification==='outside-regular-session'?'位于常规盘外、周末或已声明早收市之后；不是漏数证明，是否提供盘前盘后数据取决于来源':'存在常规交易时段，但未核验停牌、来源覆盖和成交；仅为待核验漏数，不推算缺失根数'};
  });
  return {market:input.market,instrument:input.instrument,timeframe:input.timeframe,asOf:input.asOf??null,timezone:exchangeSessionContext(venue,cut).timezone,gaps,
    dataStatus:'partial',source:'现有交易所日历证据与常规交易时段定义',reason:'只读分类，不查询报价、不修复分区；常规时段不是本日必然开市或未停牌的证明。',orderChanges:0};
}
