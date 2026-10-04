import asyncio, json, math
from pathlib import Path
from playwright.async_api import async_playwright

BASE=Path(__file__).resolve().parent.parent
OUT=BASE/'review'

async def main():
    async with async_playwright() as p:
        browser=await p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
        context=await browser.new_context(viewport={'width':900,'height':750},device_scale_factor=1)
        page=await context.new_page();page.set_default_timeout(100000)
        errors,console,requests=[],[],[]
        page.on('pageerror',lambda e:errors.append(str(e)))
        page.on('console',lambda m:console.append({'type':m.type,'text':m.text[:1000]}))
        page.on('request',lambda r:requests.append(r.url) if r.url.startswith(('http:','https:')) else None)
        document_url='http://127.0.0.1:8765/Kinkakuji.html?render=light'
        await page.goto(document_url,wait_until='domcontentloaded')
        await context.set_offline(True)
        await page.wait_for_function('window.__kinkakuji?.ready',timeout=150000)
        print('OFFLINE_HTML_READY',await page.evaluate('window.__kinkakuji'),flush=True)
        await page.screenshot(path=str(OUT/'offline-front.png'))
        before=await page.evaluate('window.__kinkakuji.position')
        print('POINTER_TARGET',await page.evaluate('({target:document.elementFromPoint(440,300).tagName,hidden:document.hidden,lost:window.__kinkakuji.contextLost})'),flush=True)
        await page.mouse.move(440,300);await page.mouse.down();await page.mouse.move(500,315,steps=3);await page.mouse.up()
        print('AFTER_DRAG',await page.evaluate('window.__kinkakuji.position'),flush=True)
        await page.wait_for_function('Math.abs(window.__kinkakuji.position[0]-41.88939)>0.1',polling=100,timeout=30000)
        await page.click('#reset-view')
        await page.wait_for_function('Math.abs(window.__kinkakuji.position[0]-41.88939)<0.01',polling=100,timeout=30000)
        print('ORBIT_AND_RESET_VERIFIED',flush=True)
        async with page.expect_download() as event:
            await page.click('#save-image')
        download=await event.value;await download.save_as(str(OUT/'saved-view.png'))
        print('PNG_EXPORT_VERIFIED',flush=True)
        await page.click('button[data-camera="12"]')
        await page.wait_for_function('window.__kinkakuji?.preset==="12"',timeout=90000)
        await page.set_viewport_size({'width':600,'height':500})
        await page.click('button[data-camera="17"]')
        await page.wait_for_function('window.__kinkakuji?.preset==="17"',timeout=90000)
        await page.select_option('#quality','pathtrace')
        await page.wait_for_function('window.__kinkakuji?.samples>=1 || !!window.__kinkakujiTraceError',timeout=240000)
        trace=await page.evaluate('({state:window.__kinkakuji,error:window.__kinkakujiTraceError||null})')
        print('OFFLINE_PATH_TRACE_VERIFIED',trace,flush=True)
        async with page.expect_download() as event:
            await page.click('#save-image')
        download=await event.value;await download.save_as(str(OUT/'offline-high.png'))
        external=[url for url in requests if url!=document_url]
        report={'offline_standalone_opened':True,'external_requests':external,'initial_document_url':document_url,'offline_after_document_load':True,'file_url_note':'Managed Chromium blocks file:// navigation. The self-contained document was tested via localhost, then networking was disabled.','orbit_and_reset':True,'png_export':(OUT/'saved-view.png').stat().st_size>1000,'ground_floor_view':True,'path_tracing':trace,'page_errors':errors,'console':console,'test_renderer':'Chromium / software ANGLE SwiftShader; not a benchmark of a physical GPU.'}
        (OUT/'final_report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
        await browser.close()
        assert not external,external
        assert not errors,errors
        assert not trace['error'],trace
        assert trace['state']['samples']>=1,trace
asyncio.run(main())
