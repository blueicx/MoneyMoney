const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{JSDOM}=require('jsdom');
const controls=fs.existsSync('src/web/public/chart-strategy-controls.js')?require('../src/web/public/chart-strategy-controls.js'):{};
const library=require('../src/web/public/chart-strategies.js');
const ts=require('typescript'),source=fs.readFileSync('src/web/public/modules/dashboard-runtime.js','utf8');
function declaration(name){const ast=ts.createSourceFile('runtime.js',source,99,true);const fn=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);assert.ok(fn,name);return fn.getText(ast);}

test('all new strategies have accessible independent controls, bounded parameters and status reasons',()=>{
  assert.equal(typeof controls.render,'function');
  const dom=new JSDOM('<div id="host"></div>'),host=dom.window.document.getElementById('host');
  try{
    controls.render({host,enabled:{},parameters:{},statuses:{sessionVwap:{reason:'当前周期不支持',state:'unsupported'}},onChange:()=>{}});
    assert.equal(host.querySelectorAll('input[type=checkbox]').length,10);
    assert.equal(host.querySelectorAll('input[type=checkbox]:checked').length,0);
    assert.ok([...host.querySelectorAll('input')].every(input=>input.getAttribute('aria-label')));
    assert.ok([...host.querySelectorAll('input[type=number]')].every(input=>input.min&&input.max&&input.step));
    assert.match(host.textContent,/当前周期不支持/);
    assert.ok(library.STRATEGY_CATALOG.every(s=>host.textContent.includes(s.version)));
  }finally{dom.window.close();}
});

test('repeated renders preserve focused nodes, use the latest callbacks and reject invalid parameters',()=>{
  const dom=new JSDOM('<div id="host"></div>',{pretendToBeVisual:true}),w=dom.window,host=w.document.getElementById('host'),old=[],changes=[];
  try{
    const options={host,enabled:{macdCross:true},parameters:{},statuses:{},onChange:c=>old.push(c)};
    controls.render(options);
    const toggle=host.querySelector('[data-strategy-id=macdCross][type=checkbox]'),input=host.querySelector('[data-strategy-id=macdCross][data-parameter=fast]');
    input.focus();controls.render({...options,onChange:c=>changes.push(c)});
    assert.equal(host.querySelector('[data-strategy-id=macdCross][data-parameter=fast]'),input);assert.equal(w.document.activeElement,input);
    input.value='50';input.dispatchEvent(new w.Event('change',{bubbles:true}));
    assert.equal(changes.length,0);assert.equal(input.value,'12');assert.match(host.textContent,/参数/);
    input.value='8';input.dispatchEvent(new w.Event('change',{bubbles:true}));
    assert.equal(changes[0].parameters.fast,8);assert.equal(changes[0].id,'macdCross');
    toggle.checked=false;toggle.dispatchEvent(new w.Event('change',{bubbles:true}));
    assert.equal(changes[1].enabled,false);assert.equal(old.length,0);
  }finally{w.close();}
});

test('mount points stay in their own stock/crypto chart workspaces and library is deferred with charts',()=>{
  const html=fs.readFileSync('src/web/public/index.html','utf8'),dom=new JSDOM(html);
  try{
    assert.ok(dom.window.document.querySelector('#stock-chart-card #stock-advanced-strategies'));
    assert.ok(dom.window.document.querySelector('#binance-tab #bn-advanced-strategies'));
    const build=fs.readFileSync('scripts/copy-web-assets.js','utf8');
    assert.match(build,/modules\.charts\.push\([\s\S]*chart-strategies\.js[\s\S]*chart-strategy-controls\.js/);
  }finally{dom.window.close();}
});

test('parameters survive two edits before data arrives without changing another market',()=>{
  const dom=new JSDOM('<div id="stock-advanced-strategies"></div>',{runScripts:'outside-only',url:'http://localhost/'}),w=dom.window;
  w.MoneyChartStrategies=library;w.MoneyChartStrategyControls=controls;
  w.eval("var stockChartOverlayConfig={strategies:{macdCross:true}},cryptoChartOverlayConfig={},cryptoChartStrategyConfig={},stockChartKlines=[],bnKlineData=[];");
  w.stockChartStorageKey=()=> 'stock:fixture';w.cryptoChartOverlayStorageKey=()=> 'crypto:fixture';
  w.eval(declaration('saveChartLayoutPreference'));w.eval(declaration('renderAdvancedChartStrategyControls'));w.eval(declaration('setChartStrategyParameters'));
  try{
    w.renderAdvancedChartStrategyControls('stock');
    const host=w.document.getElementById('stock-advanced-strategies'),fast=host.querySelector('[data-strategy-id=macdCross][data-parameter=fast]'),slow=host.querySelector('[data-strategy-id=macdCross][data-parameter=slow]');
    fast.value='8';fast.dispatchEvent(new w.Event('change',{bubbles:true}));
    slow.value='30';slow.dispatchEvent(new w.Event('change',{bubbles:true}));
    const saved=JSON.parse(w.localStorage.getItem('stock:fixture'));
    assert.equal(saved.strategyParameters.macdCross.fast,8);assert.equal(saved.strategyParameters.macdCross.slow,30);
    assert.equal(w.localStorage.getItem('crypto:fixture'),null);
  }finally{w.close();}
});
