// FREIGHTLINE effects: tracers, impact sparks, muzzle flash, explosion and
// smoke visuals. Everything is pooled and reused — a fixed set of line and
// sprite objects created at boot, cycled as effects fire — so the render
// loop allocates nothing while the yard is busy.

import * as THREE from 'three';
import { PALETTE } from './data.js';

const MAX_TRACERS = 24;
const MAX_SPARKS = 40;
const MAX_SMOKES = 8;

export function createEffects(scene) {
  const tracers = [];
  const tracerMaterial = new THREE.LineBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.9 });
  for (let i = 0; i < MAX_TRACERS; i += 1) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const line = new THREE.Line(geometry, tracerMaterial);
    line.visible = false;
    line.frustumCulled = false;
    scene.add(line);
    tracers.push({ line, until: 0 });
  }

  const sparks = [];
  const sparkMaterial = new THREE.MeshBasicMaterial({ color: 0xffc98a });
  const sparkGeometry = new THREE.SphereGeometry(0.05, 6, 6);
  for (let i = 0; i < MAX_SPARKS; i += 1) {
    const mesh = new THREE.Mesh(sparkGeometry, sparkMaterial);
    mesh.visible = false;
    scene.add(mesh);
    sparks.push({ mesh, vx: 0, vy: 0, vz: 0, until: 0 });
  }

  const smokes = [];
  const smokeMaterial = new THREE.MeshStandardMaterial({
    color: 0x9aa5ad, transparent: true, opacity: 0.42, roughness: 1, depthWrite: false,
  });
  for (let i = 0; i < MAX_SMOKES; i += 1) {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 14), smokeMaterial);
    mesh.visible = false;
    scene.add(mesh);
    smokes.push({ mesh, until: 0, radius: 4 });
  }

  const flash = new THREE.PointLight(0xffb454, 0, 9, 2);
  scene.add(flash);

  const explosionLight = new THREE.PointLight(0xff7a3c, 0, 26, 1.6);
  scene.add(explosionLight);

  let tracerIndex = 0;
  let sparkIndex = 0;
  let smokeIndex = 0;

  return {
    tracer(from, to, now) {
      const slot = tracers[tracerIndex];
      tracerIndex = (tracerIndex + 1) % MAX_TRACERS;
      const positions = slot.line.geometry.attributes.position;
      positions.setXYZ(0, from.x, from.y, from.z);
      positions.setXYZ(1, to.x, to.y, to.z);
      positions.needsUpdate = true;
      slot.line.visible = true;
      slot.until = now + 0.07;
      flash.position.set(from.x, from.y, from.z);
      flash.intensity = 14;
    },
    impact(point, now, random) {
      for (let n = 0; n < 3; n += 1) {
        const slot = sparks[sparkIndex];
        sparkIndex = (sparkIndex + 1) % MAX_SPARKS;
        slot.mesh.position.set(point.x, point.y, point.z);
        slot.vx = (random() - 0.5) * 2.4;
        slot.vy = random() * 2.4;
        slot.vz = (random() - 0.5) * 2.4;
        slot.mesh.visible = true;
        slot.until = now + 0.32;
      }
    },
    explosion(point, now, random) {
      explosionLight.position.set(point.x, 1.4, point.z);
      explosionLight.intensity = 120;
      for (let n = 0; n < 14; n += 1) {
        const slot = sparks[sparkIndex];
        sparkIndex = (sparkIndex + 1) % MAX_SPARKS;
        slot.mesh.position.set(point.x, 0.5 + random() * 0.6, point.z);
        const angle = random() * Math.PI * 2;
        const speed = 2 + random() * 6;
        slot.vx = Math.cos(angle) * speed;
        slot.vy = 2 + random() * 5;
        slot.vz = Math.sin(angle) * speed;
        slot.mesh.visible = true;
        slot.until = now + 0.8;
      }
    },
    smoke(point, radius, now, seconds) {
      const slot = smokes[smokeIndex];
      smokeIndex = (smokeIndex + 1) % MAX_SMOKES;
      slot.mesh.position.set(point.x, 1.15, point.z);
      slot.mesh.scale.set(radius, radius * 0.62, radius);
      slot.mesh.visible = true;
      slot.until = now + seconds;
      slot.radius = radius;
    },
    step(now, dt) {
      for (const slot of tracers) if (slot.line.visible && now >= slot.until) slot.line.visible = false;
      for (const slot of sparks) {
        if (!slot.mesh.visible) continue;
        if (now >= slot.until) { slot.mesh.visible = false; continue; }
        slot.vy -= 9 * dt;
        slot.mesh.position.x += slot.vx * dt;
        slot.mesh.position.y += slot.vy * dt;
        slot.mesh.position.z += slot.vz * dt;
        if (slot.mesh.position.y < 0.04) slot.mesh.position.y = 0.04;
      }
      for (const slot of smokes) if (slot.mesh.visible && now >= slot.until) slot.mesh.visible = false;
      if (flash.intensity > 0) flash.intensity = Math.max(0, flash.intensity - 260 * dt);
      if (explosionLight.intensity > 0) explosionLight.intensity = Math.max(0, explosionLight.intensity - 300 * dt);
    },
    accent: PALETTE.accent,
  };
}
