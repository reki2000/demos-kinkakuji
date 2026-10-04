import asyncio, json, os
from pathlib import Path
from playwright.async_api import async_playwright

BASE = Path(__file__).resolve().parent.parent
OUT = BASE / 'review'
OUT.mkdir(exist_ok=True)

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=[
            '--no-sandbox','--disable-dev-shm-usage','--use-gl=angle',
            '--use-angle=swiftshader','--enable-unsafe-swiftshader',
            '--disable-background-timer-throttling',
        ])
        page = await browser.new_page(viewport={'width':1000,'height':750},device_scale_factor=1)
        page.set_default_timeout(90000)
        errors, consoles, requests = [], [], []
        page.on('pageerror',lambda e:errors.append(str(e)))
        page.on('console',lambda m:consoles.append({'type':m.type,'text':m.text[:1200]}))
        page.on('requestfailed',lambda r:requests.append({'url':r.url,'reason':r.failure}))
        await page.goto('http://127.0.0.1:8765/?render=light',wait_until='domcontentloaded')
        await page.wait_for_function('window.__kinkakuji?.ready',timeout=150000)
        print('WEBGL_READY',await page.evaluate('window.__kinkakuji'),flush=True)
        await page.screenshot(path=str(OUT/'front.png'))
        for id,name in [('14','rear'),('16','eave'),('17','bell'),('10','phoenix')]:
            await page.locator(f'button[data-camera="{id}"]').click()
            await page.wait_for_function(f'window.__kinkakuji?.preset === "{id}"',timeout=90000)
            await page.screenshot(path=str(OUT/(name+'.png')))
            print('VIEW_VERIFIED',name,await page.evaluate('window.__kinkakuji'),flush=True)
        await page.locator('button[data-camera="17"]').click()
        await page.wait_for_function('window.__kinkakuji?.preset === "17"',timeout=90000)
        await page.select_option('#quality','pathtrace')
        await page.wait_for_function('window.__kinkakuji?.samples > 0 || !!window.__kinkakujiTraceError',timeout=240000)
        trace = await page.evaluate('({state:window.__kinkakuji,error:window.__kinkakujiTraceError||null})')
        print('PATH_TRACE_RESULT',trace,flush=True)
        await page.screenshot(path=str(OUT/'bell-high-quality.png'))
        report={'errors':errors,'requests_failed':requests,'console':consoles,'path_tracing':trace}
        (OUT/'browser_report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
        await browser.close()
        assert not errors,errors
        assert not requests,requests
        assert not trace['error'],trace

asyncio.run(main())
