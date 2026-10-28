import {createHash} from 'node:crypto';
import type {EvidenceSnapshot} from './decision-intelligence';
import {verifyEvidenceSnapshotHash} from './decision-intelligence';

type Market='stocks';
type EvidenceRole='income'|'balance';

export interface ThreeStatementAssumptions {
  forecastYears:number;
  segments:Array<{id:string;label:string;initialRevenuePct:number;growthPct:number[]}>;
  cogsPctRevenue:number[];
  operatingExpensePctRevenue:number[];
  depreciationPctRevenue:number[];
  capexPctRevenue:number[];
  workingCapitalPctRevenue:number;
  receivablePctRevenue:number;
  inventoryPctRevenue:number;
  payablePctRevenue:number;
  interestRatePct:number;
  taxRatePct:number;
  debtRepaymentByYear:number[];
  financingScenarios:Array<{
    id:string;
    label:string;
    equityIssuanceByYear:number[];
    debtIssuanceByYear:number[];
    dividendPayoutPct:number[];
  }>;
}

export interface ThreeStatementInput {
  market:Market;
  instrument:string;
  asOf:string;
  evidence:{income:string;balance:string};
  assumptions:ThreeStatementAssumptions;
}

interface ModelYearBase {
  year:number;
  revenue:number;
  segmentRevenue:Record<string,number>;
  cogs:number;
  operatingExpenses:number;
  depreciation:number;
  ebit:number;
  interestExpense:number;
  tax:number;
  netIncome:number;
}

interface CashFlowYear extends ModelYearBase {
  netIncome:number;
  depreciation:number;
  workingCapitalChange:number;
  capex:number;
  debtRepayment:number;
  debtIssuance:number;
  equityIssuance:number;
  dividends:number;
  operatingCashFlow:number;
  investingCashFlow:number;
  financingCashFlow:number;
  netCashChange:number;
}

interface BalanceYear extends ModelYearBase {
  cash:number;
  receivables:number;
  inventory:number;
  payables:number;
  ppe:number;
  debt:number;
  equity:number;
  assets:number;
  liabilitiesAndEquity:number;
  balanceDifference:number;
}

interface ScenarioResult {
  id:string;
  label:string;
  status:'balanced'|'rejected';
  incomeStatements:ModelYearBase[];
  balanceSheets:BalanceYear[];
  cashFlows:CashFlowYear[];
  checks:Array<{year:number|null;id:string;passed:boolean;difference:number|null;reason:string}>;
}

export interface ThreeStatementResult {
  market:Market;
  instrument:string;
  asOf:string;
  evidenceRefs:string[];
  sources:Array<{role:EvidenceRole;id:string;source:string;observedAt:string;fetchedAt:string}>;
  opening:{incomeRevenue:number;cash:number;assets:number;liabilities:number;equity:number;balanceDifference:number};
  scenarios:ScenarioResult[];
  status:'balanced'|'rejected';
  checks:{openingBalanced:boolean;allScenariosBalanced:boolean;cashTies:boolean;balanceTies:boolean};
  model:'three-statement-linked-v1';
  executionEnabled:false;
  ordersCreated:0;
  modelCalls:0;
  reason:string;
  contentHash:string;
}

type Dependencies={evidence:(id:string)=>EvidenceSnapshot|null};

const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const finite=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value);
const num=(fields:Record<string,unknown>,key:string)=>{
  const value=fields[key];
  if(!finite(value))throw Error(`已保存报表缺少有限数值字段 ${key}`);
  return value;
};
const timestamp=(value:unknown,label:string)=>{
  if(typeof value!=='string'||!Number.isFinite(Date.parse(value))||!/(?:Z|[+-]\d\d:\d\d)$/i.test(value))throw Error(`${label}必须包含有效时区`);
  return new Date(Date.parse(value)).toISOString();
};
function arrays(input:ThreeStatementAssumptions,years:number){
  for(const [key,expected] of [
    ['cogsPctRevenue',years],['operatingExpensePctRevenue',years],['depreciationPctRevenue',years],
    ['capexPctRevenue',years],['debtRepaymentByYear',years],
  ] as const){
    const values=input[key];
    if(!Array.isArray(values)||values.length!==expected||values.some(value=>!finite(value)))throw Error(`${key} 必须保存${years}个有限数值`);
  }
}
const tolerance=(value:number)=>Math.max(0.01,Math.abs(value)*1e-9);

/** Server-side linked statement projection over fixed evidence and explicit user assumptions. */
export class ThreeStatementModelService {
  constructor(private deps:Dependencies,private now=Date.now){}

  preview(input:ThreeStatementInput):ThreeStatementResult{
    const allowed=['market','instrument','asOf','evidence','assumptions'];
    if(!input||Object.keys(input).some(key=>!allowed.includes(key))||input.market!=='stocks'||!/^stock:us:[A-Z0-9.-]{1,20}$/.test(String(input.instrument||'')))throw Error('三表模型市场或股票身份无效');
    const asOf=timestamp(input.asOf,'模型截止时间');
    if(Date.parse(asOf)>this.now())throw Error('三表模型截止时间来自未来');
    if(!input.evidence||Object.keys(input.evidence).some(key=>!['income','balance'].includes(key)))throw Error('三表模型证据字段无效');
    const load=(role:EvidenceRole,id:string)=>{
      const evidence=this.deps.evidence(id);
      if(!evidence||evidence.id!==id||!verifyEvidenceSnapshotHash(evidence)||evidence.market!=='stocks'||evidence.instrument!==input.instrument||Date.parse(evidence.observedAt)>Date.parse(asOf)||Date.parse(evidence.fetchedAt)>Date.parse(asOf))throw Error(`${role} 报表证据不存在、Hash/市场/标的不一致或晚于截止时点`);
      return evidence;
    };
    const incomeEvidence=load('income',String(input.evidence.income||'')),balanceEvidence=load('balance',String(input.evidence.balance||''));
    if(incomeEvidence.id===balanceEvidence.id)throw Error('利润表和资产负债表需要两份不同且明确的证据');
    const assumptions=input.assumptions;
    if(!assumptions||Object.keys(assumptions).some(key=>!['forecastYears','segments','cogsPctRevenue','operatingExpensePctRevenue','depreciationPctRevenue','capexPctRevenue','workingCapitalPctRevenue','receivablePctRevenue','inventoryPctRevenue','payablePctRevenue','interestRatePct','taxRatePct','debtRepaymentByYear','financingScenarios'].includes(key)))throw Error('三表模型假设包含未允许字段');
    if(!Number.isSafeInteger(assumptions.forecastYears)||assumptions.forecastYears<1||assumptions.forecastYears>5)throw Error('预测年限必须为1–5年');
    const years=assumptions.forecastYears;
    arrays(assumptions,years);
    for(const key of ['cogsPctRevenue','operatingExpensePctRevenue','depreciationPctRevenue','capexPctRevenue'] as const)if(assumptions[key].some(value=>value<0||value>500))throw Error(`${key} 超出0–500%支持范围`);
    for(const key of ['workingCapitalPctRevenue','receivablePctRevenue','inventoryPctRevenue','payablePctRevenue'] as const){
      if(!finite(assumptions[key])||assumptions[key]<0||assumptions[key]>500)throw Error(`${key} 超出0–500%支持范围`);
    }
    if(!finite(assumptions.interestRatePct)||assumptions.interestRatePct<0||assumptions.interestRatePct>100||!finite(assumptions.taxRatePct)||assumptions.taxRatePct<0||assumptions.taxRatePct>100)throw Error('利率或税率超出0–100%');
    if(assumptions.debtRepaymentByYear.some(value=>value<0))throw Error('债务偿还不能为负值；新增债务应写入融资情景');
    if(!Array.isArray(assumptions.segments)||assumptions.segments.length<1||assumptions.segments.length>12)throw Error('业务分部需要1–12组');
    if(new Set(assumptions.segments.map(segment=>segment.id)).size!==assumptions.segments.length)throw Error('业务分部ID必须唯一');
    let segmentWeight=0;
    for(const segment of assumptions.segments){
      if(!/^[A-Za-z0-9._:-]{2,80}$/.test(String(segment.id||''))||typeof segment.label!=='string'||!segment.label.trim()||segment.label.length>120||!finite(segment.initialRevenuePct)||segment.initialRevenuePct<=0||segment.initialRevenuePct>100||!Array.isArray(segment.growthPct)||segment.growthPct.length!==years||segment.growthPct.some(value=>!finite(value)||value<-100||value>500))throw Error('业务分部身份、初始占比或逐年增长无效');
      segmentWeight+=segment.initialRevenuePct;
    }
    if(Math.abs(segmentWeight-100)>1e-6)throw Error('业务分部初始收入占比必须合计100%');
    if(!Array.isArray(assumptions.financingScenarios)||assumptions.financingScenarios.length<1||assumptions.financingScenarios.length>3)throw Error('融资情景需要1–3组');
    if(new Set(assumptions.financingScenarios.map(scenario=>scenario.id)).size!==assumptions.financingScenarios.length)throw Error('融资情景ID必须唯一');
    for(const scenario of assumptions.financingScenarios){
      if(!/^[A-Za-z0-9._:-]{2,80}$/.test(String(scenario.id||''))||typeof scenario.label!=='string'||!scenario.label.trim()||scenario.label.length>120)throw Error('融资情景身份或名称无效');
      for(const key of ['equityIssuanceByYear','debtIssuanceByYear','dividendPayoutPct'] as const){
        const values=scenario[key];
        if(!Array.isArray(values)||values.length!==years||values.some(value=>!finite(value)||value<0||(key==='dividendPayoutPct'?value>100:false)))throw Error(`融资情景 ${key} 必须为${years}个有效非负数`);
      }
    }
    const incomeFields=incomeEvidence.fields,balanceFields=balanceEvidence.fields;
    const initialRevenue=num(incomeFields,'revenue'),cash=num(balanceFields,'cash'),receivables=num(balanceFields,'receivables'),inventory=num(balanceFields,'inventory'),payables=num(balanceFields,'payables'),ppe=num(balanceFields,'ppe'),debt=num(balanceFields,'debt'),equity=num(balanceFields,'equity');
    if([initialRevenue,cash,receivables,inventory,payables,ppe,debt,equity].some(value=>value<0))throw Error('起点报表数值不能为负；应使用单独标签记录特殊项目');
    const openingAssets=cash+receivables+inventory+ppe,openingLiabilities=payables+debt,openingDifference=openingAssets-openingLiabilities-equity;
    const openingBalanced=Math.abs(openingDifference)<=tolerance(openingAssets);
    const opening={incomeRevenue:initialRevenue,cash,assets:openingAssets,liabilities:openingLiabilities,equity,balanceDifference:openingDifference};
    const scenarioResults=assumptions.financingScenarios.map(scenario=>{
      const checks:ScenarioResult['checks']=[];
      if(!openingBalanced){
        checks.push({year:null,id:'opening-balance',passed:false,difference:openingDifference,reason:'起点资产不等于负债加权益；拒绝输出完整联动模型'});
        return {id:scenario.id,label:scenario.label,status:'rejected' as const,incomeStatements:[],balanceSheets:[],cashFlows:[],checks};
      }
      let previousCash=cash,previousReceivables=receivables,previousInventory=inventory,previousPayables=payables,previousPpe=ppe,previousDebt=debt,previousEquity=equity;
      const incomeStatements:ModelYearBase[]=[],balanceSheets:BalanceYear[]=[],cashFlows:CashFlowYear[]=[];
      for(let index=0;index<years;index++){
        const segmentRevenue=Object.fromEntries(assumptions.segments.map(segment=>[segment.id,initialRevenue*(segment.initialRevenuePct/100)*Math.pow(1+segment.growthPct[index]/100,index+1)]));
        const revenue=Object.values(segmentRevenue).reduce((sum,value)=>sum+value,0);
        const cogs=revenue*assumptions.cogsPctRevenue[index]/100,operatingExpenses=revenue*assumptions.operatingExpensePctRevenue[index]/100,depreciation=revenue*assumptions.depreciationPctRevenue[index]/100,capex=revenue*assumptions.capexPctRevenue[index]/100;
        const debtRepayment=assumptions.debtRepaymentByYear[index],debtIssuance=scenario.debtIssuanceByYear[index],debtEnd=previousDebt-debtRepayment+debtIssuance;
        const averageDebt=(previousDebt+Math.max(0,debtEnd))/2,ebit=revenue-cogs-operatingExpenses-depreciation,interestExpense=averageDebt*assumptions.interestRatePct/100,pretax=ebit-interestExpense,tax=Math.max(0,pretax)*assumptions.taxRatePct/100,netIncome=pretax-tax;
        const newReceivables=revenue*assumptions.receivablePctRevenue/100,newInventory=revenue*assumptions.inventoryPctRevenue/100,newPayables=revenue*assumptions.payablePctRevenue/100;
        const previousWorkingCapital=previousReceivables+previousInventory-previousPayables,workingCapital=newReceivables+newInventory-newPayables,workingCapitalChange=workingCapital-previousWorkingCapital;
        const equityIssuance=scenario.equityIssuanceByYear[index],dividends=Math.max(0,netIncome)*scenario.dividendPayoutPct[index]/100;
        const operatingCashFlow=netIncome+depreciation-workingCapitalChange,investingCashFlow=-capex,financingCashFlow=-debtRepayment+debtIssuance+equityIssuance-dividends,netCashChange=operatingCashFlow+investingCashFlow+financingCashFlow;
        const cashEnd=previousCash+netCashChange,ppeEnd=previousPpe+capex-depreciation,equityEnd=previousEquity+netIncome+equityIssuance-dividends;
        const assets=cashEnd+newReceivables+newInventory+ppeEnd,liabilitiesAndEquity=newPayables+debtEnd+equityEnd,balanceDifference=assets-liabilitiesAndEquity;
        const income={year:index+1,revenue,segmentRevenue,cogs,operatingExpenses,depreciation,ebit,interestExpense,tax,netIncome};
        const cashFlow={...income,workingCapitalChange,capex,debtRepayment,debtIssuance,equityIssuance,dividends,operatingCashFlow,investingCashFlow,financingCashFlow,netCashChange};
        const balance={...income,cash:cashEnd,receivables:newReceivables,inventory:newInventory,payables:newPayables,ppe:ppeEnd,debt:debtEnd,equity:equityEnd,assets,liabilitiesAndEquity,balanceDifference};
        const values=[...Object.values(income),...Object.values(cashFlow),...Object.values(balance),...Object.values(segmentRevenue)];
        if(values.some(value=>typeof value==='number'&&!Number.isFinite(value))||debtEnd<0||equityEnd<0||cashEnd<0){
          checks.push({year:index+1,id:'domain',passed:false,difference:null,reason:'模型出现非有限数值、负现金/债务/权益；拒绝发布该情景'});
          return {id:scenario.id,label:scenario.label,status:'rejected' as const,incomeStatements:[],balanceSheets:[],cashFlows:[],checks};
        }
        const balancePassed=Math.abs(balanceDifference)<=tolerance(assets),cashTiePassed=Math.abs((cashEnd-previousCash)-netCashChange)<=tolerance(cashEnd);
        checks.push({year:index+1,id:'balance-sheet',passed:balancePassed,difference:balanceDifference,reason:balancePassed?'资产等于负债加权益':'三张表未平衡'});
        checks.push({year:index+1,id:'cash-tie',passed:cashTiePassed,difference:(cashEnd-previousCash)-netCashChange,reason:cashTiePassed?'现金期末变动与现金流量表一致':'现金变动未通过勾稽'});
        incomeStatements.push(income);cashFlows.push(cashFlow);balanceSheets.push(balance);
        previousCash=cashEnd;previousReceivables=newReceivables;previousInventory=newInventory;previousPayables=newPayables;previousPpe=ppeEnd;previousDebt=debtEnd;previousEquity=equityEnd;
      }
      const balanced=checks.every(check=>check.passed);
      return {id:scenario.id,label:scenario.label,status:balanced?'balanced' as const:'rejected' as const,incomeStatements:balanced?incomeStatements:[],balanceSheets:balanced?balanceSheets:[],cashFlows:balanced?cashFlows:[],checks};
    });
    const allScenariosBalanced=scenarioResults.length>0&&scenarioResults.every(scenario=>scenario.status==='balanced');
    const base:Omit<ThreeStatementResult,'contentHash'>={
      market:'stocks',instrument:input.instrument,asOf,evidenceRefs:[incomeEvidence.id,balanceEvidence.id],
      sources:[
        {role:'income',id:incomeEvidence.id,source:incomeEvidence.source.name,observedAt:incomeEvidence.observedAt,fetchedAt:incomeEvidence.fetchedAt},
        {role:'balance',id:balanceEvidence.id,source:balanceEvidence.source.name,observedAt:balanceEvidence.observedAt,fetchedAt:balanceEvidence.fetchedAt},
      ],
      opening,scenarios:scenarioResults,status:allScenariosBalanced?'balanced':'rejected',
      checks:{openingBalanced,allScenariosBalanced,cashTies:scenarioResults.every(scenario=>scenario.checks.filter(check=>check.id==='cash-tie').every(check=>check.passed)),balanceTies:scenarioResults.every(scenario=>scenario.checks.filter(check=>check.id==='balance-sheet').every(check=>check.passed))},
      model:'three-statement-linked-v1',executionEnabled:false,ordersCreated:0,modelCalls:0,
      reason:openingBalanced&&allScenariosBalanced?'服务端按固定报表证据和用户假设联动三表；所有情景通过现金勾稽和资产负债平衡，但仍是模型输出而非事实预测':'存在起点或情景勾稽失败；失败情景不输出完整三表，不以局部结果冒充完整模型',
    };
    return {...base,contentHash:digest(base)};
  }
}
