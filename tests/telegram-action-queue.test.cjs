const test=require('node:test'),assert=require('node:assert/strict');
const {buildActionCenter}=require('../dist/features/action-center');
const at='2026-10-19T00:00:00.000Z',base={market:'stocks',instrument:'stock:us:AAPL',kind:'event',observedAt:at,source:'SEC',dataStatus:'historical',evidenceRefs:['snapshot-1']};
test('shared action queue orders source failures and actual scheduled deadlines without promoting read or snoozed items',()=>{
 const result=buildActionCenter([{...base,id:'recent',title:'recent'},{...base,id:'due',title:'due',scheduledAt:'2026-10-19T01:00:00Z'},{...base,id:'failure',title:'failure',kind:'source',dataStatus:'failed'},{...base,id:'read',title:'read'},{...base,id:'later',title:'later'}],{now:at,states:{read:{read:true,pinned:false,snoozedUntil:null,updatedAt:at},later:{read:false,pinned:false,snoozedUntil:'2026-10-20T00:00:00Z',updatedAt:at}}});
 assert.deepEqual(result.items.filter(r=>!r.read&&!r.snoozed).map(r=>r.id),['failure','due','recent']);
});

test('whole queue fits the Telegram message budget without splitting HTML or renumbering actions',()=>{
 require('ts-node/register/transpile-only');
 const {fitTelegramActionQueue}=require('../src/features/telegram-action-queue.ts');
 const lines=Array.from({length:8},(_,i)=>`${i+1}. <a href="https://example.com">${'证据'.repeat(500)}</a>`);
 const result=fitTelegramActionQueue(lines);
 assert.ok(result.lines.join('\n').length<=3200);assert.equal(result.count,3);assert.equal(result.omitted,5);
 assert.deepEqual(result.lines,lines.slice(0,3));
 assert.equal(fitTelegramActionQueue([]).omitted,0);
 const oversized=fitTelegramActionQueue(['x'.repeat(4000)]);assert.equal(oversized.count,0);assert.equal(oversized.omitted,1);
});
test('Telegram queue preserves deadlines, unknown results, evidence and safe original links with bounded escaped text',()=>{
 const {formatTelegramActionItem}=require('../dist/features/telegram-action-queue');
 const row={...base,id:'event-1',title:'<b>'.repeat(100),source:'<SEC>',scheduledAt:'2026-10-20T00:00:00Z',sourceUrl:'https://www.sec.gov/Archives/test',reason:'结果尚未发布',section:'upcoming'};
 const text=formatTelegramActionItem(row);assert.match(text,/计划时间.*2026-10-20/);assert.match(text,/尚未发布/);assert.match(text,/snapshot-1/);assert.match(text,/https:\/\/www.sec.gov/);assert.doesNotMatch(text,/<b>/);assert.ok(text.length<1300);
 const unsafe=formatTelegramActionItem({...row,sourceUrl:'javascript:alert(1)',scheduledAt:undefined});assert.doesNotMatch(unsafe,/javascript:|计划时间/);
});
