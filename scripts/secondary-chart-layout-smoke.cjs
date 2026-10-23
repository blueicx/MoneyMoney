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
    for (const width of [375, 1003, 1440]) {
      const page = await browser.newPage({ viewport: { width, height: 1000 } });
      await page.setContent(`<style>${css}</style><div class="stock-chart-companion-panel" data-stock-chart-companion><div class="stock-chart-companion-toolbar">同步双图 视图 同标的·不同周期</div><div class="stock-chart-companion-stage"><canvas id="stock-kline-companion"></canvas></div><section class="mm-stock-multi-chart"><div class="mm-stock-multi-grid"><article data-mm-multi-period="1d"><header>日线</header><canvas></canvas></article></div></section></div><p id="after">后续内容</p>`);
      await page.addScriptTag({ path: 'src/web/public/trading-chart.js' });
      await page.addScriptTag({ content: `var stockChartCompanionPeriod='1d',stockChartCompanionMode='same',stockChartExchangeTimezone='America/New_York',stockChartAsOf=''; function stockChartEventInstrumentId(){return 'stock:us:SNDK';} ${source.slice(draw.getStart(ast), draw.end)}` });
      const result = await page.evaluate(() => {
        const bars = Array.from({ length: 80 }, (_, index) => ({ time: 1792762200000 + index * 86400000, open: 1269.001953, high: 1299.98999, low: 1258.300029, close: 1286.880005, volume: 3349777 }));
        for (let pass = 0; pass < 3; pass++) document.querySelectorAll('canvas:not(.mm-trading-crosshair)').forEach(canvas => drawStockChartCompanion(canvas, bars));
        const stage = document.querySelector('.stock-chart-companion-stage').getBoundingClientRect();
        const host = document.querySelector('#stock-kline-companion').parentElement.getBoundingClientRect();
        const multi = document.querySelector('.mm-stock-multi-chart').getBoundingClientRect();
        return { stageBottom: stage.bottom, hostBottom: host.bottom, multiTop: multi.top, text: document.querySelector('.mm-trading-readout').textContent, plotHeights: [...document.querySelectorAll('canvas:not(.mm-trading-crosshair)')].map(canvas => canvas.getBoundingClientRect().height), overflow: document.documentElement.scrollWidth > innerWidth };
      });
      assert.ok(result.stageBottom >= result.hostBottom - 1, `${width}px: chart toolbar, readout and canvas must fit inside stage: ${JSON.stringify(result)}`);
      assert.ok(result.multiTop >= result.hostBottom - 1, `${width}px: four-period panel must follow the full companion chart`);
      assert.equal(result.overflow, false, `${width}px: chart must fit viewport`);
      assert.ok(result.plotHeights.every(height => height <= 260), 'secondary plots retain compact height');
      assert.doesNotMatch(result.text, /1269\.001953|1,269\.001953/);
      await page.close();
      console.log(`Secondary chart layout passed at ${width}px`);
    }
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
