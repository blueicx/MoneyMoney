import type { AiRunnerQuote } from './ai-paper-runner';

export interface PredictionExecutionContract {
  instrumentId:string; verified:boolean;
  rules:{url:string;source:string;evidenceId:string;publishedAt:string};
  outcomes:Record<'YES'|'NO',{tokenId:string;bestBid:number;bestAsk:number;updatedAt:string}>;
}

/** Only explicitly identified outcome books are executable. Complement prices are not source evidence. */
export function predictionOutcomeQuote(quote:AiRunnerQuote,side:string|undefined,now=new Date(),maxAgeMs=120000):AiRunnerQuote {
  if(quote.market!=='prediction')return quote;
  const reject=(reason:string,status='unsupported'):AiRunnerQuote=>({...quote,status,dataStatus:status,reason,bestBid:undefined,bestAsk:undefined,outcome:undefined,tokenId:undefined});
  const status=quote.dataStatus||quote.status||'unavailable';
  if(!['live','delayed'].includes(status))return reject(quote.reason||'来源报价不可用于模拟成交',status);
  const c=quote.predictionContract;
  if(!['YES','NO'].includes(String(side))||!c||c.verified!==true||!/^prediction:predictfun:\d+$/.test(c.instrumentId))return reject('缺少已核验的预测事件及 YES/NO 合约身份');
  const rulesAt=Date.parse(c.rules?.publishedAt);
  if(!c.rules?.source?.trim()||!c.rules.evidenceId?.trim()||!/^https:\/\//.test(c.rules.url)||!Number.isFinite(rulesAt)||rulesAt>now.getTime())return reject('缺少当时已发布的官方结算规则证据');
  let rulesUrl:URL;try{rulesUrl=new URL(c.rules.url);}catch{return reject('结算规则链接无效');}
  if(rulesUrl.username||rulesUrl.password||!(rulesUrl.hostname==='predict.fun'||rulesUrl.hostname.endsWith('.predict.fun')))return reject('结算规则不是当前交易场所官方来源');
  const yes=c.outcomes?.YES,no=c.outcomes?.NO;
  if(!yes?.tokenId?.trim()||!no?.tokenId?.trim()||yes.tokenId===no.tokenId)return reject('YES/NO token 身份缺失或重复');
  const book=c.outcomes[side as 'YES'|'NO'];
  if(!Number.isFinite(book.bestBid)||!Number.isFinite(book.bestAsk)||book.bestBid<=0||book.bestAsk<book.bestBid||book.bestAsk>=1)return reject('所选 outcome 没有有效双边报价');
  const at=Date.parse(book.updatedAt),age=now.getTime()-at;
  if(!Number.isFinite(at)||age<0||!Number.isFinite(maxAgeMs)||maxAgeMs<=0)return reject('所选 outcome 源时间无效');
  if(age>maxAgeMs)return reject('所选 outcome 盘口过期','stale');
  return {...quote,price:(book.bestBid+book.bestAsk)/2,bestBid:book.bestBid,bestAsk:book.bestAsk,updatedAt:book.updatedAt,outcome:side as 'YES'|'NO',tokenId:book.tokenId};
}
