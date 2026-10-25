import {createHash} from 'node:crypto';
import {runResearchExperiment} from './experiment-runner';
import {runRestrictedHistoricalExperiment} from './restricted-experiment';
import {assertMarketContext} from './research-contracts';

const limit=4*1024*1024;
function canonical(value:any):string {if(value===null||typeof value!=='object')return JSON.stringify(value);if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';}
const digest=(value:any)=>createHash('sha256').update(canonical(value)).digest('hex');
const copy=(value:any)=>JSON.parse(JSON.stringify(value));
function safe(value:any,depth=0):void {if(depth>24)throw Error('研究包嵌套超过上限');if(typeof value==='number'&&!Number.isFinite(value))throw Error('研究包数值无效');if(typeof value==='string'&&value.length>20000)throw Error('研究包字段过长');if(Array.isArray(value)){if(value.length>10000)throw Error('研究包样本超过上限');for(const row of value)safe(row,depth+1);}else if(value&&typeof value==='object'){for(const [key,row]of Object.entries(value)){if(/token|secret|password|cookie|credential|privatekey|authorization|__proto__|constructor|prototype/i.test(key))throw Error('研究包含禁止字段');safe(row,depth+1);}}}
function keys(value:any,allowed:string[]){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!allowed.includes(k)))throw Error('研究包输入字段无效');}
function validateInput(input:any,engine:string){
 safe(input);
 if(engine==='research-experiment-v1'){
  keys(input,['context','prices','signals','split','promotion']);keys(input.context,['market','workspace','instrument','timeframe','dataStatus','updatedAt','strategyId','strategyVersion','dataSource','dataFrom','dataTo','dataSnapshotHash','feeRate','slippage','seed','parameters']);assertMarketContext(input.context);
  if(!input.context.instrument||!input.context.timeframe||!input.context.dataSource||!Array.isArray(input.prices)||!input.prices.length||input.prices.length>10000||input.prices.some((p:any)=>typeof p!=='number'||!Number.isFinite(p)||p<=0)||!Array.isArray(input.signals))throw Error('缺少可复现输入、来源或身份');
  for(const key of ['feeRate','slippage'])if(input.context[key]!==undefined&&(typeof input.context[key]!=='number'||!Number.isFinite(input.context[key])||input.context[key]<0||input.context[key]>1))throw Error('研究包成本参数无效');
  for(const row of input.signals){keys(row,['timeIndex','direction','price','volume','strategyId','source','tag','exitReason','orderType','limitPrice','stopPrice','timeoutBars','status']);if(!Number.isSafeInteger(row.timeIndex)||row.timeIndex<0||row.timeIndex>=input.prices.length||!['buy','sell'].includes(row.direction))throw Error('研究包信号无效');for(const key of ['price','limitPrice','stopPrice','volume'])if(row[key]!==undefined&&(typeof row[key]!=='number'||!Number.isFinite(row[key])||row[key]<0||row[key]>1e12))throw Error('研究包信号数值无效');if(row.orderType!==undefined&&!['market','limit','stop','take_profit','cancel'].includes(row.orderType))throw Error('研究包订单类型无效');if(row.timeoutBars!==undefined&&(!Number.isSafeInteger(row.timeoutBars)||row.timeoutBars<0||row.timeoutBars>10000))throw Error('研究包信号期限无效');}
  if(input.split!==undefined){keys(input.split,['trainSize','testSize','step','purge','embargo']);for(const [key,value]of Object.entries(input.split))if(!Number.isSafeInteger(value)||(value as number)<(['purge','embargo'].includes(key)?0:1)||(value as number)>10000)throw Error('研究包分段参数必须为范围内整数');}
  if(input.promotion!==undefined){keys(input.promotion,['minOutOfSampleReturnPct','minTrades']);for(const value of Object.values(input.promotion))if(typeof value!=='number'||!Number.isFinite(value)||Math.abs(value)>1e6)throw Error('研究包门槛参数无效');}
 }else if(engine==='restricted-next-open-v1'){
  keys(input,['version','market','instrument','asOf','source','snapshotId','dataHash','bars','windowStart']);if(!Array.isArray(input.bars)||!input.bars.length||input.bars.length>10000)throw Error('缺少冻结K线');
  keys(input.version,['id','hash','version','market','interpreterVersion','definition','createdAt']);
  for(const row of input.bars)keys(row,['time','open','high','low','close','volume','closed','publishedAt']);
 }else throw Error('未知研究引擎版本，拒绝执行');
}
function projection(result:any){const b=result.backtest;if(!b)throw Error('缺少已保存结果');return copy({backtest:Object.fromEntries(['pnl','remainingPositions','trades','totalFees','totalSlippage','startingBalance','equityCurve','underwaterCurve','metrics'].filter(k=>b[k]!==undefined).map(k=>[k,b[k]])),folds:result.folds||[],gate:result.gate,signals:result.signals||[],rejections:result.rejections||[]});}
export function exportResearchPackage(saved:any,market:string,commit:string){
 if(!saved?.experiment||saved.experiment.market!==market)throw Error('实验不存在或市场不匹配');
 const engine=saved.reproducibility?.engine||(!saved.executionModel&&saved.input?'research-experiment-v1':null),input=copy(saved.reproducibility?.input||saved.input||null);if(!engine||!input)throw Error('旧记录缺少可复现的已保存输入；不使用当前行情补猜');
 validateInput(input,engine);const scope=engine==='research-experiment-v1'?input.context:input;
 if(scope.market!==market||scope.instrument!==saved.experiment.instrument||(engine==='research-experiment-v1'?scope.timeframe:input.version.definition.timeframe)!==saved.experiment.timeframe)throw Error('研究包输入与实验身份不匹配');
 const payload={engine,experimentId:saved.experiment.id,market,instrument:saved.experiment.instrument,timeframe:saved.experiment.timeframe,producerCommit:/^[a-f0-9]{40}$/.test(commit)?commit:'unknown',sourceSnapshotHash:saved.experiment.dataSnapshotHash||null,input,inputHash:digest(input),result:projection(saved)};safe(payload);if(Buffer.byteLength(JSON.stringify(payload))>limit)throw Error('研究包超过4MB上限');
 return {schemaVersion:1,kind:'moneymoney-research-package',payload,contentHash:digest(payload),reason:'只含冻结研究数据；Hash检验字节一致，不认证来源事实或收益。离线CLI不导入生产、不加载路径或脚本、不请求网络'};
}
export function verifyResearchPackage(bundle:any){
 keys(bundle,['schemaVersion','kind','payload','contentHash','reason']);if(bundle.schemaVersion!==1||bundle.kind!=='moneymoney-research-package'||Buffer.byteLength(JSON.stringify(bundle))>limit)throw Error('研究包格式或大小无效');safe(bundle);
 const p=bundle.payload;keys(p,['engine','experimentId','market','instrument','timeframe','producerCommit','sourceSnapshotHash','input','inputHash','result']);if(digest(p)!==bundle.contentHash||digest(p.input)!==p.inputHash)throw Error('研究包内容Hash不匹配');validateInput(p.input,p.engine);
 const identity=p.engine==='research-experiment-v1'?p.input.context:p.input;if(identity.market!==p.market||identity.instrument!==p.instrument||(p.engine==='research-experiment-v1'?identity.timeframe:p.input.version.definition.timeframe)!==p.timeframe)throw Error('研究包市场身份不一致');
 const result=projection(p.engine==='research-experiment-v1'?runResearchExperiment(copy(p.input)):runRestrictedHistoricalExperiment(copy(p.input))),differences:Array<{field:string;expectedHash:string;actualHash:string}>=[];
 const visit=(a:any,b:any,field:string)=>{if(digest(a??null)===digest(b??null))return;if(a&&b&&typeof a==='object'&&typeof b==='object'&&!Array.isArray(a)&&!Array.isArray(b)){for(const key of new Set([...Object.keys(a),...Object.keys(b)]))visit(a[key],b[key],field?field+'.'+key:key);}else differences.push({field,expectedHash:digest(a??null),actualHash:digest(b??null)});};visit(p.result,result,'');
 return {schemaVersion:1,matches:differences.length===0,engine:p.engine,producerCommit:p.producerCommit,experimentId:p.experimentId,expectedResultHash:digest(p.result),actualResultHash:digest(result),differences,networkCalls:0,stateWrites:0,reason:'独立内存计算；差异不覆盖原结果，不代表实盘验证'};
}
