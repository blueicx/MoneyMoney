from playwright.sync_api import sync_playwright


def wait_ready(page):
    try:
        page.wait_for_load_state('networkidle', timeout=8000)
    except Exception:
        pass
    page.wait_for_timeout(1200)


with sync_playwright() as p:
    print('launch', flush=True)
    browser = p.chromium.launch(headless=True, executable_path=r"C:\Program Files\Google\Chrome\Application\chrome.exe")
    page = browser.new_page(viewport={"width": 1440, "height": 1000})
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto("http://127.0.0.1:3199/login", wait_until="domcontentloaded")
    print('login page', page.url, flush=True)
    page.locator("#username").fill("admin")
    page.locator("#password").fill("admin123")
    page.locator("#submitBtn").click()
    page.wait_for_url("**/")
    print('dashboard', page.url, flush=True)
    wait_ready(page)

    market_buttons = page.locator("button[data-market-scope]")
    assert market_buttons.count() >= 4, "four market switch buttons are missing"

    page.locator("button[data-market-scope='stocks']").click()
    print('stocks', flush=True)
    wait_ready(page)
    assert page.locator("button[data-market-scope='stocks'].active").count() == 1
    assert page.locator("#stock-instrument-library").is_visible()
    assert "美股七姐妹" not in page.locator("#center-workspace").inner_text()
    quick = page.locator("#stock-library-quick button")
    assert quick.count() >= 3, "stock right library did not load"
    quick.first.click()
    wait_ready(page)
    symbol = page.locator("#stock-library-current-symbol").inner_text().strip()
    assert symbol and symbol in page.locator("#center-workspace").inner_text()
    assert page.locator("#stock-kline").count() == 1
    page.locator("input[data-chart-overlay='patterns']").check()
    page.locator("button[data-chart-fullscreen='stocks']").click()
    assert page.locator("body").get_attribute("data-chart-fullscreen") == "stocks"
    page.keyboard.press("Escape")
    assert page.locator("body").get_attribute("data-chart-fullscreen") in (None, "")
    page.locator("button[data-chart-replay='reset']").click()
    page.locator("button[data-chart-replay='next']").click()
    assert "/" in page.locator("#stock-chart-replay-status").inner_text()

    page.locator("button[data-market-scope='options']").click()
    print('options', flush=True)
    wait_ready(page)
    assert page.locator("button[data-market-scope='options'].active").count() == 1
    assert page.locator("#options-library-quick").is_visible()
    assert "期权标的库" in page.locator("#right-instrument-library").inner_text()

    page.locator("button[data-market-scope='crypto']").click()
    print('crypto', flush=True)
    wait_ready(page)
    assert page.locator("button[data-market-scope='crypto'].active").count() == 1
    assert page.locator("#crypto-library-quick").is_visible()
    assert "虚拟币标的库" in page.locator("#right-instrument-library").inner_text()

    page.locator("button[data-market-scope='prediction']").click()
    print('prediction', flush=True)
    wait_ready(page)
    assert page.locator("button[data-market-scope='prediction'].active").count() == 1
    assert page.locator("#prediction-library-quick").is_visible()
    assert "预测市场标的库" in page.locator("#right-instrument-library").inner_text()

    collapsed = page.locator("#sidebar-edge-toggle")
    collapsed.click()
    assert page.locator(".layout.sidebar-collapsed").count() == 1
    page.locator("#sidebar-expand-fab").click()
    assert page.locator(".layout.sidebar-collapsed").count() == 0
    assert page.locator("#right-instrument-library").is_visible()

    experiment = page.evaluate("""async () => {
      const response = await fetch('/api/research/experiments', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({market:'stocks', workspace:'backtest', instrument:'AAPL', timeframe:'1d', dataSource:'browser-fixture', prices:[100,110,105,120,118,130], signals:[{timeIndex:0,direction:'buy'},{timeIndex:1,direction:'sell'},{timeIndex:4,direction:'buy'},{timeIndex:5,direction:'sell'}], split:{trainSize:2,testSize:2,purge:1,embargo:1}, promotion:{minOutOfSampleReturnPct:0,minTrades:1}})
      });
      return {status: response.status, body: await response.json()};
    }""")
    assert experiment["status"] == 200 and experiment["body"]["success"]
    assert experiment["body"]["data"]["evidence"]["checks"]["futureData"]["passed"]
    assert not errors, errors
    print("Browser acceptance passed: four markets, scoped libraries, stock K-line overlays/fullscreen/replay, library restore, experiment API")
    browser.close()
