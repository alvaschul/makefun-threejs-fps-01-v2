// FREIGHTLINE viewmodel: the first-person weapon in front of the camera —
// a low-poly gun built from boxes, one silhouette per weapon family, with
// sway from look and movement, a recoil kick, a reload dip, and a muzzle
// flash plane. Attached to the camera, created once, posed per frame.

import * as THREE from 'three';

const darkMetal = new THREE.MeshStandardMaterial({ color: 0x23282f, roughness: 0.45, metalness: 0.45 });
const gripMaterial = new THREE.MeshStandardMaterial({ color: 0x3a3128, roughness: 0.8, metalness: 0.05 });
const accentMaterial = new THREE.MeshStandardMaterial({ color: 0xffb454, roughness: 0.5, metalness: 0.2 });

function box(w, h, d, x, y, z, material = darkMetal) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.position.set(x, y, z);
  return mesh;
}

function buildGun(weaponId) {
  const group = new THREE.Group();
  if (weaponId === 'p9') {
    group.add(box(0.055, 0.11, 0.24, 0, 0, -0.1));
    group.add(box(0.05, 0.12, 0.07, 0, -0.1, 0.03, gripMaterial));
  } else if (weaponId === 'rook') {
    group.add(box(0.06, 0.12, 0.46, 0, 0, -0.18));
    group.add(box(0.05, 0.17, 0.06, 0, -0.13, -0.12, gripMaterial));
    group.add(box(0.045, 0.2, 0.05, 0, -0.14, -0.3));
    group.add(box(0.03, 0.03, 0.2, 0, 0.085, -0.2, accentMaterial));
  } else if (weaponId === 'longshot') {
    group.add(box(0.055, 0.1, 0.78, 0, 0, -0.32));
    group.add(box(0.05, 0.13, 0.07, 0, -0.1, 0.02, gripMaterial));
    group.add(box(0.07, 0.07, 0.22, 0, 0.1, -0.3));
    group.add(box(0.02, 0.02, 0.16, 0, 0.02, -0.78, accentMaterial));
  } else {
    // vk9 carbine, the default primary silhouette.
    group.add(box(0.06, 0.11, 0.58, 0, 0, -0.24));
    group.add(box(0.05, 0.16, 0.06, 0, -0.12, -0.05, gripMaterial));
    group.add(box(0.045, 0.19, 0.055, 0, -0.13, -0.28));
    group.add(box(0.05, 0.09, 0.16, 0, -0.02, 0.22, gripMaterial));
    group.add(box(0.025, 0.04, 0.025, 0, 0.085, -0.48, accentMaterial));
  }
  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.3, 0.3),
    new THREE.MeshBasicMaterial({ color: 0xffcf7d, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.position.set(0, 0.02, weaponId === 'p9' ? -0.26 : weaponId === 'longshot' ? -0.9 : -0.6);
  flash.name = 'flash';
  group.add(flash);
  return { group, flash };
}

export function createViewmodel(camera) {
  const holder = new THREE.Group();
  camera.add(holder);
  const guns = {};
  for (const id of ['p9', 'rook', 'vk9', 'longshot']) {
    const gun = buildGun(id);
    gun.group.position.set(0.24, -0.22, -0.45);
    gun.group.visible = false;
    holder.add(gun.group);
    guns[id] = gun;
  }
  // Grenade in hand: a small dark sphere with a coloured band.
  const grenade = new THREE.Group();
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.055, 12, 10), darkMetal);
  grenade.add(ball);
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.056, 0.012, 8, 18), accentMaterial);
  band.rotation.x = Math.PI / 2;
  grenade.add(band);
  grenade.position.set(0.24, -0.2, -0.42);
  grenade.visible = false;
  holder.add(grenade);

  let kick = 0;
  let flashUntil = 0;

  return {
    show(weaponId) {
      for (const id of Object.keys(guns)) guns[id].group.visible = id === weaponId;
      grenade.visible = false;
    },
    showGrenade() {
      for (const id of Object.keys(guns)) guns[id].group.visible = false;
      grenade.visible = true;
    },
    fire(now) {
      kick = Math.min(1, kick + 0.55);
      flashUntil = now + 0.05;
    },
    step(dt, now, { moving, aiming, reloading, weaponId }) {
      kick = Math.max(0, kick - dt * 7);
      const gun = guns[weaponId];
      if (!gun) return;
      const bob = moving ? Math.sin(now * 9) * 0.012 : 0;
      const targetX = aiming ? 0 : 0.24;
      const targetY = (aiming ? -0.148 : -0.22) + bob - (reloading ? 0.09 : 0);
      const targetZ = -0.45 + kick * 0.07;
      gun.group.position.x += (targetX - gun.group.position.x) * Math.min(1, dt * 14);
      gun.group.position.y += (targetY - gun.group.position.y) * Math.min(1, dt * 14);
      gun.group.position.z += (targetZ - gun.group.position.z) * Math.min(1, dt * 18);
      gun.group.rotation.x = kick * 0.14 + (reloading ? 0.5 : 0);
      gun.flash.material.opacity = now < flashUntil ? 0.95 : 0;
      gun.flash.rotation.z = now * 31 % Math.PI;
    },
  };
}
