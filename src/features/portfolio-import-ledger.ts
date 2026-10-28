import {createHash,randomUUID} from 'node:crypto';
import type {SQLiteStateStore} from '../storage/sqlite-state';
import type {MarketId} from './research-contracts';

type State=Pick<SQLiteStateStore,'get'|'set'|'transaction'|'health'|'appendAudit'>;

export interface ImportedPortfolioRow {
  id:string;
  market:MarketId;
  instrument:string;
  currency:string;
  quantity:number;
  averageCost:number;
  price:number;
  fees:number;
  asOf:string;
  accountSource:string;
  accountId:string;
  rawHash:string;
}

export interface PortfolioImportPreview {
  id:string;
  accountKey:string;
  accountSource:string;
  accountId:string;
  fileName:string;
  fileHash:string;
  asOf:string;
  expectedVersion:number;
  accepted:ImportedPortfolioRow[];
  duplicates:Array<{row:number;identity:string;reason:string;rawHash:string}>;
  rejected:Array<{row:number;reason:string;rawHash:string|null}>;
  totalsByCurrency:Record<string,{quantity:number;costBasis:number;marketValue:number;fees:number}>;
  companyActions:Record<string,Array<{id:string;kind:string;effectiveAt:string;factor:number|null;contentHash:string|null;publishedAt:string|null;observedAt:string|null}>>;
  coverage:{inputRows:number;acceptedRows:number;duplicateRows:number;rejectedRows:number;companyActionCoverage:'partial'};
  previewHash:string;
  createdAt:number;
  reason:string;
}

interface LedgerDocument {
  version:1;
  accountKey:string;
  currentVersion:number;
  currentHash:string|null;
  versions:string[];
  requests:Record<string,{requestHash:string;versionId:string}>;
  previews:Record<string,PortfolioImportPreview>;
  updatedAt:number;
}

interface LedgerVersion {
  id:string;
  version:1;
  accountKey:string;
  accountSource:string;
  accountId:string;
  number:number;
  previousVersionId:string|null;
  previousHash:string|null;
  action:'import'|'rollback';
  fileName:string;
  fileHash:string;
  asOf:string;
  rows:ImportedPortfolioRow[];
  rawHashes:string[];
  source:{format:'csv'|'json';content:string;fileName:string;fileHash:string};
  companyActions:PortfolioImportPreview['companyActions'];
  previewHash:string;
  createdAt:string;
  reason:string;
  contentHash:string;
}

interface Dependencies {
  resolve:(market:string,instrument:string)=>{id:string;symbol:string}|null;
  companyActions?:(identity:{market:'stocks';instrument:string;asOf:string})=>{
    records:Array<{
      action:{id:string;kind:string;effectiveAt:string;factor?:number;publishedAt?:string;observedAt?:string};
      recordedAt:string;
      contentHash:string;
    }>;
    coverage:'partial';
    reason:string;
  };
}

const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const accountKey=(source:string,id:string)=>digest({source,id});
const docKey=(key:string)=>`portfolio-import-ledger:v1:${key}`;
const sourceKey=(previewId:string)=>`portfolio-import-source:v1:${previewId}`;
const ACCOUNT_INDEX='portfolio-import-ledger:accounts:v1';

export function parseCsv(content:string):string[][]{
  if(typeof content!=='string'||!content.trim())throw Error('CSV 内容为空');
  if(Buffer.byteLength(content,'utf8')>2*1024*1024)throw Error('CSV 超过2MB导入预算');
  const rows:string[][]=[];let row:string[]=[],field='',quoted=false;
  for(let i=0;i<content.length;i++){
    const char=content[i];
    if(quoted){
      if(char==='"'){if(content[i+1]==='"'){field+='"';i++;}else quoted=false;}
      else field+=char;
    }else if(char==='"')quoted=true;
    else if(char===',') {row.push(field);field='';}
    else if(char==='\r'||char==='\n'){
      if(char==='\r'&&content[i+1]==='\n')i++;
      row.push(field);field='';
      if(row.some(value=>value.trim()))rows.push(row);
      row=[];
    }else field+=char;
  }
  if(quoted)throw Error('CSV 引号未闭合');
  row.push(field);if(row.some(value=>value.trim()))rows.push(row);
  if(rows.length<2||rows.length>5001)throw Error('CSV 需要表头和1–5000条记录');
  return rows;
}

function rowsFromCsv(content:string):Array<Record<string,string>>{
  const parsed=parseCsv(content),headers=parsed[0].map(value=>value.trim());if(new Set(headers).size!==headers.length||headers.some(header=>!/^[A-Za-z][A-Za-z0-9_]*$/.test(header)))throw Error('CSV 表头重复或无效');
  return parsed.slice(1).map(values=>Object.fromEntries(headers.map((header,index)=>[header,String(values[index]??'')])));
}

/** Versioned manual import only; it does not mutate the executable paper ledger. */
export class PortfolioImportLedgerStore {
 constructor(private state:State,private deps:Dependencies,private now=Date.now){}
 private accounts(){const rows=this.state.get<string[]>(ACCOUNT_INDEX)||[];if(!this.state.health.ok||!Array.isArray(rows)||rows.length>100||rows.some(key=>!/^[a-f0-9]{64}$/.test(key)))throw Error('导入账户目录不可核验');return rows;}
 private doc(key:string):LedgerDocument|null{
  if(!/^[a-f0-9]{64}$/.test(key))throw Error('导入账户键无效');
  const doc=this.state.get<LedgerDocument>(docKey(key));
  if(doc===null||doc===undefined)return null;
  if(doc.version!==1||doc.accountKey!==key||!Number.isSafeInteger(doc.currentVersion)||!Array.isArray(doc.versions)||doc.versions.length>100||!doc.requests||!doc.previews)throw Error('导入账户账本损坏');
  return structuredClone(doc);
 }
 private readVersion(id:string):LedgerVersion{
  if(!/^portfolio_import_[a-f0-9]{64}$/.test(id))throw Error('导入版本ID无效');
  const row=this.state.get<LedgerVersion>('portfolio-import-version:'+id);
  if(!row||row.id!==id||row.version!==1){throw Error('导入版本不存在或损坏');}
  const {contentHash,...payload}=row;if(contentHash!==digest(payload)||row.rawHashes.length!==row.rows.length)throw Error('导入版本Hash不可核验');
  return structuredClone(row);
 }
 current(accountSource:string,accountId:string){
  const source=String(accountSource||'').trim(),id=String(accountId||'').trim();if(!source||!id)throw Error('需要明确账户来源和账户ID');
  const key=accountKey(source,id),doc=this.doc(key);if(!doc||!doc.currentHash)return {accountKey:key,accountSource:source,accountId:id,version:null,reason:'该账户尚无已确认导入版本'};
  const version=this.readVersion(doc.currentHash);return {accountKey:key,accountSource:source,accountId:id,version,reason:'已确认的独立研究导入版本；不是执行账户'};
 }
 async preview(input:{fileName:string;format:'csv'|'json';content:string;accountSource:string;accountId:string;expectedVersion:number;acknowledge?:boolean}){
  if(!input||Object.keys(input).some(key=>!['fileName','format','content','accountSource','accountId','expectedVersion','acknowledge'].includes(key)))throw Error('导入预览字段无效');
  const fileName=String(input.fileName||'').trim(),accountSource=String(input.accountSource||'').trim(),accountId=String(input.accountId||'').trim();
  if(!fileName||fileName.length>255||!/\.(csv|json)$/i.test(fileName)||!accountSource||accountSource.length>120||!accountId||accountId.length>120)throw Error('文件名或账户身份无效');
  if(!Number.isSafeInteger(input.expectedVersion)||input.expectedVersion<0)throw Error('期望账本版本无效');
  if(typeof input.content!=='string'||Buffer.byteLength(input.content,'utf8')>2*1024*1024)throw Error('导入文件为空或超过2MB');
  let normalized:unknown;
  try{normalized=input.format==='csv'?rowsFromCsv(input.content):JSON.parse(input.content);}catch(error){throw error instanceof Error?error:Error('导入文件无法解析');}
  const rows=Array.isArray(normalized)?normalized:null;if(!rows||rows.length<1||rows.length>5000)throw Error('导入文件需要1–5000条记录');
  if(input.format==='csv'&&!fileName.toLowerCase().endsWith('.csv')||input.format==='json'&&!fileName.toLowerCase().endsWith('.json'))throw Error('文件格式与扩展名不一致');
  const fileHash=createHash('sha256').update(input.content).digest('hex') as string,key=accountKey(accountSource,accountId),doc=this.doc(key);
  if((doc?.currentVersion||0)!==input.expectedVersion)throw Error('导入账本版本已变化，请重新预览');
  const existing=doc?.currentHash?this.readVersion(doc.currentHash).rows:[];const duplicateKeys=new Set(existing.map(row=>`${row.market}:${row.instrument}:${row.currency}:${row.asOf}:${row.accountId}`));
  const accepted:ImportedPortfolioRow[]=[],duplicates:PortfolioImportPreview['duplicates']=[],rejected:PortfolioImportPreview['rejected']=[],rawHashes:string[]=[];
  rows.forEach((raw,index)=>{
    const rowNumber=index+(input.format==='csv'?2:1),rawHash=digest(raw),allowed=['market','instrument','currency','quantity','averageCost','price','fees','asOf','accountSource','accountId'];
    try{
      if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).some(field=>!allowed.includes(field)))throw Error('记录包含未知字段');
      const market=String((raw as any).market||'').trim(),instrumentInput=String((raw as any).instrument||'').trim(),currency=String((raw as any).currency||'').trim().toUpperCase();
      if(!['stocks','crypto','options','prediction'].includes(market)||!/^[A-Z]{3,8}$/.test(currency))throw Error('市场或币种无效');
      const ref=this.deps.resolve(market,instrumentInput);if(!ref)throw Error('标的身份未登记');
      const asOf=new Date(String((raw as any).asOf||'')).toISOString();if(Date.parse(asOf)>this.now())throw Error('持仓时点位于未来');
      const quantity=Number((raw as any).quantity),averageCost=Number((raw as any).averageCost),price=Number((raw as any).price),fees=Number((raw as any).fees??0);
      if(![quantity,averageCost,price,fees].every(Number.isFinite)||quantity<=0||quantity>1e12||averageCost<=0||price<=0||fees<0||fees>1e12)throw Error('数量、成本、价格或费用无效');
      const rawSource=String((raw as any).accountSource||accountSource).trim(),rawId=String((raw as any).accountId||accountId).trim();if(rawSource!==accountSource||rawId!==accountId)throw Error('文件账户身份与预览账户不一致');
      const identity=`${market}:${ref.id}:${currency}:${asOf}:${accountId}`;
      if(duplicateKeys.has(identity)){duplicates.push({row:rowNumber,identity,reason:'当前账本或本文件已有同一标的、币种、时点和账户记录',rawHash});rawHashes.push(rawHash);return;}
      duplicateKeys.add(identity);
      accepted.push({id:'imported_'+digest({key,identity,rawHash}).slice(0,24),market:market as MarketId,instrument:ref.id,currency,quantity,averageCost,price,fees,asOf,accountSource,accountId,rawHash});rawHashes.push(rawHash);
    }catch(error){rejected.push({row:rowNumber,reason:error instanceof Error?error.message:'记录无效',rawHash});rawHashes.push(rawHash);}
  });
  const totalsByCurrency:PortfolioImportPreview['totalsByCurrency']={};
  for(const row of accepted){const total=totalsByCurrency[row.currency]||{quantity:0,costBasis:0,marketValue:0,fees:0};total.quantity+=row.quantity;total.costBasis+=row.quantity*row.averageCost;total.marketValue+=row.quantity*row.price;total.fees+=row.fees;if(!Object.values(total).every(Number.isFinite))throw Error('币种汇总溢出');totalsByCurrency[row.currency]=total;}
  const companyActions:PortfolioImportPreview['companyActions']={};
  for(const row of accepted.filter(row=>row.market==='stocks')){
    try{const records=this.deps.companyActions?.({market:'stocks',instrument:row.instrument,asOf:row.asOf})?.records||[];companyActions[row.instrument]=records.filter(item=>!item.action.publishedAt||Date.parse(item.action.publishedAt)<=Date.parse(row.asOf)).map(item=>({id:item.action.id,kind:item.action.kind,effectiveAt:item.action.effectiveAt,factor:item.action.factor??null,contentHash:item.contentHash||null,publishedAt:item.action.publishedAt??null,observedAt:item.action.observedAt??null}));}
    catch{companyActions[row.instrument]=[];}
  }
  const asOf=accepted.map(row=>row.asOf).sort().at(-1)||new Date(this.now()).toISOString();
  const base={accountKey:key,accountSource,accountId,fileName,fileHash,asOf,expectedVersion:input.expectedVersion,accepted,duplicates,rejected,totalsByCurrency,companyActions,
    coverage:{inputRows:rows.length,acceptedRows:accepted.length,duplicateRows:duplicates.length,rejectedRows:rejected.length,companyActionCoverage:'partial' as const},
    createdAt:this.now(),reason:rejected.length?'部分记录未通过校验，预览不写入账本':duplicates.length?'重复记录将在确认时跳过':'全部记录通过本地身份、币种、费用和去重预览；尚未写入账本'};
  const preview:PortfolioImportPreview={id:'portfolio_preview_'+digest({key,fileHash,expectedVersion:input.expectedVersion,createdAt:this.now(),base}).slice(0,24),...base,previewHash:digest(base)};
  return this.state.transaction(()=>{const latest=this.doc(key);if((latest?.currentVersion||0)!==input.expectedVersion)throw Error('导入账本版本已变化，请重新预览');const d:any=latest||{version:1,accountKey:key,currentVersion:0,currentHash:null,versions:[],requests:{},previews:{},updatedAt:this.now()};if(Object.keys(d.previews).length>=100){const oldest=Object.keys(d.previews).sort((a,b)=>d.previews[a].createdAt-d.previews[b].createdAt)[0];delete d.previews[oldest];this.state.set(sourceKey(oldest),null);}d.previews[preview.id]=preview;d.updatedAt=this.now();this.state.set(sourceKey(preview.id),{format:input.format,content:input.content,fileName,fileHash});this.state.set(docKey(key),d);if(!latest)this.state.set(ACCOUNT_INDEX,[...this.accounts(),key]);return structuredClone(preview);});
 }
 commit(input:{previewId:string;previewHash:string;expectedVersion:number;requestId:string;acknowledge:boolean}){
  return this.state.transaction(()=>{
    if(!input||Object.keys(input).some(key=>!['previewId','previewHash','expectedVersion','requestId','acknowledge'].includes(key))||!input.acknowledge||!/^[a-f0-9-]{36}$/.test(input.requestId))throw Error('导入确认需要明确确认、请求ID和预览Hash');
    const previewId=String(input.previewId||'');let key='',preview:PortfolioImportPreview|null=null;
    for(const account of this.accounts()){const candidate=this.doc(account)?.previews[previewId];if(candidate){key=account;preview=candidate;break;}}
    if(!preview||preview.previewHash!==input.previewHash)throw Error('导入预览不存在或Hash不一致');
    const d=this.doc(key)!,requestHash=digest({previewId,previewHash:input.previewHash,expectedVersion:input.expectedVersion});
    if(d.requests[input.requestId]){if(d.requests[input.requestId].requestHash!==requestHash)throw Error('请求ID已绑定另一导入确认');return this.readVersion(d.requests[input.requestId].versionId);}
    if(d.currentVersion!==input.expectedVersion||preview.expectedVersion!==input.expectedVersion)throw Error('导入账本版本已变化，请重新预览');
    if(!preview.accepted.length)throw Error('预览没有可写入的有效记录');
    const source=this.state.get<LedgerVersion['source']>(sourceKey(preview.id));
    if(!source||source.fileName!==preview.fileName||source.fileHash!==preview.fileHash||source.format!=='csv'&&source.format!=='json'||typeof source.content!=='string'||createHash('sha256').update(source.content).digest('hex')!==preview.fileHash)throw Error('导入原始文件证据缺失或已变化，请重新预览');
    if(d.versions.length>=100)throw Error('导入账本已有100个版本，保留历史且不覆盖');
    const number=d.currentVersion+1,previous=d.currentHash?this.readVersion(d.currentHash):null;
    const payload={version:1 as const,accountKey:key,accountSource:preview.accountSource,accountId:preview.accountId,number,previousVersionId:previous?.id||null,previousHash:d.currentHash,action:'import' as const,fileName:preview.fileName,fileHash:preview.fileHash,asOf:preview.asOf,rows:previous?[...previous.rows,...preview.accepted]:preview.accepted,rawHashes:previous?[...previous.rawHashes,...preview.accepted.map(row=>row.rawHash)]:preview.accepted.map(row=>row.rawHash),source:structuredClone(source),companyActions:preview.companyActions,previewHash:preview.previewHash,createdAt:new Date(this.now()).toISOString(),reason:'用户确认的独立研究导入版本；原文件、逐行Hash和冻结公司行动证据随版本保存，未写入执行账本'};
    const id='portfolio_import_'+digest(payload).slice(0,64),version:LedgerVersion={...payload,id,contentHash:digest({...payload,id})};
    this.state.set('portfolio-import-version:'+id,version);d.currentVersion=number;d.currentHash=id;d.versions.push(id);d.requests[input.requestId]={requestHash,versionId:id};d.updatedAt=this.now();this.state.set(docKey(key),d);
    this.state.appendAudit({id:randomUUID(),action:'portfolio-import-commit',detail:JSON.stringify({accountKey:key,versionId:id,number,previewHash:preview.previewHash}),at:new Date(this.now()).toISOString()});return structuredClone(version);
  });
 }
 rollback(input:{accountSource:string;accountId:string;targetVersionId:string;expectedVersion:number;requestId:string;acknowledge:boolean}){
  return this.state.transaction(()=>{
    if(!input||Object.keys(input).some(key=>!['accountSource','accountId','targetVersionId','expectedVersion','requestId','acknowledge'].includes(key))||!input.acknowledge||!/^[a-f0-9-]{36}$/.test(input.requestId)||!Number.isSafeInteger(input.expectedVersion))throw Error('回滚需要明确确认、请求ID和目标版本');
    const key=accountKey(String(input.accountSource||''),String(input.accountId||'')),d=this.doc(key);if(!d||d.currentVersion!==input.expectedVersion||!d.currentHash)throw Error('导入账本版本已变化');
    const target=this.readVersion(input.targetVersionId);if(target.accountKey!==key||!d.versions.includes(target.id))throw Error('回滚目标不属于该导入账户');
    const requestHash=digest({targetVersionId:target.id,expectedVersion:input.expectedVersion});if(d.requests[input.requestId]){if(d.requests[input.requestId].requestHash!==requestHash)throw Error('请求ID已绑定另一回滚');return this.readVersion(d.requests[input.requestId].versionId);}
    if(d.versions.length>=100)throw Error('导入账本已有100个版本，保留历史且不覆盖');const previous=this.readVersion(d.currentHash),number=d.currentVersion+1;
    const payload={version:1 as const,accountKey:key,accountSource:previous.accountSource,accountId:previous.accountId,number,previousVersionId:previous.id,previousHash:previous.contentHash,action:'rollback' as const,fileName:target.fileName,fileHash:target.fileHash,asOf:target.asOf,rows:structuredClone(target.rows),rawHashes:structuredClone(target.rawHashes),source:structuredClone(target.source),companyActions:structuredClone(target.companyActions),previewHash:target.previewHash,createdAt:new Date(this.now()).toISOString(),reason:`人工回滚到 ${target.id}，作为新版本追加；不删除被回滚版本`};
    const id='portfolio_import_'+digest(payload).slice(0,64),version:LedgerVersion={...payload,id,contentHash:digest({...payload,id})};this.state.set('portfolio-import-version:'+id,version);d.currentVersion=number;d.currentHash=id;d.versions.push(id);d.requests[input.requestId]={requestHash,versionId:id};d.updatedAt=this.now();this.state.set(docKey(key),d);
    this.state.appendAudit({id:randomUUID(),action:'portfolio-import-rollback',detail:JSON.stringify({accountKey:key,versionId:id,targetVersionId:target.id}),at:new Date(this.now()).toISOString()});return structuredClone(version);
  });
 }
 versions(accountSource:string,accountId:string){
  const key=accountKey(accountSource,accountId),doc=this.doc(key);if(!doc)return [];return doc.versions.map(id=>this.readVersion(id)).map(({rows,rawHashes,source,...rest})=>({...rest,rowCount:rows.length,rawRecordCount:rawHashes.length,source:{format:source.format,fileName:source.fileName,fileHash:source.fileHash,contentHash:digest(source.content),contentBytes:Buffer.byteLength(source.content,'utf8')}}));
 }
}
