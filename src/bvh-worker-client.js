import { MeshBVH } from 'three-mesh-bvh';
import { BufferAttribute, Box3 } from 'three';

// The worker is bundled into a Blob so the standalone HTML also works offline.
export class OfflineBVHWorker {
  constructor(source) {
    this.url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
    this.worker = new Worker(this.url);
    this.running = false;
  }
  generate(geometry, options = {}) {
    if (this.running) return Promise.reject(new Error('BVH worker is busy'));
    this.running = true;
    return new Promise((resolve, reject) => {
      const finish = () => { this.running = false; this.worker.onmessage = null; };
      this.worker.onerror = e => { finish(); reject(new Error(e.message)); };
      this.worker.onmessage = ({ data }) => {
        if (data.error) { finish(); reject(new Error(String(data.error))); return; }
        options.onProgress?.(data.progress);
        if (!data.serialized) return;
        geometry.attributes.position.array = data.position;
        if (data.serialized.index) geometry.setIndex(new BufferAttribute(data.serialized.index, 1));
        const bvh = MeshBVH.deserialize(data.serialized, geometry, { setIndex: false });
        geometry.boundingBox = bvh.getBoundingBox(new Box3());
        finish(); resolve(bvh);
      };
      const position = geometry.attributes.position.array;
      const index = geometry.index?.array ?? null;
      this.worker.postMessage({ position, index, options: {
        ...options, onProgress: null, includedProgressCallback: !!options.onProgress,
        groups: geometry.groups.map(g => ({ ...g })),
      } }, [position.buffer, ...(index ? [index.buffer] : [])]);
    });
  }
  dispose() { this.worker.terminate(); URL.revokeObjectURL(this.url); }
}
