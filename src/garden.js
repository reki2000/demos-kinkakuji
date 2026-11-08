import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Approximate the Kyōkochi shoreline around the existing pavilion (at the origin).
// Coordinates follow the viewer's X/Z plane. The official guide map is illustrative.
const shoreline = [
  [-27, -5], [-9, -9], [7, -10], [23, -4], [36, 7], [46, 24],
  [53, 45], [55, 65], [46, 82], [27, 88], [3, 92], [-22, 87],
  [-46, 73], [-57, 53], [-54, 35], [-44, 18], [-45, 5],
];

export const gardenCamera = {
  id: 'garden', label: '庭園', position: [64, 22, 95], target: [-3, 1.5, 18], fov: 41, landscape: 'garden',
};

export function createGarden(pondHeight, groundTexture) {
  let seed = 3857;
  const random = () => {
    seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  const range = (min, max) => min + (max - min) * random();
  const curve = new THREE.CatmullRomCurve3(
    shoreline.map(([x, z]) => new THREE.Vector3(x, 0, z)), true,
  );
  const shore = curve.getSpacedPoints(120).slice(0, -1);
  const waterShape = new THREE.Shape(shore.map(({ x, z }) => new THREE.Vector2(x, -z)));
  const waterGeometry = new THREE.ShapeGeometry(waterShape);
  const waterUV = waterGeometry.attributes.uv;
  for (let i = 0; i < waterUV.count; i++) {
    waterUV.setXY(i, waterUV.getX(i) / 8, waterUV.getY(i) / 8);
  }

  const banks = new THREE.Group();
  banks.name = 'Kyōkochi shoreline and islands';
  const woodland = new THREE.Group();
  woodland.name = 'Mixed woodland behind the pavilion';
  const groundMaterial = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: .95, map: groundTexture, bumpMap: groundTexture, bumpScale: .06,
  });
  const barkMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .95 });
  const leafMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .9 });
  const stoneMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .9 });
  const groundColors = [0x39442a, 0x53603a, 0x5f6040, 0x4e5c37].map(hex => new THREE.Color(hex));

  // The inner bank overlaps the water mesh below the surface, closing the edge.
  const positions = [], colors = [], uvs = [], indices = [];
  const ringScales = [.976, 1.025, 1.09, 1.22, 1.55, 2.25];
  ringScales.forEach((scale, ring) => {
    shore.forEach(({ x, z }, i) => {
      const height = [-.25, .22, .45, .64, 1.25, 2.15][ring];
      const rise = ring < 2 ? 0 : (.35 * Math.sin(i * .21) + .2 * Math.sin(i * .63));
      positions.push(x * scale, pondHeight + height + rise, 39 + (z - 39) * scale);
      uvs.push(x * scale / 2, (z - 39) * scale / 2);
      const color = groundColors[ring === 0 ? 0 : (i + ring) % 3 + 1].clone();
      color.multiplyScalar(range(.83, 1.11)).toArray(colors, colors.length);
      if (ring === ringScales.length - 1) return;
      const a = ring * shore.length + i;
      const b = ring * shore.length + (i + 1) % shore.length;
      indices.push(a, b, a + shore.length, b, b + shore.length, a + shore.length);
    });
  });
  const bankGeometry = new THREE.BufferGeometry();
  bankGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  bankGeometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  bankGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  bankGeometry.setIndex(indices);
  bankGeometry.computeVertexNormals();
  const bank = new THREE.Mesh(bankGeometry, groundMaterial);
  bank.receiveShadow = true;
  banks.add(bank);

  const stoneShape = new THREE.IcosahedronGeometry(1, 1);
  const crownShape = new THREE.IcosahedronGeometry(1, 2);
  const branchShape = new THREE.CylinderGeometry(.58, 1, 1, 7);
  const stones = [], trunks = [], leaves = [];

  function colorGeometry(geometry, hex, variation) {
    const positions = geometry.attributes.position;
    const base = new THREE.Color(hex);
    const color = new Float32Array(positions.count * 3);
    const tint = new THREE.Color();
    for (let i = 0; i < positions.count; i++) {
      const wave = Math.sin(positions.getX(i) * 15 + positions.getY(i) * 7 + positions.getZ(i) * 11);
      tint.copy(base).multiplyScalar(1 + variation * wave).toArray(color, i * 3);
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(color, 3));
    return geometry;
  }

  function lump(batch, shape, x, y, z, sx, sy, sz, color) {
    const geometry = shape.clone();
    const points = geometry.attributes.position;
    const phase = range(0, Math.PI * 2);
    for (let i = 0; i < points.count; i++) {
      const px = points.getX(i), py = points.getY(i), pz = points.getZ(i);
      const radius = 1 + .21 * Math.sin(px * 8 + phase) * Math.cos(py * 7 + pz * 5);
      points.setXYZ(i, px * radius, py * radius, pz * radius);
    }
    colorGeometry(geometry, color, .24);
    batch.push(geometry.scale(sx, sy, sz).rotateY(phase).translate(x, y, z));
  }

  function branch(from, to, radius) {
    const direction = to.clone().sub(from);
    const rotation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize());
    const geometry = branchShape.clone().scale(radius, direction.length(), radius);
    geometry.applyQuaternion(rotation).translate(...from.clone().lerp(to, .5).toArray());
    trunks.push(colorGeometry(geometry, 0x65584a, .18).toNonIndexed());
    geometry.dispose();
  }

  function tree(x, y, z, height, pine) {
    const base = new THREE.Vector3(x, y, z);
    const lean = range(-.21, .21) * height;
    const bend = base.clone().add(new THREE.Vector3(lean * .35, height * .46, 0));
    const top = base.clone().add(new THREE.Vector3(lean, height * .94, height * .08));
    branch(base, bend, height * .038);
    branch(bend, top, height * .024);
    const palette = pine ? [0x2f4b24, 0x405b29, 0x506a31] : [0x354e2a, 0x455c2e, 0x536e37];
    const angleOffset = range(0, Math.PI * 2);
    for (let i = 0; i < 6; i++) {
      const angle = angleOffset + i * 2.4;
      const join = bend.clone().lerp(top, i / 7);
      const width = height * range(.18, .28) * (1 - .065 * i);
      const tip = join.clone().add(new THREE.Vector3(Math.cos(angle) * width, height * .11, Math.sin(angle) * width));
      branch(join, tip, height * .012);
      for (let j = 0; j < 3; j++) {
        const spread = height * .13;
        lump(leaves, crownShape, tip.x + range(-spread, spread), tip.y + range(-.3, .3), tip.z + range(-spread, spread),
          width * range(.52, .86), height * (pine ? .07 : .15), width * range(.48, .75), palette[(i + j) % 3]);
      }
    }
    lump(leaves, crownShape, top.x, top.y, top.z, height * .15, height * (pine ? .09 : .18), height * .17, palette[2]);
  }

  function addBatch(parent, name, parts, material) {
    const mesh = new THREE.Mesh(mergeGeometries(parts), material);
    mesh.name = name;
    mesh.castShadow = mesh.receiveShadow = true;
    parent.add(mesh);
    parts.forEach(part => part.dispose());
    parts.length = 0;
  }

  // Ashihara-jima and smaller rock islands leave open water in the main sightline.
  for (const [x, z, sx, sz, height] of [[19, 13, 5.5, 3.5, 1.25], [-13, 15, 2.2, 1.5, .65], [-22, 38, 4.6, 2.8, .88]]) {
    lump(stones, stoneShape, x, pondHeight - .35, z, sx, height, sz, 0x69764a);
    for (let i = 0; i < 11; i++) {
      const angle = i * 2.4, size = range(.32, .83);
      lump(stones, stoneShape, x + Math.cos(angle) * sx * .85, pondHeight + size * .12,
        z + Math.sin(angle) * sz * .86, size * 1.35, size, size * range(.6, 1.25), i % 3 ? 0x7a7b6c : 0x676b61);
    }
    tree(x - sx * .22, pondHeight + height * .6, z, 2.5 + height, true);
    if (sx > 4) tree(x + sx * .39, pondHeight + height * .52, z - sz * .25, 1.9 + height * .65, true);
  }

  shore.forEach(({ x, z }, i) => {
    if (i % 2 || random() < .28) return;
    const size = range(.28, .87);
    lump(stones, stoneShape, x * .993, pondHeight + range(-.1, .07), 39 + (z - 39) * .993,
      size * range(1.1, 1.8), size * .65, size, i % 4 ? 0x64695c : 0x767565);
  });
  addBatch(banks, 'Shore and island stones', stones, stoneMaterial);
  addBatch(banks, 'Island pine branches', trunks, barkMaterial);
  addBatch(banks, 'Island pine crowns', leaves, leafMaterial);

  for (let row = 0; row < 3; row++) {
    for (let i = 0; i < 16; i++) {
      const x = (i - 7.5) * 5.6 + range(-2.3, 2.3);
      const z = -20 - row * 11 + range(-3, 3);
      tree(x, pondHeight + .45, z, range(5, 9) + row * 1.9, i % 5 === 0);
    }
  }
  // Low trees at the flanks continue the woodland around the visible coves.
  for (const side of [-1, 1]) {
    const flank = shore.filter(({ x, z }) => Math.sign(x) === side && Math.abs(x) > 29 && z > 4 && z < 60);
    for (let i = 0; i < flank.length; i += 2) {
      const { x, z } = flank[i];
      const scale = range(1.15, 1.37);
      tree(x * scale, pondHeight + .55, 39 + (z - 39) * scale, range(3.3, 7.3), i % 6 === 0);
    }
  }
  addBatch(woodland, 'Woodland trunks and branches', trunks, barkMaterial);
  addBatch(woodland, 'Mixed woodland crowns', leaves, leafMaterial);
  stoneShape.dispose();
  crownShape.dispose();
  branchShape.dispose();

  return { waterGeometry, banks, woodland };
}
