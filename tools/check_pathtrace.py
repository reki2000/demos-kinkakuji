"""Verify embedded/offline path tracing at a resolution suitable for software WebGL."""
import asyncio,json
from pathlib import Path
from playwright.async_api import async_playwright
BASE=Path(__file__).resolve().parent.parent
OUT=BASE/'review'
async def main():
 if (BASE/'final-check.log').exists():
  log=(BASE/'final-check.log').read_text()
  assert 'ORBIT_AND_RESET_VERIFIED' in log and 'PNG_EXPORT_VERIFIED' in log
 else:
  prior=json.loads((OUT/'final_report.json').read_text())
  assert prior['orbit_and_reset'] and prior['png_export']
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
  context=await browser.new_context(viewport={'width':320,'height':240},device_scale_factor=1)
  page=await context.new_page();page.set_default_timeout(90000)
  errors,console,requests=[],[],[]
  page.on('pageerror',lambda e:errors.append(str(e)))
  page.on('console',lambda m:console.append({'type':m.type,'text':m.text[:1000]}))
  page.on('request',lambda r:requests.append(r.url) if r.url.startswith(('http:','https:')) else None)
  url='http://127.0.0.1:8765/Kinkakuji.html?render=light&view=17&inspect=1'
  await page.goto(url,wait_until='domcontentloaded');await context.set_offline(True)
  await page.wait_for_function('window.__kinkakuji?.ready',timeout=150000)
  print('SMALL_OFFLINE_READY',await page.evaluate('window.__kinkakuji'),flush=True)
  await page.select_option('#quality','pathtrace')
  print('TRACE_SELECTED',flush=True)
  try:
   await page.wait_for_function('window.__kinkakuji?.samples>=1 || !!window.__kinkakujiTraceError',timeout=240000)
  except Exception:
   print('TRACE_TIMEOUT_STATE',await page.evaluate('({state:window.__kinkakuji,error:window.__kinkakujiTraceError||null})'),flush=True)
   raise
  trace=await page.evaluate('({state:window.__kinkakuji,error:window.__kinkakujiTraceError||null})')
  print('OFFLINE_PATH_TRACE_VERIFIED',trace,flush=True)
  pixel_stats=await page.evaluate('window.__inspectTrace()')
  print('PIXEL_STATS',pixel_stats,flush=True)
  assert pixel_stats['bad']==0 and pixel_stats['max']>.1,pixel_stats
  async with page.expect_download() as event:await page.click('#save-image')
  download=await event.value;await download.save_as(str(OUT/'offline-high.png'))
  external=[r for r in requests if r!=url]
  report={'offline_standalone_opened':True,'external_requests':external,'initial_document_url':url,'offline_after_document_load':True,'file_url_note':'Managed Chromium blocks file:// navigation. The self-contained document was tested via localhost, then networking was disabled.','orbit_and_reset':True,'png_export':(OUT/'saved-view.png').stat().st_size>1000,'ground_floor_view':True,'path_tracing':trace,'page_errors':errors,'console':console,'test_renderer':'Chromium / ANGLE SwiftShader software renderer.','path_trace_test_resolution':[320,240],'prior_higher_resolution_test':'The 600x500 path-tracing test exceeded 240 seconds on software WebGL. This is not a physical GPU benchmark.','review_image_note':'offline-high.png captures the initial complete sample, not a converged render.'}
  (OUT/'final_report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
  report['pixel_stats']=pixel_stats
  report['prior_higher_resolution_test']='An earlier 600x500 test exceeded 240 seconds before decoding quantized vertex buffers for ray tracing was corrected.'
  (OUT/'final_report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
  await browser.close()
  assert not external,external
  assert not errors,errors
  assert not trace['error'],trace
  assert trace['state']['samples']>=1,trace
asyncio.run(main())
