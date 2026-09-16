from playwright.sync_api import sync_playwright


BASE = "http://127.0.0.1:3199"


def wait_ready(page):
    try:
        page.wait_for_load_state("networkidle", timeout=8000)
    except Exception:
        pass
    page.wait_for_timeout(1600)


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, executable_path=r"C:\Program Files\Google\Chrome\Application\chrome.exe")
    page = browser.new_page(viewport={"width": 1440, "height": 1000})
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto(f"{BASE}/login", wait_until="domcontentloaded")
    page.locator("#username").fill("admin")
    page.locator("#password").fill("admin123")
    page.locator("#submitBtn").click()
    page.wait_for_url("**/")
    page.evaluate("localStorage.clear()")

    page.locator("button[data-market-scope='stocks']").click()
    wait_ready(page)
    assert page.locator("#stock-instrument-library").is_visible()

    shell = page.locator("#market-workspace-shell")
    page.locator("#sidebar-edge-toggle").click()
    page.wait_for_timeout(300)
    layout = page.evaluate("""() => {
      const shell = document.querySelector('#market-workspace-shell');
      const layout = document.querySelector('.layout');
      const center = document.querySelector('#center-workspace');
      const right = document.querySelector('#right-instrument-library');
      const shellRect = shell.getBoundingClientRect();
      const centerRect = center.getBoundingClientRect();
      return {
        columns: getComputedStyle(shell).gridTemplateColumns,
        outerState: layout.className,
        shellWidth: shellRect.width,
        centerWidth: centerRect.width,
        centerRight: centerRect.right,
        shellRight: shellRect.right,
        rightWidth: right.getBoundingClientRect().width,
      };
    }""")
    assert "sidebar-collapsed" in layout["outerState"], layout
    assert len(layout["columns"].split()) == 2, layout
    assert abs(layout["centerRight"] - layout["shellRight"]) < 2, layout
    assert layout["rightWidth"] < 4, layout

    pattern_inputs = page.locator("#stock-chart-pattern-controls input[data-chart-pattern]")
    print('pattern count:', pattern_inputs.count(), flush=True)
    assert pattern_inputs.count() >= 20, pattern_inputs.count()
    assert page.locator("#stock-chart-structure-list").count() == 1
    assert page.locator("#stock-chart-ma-values").count() == 1
    doji = page.locator("#stock-chart-pattern-controls input[data-chart-pattern='doji']")
    print('doji onchange:', doji.get_attribute('onchange'), flush=True)
    print('doji checked before:', doji.is_checked(), flush=True)
    doji.uncheck()
    print('doji checked after:', doji.is_checked(), 'keys:', page.evaluate("() => Object.keys(localStorage)"), 'errors:', errors, flush=True)
    stored = page.evaluate("""() => {
      const key = Object.keys(localStorage).find(key => key.startsWith('mm-chart-overlays:'));
      return key ? JSON.parse(localStorage.getItem(key)) : null;
    }""")
    assert stored and stored["patternTypes"]["doji"] is False, stored

    fullscreen = page.locator("button[data-chart-fullscreen='stocks']")
    fullscreen.click()
    page.wait_for_timeout(400)
    full = page.evaluate("""() => {
      const card = document.querySelector('#stock-chart-card');
      const overlay = document.querySelector('#chart-fullscreen-overlay');
      const rect = card.getBoundingClientRect();
      const overlayRect = overlay.getBoundingClientRect();
      return {
        mode: document.body.dataset.chartFullscreen,
        parent: card.parentElement?.id,
        x: rect.x, y: rect.y, width: rect.width, height: rect.height,
        overlayX: overlayRect.x, overlayY: overlayRect.y, overlayWidth: overlayRect.width, overlayHeight: overlayRect.height,
        overlayPosition: getComputedStyle(overlay).position,
        viewportWidth: window.innerWidth, viewportHeight: window.innerHeight,
      };
    }""")
    assert full["mode"] == "stocks" and full["parent"] == "chart-fullscreen-overlay", full
    assert full["x"] <= 1 and full["y"] <= 1, full
    assert abs(full["width"] - full["viewportWidth"]) < 3, full
    assert abs(full["height"] - full["viewportHeight"]) < 3, full
    page.keyboard.press("Escape")
    page.wait_for_timeout(250)
    assert not page.evaluate("() => document.body.dataset.chartFullscreen")
    assert page.evaluate("() => document.querySelector('#stock-chart-card').parentElement.classList.contains('collapse-body')")

    assert not errors, errors
    print("UI regression passed:", {"layout": layout, "fullscreen": full, "patterns": pattern_inputs.count()}, flush=True)
    browser.close()
