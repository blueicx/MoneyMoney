import json
import re
from playwright.sync_api import sync_playwright

BASE = 'http://127.0.0.1:3193'
CIK = '0001067983'
SEC_URL = 'https://www.sec.gov/Archives/edgar/data/1067983/000106798326000001/infotable.xml'


def fulfill_json(route, payload):
    route.fulfill(status=200, content_type='application/json', body=json.dumps(payload))


def guru_route(route):
    url = route.request.url
    path = re.sub(r'^https?://[^/]+', '', url).split('?', 1)[0]
    if path.endswith('/managers'):
        fulfill_json(route, {
            'market': 'stocks', 'dataStatus': 'historical', 'source': 'SEC EDGAR CIK fixture',
            'updatedAt': '2026-09-29T01:00:00Z', 'reason': None, 'evidenceRefs': [],
            'data': [{'cik': CIK, 'filingName': 'Berkshire Hathaway Inc.', 'personAssociation': 'Warren Buffett',
                      'dataStatus': 'cached', 'reportPeriod': '2026-06-30', 'filedAt': '2026-08-14'}],
        })
    elif path.endswith('/managers/' + CIK):
        fulfill_json(route, {
            'market': 'stocks', 'instrument': None, 'dataStatus': 'cached', 'source': 'SEC EDGAR Form 13F',
            'updatedAt': '2026-09-29T01:00:00Z', 'reason': None, 'evidenceRefs': [SEC_URL],
            'manager': {'cik': CIK, 'filingName': 'Berkshire Hathaway Inc.', 'personAssociation': 'Warren Buffett',
                        'filerName': 'Berkshire Hathaway Inc.', 'attributionNote': 'SEC申报主体为公司'},
            'latestReport': {'reportPeriod': '2026-06-30', 'filedAt': '2026-08-14', 'informationTableUrl': SEC_URL,
                             'positions': [{'issuerName': 'APPLE INC', 'classTitle': 'COM', 'cusip': '037833100',
                                            'putCall': None, 'shares': 150, 'reportedValueUsd': 125000}]},
            'previousReport': None,
            'changes': [{'issuerName': 'APPLE INC', 'classTitle': 'COM', 'cusip': '037833100', 'putCall': None,
                         'currentShares': 150, 'previousShares': None, 'shareDelta': None, 'change': 'newly-disclosed'}],
            'caveats': ['季度披露，非实时持仓。'],
        })
    else:
        symbol = path.rsplit('/', 1)[-1]
        if symbol == 'SNDK':
            fulfill_json(route, {
                'market': 'stocks', 'instrument': symbol, 'dataStatus': 'unavailable',
                'source': 'SEC CUSIP/class registry', 'updatedAt': None,
                'reason': '该股票尚无已核验的 SEC CUSIP 与证券类别映射，不能按公司名称猜测持仓。',
                'evidenceRefs': [], 'mapping': None, 'holders': [], 'caveats': ['13F 报告期持仓，不是实时持仓。'],
            })
            return
        fulfill_json(route, {
            'market': 'stocks', 'instrument': symbol, 'dataStatus': 'cached', 'source': 'SEC EDGAR Form 13F fixture',
            'updatedAt': '2026-09-29T01:00:00Z', 'reason': None, 'evidenceRefs': [SEC_URL],
            'mapping': {'cusip': '037833100', 'classTitle': 'COM', 'issuerName': 'Apple Inc.'},
            'holders': [{'manager': {'cik': CIK, 'filingName': 'Berkshire Hathaway Inc.', 'personAssociation': 'Warren Buffett'},
                         'reportPeriod': '2026-06-30', 'filedAt': '2026-08-14', 'sourceUrl': SEC_URL,
                         'shares': 150, 'reportedValueUsd': 125000, 'portfolioWeightPct': 1.25,
                         'previousShares': 100, 'shareDelta': 50, 'change': 'increased'}],
            'caveats': ['13F 报告期持仓，不是实时持仓。'],
        })


def main():
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True, channel='chrome')
        try:
            context = browser.new_context(viewport={'width': 1365, 'height': 900}, service_workers='block')
            try:
                page = context.new_page()
                page_errors = []
                page.on('pageerror', lambda error: page_errors.append(str(error)))
                page.route('**/api/stocks/guru-holdings/**', guru_route)
                page.route('**/api/stock/market-breadth', lambda route: fulfill_json(route, {
                    'success': True,
                    'data': {'generatedAt': '2026-09-29T01:00:00Z',
                             'gainers': [{'symbol': 'SNDK', 'name': 'Fixture Semiconductor', 'changePct': 4.2}],
                             'losers': [{'symbol': 'TEST', 'name': 'Fixture Test', 'changePct': -2.1}]},
                }))
                page.route('**/api/workspace/watchlist**', lambda route: fulfill_json(route, {
                    'success': True,
                    'groups': [{'id': 'watchlist', 'label': '我的自选',
                                'items': [{'instrumentId': 'stock:us:FIX', 'title': 'Fixture Watchlist'}]}],
                }))

                page.goto(BASE + '/login', wait_until='domcontentloaded')
                page.locator('#username').fill('guru-browser-owner')
                page.locator('#password').fill('local-guru-browser-test-only-91!')
                page.locator('#submitBtn').click()
                page.wait_for_url(re.compile(r'.*/$'), timeout=15000)
                try:
                    page.wait_for_load_state('networkidle', timeout=15000)
                except Exception:
                    pass
                page.evaluate("setMarketScope('stocks')")
                page.wait_for_function("document.body.dataset.marketScope === 'stocks'", timeout=10000)
                page.locator('#stock-library-quick .stock-library-item').first.wait_for(state='visible', timeout=10000)
                page.locator('#stock-library-quick .stock-library-item').first.click()
                page.wait_for_function("window._stockSelectedSymbol === 'AAPL'", timeout=10000)
                page.locator('#workspace-sidebar-content [data-workspace-id="guru-holdings"]').click()
                page.wait_for_function("activeWorkspaceId === 'guru-holdings'", timeout=10000)
                page.locator('#guru-holdings-tab').wait_for(state='visible')
                assert page.evaluate('guruHoldingsView') == 'stocks'

                page.locator('[data-guru-view="managers"]').click()
                page.wait_for_function("guruHoldingsView === 'managers'", timeout=10000)
                page.get_by_text('Warren Buffett', exact=False).first.wait_for(state='visible', timeout=10000)
                page.locator('[data-guru-manager-index="0"]').click()
                page.get_by_text('报告期截至', exact=False).wait_for(state='visible', timeout=10000)
                assert '2026-06-30' in page.locator('#guru-holdings-content').inner_text()
                assert page.locator('#guru-holdings-content a').get_attribute('href') == SEC_URL
                assert page.locator('#guru-holdings-content a').get_attribute('rel') == 'noopener noreferrer'

                page.locator('[data-guru-view="stocks"]').click()
                page.locator('[data-guru-stock="SNDK"]').wait_for(state='visible', timeout=10000)
                page.locator('[data-guru-stock="SNDK"]').click()
                page.locator('#guru-holdings-content .empty-tip').filter(has_text='不能按公司名称猜测持仓').wait_for(state='visible', timeout=10000)
                page.locator('#guru-holdings-search').fill('AAPL')
                page.locator('#guru-holdings-content tbody tr').first.wait_for(state='visible', timeout=10000)
                page.locator('#guru-holdings-content [data-guru-cik="' + CIK + '"]').click()
                page.get_by_text('申报证券', exact=False).wait_for(state='visible', timeout=10000)

                page.evaluate("setMarketScope('options')")
                assert page.locator('#workspace-sidebar-content [data-workspace-id="guru-holdings"]').count() == 0
                assert not page.locator('#guru-holdings-tab').is_visible()
                page.set_viewport_size({'width': 390, 'height': 844})
                assert not page_errors, page_errors
                print('Guru holdings browser acceptance passed: two-way views, SEC evidence link, stock selection, strict market scope, mobile viewport, no page errors')
            finally:
                context.close()
        finally:
            browser.close()


if __name__ == '__main__':
    main()
