// FREIGHTLINE world: builds the depot's three.js scene from the pure box
// list in data.js — ground with painted lanes and cache circles, container
// and crate meshes with edge trim, lamp posts that carry the dawn light,
// and the actor and charge meshes that main.js moves every frame. Materials
// are shared and created once; nothing here allocates per frame.

import * as THREE from 'three';
import { PALETTE, MAP } from './data.js';

const materialCache = new Map();
function material(color, roughness = 0.9, metalness = 0.05) {
  const key = `${color}|${roughness}|${metalness}`;
  if (!materialCache.has(key)) {
    materialCache.set(key, new THREE.MeshStandardMaterial({ color, roughness, metalness }));
  }
  return materialCache.get(key);
}

const KIND_COLORS = {
  wall: PALETTE.wall,
  containerA: PALETTE.containerA,
  containerB: PALETTE.containerB,
  containerC: PALETTE.containerC,
  crate: PALETTE.crate,
  lowwall: '#596068',
};

export function createWorld(scene) {
  scene.background = new THREE.Color(PALETTE.sky);
  scene.fog = new THREE.Fog(new THREE.Color(PALETTE.fog), 42, 118);

  const hemi = new THREE.HemisphereLight(0xbdd3e6, 0x2a241d, 1.2);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffd9a8, 2.6);
  sun.position.set(28, 34, -18);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -45;
  sun.shadow.camera.right = 45;
  sun.shadow.camera.top = 45;
  sun.shadow.camera.bottom = -45;
  sun.shadow.camera.far = 110;
  scene.add(sun);

  // Ground: one big slab plus a canvas texture of lane paint and hatching,
  // drawn once at boot — the yard's own markings, no image files.
  const groundTexture = paintGroundTexture();
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(90, 90),
    new THREE.MeshStandardMaterial({ map: groundTexture, roughness: 0.96, metalness: 0 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
  const edgeMaterial = new THREE.LineBasicMaterial({ color: 0x0c0f13, transparent: true, opacity: 0.35 });
  for (const box of MAP.boxes) {
    const mesh = new THREE.Mesh(boxGeometry, material(KIND_COLORS[box.kind] ?? PALETTE.wall));
    mesh.scale.set(box.w, box.h, box.d);
    mesh.position.set(box.x, box.h / 2, box.z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    if (box.kind !== 'wall') {
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(boxGeometry), edgeMaterial);
      edges.scale.copy(mesh.scale);
      edges.position.copy(mesh.position);
      scene.add(edges);
    }
  }

  // Cache rings: flat glowing circles the whole round revolves around.
  for (const site of MAP.sites) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(site.radius - 0.35, site.radius, 48),
      new THREE.MeshBasicMaterial({ color: PALETTE.accent, transparent: true, opacity: 0.85, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(site.x, 0.03, site.z);
    scene.add(ring);
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(site.radius - 0.35, 48),
      new THREE.MeshBasicMaterial({ color: PALETTE.accent, transparent: true, opacity: 0.1, side: THREE.DoubleSide }),
    );
    disc.rotation.x = -Math.PI / 2;
    disc.position.set(site.x, 0.025, site.z);
    scene.add(disc);
  }

  // Lamp posts at the lane ends: a pole, a head, and a warm point light on
  // two of them (the rest are emissive only, to keep the light count low).
  const lampPositions = [[20, -11], [-11, 11], [8, -11], [-24, 0]];
  lampPositions.forEach(([x, z], index) => {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 5.4, 8), material('#39424c', 0.6, 0.4));
    pole.position.set(x, 2.7, z);
    pole.castShadow = true;
    scene.add(pole);
    const head = new THREE.Mesh(
      new THREE.BoxGeometry(0.7, 0.16, 0.34),
      new THREE.MeshStandardMaterial({ color: PALETTE.lamp, emissive: new THREE.Color(PALETTE.lamp), emissiveIntensity: 1.6 }),
    );
    head.position.set(x, 5.45, z);
    scene.add(head);
    if (index % 2 === 0) {
      const light = new THREE.PointLight(0xffc98a, 22, 20, 1.8);
      light.position.set(x, 5.2, z);
      scene.add(light);
    }
  });

  // The breach charge: a small dark case with a blinking beacon, carried,
  // dropped or planted — main.js positions this group and sets its state.
  const bomb = new THREE.Group();
  const bombCase = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.3, 0.38), material('#22262c', 0.5, 0.3));
  bombCase.position.y = 0.15;
  bombCase.castShadow = true;
  bomb.add(bombCase);
  const beaconMaterial = new THREE.MeshStandardMaterial({ color: PALETTE.danger, emissive: new THREE.Color(PALETTE.danger), emissiveIntensity: 2 });
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 10), beaconMaterial);
  beacon.position.set(0.16, 0.34, 0);
  bomb.add(beacon);
  scene.add(bomb);

  return { bomb, beaconMaterial };
}

function paintGroundTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 1024;
  const ctx = canvas.getContext('2d');
  const scale = 1024 / 90;
  const toPx = (v) => (v + 45) * scale;
  ctx.fillStyle = PALETTE.ground;
  ctx.fillRect(0, 0, 1024, 1024);
  // Concrete seams.
  ctx.strokeStyle = PALETTE.groundLine;
  ctx.lineWidth = 2;
  for (let i = -40; i <= 40; i += 10) {
    ctx.beginPath(); ctx.moveTo(toPx(i), 0); ctx.lineTo(toPx(i), 1024); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, toPx(i)); ctx.lineTo(1024, toPx(i)); ctx.stroke();
  }
  // Lane paint: dashed centre lines down the three lanes.
  ctx.strokeStyle = 'rgba(236,231,219,0.5)';
  ctx.lineWidth = 5;
  ctx.setLineDash([26, 20]);
  for (const z of [-23, 0, 23]) {
    ctx.beginPath(); ctx.moveTo(toPx(-34), toPx(z)); ctx.lineTo(toPx(34), toPx(z)); ctx.stroke();
  }
  ctx.setLineDash([]);
  // Site letters, painted large inside each cache ring.
  ctx.fillStyle = 'rgba(255,180,84,0.75)';
  ctx.font = 'bold 90px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('A', toPx(-22), toPx(-23));
  ctx.fillText('B', toPx(-22), toPx(23));
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

// Actor meshes: a body capsule in team colours, a head, a simple gun block,
// and a floating name/health sprite-free bar made of two thin boxes. One
// group per actor, created once, posed every frame by main.js.
export function createActorMesh(scene, actor) {
  const teamColor = actor.team === 'warden' ? PALETTE.warden : PALETTE.jackal;
  const darkColor = actor.team === 'warden' ? PALETTE.wardenDark : PALETTE.jackalDark;
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.34, 0.78, 4, 12),
    material(teamColor, 0.75, 0.05),
  );
  body.position.y = 0.86;
  body.castShadow = true;
  group.add(body);
  const vest = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.55, 0.36), material(darkColor, 0.85, 0.02));
  vest.position.set(0, 1.02, 0.02);
  group.add(vest);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.235, 16, 12), material('#c9a184', 0.65, 0));
  head.position.y = 1.55;
  head.castShadow = true;
  head.name = 'head';
  group.add(head);
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.14, 0.72), material('#1d2126', 0.45, 0.35));
  gun.position.set(0.22, 1.22, -0.42);
  group.add(gun);
  // Health bar: background and fill, billboarded by main.js.
  const barBack = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.11), new THREE.MeshBasicMaterial({ color: 0x11151a, transparent: true, opacity: 0.8, depthWrite: false }));
  barBack.position.y = 1.98;
  group.add(barBack);
  const barFill = new THREE.Mesh(
    new THREE.PlaneGeometry(0.86, 0.07),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(teamColor), depthWrite: false, transparent: true }),
  );
  barFill.position.set(0, 1.98, 0.005);
  barFill.name = 'barFill';
  group.add(barFill);
  scene.add(group);
  return { group, body, head, barFill, vest };
}
