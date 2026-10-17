const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
test('action priority promotes explicit failures and pins but does not infer failures from absent data',()=>{
 const source=fs.readFileSync('src/web/public/action-research-workspace.js','utf8'),fn=source.match(/function actionPriority\(row\) \{[\s\S]*?\n  \}/)?.[0];assert.ok(fn,'action priority function missing');
 const priority=vm.runInNewContext(fn+';actionPriority');assert.ok(priority({dataStatus:'failed'})>priority({dataStatus:'live'}));assert.ok(priority({pinned:true})>priority({dataStatus:'failed'}));assert.equal(priority({}),priority({dataStatus:'live'}));
 assert.match(source,/data-action-issue-first/);assert.match(source,/mm-action-normal/);assert.match(source,/pref\.issueFirst/);
});
