import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Water } from 'three/addons/objects/Water.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { WebGLPathTracer } from 'three-gpu-pathtracer';
import { OfflineBVHWorker } from './bvh-worker-client.js';
import { createGarden, gardenCamera } from './garden.js';

const $ = id => document.getElementById(id);
const mobile = window.matchMedia('(pointer: coarse)').matches;
const params = new URLSearchParams(location.search);
const lightDefault = mobile || params.get('render') === 'light';
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(24, innerWidth / innerHeight, .05, 500);
let renderer, composer, ao, controls, config, model, sun, water, traceWater;
let pathTracer, worker, traceScene, traceBuild = null, traceDirty = true;
let currentPreset, ready = false, mode = 'realtime', lastMotion = performance.now();
let frames = 0, fps = 0, lastFPS = performance.now(), contextLost = false;
let needsRender = true, sceneRevision = 0;
let capturePending = false;
const landscapeGroups = { garden: [], rearGarden: [] };
const textures = new Map();
let saveURL = null;
let seed = 5786;
const rand = () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 4294967296; };

function fail(error) {
  console.error(error);
  $('loading').classList.add('done');
  $('error').hidden = false;
  $('error').textContent = location.protocol === 'file:' && !$('asset-model')
    ? 'ダブルクリックで開く場合は Kinkakuji.html を使用してください。分割版は serve.py で起動して表示できます。'
    : '3D表示を開始できませんでした。WebGL 2を有効にしたブラウザーで再読み込みしてください。';
  $('render-status').textContent = '描画を開始できません';
  window.__kinkakujiError = String(error);
}

function progress(text, percent) {
  $('loading-text').textContent = text;
  $('loading-bar').style.width = `${percent}%`;
}

function unbase64(element) {
  const binary = atob(element.textContent.trim());
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function asset(name, embeddedId) {
  const embedded = $(embeddedId);
  if (embedded) return embeddedId === 'asset-config' ? JSON.parse(embedded.textContent) : unbase64(embedded);
  const response = await fetch(`assets/${name}`);
  if (!response.ok) throw new Error(`Asset ${name}: HTTP ${response.status}`);
  return name.endsWith('.json') ? response.json() : response.arrayBuffer();
}

function canvasTexture(draw, size = 512, color = true) {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = size;
  draw(canvas.getContext('2d'), size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  return texture;
}

function surfaceTexture(kind) {
  if (textures.has(kind)) return textures.get(kind);
  const texture = canvasTexture((ctx, n) => {
    ctx.fillStyle = '#f1eee5'; ctx.fillRect(0, 0, n, n);
    if (kind === 'gold') {
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
        const v = 238 + Math.floor(rand() * 12);
        ctx.fillStyle = `rgb(${v},${v},${v})`; ctx.fillRect(x * 32, y * 32, 32, 32);
        ctx.fillStyle = '#a6a19b22'; ctx.fillRect(x * 32, y * 32, 32, .7); ctx.fillRect(x * 32, y * 32, .7, 32);
      }
      for (let i = 0; i < 22000; i++) { ctx.fillStyle = rand() > .5 ? '#ffffff05' : '#00000004'; ctx.fillRect(rand()*n,rand()*n,1,1); }
    } else if (kind === 'wood') {
      ctx.fillStyle = '#a49c8c'; ctx.fillRect(0,0,n,n);
      for (let i = 0; i < 1200; i++) {
        const x = rand()*n; ctx.beginPath();ctx.moveTo(x,0);
        for(let y=0;y<=n;y+=12)ctx.lineTo(x+Math.sin(y*.018+i)*(.2+rand()*2),y);
        ctx.strokeStyle=rand()>.35?'#473b2b32':'#efe2c81c';ctx.lineWidth=.3+rand()*1.4;ctx.stroke();
      }
    } else {
      const image = ctx.getImageData(0,0,n,n);
      for(let i=0;i<image.data.length;i+=4){const v=190+rand()*55;image.data[i]=v;image.data[i+1]=v;image.data[i+2]=v;image.data[i+3]=255;}
      ctx.putImageData(image,0,0);
      if(kind==='roof')for(let i=0;i<1800;i++){ctx.strokeStyle='#00000018';ctx.beginPath();const x=rand()*n,y=rand()*n;ctx.moveTo(x,y);ctx.lineTo(x+.6,y+rand()*42);ctx.stroke();}
    }
  });
  textures.set(kind, texture); return texture;
}

function foliageTexture() {
  return canvasTexture((ctx, n) => {
    ctx.clearRect(0,0,n,n);
    const image=ctx.createImageData(n,n);
    for(let y=0;y<n;y++)for(let x=0;x<n;x++){
      const dx=(x/n-.5)*2,dy=(y/n-.5)*2,angle=Math.atan2(dy,dx);
      const radius=Math.hypot(dx,dy)/(1+.055*Math.sin(angle*13)+.035*Math.cos(angle*23));
      const alpha=Math.max(0,Math.min(1,(.94-radius)/.22));
      const v=160+rand()*65;const i=(y*n+x)*4;
      image.data[i]=image.data[i+1]=image.data[i+2]=v;image.data[i+3]=alpha*255;
    }
    ctx.putImageData(image,0,0);
    for(let i=0;i<1600;i++) {
      const angle=rand()*Math.PI*2,r=Math.pow(rand(),.65)*.46*n;
      const x=n/2+Math.cos(angle)*r,y=n/2+Math.sin(angle)*r;
      const a=angle+(rand()-.5)*1.8,length=5+rand()*19;
      const value=145+Math.floor(rand()*100);
      ctx.strokeStyle=`rgba(${value},${value},${value},${.65+rand()*.35})`;ctx.lineWidth=.65+rand()*1.7;
      ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+Math.cos(a)*length,y+Math.sin(a)*length);ctx.stroke();
    }
  });
}

function cardGeometry() {
  const p=[],normal=[],uv=[],indices=[];
  for(const plane of [0,1,2]) {
    const start=p.length/3;
    for(const [x,y,u,v] of [[-1,-1,0,0],[1,-1,1,0],[1,1,1,1],[-1,1,0,1]]) {
      p.push(...(plane===0?[x,y,0]:plane===1?[x,0,y]:[0,x,y]));
      normal.push(...(plane===0?[0,0,1]:plane===1?[0,1,0]:[1,0,0]));uv.push(u,v);
    }
    indices.push(start,start+1,start+2,start,start+2,start+3);
  }
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setAttribute('normal',new THREE.Float32BufferAttribute(normal,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(indices);return g;
}

function addFoliage() {
  const texture=foliageTexture(), geometry=cardGeometry();
  for(const entry of config.foliage) {
    const material=new THREE.MeshStandardMaterial({color:new THREE.Color(...entry.color),map:texture,alphaTest:.30,side:THREE.DoubleSide,roughness:.95});
    const mesh=new THREE.InstancedMesh(geometry,material,entry.matrices.length);
    entry.matrices.forEach((m,i)=>mesh.setMatrixAt(i,new THREE.Matrix4().fromArray(m)));
    mesh.instanceMatrix.needsUpdate=true;mesh.computeBoundingSphere();mesh.castShadow=true;mesh.receiveShadow=true;mesh.name=entry.name;
    mesh.userData.foliage=true;scene.add(mesh);landscapeGroups[entry.category].push(mesh);
  }
}

function expandInstances(instanced) {
  const src=instanced.geometry.toNonIndexed(), count=src.attributes.position.count, total=count*instanced.count;
  const position=new Float32Array(total*3),normal=new Float32Array(total*3),uv=new Float32Array(total*2);
  const m=new THREE.Matrix4(),nm=new THREE.Matrix3(),p=new THREE.Vector3(),n=new THREE.Vector3();
  for(let instance=0;instance<instanced.count;instance++) {
    instanced.getMatrixAt(instance,m);nm.getNormalMatrix(m);
    for(let i=0;i<count;i++) {
      const dest=instance*count+i;
      p.fromBufferAttribute(src.attributes.position,i).applyMatrix4(m).toArray(position,dest*3);
      n.fromBufferAttribute(src.attributes.normal,i).applyNormalMatrix(nm).toArray(normal,dest*3);
      uv[dest*2]=src.attributes.uv.getX(i);uv[dest*2+1]=src.attributes.uv.getY(i);
    }
  }
  src.dispose();const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(position,3));g.setAttribute('normal',new THREE.BufferAttribute(normal,3));g.setAttribute('uv',new THREE.BufferAttribute(uv,2));
  const mesh=new THREE.Mesh(g,instanced.material);mesh.name=instanced.name;mesh.visible=instanced.visible;mesh.userData.expanded=true;return mesh;
}

function setupWater(geometry) {
  const normals=canvasTexture((ctx,n)=>{
    const image = ctx.createImageData(n, n);
    // Integer frequencies make the ripple normals tile without seams.
    const waves = [[2, 5, 5.5], [-5, 2, 3.1], [7, 6, 2.2], [-9, 13, 1.7], [13, 19, 1.0]];
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      let nx = 0, ny = 0;
      waves.forEach(([fx, fy, strength], phase) => {
        const slope = Math.sin((x * fx + y * fy) * 2 * Math.PI / n + phase) * strength / Math.hypot(fx, fy);
        nx += slope * fx;
        ny += slope * fy;
      });
      const i = (y * n + x) * 4;
      image.data.set([128 + nx, 128 + ny, 255, 255], i);
    }
    ctx.putImageData(image, 0, 0);
  },256,false);
  water=new Water(geometry,{textureWidth:mobile?512:1024,textureHeight:mobile?512:1024,waterNormals:normals,sunDirection:new THREE.Vector3(...config.sun.direction),sunColor:0xfff1cc,waterColor:0x294533,distortionScale:.20,alpha:1});
  water.rotation.x=-Math.PI/2;water.position.y=config.pondHeight;water.name='Pond reflections';scene.add(water);
  water.material.uniforms.size.value=9;
  const renderReflection = water.onBeforeRender;
  water.onBeforeRender = (...args) => {
    if (!scene.overrideMaterial) renderReflection.apply(water, args);
  };
  const material=new THREE.MeshPhysicalMaterial({color:0x314a3e,roughness:.025,metalness:0,transmission:.60,ior:1.333,thickness:.35,side:THREE.DoubleSide,normalMap:normals,normalScale:new THREE.Vector2(.04,.04),attenuationColor:new THREE.Color(0x203b31),attenuationDistance:2});
  traceWater=new THREE.Mesh(water.geometry,material);traceWater.copy(water,false);traceWater.material=material;traceWater.onBeforeRender=()=>{};
  const bed=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({color:0x142820,roughness:1}));bed.rotation.x=-Math.PI/2;bed.position.y=config.pondHeight-.55;bed.name='Pond bed';scene.add(bed);
}

function setupLights() {
  sun=new THREE.DirectionalLight(0xffedcf,config.sun.energy*1.65);sun.position.fromArray(config.sun.direction).multiplyScalar(45);sun.target.position.set(0,5,0);
  sun.castShadow=true;sun.shadow.mapSize.set(mobile?1024:2048,mobile?1024:2048);sun.shadow.camera.left=-30;sun.shadow.camera.right=30;sun.shadow.camera.top=30;sun.shadow.camera.bottom=-30;sun.shadow.camera.near=.2;sun.shadow.camera.far=110;sun.shadow.bias=-.00004;sun.shadow.normalBias=.012;sun.shadow.autoUpdate=false;sun.shadow.needsUpdate=true;
  scene.add(sun,sun.target);
  scene.add(new THREE.HemisphereLight(0xc3dce6,0x5c602e,.32));
  const pondFill=new THREE.PointLight(0xfff1d5,95,35,2);pondFill.position.set(0,2,13);scene.add(pondFill);
  const eaveFill=new THREE.PointLight(0xffd99c,10,4,2);eaveFill.position.set(3.2,8.7,4.6);eaveFill.name='Eave closeup fill';scene.add(eaveFill);
}

function setupComposer() {
  composer=new EffectComposer(renderer);composer.addPass(new RenderPass(scene,camera));
  ao=new GTAOPass(scene,camera,innerWidth,innerHeight,undefined,{radius:.28,thickness:.7,distanceFallOff:1});ao.blendIntensity=.65;ao.enabled=!mobile;
  // The override normal pass treats foliage cards as solid rectangles.
  ao.setSceneClipBox(new THREE.Box3(new THREE.Vector3(-10, 0, -8), new THREE.Vector3(9, 14, 8)));
  composer.addPass(ao);composer.addPass(new OutputPass());
}

function setPreset(id) {
  const next=config.cameras.find(p=>p.id===id)||config.cameras[0];currentPreset=next;
  const damping=controls.enableDamping;controls.enableDamping=false;controls.update();controls.enableDamping=damping;
  camera.position.fromArray(next.position);camera.fov=next.fov;camera.near=['16','17','10'].includes(next.id)?.005:.08;camera.updateProjectionMatrix();
  controls.target.fromArray(next.target);camera.lookAt(controls.target);controls.update();
  for(const [category,nodes] of Object.entries(landscapeGroups)) nodes.forEach(o=>o.visible=category===next.landscape);
  $('camera-presets').querySelectorAll('button').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.camera===next.id)));
  sun.shadow.needsUpdate=true;lastMotion=performance.now();traceDirty=true;sceneRevision++;needsRender=true;
  if(mode==='pathtrace')ensureTrace().catch(traceFailure);
}

function renderRealtime() {
  renderer.info.reset();
  if(mode==='light')renderer.render(scene,camera);else composer.render();
  needsRender=false;
}

async function ensureTrace() {
  if(traceBuild)return traceBuild;
  if(!traceDirty&&pathTracer)return;
  traceBuild=(async()=>{
    $('render-status').textContent='高画質の準備中';
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    if(!pathTracer) {
      pathTracer=new WebGLPathTracer(renderer);worker=new OfflineBVHWorker(BVH_WORKER_SOURCE);pathTracer.setBVHWorker(worker);
      pathTracer.bounces=7;pathTracer.transmissiveBounces=5;pathTracer.filterGlossyFactor=.35;pathTracer.tiles.set(3,3);pathTracer.renderDelay=250;pathTracer.minSamples=1;pathTracer.fadeDuration=300;pathTracer.renderScale=mobile?.7:1;pathTracer.textureSize.set(512,512);
      pathTracer.rasterizeScene=false;pathTracer.fadeDuration=0;
      pathTracer.renderToCanvasCallback=(target,renderer,quad)=>{renderer.setRenderTarget(null);const clear=renderer.autoClear;renderer.autoClear=true;quad.render(renderer);renderer.autoClear=clear;};
      pathTracer.rasterizeSceneCallback=()=>{if(needsRender)renderRealtime();};
    }
    if(traceScene)traceScene.traverse(o=>{if(o.userData.expanded||o.userData.traceGeometry)o.geometry.dispose();});
    const revision=sceneRevision;
    traceScene=scene.clone(true);
    const replace=[];traceScene.traverse(o=>{if(o.isInstancedMesh)replace.push(o);});
    for(const old of replace){const replacement=expandInstances(old);old.parent.add(replacement);old.parent.remove(old);}
    // Ray tracing applies world transforms to vertex buffers. Decode quantized
    // GLB attributes first so transformed positions remain floating point.
    traceScene.traverse(o=>{
      if(!o.isMesh||o.isInstancedMesh||o.userData.expanded)return;
      const original=o.geometry,g=original.clone();
      for(const [name,a] of Object.entries(original.attributes)){
        const values=new Float32Array(a.count*a.itemSize);
        for(let i=0;i<a.count;i++)for(let c=0;c<a.itemSize;c++)values[i*a.itemSize+c]=a.getComponent(i,c);
        g.setAttribute(name,new THREE.BufferAttribute(values,a.itemSize));
      }
      o.geometry=g;o.userData.traceGeometry=true;
    });
    const oldWater=traceScene.getObjectByName('Pond reflections');if(oldWater){oldWater.parent.add(traceWater.clone());oldWater.parent.remove(oldWater);}
    traceScene.environment=radiance;traceScene.background=radiance;
    await pathTracer.setSceneAsync(traceScene,camera,{onProgress:p=>{$('render-status').textContent=`高画質の準備 ${Math.floor(p*100)}%`;}});
    traceDirty=revision!==sceneRevision;pathTracer.reset();lastMotion=performance.now();needsRender=true;
  })().finally(()=>{traceBuild=null;if(mode==='pathtrace'&&traceDirty)ensureTrace().catch(traceFailure);});
  return traceBuild;
}

function traceFailure(error) {
  console.warn('Path tracing unavailable',error);mode='realtime';$('quality').value='realtime';$('render-status').textContent='リアルタイム表示を使用';window.__kinkakujiTraceError=String(error);
}

function resize() {
  camera.aspect=innerWidth/innerHeight;if(currentPreset)camera.fov=Math.min(85,currentPreset.fov*Math.max(1,.667/camera.aspect));camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);composer.setSize(innerWidth,innerHeight);pathTracer?.updateCamera();lastMotion=performance.now();needsRender=true;
}

function animate() {
  requestAnimationFrame(animate);if(!ready||document.hidden||contextLost||capturePending)return;
  controls.update();const now=performance.now();
  if(mode==='pathtrace'&&pathTracer&&!traceBuild&&!traceDirty&&now-lastMotion>350){pathTracer.renderSample();$('render-status').textContent=pathTracer.isCompiling?'高画質の準備中':`高画質 · ${Math.floor(pathTracer.samples)} samples`;}
  else {if(needsRender)renderRealtime();if(!traceBuild)$('render-status').textContent=mode==='pathtrace'?'操作中 · リアルタイム':mode==='light'?'軽量表示':'リアルタイム';}
  frames++;if(now-lastFPS>1200){fps=frames*1000/(now-lastFPS);frames=0;lastFPS=now;}
  window.__kinkakuji={ready,preset:currentPreset.id,mode,samples:pathTracer?.samples??0,traceBuilding:!!traceBuild,drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,fps,get position(){return camera.position.toArray();},get contextLost(){return contextLost;},get orbit(){return {enabled:controls.enabled,rotate:controls.enableRotate,state:controls.state,pointers:controls._pointers,canvas:controls.domElement===renderer.domElement};}};
}

let radiance;
async function init() {
  const canvas=document.createElement('canvas');
  const context=canvas.getContext('webgl2',{antialias:true,alpha:false,preserveDrawingBuffer:true,powerPreference:'high-performance'});
  if(!context)throw new Error('WebGL 2 unavailable');
  renderer=new THREE.WebGLRenderer({canvas,context,antialias:true,preserveDrawingBuffer:true});
  renderer.setPixelRatio(Math.min(devicePixelRatio,lightDefault?1:1.5));renderer.setSize(innerWidth,innerHeight);renderer.toneMapping=THREE.AgXToneMapping;renderer.toneMappingExposure=1.05;renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.info.autoReset=false;
  $('viewer').appendChild(canvas);canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();contextLost=true;$('render-status').textContent='描画が一時停止しました';});canvas.addEventListener('webglcontextrestored',()=>{contextLost=false;pathTracer?.reset();});
  controls=new OrbitControls(camera,canvas);controls.enableDamping=!lightDefault;controls.dampingFactor=.075;controls.minDistance=.15;controls.maxDistance=160;controls.maxPolarAngle=Math.PI*.65;controls.addEventListener('change',()=>{lastMotion=performance.now();needsRender=true;pathTracer?.updateCamera();});
  progress('形状と空の光を読み込んでいます',20);
  const [glb,sky,settings]=await Promise.all([asset('kinkakuji.glb','asset-model'),asset('sky.hdr','asset-sky'),asset('scene.json','asset-config')]);config=settings;
  const loader=new GLTFLoader();loader.setMeshoptDecoder(MeshoptDecoder);const loaded=await loader.parseAsync(glb,'');model=loaded.scene;scene.add(model);
  progress('金箔と水面を仕上げています',60);
  const parsed=new RGBELoader().parse(sky);radiance=new THREE.DataTexture(parsed.data,parsed.width,parsed.height,THREE.RGBAFormat,parsed.type);radiance.flipY=parsed.flipY??true;radiance.mapping=THREE.EquirectangularReflectionMapping;radiance.colorSpace=THREE.LinearSRGBColorSpace;radiance.needsUpdate=true;
  scene.background=radiance;const pmrem=new THREE.PMREMGenerator(renderer);scene.environment=pmrem.fromEquirectangular(radiance).texture;pmrem.dispose();
  model.traverse(o=>{
    if(o.name==='garden'||o.name==='rearGarden')landscapeGroups[o.name].push(o);
    if(!o.isMesh)return;o.castShadow=true;o.receiveShadow=true;
    const mat=o.material,surface=mat.userData.surface;
    if(['gold','wood','roof','stone','moss'].includes(surface)){
      const texture=surfaceTexture(surface);mat.map=texture;mat.bumpMap=texture;mat.bumpScale=surface==='gold'?.00012:surface==='wood'?.012:surface==='roof'?.018:.035;mat.needsUpdate=true;
    }
  });
  const garden = createGarden(config.pondHeight, surfaceTexture('moss'));
  config.cameras.push(gardenCamera);
  scene.add(garden.banks, garden.woodland);
  landscapeGroups.garden.push(garden.woodland);
  addFoliage();setupLights();setupWater(garden.waterGeometry);setupComposer();
  for(const preset of config.cameras){const button=document.createElement('button');button.textContent=preset.label;button.dataset.camera=preset.id;button.type='button';button.setAttribute('aria-pressed','false');button.addEventListener('click',()=>setPreset(preset.id));$('camera-presets').appendChild(button);}
  mode=lightDefault?'light':'realtime';$('quality').value=mode;
  setPreset(params.get('view')||'01');ready=true;resize();renderRealtime();progress('準備ができました',100);$('loading').classList.add('done');
  for(const id of ['quality','reset-view','save-image'])$(id).disabled=false;
  if(!context.getExtension('EXT_color_buffer_float')){$('quality').querySelector('[value="pathtrace"]').disabled=true;}
  $('quality').addEventListener('change',async e=>{mode=e.target.value;controls.enableDamping=mode!=='light';needsRender=true;renderer.setPixelRatio(Math.min(devicePixelRatio,mode==='light'?1:mobile?1.25:1.5));resize();if(mode==='pathtrace')await ensureTrace().catch(traceFailure);else pathTracer?.reset();});
  $('reset-view').addEventListener('click',()=>setPreset(currentPreset.id));
  $('save-image').addEventListener('click',()=>{
    if(mode==='realtime')renderRealtime();
    capturePending=true;$('save-image').disabled=true;
    canvas.toBlob(blob=>{capturePending=false;$('save-image').disabled=false;if(!blob)return;if(saveURL)URL.revokeObjectURL(saveURL);saveURL=URL.createObjectURL(blob);const a=document.createElement('a');a.href=saveURL;a.download=`Kinkakuji_${currentPreset.id}.png`;a.click();},'image/png');
  });
  addEventListener('resize',resize);addEventListener('keydown',e=>{if(['SELECT','INPUT','TEXTAREA'].includes(e.target.tagName))return;const index=Number(e.key)-1;if(index>=0&&index<config.cameras.length)setPreset(config.cameras[index].id);});
  animate();if(params.get('quality')==='high'){mode='pathtrace';$('quality').value='pathtrace';ensureTrace().catch(traceFailure);}
  if(params.has('inspect'))window.__inspectTrace=()=>{capturePending=true;const rt=pathTracer._pathTracer.target;const data=new Float32Array(rt.width*rt.height*4);renderer.readRenderTargetPixels(rt,0,0,rt.width,rt.height,data);let max=0,min=Infinity,bad=0;for(let i=0;i<data.length;i+=4)for(let c=0;c<3;c++){const v=data[i+c];if(!Number.isFinite(v))bad++;else{max=Math.max(max,v);min=Math.min(min,v);}}return {min,max,bad,target:[rt.width,rt.height],opacity:pathTracer._quad.material.opacity,alpha:pathTracer._pathTracer.alpha};};
}
init().catch(fail);
