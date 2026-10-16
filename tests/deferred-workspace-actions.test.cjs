const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

test('browser focus acceptance waits until the chart has data and its controls are enabled', () => {
  const smoke = fs.readFileSync('scripts/browser-market-matrix.cjs', 'utf8');
  assert.match(smoke, /await page\.waitForFunction\(\(\) =>[\s\S]*?klineState === 'ready'[\s\S]*?input && !input\.disabled[\s\S]*?const patternControlsStable/);
});

test('noninitial async actions live in existing workspace bundles with guarded public entry points', () => {
  const manifest = JSON.parse(fs.readFileSync('dist/web/public/asset-manifest.json', 'utf8'));
  const read = name => fs.readFileSync('dist/web/public' + Object.keys(manifest).find(path => path.includes('/' + name + '.')), 'utf8');
  const core = read('dashboard-startup-runtime');
  const ast = ts.createSourceFile('core.js', core, ts.ScriptTarget.Latest, true);
  for (const [group, name] of [['ops','loadInstrumentSilences'], ['ops','loadAlerts'], ['ai','saveAiSettings'], ['ai','pauseRunner'], ['research','saveDecisionRecordUi'], ['prediction','calculatePredictionSizing'], ['overview','loadOverview']]) {
    const declaration = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
    assert.ok(declaration, name + ' keeps its legacy handler name');
    const code = core.slice(declaration.getStart(ast), declaration.end);
    assert.ok(code.length < 200, name + ' must not ship its full implementation in the initial core');
    const context = vm.createContext({ window:{ MoneyWorkspaceModules:{ invoke:(...args) => args } } });
    vm.runInContext(code, context);
    assert.deepEqual(JSON.parse(JSON.stringify(context[name]('fixture'))), [group, name, ['fixture'], true]);
    assert.match(read('workspace-' + group), new RegExp('(?:async )?function ' + name + '\\('));
  }
});

test('pending deferred actions are discarded on market, workspace or instrument changes, including market ABA', async () => {
  const loader = fs.readFileSync('src/web/public/modules/workspace-loader.js', 'utf8').replace('__WORKSPACE_MANIFEST__', JSON.stringify({ modules:{ ops:'/assets/ops.fixture.js' } }));
  for (const change of ['market','workspace','instrument','aba','unchanged']) {
    const dom = new JSDOM('<div id="market-workspace-shell" data-workspace="alerts"></div>', { url:'http://localhost/', runScripts:'outside-only' });
    const w = dom.window; let calls = 0, epoch = 0, instrument = 'stock:us:AAPL';
    w.document.body.dataset.marketScope='stocks';
    w.mm_authReady=Promise.resolve(); w.mm_dashboardCoreReady=true;
    w.marketScopeRequestToken=()=>({ scope:w.document.body.dataset.marketScope, epoch });
    w.currentInstrumentFilterId=()=>instrument;
    w.fixtureAction=value=>{ calls++; return value; };
    try {
      w.eval(loader);
      const pending=w.MoneyWorkspaceModules.invoke('ops','fixtureAction',['saved'],true);
      await new Promise(resolve=>setTimeout(resolve,0));
      const script=w.document.querySelector('script[data-workspace-group="ops"]'); assert.ok(script);
      if(change==='market')w.document.body.dataset.marketScope='crypto';
      if(change==='workspace')w.document.getElementById('market-workspace-shell').dataset.workspace='events';
      if(change==='instrument')instrument='stock:us:SNDK';
      if(change==='aba')epoch+=2;
      script.dispatchEvent(new w.Event('load'));
      assert.equal(await pending,change==='unchanged'?'saved':undefined,change);
      assert.equal(calls,change==='unchanged'?1:0,change+' must not execute an obsolete action');
    } finally { dom.window.close(); }
  }
});

test('identical queued actions execute once, distinct arguments remain separate and later retries work', async () => {
  const loader=fs.readFileSync('src/web/public/modules/workspace-loader.js','utf8').replace('__WORKSPACE_MANIFEST__',JSON.stringify({modules:{ops:'/assets/ops.fixture.js'}}));
  const dom=new JSDOM('<body></body>',{url:'http://localhost/',runScripts:'outside-only'}),w=dom.window,calls=[];
  w.mm_authReady=Promise.resolve();w.mm_dashboardCoreReady=true;
  w.fixtureAction=async value=>{calls.push(value);return value;};
  try{
    w.eval(loader);
    const first=w.MoneyWorkspaceModules.invoke('ops','fixtureAction',['first'],true);
    const duplicate=w.MoneyWorkspaceModules.invoke('ops','fixtureAction',['first'],true);
    const distinct=w.MoneyWorkspaceModules.invoke('ops','fixtureAction',['second'],true);
    await new Promise(resolve=>setTimeout(resolve,0));
    w.document.querySelector('script[data-workspace-group="ops"]').dispatchEvent(new w.Event('load'));
    assert.deepEqual(await Promise.all([first,duplicate,distinct]),['first','first','second']);
    assert.deepEqual(calls,['first','second']);
    assert.equal(await w.MoneyWorkspaceModules.invoke('ops','fixtureAction',['first'],true),'first');
    assert.deepEqual(calls,['first','second','first']);
  }finally{dom.window.close();}
});

test('failed deferred downloads release the deduplication entry and permit an explicit retry', async () => {
  const loader = fs.readFileSync('src/web/public/modules/workspace-loader.js', 'utf8')
    .replace('__WORKSPACE_MANIFEST__', JSON.stringify({ modules: { ops: '/assets/ops.fixture.js' } }));
  const dom = new JSDOM('<body></body>', { url: 'http://localhost/', runScripts: 'outside-only' });
  const w = dom.window;
  let calls = 0;
  w.mm_authReady = Promise.resolve();
  w.mm_dashboardCoreReady = true;
  w.fixtureAction = () => ++calls;
  try {
    w.eval(loader);
    const first = w.MoneyWorkspaceModules.invoke('ops', 'fixtureAction', [], true);
    const duplicate = w.MoneyWorkspaceModules.invoke('ops', 'fixtureAction', [], true);
    const rejected = Promise.allSettled([first, duplicate]);
    await new Promise(resolve => setTimeout(resolve, 0));
    w.document.querySelector('script[data-workspace-group="ops"]').dispatchEvent(new w.Event('error'));
    assert.deepEqual((await rejected).map(result => result.status), ['rejected', 'rejected']);
    assert.equal(calls, 0);
    const retry = w.MoneyWorkspaceModules.invoke('ops', 'fixtureAction', [], true);
    await new Promise(resolve => setTimeout(resolve, 0));
    const scripts = w.document.querySelectorAll('script[data-workspace-group="ops"]');
    scripts[scripts.length - 1].dispatchEvent(new w.Event('load'));
    assert.equal(await retry, 1);
    assert.equal(calls, 1);
  } finally { dom.window.close(); }
});
