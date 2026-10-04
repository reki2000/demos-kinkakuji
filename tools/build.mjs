import { build } from 'esbuild';
import { NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression, KHRMeshQuantization } from '@gltf-transform/extensions';
import { dedup, prune, meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const base = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
process.chdir(base);
if (!process.argv.includes('--skip-model') && await fs.stat('assets/kinkakuji-source.glb').catch(() => null)) {
  await MeshoptEncoder.ready; await MeshoptDecoder.ready;
  const io = new NodeIO().registerExtensions([EXTMeshoptCompression, KHRMeshQuantization]).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
  const document = await io.read('assets/kinkakuji-source.glb');
  await document.transform(dedup(), prune(), meshopt({encoder:MeshoptEncoder,level:'medium',quantizePosition:16,quantizeNormal:12,quantizeTexcoord:16}));
  await io.write('assets/kinkakuji.glb',document);
  console.log('Compressed geometry', (await fs.stat('assets/kinkakuji.glb')).size, 'bytes');
}
const worker = await build({entryPoints:['node_modules/three-mesh-bvh/src/workers/generateMeshBVH.worker.js'],bundle:true,write:false,format:'iife',target:'es2022',minify:true,legalComments:'inline'});
const workerSource = worker.outputFiles[0].text;
await build({entryPoints:['src/main.js'],bundle:true,outfile:'app.js',format:'iife',target:'es2022',minify:true,legalComments:'inline',define:{BVH_WORKER_SOURCE:JSON.stringify(workerSource)}});
const [template,css,js,model,sky,config] = await Promise.all([
  fs.readFile('index.html','utf8'),fs.readFile('style.css','utf8'),fs.readFile('app.js','utf8'),
  fs.readFile('assets/kinkakuji.glb'),fs.readFile('assets/sky.hdr'),fs.readFile('assets/scene.json','utf8'),
]);
const embedded = `<script id="asset-config" type="application/json">${config.replace(/<\/script/gi,'<\\/script')}</script>\n<script id="asset-model" type="application/octet-stream">${model.toString('base64')}</script>\n<script id="asset-sky" type="application/octet-stream">${sky.toString('base64')}</script>\n<script>${js.replace(/<\/script/gi,'<\\/script')}</script>`;
const standalone = template.replace('<link rel="stylesheet" href="style.css">',()=>`<style>${css}</style>`).replace('<script src="app.js" defer></script>',()=>embedded);
await fs.writeFile('Kinkakuji.html',standalone);
const notices = [];
for (const name of ['three','three-gpu-pathtracer','three-mesh-bvh','meshoptimizer']) {
  const packageJson = JSON.parse(await fs.readFile(`node_modules/${name}/package.json`,'utf8'));
  const license = await fs.readFile(`node_modules/${name}/LICENSE`,'utf8').catch(async()=>fs.readFile(`node_modules/${name}/LICENSE.md`,'utf8').catch(()=>String(packageJson.license)));
  notices.push(`${name} ${packageJson.version}\n${license}`);
}
await fs.writeFile('THIRD_PARTY_NOTICES.txt',notices.join('\n\n------------------------\n\n'));
console.log('Standalone HTML',Buffer.byteLength(standalone),'bytes');
