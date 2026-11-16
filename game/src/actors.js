// FREIGHTLINE actors: the one actor record every fighter — the player and
// all five bots — shares, and the fixed-step movement that drives it.
// Movement has acceleration and friction (no instant starts or stops),
// crouching lowers both the body and its speed, and a vest soaks a share of
// every hit. State lives here and in match.js only; rendering reads it.

import { WEAPONS } from './data.js';
import { resolveCollisions, EYE_STAND, EYE_CROUCH, STAND_HEIGHT, CROUCH_HEIGHT } from './geometry.js';
import { clamp } from './rng.js';

export function createActor(id, team, name, isPlayer) {
  const pistol = WEAPONS.p9;
  return {
    id, team, name, isPlayer,
    x: 0, z: 0, y: 0, vx: 0, vz: 0, vy: 0,
    yaw: 0, pitch: 0,
    crouching: false, grounded: true,
    health: 100, armour: 0, alive: true,
    // Loadout. primary is null until bought; grenades are counts.
    primaryId: null, sidearmId: 'p9',
    mag: { primary: 0, sidearm: pistol.mag },
    reserve: { primary: 0, sidearm: pistol.reserve },
    current: 'sidearm',
    frags: 0, smokes: 0,
    hasVest: false, hasKit: false,
    reloadingUntil: 0, nextShotAt: 0, shotsFiredBurst: 0,
    // Per-round bookkeeping the match and the HUD read.
    kills: 0, deaths: 0,
    lastDamageAt: -10, lastShotAt: -10, speed: 0,
    // Bot brain scratch (bots.js owns these fields).
    brain: null,
  };
}

export function currentWeapon(actor) {
  return actor.current === 'primary' && actor.primaryId ? WEAPONS[actor.primaryId] : WEAPONS[actor.sidearmId];
}

export function eyeHeight(actor) {
  return actor.crouching ? EYE_CROUCH : EYE_STAND;
}

export function bodyHeight(actor) {
  return actor.crouching ? CROUCH_HEIGHT : STAND_HEIGHT;
}

// Spawn placement: position, facing, full health, kept purchases. Ammunition
// refills each round, as in the genre: you keep the gun, not the magazine.
export function placeAtSpawn(actor, spawn) {
  actor.x = spawn.x;
  actor.z = spawn.z;
  actor.y = 0;
  actor.vx = 0; actor.vz = 0; actor.vy = 0;
  actor.yaw = spawn.yaw;
  actor.pitch = 0;
  actor.crouching = false;
  actor.health = 100;
  actor.armour = actor.hasVest ? 100 : 0;
  actor.alive = true;
  if (actor.primaryId) {
    const w = WEAPONS[actor.primaryId];
    actor.mag.primary = w.mag;
    actor.reserve.primary = w.reserve;
  }
  const p = WEAPONS[actor.sidearmId];
  actor.mag.sidearm = p.mag;
  actor.reserve.sidearm = p.reserve;
  actor.current = actor.primaryId ? 'primary' : 'sidearm';
  actor.reloadingUntil = 0;
  actor.nextShotAt = 0;
}

// Damage with the vest rule: a vest absorbs 45% of a hit while it has
// points, spending one point per point absorbed. Returns true on a kill.
export function applyDamage(actor, amount, now) {
  if (!actor.alive) return false;
  let remaining = amount;
  if (actor.hasVest && actor.armour > 0) {
    const absorbed = Math.min(actor.armour, amount * 0.45);
    actor.armour -= absorbed;
    remaining = amount - absorbed;
  }
  actor.health -= remaining;
  actor.lastDamageAt = now;
  if (actor.health <= 0) {
    actor.health = 0;
    actor.alive = false;
    actor.deaths += 1;
    return true;
  }
  return false;
}

const scratch = { x: 0, z: 0 };

// One fixed movement step. wishX/wishZ is a unit wish direction in world
// space; sprinting is deliberately absent — in this genre you move at one
// honest speed, slower with a heavier gun, slower still crouched, and your
// spread (weapons.js) is what punishes moving, not a sprint key.
export function stepMovement(actor, wishX, wishZ, dt, now) {
  const weapon = currentWeapon(actor);
  const weight = weapon.id === 'longshot' ? 0.92 : weapon.id === 'vk9' ? 0.96 : 1;
  const maxSpeed = (actor.crouching ? 2.2 : 4.6) * weight;
  const accel = actor.grounded ? 38 : 6;
  actor.vx += wishX * accel * dt;
  actor.vz += wishZ * accel * dt;
  const speed = Math.hypot(actor.vx, actor.vz);
  if (wishX === 0 && wishZ === 0 && actor.grounded) {
    const friction = Math.max(0, 1 - 11 * dt);
    actor.vx *= friction;
    actor.vz *= friction;
  } else if (speed > maxSpeed) {
    actor.vx = (actor.vx / speed) * maxSpeed;
    actor.vz = (actor.vz / speed) * maxSpeed;
  }
  // Gravity and the ground plane: the depot is flat, jumping is a hop that
  // ruins your aim, exactly as it should.
  actor.vy -= 19 * dt;
  actor.y += actor.vy * dt;
  if (actor.y <= 0) {
    actor.y = 0;
    actor.vy = 0;
    actor.grounded = true;
  } else {
    actor.grounded = false;
  }
  resolveCollisions(scratch, actor.x + actor.vx * dt, actor.z + actor.vz * dt);
  actor.x = scratch.x;
  actor.z = scratch.z;
  actor.speed = Math.hypot(actor.vx, actor.vz);
  void now;
}

export function jump(actor) {
  if (actor.grounded && actor.alive) {
    actor.vy = 5.4;
    actor.grounded = false;
  }
}

// Spread in radians for the actor's next shot: the weapon's base, widened by
// movement, airtime and sustained fire, tightened by crouching and by aiming
// down sights. This is the number that makes stopping to aim pay.
export function currentSpread(actor, aiming) {
  const weapon = currentWeapon(actor);
  let spread = weapon.spread;
  const moveShare = clamp(actor.speed / 4.6, 0, 1);
  spread += weapon.moveSpread * moveShare;
  if (!actor.grounded) spread += 0.035;
  if (actor.crouching) spread *= 0.72;
  if (aiming) spread *= 0.62;
  spread += Math.min(0.012, actor.shotsFiredBurst * 0.0016);
  return spread;
}
