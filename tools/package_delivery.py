from pathlib import Path
import zipfile, json, shutil

BASE=Path(__file__).resolve().parent.parent
SOURCE=BASE/'source'/'Kinkakuji_eaves_refined.blend'
if not SOURCE.exists():SOURCE=BASE.parent/'eaves_refined'/'Kinkakuji_eaves_refined.blend'
(BASE/'source').mkdir(exist_ok=True)
if SOURCE.resolve()!=(BASE/'source'/SOURCE.name).resolve():shutil.copy2(SOURCE,BASE/'source'/SOURCE.name)
report=json.loads((BASE/'review/final_report.json').read_text())
assert report['offline_standalone_opened']
assert not report['external_requests'] and not report['page_errors']
assert report['orbit_and_reset'] and report['png_export']
assert not report['path_tracing']['error']
assert report['path_tracing']['state']['samples']>=1
assert report['pixel_stats']['bad']==0 and report['pixel_stats']['max']>.1
files=[BASE/n for n in ['Kinkakuji.html','index.html','app.js','style.css','serve.py','README_ja.md','package.json','package-lock.json','THIRD_PARTY_NOTICES.txt']]
files += [BASE/'assets'/n for n in ['kinkakuji.glb','scene.json','sky.hdr']]
files += [BASE/'review'/n for n in ['offline-front.png','offline-high.png','final_report.json']]
files += [BASE/'source'/SOURCE.name]
files += list((BASE/'src').glob('*.js'))
files += [p for p in (BASE/'tools').iterdir() if p.suffix in ['.py','.mjs']]
for p in files:assert p.is_file() and p.stat().st_size>0,p
out=BASE/'Kinkakuji_WebGL_complete.zip'
with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as z:
    for p in files:z.write(p,'Kinkakuji_WebGL/'+str(p.relative_to(BASE)))
with zipfile.ZipFile(out) as z:
    assert z.testzip() is None
    assert not any('node_modules' in n or 'kinkakuji-source.glb' in n for n in z.namelist())
    print('WEBGL_ARCHIVE_VERIFIED',len(z.namelist()),'files',round(out.stat().st_size/1024**2,2),'MiB')
