const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright');
const ts = require('typescript');

async function main() {
  const browser = await chromium.launch({ headless: true, channel: process.env.MONEYMONEY_SMOKE_BROWSER || 'chrome' });
  try {
    const source = fs.readFileSync('src/web/public/modules/dashboard-runtime.js', 'utf8');
    const ast = ts.createSourceFile('runtime.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const draw = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'drawStockChartCompanion');
    assert.ok(draw);
    const css = ['src/web/public/modules/dashboard-base.css', 'src/web/public/experience-enhancements.css'].map(file => fs.readFileSync(file, 'utf8')).join('\n');
    for (const theme of ['light','dark','money']) for (const width of [375, 390, 1003, 1440]) {
      const page = await browser.newPage({ viewport: { width, height: 1000 }, hasTouch: width < 500 });
      await page.setContent(`<style>${css}</style><div class="stock-chart-companion-panel" data-stock-chart-companion><div class="stock-chart-companion-toolbar">同步双图 视图 同标的·不同周期</div><div class="stock-chart-companion-stage"><canvas id="stock-kline-companion"></canvas></div><section class="mm-stock-multi-chart"><div class="mm-stock-multi-grid"><article data-mm-multi-period="1d"><header>日线</header><canvas></canvas></article></div></section></div><p id="after">后续内容</p>`);
      await page.addScriptTag({ path: 'src/web/public/trading-chart.js' });
      await page.addScriptTag({ content: `var stockChartCompanionPeriod='1d',stockChartCompanionMode='same',stockChartExchangeTimezone='America/New_York',stockChartAsOf=''; function stockChartEventInstrumentId(){return 'stock:us:SNDK';} ${source.slice(draw.getStart(ast), draw.end)}` });
      await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
      const result = await page.evaluate(async () => {
        const bars = Array.from({ length: 80 }, (_, index) => ({ time: 1792762200000 + index * 86400000, open: 1269.001953, high: 1299.98999, low: 1258.300029, close: 1286.880005, volume: 3349777 }));
        document.querySelectorAll('canvas:not(.mm-trading-crosshair)').forEach(canvas => drawStockChartCompanion(canvas, bars));
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const stage = document.querySelector('.stock-chart-companion-stage').getBoundingClientRect();
        const host = document.querySelector('#stock-kline-companion').parentElement.getBoundingClientRect();
        const multi = document.querySelector('.mm-stock-multi-chart').getBoundingClientRect();
        return { stageBottom: stage.bottom, hostBottom: host.bottom, multiTop: multi.top, text: document.querySelector('.mm-trading-readout').textContent, plotHeights: [...document.querySelectorAll('canvas:not(.mm-trading-crosshair)')].map(canvas => canvas.getBoundingClientRect().height), overlayDelta: document.querySelector('.mm-trading-crosshair').getBoundingClientRect().top - document.querySelector('#stock-kline-companion').getBoundingClientRect().top, overflow: document.documentElement.scrollWidth > innerWidth };
      });
      assert.ok(result.stageBottom >= result.hostBottom - 1, `${width}px: chart toolbar, readout and canvas must fit inside stage: ${JSON.stringify(result)}`);
      assert.ok(result.multiTop >= result.hostBottom - 1, `${width}px: four-period panel must follow the full companion chart`);
      assert.ok(Math.abs(result.overlayDelta) < 1, 'first render overlay follows toolbar wrapping');
      assert.equal(result.overflow, false, `${width}px: chart must fit viewport`);
      assert.ok(result.plotHeights.every(height => height <= 260), 'secondary plots retain compact height');
      assert.doesNotMatch(result.text, /1269\.001953|1,269\.001953/);
      for (const nextWidth of [Math.max(320,width-60),width]) {
        await page.setViewportSize({width:nextWidth,height:1000});
        await page.waitForTimeout(50);
        const picked=await page.evaluate(()=>{
          const canvas=document.getElementById('stock-kline-companion'),layer=canvas.parentElement.querySelector('.mm-trading-crosshair'),plot=canvas.getBoundingClientRect(),overlay=layer.getBoundingClientRect();
          const selected=MoneyTradingChart.pickCandle(canvas,plot.left+plot.width/2);
          return {delta:overlay.top-plot.top,widthDelta:overlay.width-plot.width,time:selected?.time};
        });
        assert.ok(Math.abs(picked.delta)<1&&Math.abs(picked.widthDelta)<1,'resize keeps drawing, cursor and click geometry aligned');
        assert.ok(Number.isFinite(picked.time),'a touch/click position selects an actual loaded candle');
      }
      await page.close();
      console.log(`Secondary chart layout passed at ${width}px (${theme})`);
    }
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
