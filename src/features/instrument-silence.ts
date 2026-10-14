import type { SQLiteStateStore } from '../storage/sqlite-state';
import { parseInstrumentQuery, normalizeInstrumentRef } from './unified-instruments';
import { marketScopeForInstrumentType } from './market-scope';
interface Silence { market:string; instrument:string; until:string|null; at:string; actor:'web'|'telegram' }
interface State { entries:Record<string,Silence>; history:Silence[] }
/** Administrator's common web/Telegram normal-notification policy, not a trading gate. */
export class InstrumentSilenceStore {
  private readonly key='notification-instrument-silence:admin';
  constructor(private readonly store:Pick<SQLiteStateStore,'get'|'set'|'transaction'>,private readonly now=Date.now) {}
  private state():State{return this.store.get<State>(this.key)||{entries:{},history:[]};}
  update(market:string,instrument:string,until:string|null,actor:'web'|'telegram') {
    const parsed=/^(stock|option|crypto|prediction):/.test(instrument)?parseInstrumentQuery(instrument):null;
    if(!parsed||marketScopeForInstrumentType(parsed.type)!==market||normalizeInstrumentRef(parsed).id!==instrument||instrument.length>220||/\s|[<>"'\\]/.test(instrument))throw new Error('需要当前市场的完整、规范标的身份，不猜测裸代码');
    const at=this.now(),expiry=until===null?null:Date.parse(until);
    if(expiry!==null&&(!Number.isFinite(expiry)||expiry<=at||expiry>at+30*86400000))throw new Error('静默时间必须在未来30天内');
    return this.store.transaction(()=>{
      const state=this.state();
      if(!state.entries[instrument]&&Object.keys(state.entries).length>=500)for(const [id,row] of Object.entries(state.entries))if(!row.until||Date.parse(row.until)<=at)delete state.entries[id];
      if(!state.entries[instrument]&&Object.keys(state.entries).length>=500)throw new Error('有效静默记录容量已达500，请先恢复现有记录');
      const row:Silence={market,instrument,until:expiry===null?null:new Date(expiry).toISOString(),at:new Date(at).toISOString(),actor};state.entries[instrument]=row;state.history=[...state.history,row].slice(-200);this.store.set(this.key,state);return row;
    });
  }
  suppresses(instrument:string,priority:'normal'|'high'='normal') {if(priority==='high')return false;const row=this.state().entries[instrument];return !!row?.until&&Date.parse(row.until)>this.now();}
  list(market?:string){const state=this.state();return {entries:Object.values(state.entries).filter(row=>!market||row.market===market).map(row=>({...row,active:!!row.until&&Date.parse(row.until)>this.now()})),history:state.history.filter(row=>!market||row.market===market),reason:'仅普通提醒与信号静默；风险、数据源故障和模拟成交不受影响，不暂停策略或账户'};}
}
