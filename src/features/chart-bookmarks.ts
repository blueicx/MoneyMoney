import { randomUUID } from 'node:crypto';
import net from 'node:net';
import { isPublicWebhookAddress } from './extra-notification-channels';
import { createSavedWorkspace, type SavedWorkspace } from './decision-intelligence';
export function createChartBookmark(input:Record<string,any>):SavedWorkspace{
  if(!input||typeof input!=='object'||Object.keys(input).some(key=>!['market','instrument','timeframe','name','note','at','asOf','view','chartConfig'].includes(key)))throw Error('图表书签字段无效');
  const prefix=input.market==='stocks'?'stock:':input.market==='crypto'?'crypto:':null;
  if(!prefix||typeof input.instrument!=='string'||!input.instrument.startsWith(prefix)||!/^\w+:[^\s:]{1,40}:[^\s]{1,180}$/.test(input.instrument))throw Error('当前图表不支持该市场或标的身份');
  if(!['1m','5m','15m','1h','1d','3d','5d','60d','120d','1y','5y'].includes(input.timeframe)||typeof input.name!=='string'||!input.name.trim()||input.name.length>80||typeof input.note!=='string'||input.note.length>4000)throw Error('书签名称、周期或批注无效');
  const time=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=Date.now();
  if(!time(input.at)||input.asOf!=null&&!time(input.asOf))throw Error('书签日期或历史时点无效');
  const view=input.view;
  if(view!==null&&(!view||!Number.isSafeInteger(view.count)||view.count<15||view.count>300||typeof view.follow!=='boolean'||!['local','exchange'].includes(view.timeZone)||view.follow===false&&!time(view.anchor)||view.priceScale!=null&&(!Number.isFinite(view.priceScale)||view.priceScale<.25||view.priceScale>8)))throw Error('书签视窗无效');
  const config=input.chartConfig||{},allowed=['signals','patterns','structures','volume','supportResistance','maxLabels','strategies','indicators','patternTypes','strategyParameters'];
  if(typeof config!=='object'||Array.isArray(config)||Object.keys(config).some(key=>!allowed.includes(key))||JSON.stringify(config).length>16000)throw Error('书签只接受图层配置，不保存令牌、账户或行情报文');
  for(const [key,value] of Object.entries(config)){
    if(['signals','patterns','structures','volume','supportResistance'].includes(key)&&typeof value!=='boolean')throw Error('图层状态无效');
    if(['strategies','indicators','patternTypes'].includes(key)&&(!value||typeof value!=='object'||Array.isArray(value)||Object.entries(value).some(([k,v])=>!/^[A-Za-z0-9_-]{1,64}$/.test(k)||typeof v!=='boolean')||Object.keys(value).length>64))throw Error('图层开关无效');
    if(key==='maxLabels'&&(!Number.isSafeInteger(value)||Number(value)<1||Number(value)>500))throw Error('标记数量无效');
    if(key==='strategyParameters'&&(!value||typeof value!=='object'||Array.isArray(value)||Object.entries(value).some(([k,v])=>!/^[A-Za-z0-9_-]{1,64}$/.test(k)||!v||typeof v!=='object'||Array.isArray(v)||Object.entries(v).some(([name,n])=>!/^[A-Za-z0-9_-]{1,64}$/.test(name)||typeof n!=='number'||!Number.isFinite(n)))))throw Error('策略参数无效');
  }
  return createSavedWorkspace({id:`bookmark_${randomUUID()}`,name:input.name,market:input.market,workspace:input.market==='stocks'?'stock-quotes':'crypto-quotes',instrument:input.instrument,timeframe:input.timeframe,visibility:'private',filters:{chartBookmark:{version:1,note:input.note,at:input.at,asOf:input.asOf??null,view:view?{count:view.count,follow:view.follow,anchor:view.follow?null:view.anchor,timeZone:view.timeZone,priceScale:view.priceScale||1}:null,viewReason:view?'保存当前交互视窗；恢复不自动追随最新':'历史/Replay模式仅保存日期、图层与批注；未保存不适用的实时交互视窗',chartConfig:structuredClone(config)}}});
}
export function readChartBookmark(record:SavedWorkspace|null|undefined):SavedWorkspace|null{
  try{
    const b=record?.filters?.chartBookmark as any;
    if(!record||record.visibility!=='private'||b?.version!==1||record.workspace!==(record.market==='stocks'?'stock-quotes':'crypto-quotes'))return null;
    const validated=createChartBookmark({market:record.market,instrument:record.instrument,timeframe:record.timeframe,name:record.name,note:b.note,at:b.at,asOf:b.asOf,view:b.view,chartConfig:b.chartConfig});
    return {...validated,id:record.id,createdAt:record.createdAt,updatedAt:record.updatedAt};
  }catch{return null;}
}
export function chartBookmarkLink(base:string|null|undefined,record:SavedWorkspace):string|null{
  if(!base||!readChartBookmark(record))return null;
  try{const url=new URL(base),host=url.hostname.replace(/^\[|\]$/g,'').toLowerCase();
    if(url.protocol!=='https:'||url.username||url.password||host==='localhost'||host.endsWith('.local')||host.endsWith('.internal')||net.isIP(host)&&!isPublicWebhookAddress(host))return null;
    if(!record.instrument?.startsWith(record.market==='stocks'?'stock:':record.market==='crypto'?'crypto:':'unsupported:'))return null;
    url.search='';url.hash='';url.searchParams.set('market',record.market);url.searchParams.set('workspace',record.workspace);url.searchParams.set('instrument',record.instrument);url.searchParams.set('timeframe',record.timeframe||'1d');url.searchParams.set('bookmark',record.id);return url.toString();
  }catch{return null;}
}
