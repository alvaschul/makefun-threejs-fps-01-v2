// FREIGHTLINE combat: firing, hit resolution, reloads, weapon switching and
// grenades. Pure simulation — it works on actor records and the map's boxes,
// emits events for sound and effects, and never touches three.js or the DOM.
//
// A shot is a ray from the shooter's eye along their aim, jittered by the
// spread actors.js computes. Actors are tested as two capsules' worth of
// geometry: a head sphere and a body cylinder. The nearest hit — actor or
// box — wins, so cover genuinely protects and a head peeking over a low
// wall can be hit while the body behind it cannot.

import { WEAPONS, GRENADES, MATCH } from './data.js';
import { currentWeapon, currentSpread, applyDamage, eyeHeight } from './actors.js';
import { raycastBoxes, hasLineOfSight } from './geometry.js';
import { emit } from './match.js';
import { clamp } from './rng.js';

export function magOf(actor) {
  return actor.current === 'primary' ? actor.mag.primary : actor.mag.sidearm;
}

export function reserveOf(actor) {
  return actor.current === 'primary' ? actor.reserve.primary : actor.reserve.sidearm;
}

export function switchWeapon(match, actor, slot) {
  if (slot === 'primary' && !actor.primaryId) return;
  if (actor.current === slot) return;
  actor.current = slot;
  actor.reloadingUntil = 0;
  actor.shotsFiredBurst = 0;
  emit(match, { type: 'switch', actorId: actor.id });
}

export function startReload(match, actor, now) {
  const weapon = currentWeapon(actor);
  if (magOf(actor) >= weapon.mag || reserveOf(actor) <= 0) return;
  if (actor.reloadingUntil > now) return;
  actor.reloadingUntil = now + weapon.reloadSeconds;
  emit(match, { type: 'reloadStart', actorId: actor.id });
}

export function stepReload(match, actor, now) {
  if (actor.reloadingUntil > 0 && now >= actor.reloadingUntil) {
    const weapon = currentWeapon(actor);
    const slot = actor.current;
    const need = weapon.mag - actor.mag[slot];
    const take = Math.min(need, actor.reserve[slot]);
    actor.mag[slot] += take;
    actor.reserve[slot] -= take;
    actor.reloadingUntil = 0;
    emit(match, { type: 'reloadEnd', actorId: actor.id });
  }
}

// Attempt one shot. `aim` is a unit direction {x, y, z}; the caller (the
// player's camera, or a bot's aim at a target) supplies it. Returns true
// when a round actually left the barrel.
export function tryFire(match, actor, aim, aiming, now, random) {
  const weapon = currentWeapon(actor);
  if (!actor.alive || actor.reloadingUntil > now) return false;
  if (now < actor.nextShotAt) return false;
  if (magOf(actor) <= 0) {
    actor.nextShotAt = now + 0.28;
    emit(match, { type: 'dryFire', actorId: actor.id });
    startReload(match, actor, now);
    return false;
  }
  actor.nextShotAt = now + 60 / weapon.rpm;
  actor.lastShotAt = now;
  actor.shotsFiredBurst += 1;
  if (actor.current === 'primary') actor.mag.primary -= 1; else actor.mag.sidearm -= 1;

  const spread = currentSpread(actor, aiming);
  const origin = { x: actor.x, y: actor.y + eyeHeight(actor), z: actor.z };
  // Jitter in the plane perpendicular-ish to aim: two small random tilts.
  const dir = {
    x: aim.x + (random() * 2 - 1) * spread,
    y: aim.y + (random() * 2 - 1) * spread,
    z: aim.z + (random() * 2 - 1) * spread,
  };
  const length = Math.hypot(dir.x, dir.y, dir.z) || 1;
  dir.x /= length; dir.y /= length; dir.z /= length;

  const wallHit = raycastBoxes(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, weapon.range);
  let bestDistance = wallHit ? wallHit.distance : weapon.range;
  let bestActor = null;
  let bestPart = 'body';
  for (const other of match.actors) {
    // Gunfire never hits teammates: bots fire down lanes their teammates
    // are standing in, and a round stopped by a friendly back teaches the
    // victim nothing. (Frag grenades are less polite — see explodeFrag.)
    if (!other.alive || other === actor || other.team === actor.team) continue;
    const hit = rayHitsActor(origin, dir, other);
    if (hit && hit.distance < bestDistance) {
      bestDistance = hit.distance;
      bestActor = other;
      bestPart = hit.part;
    }
  }
  const end = {
    x: origin.x + dir.x * bestDistance,
    y: origin.y + dir.y * bestDistance,
    z: origin.z + dir.z * bestDistance,
  };
  emit(match, {
    type: 'shot', actorId: actor.id, weaponId: weapon.id,
    from: origin, to: end, hitActorId: bestActor ? bestActor.id : null,
  });
  if (bestActor) {
    const falloff = bestDistance > weapon.range * 0.6 ? 0.78 : 1;
    const damage = weapon.damage * (bestPart === 'head' ? weapon.headMultiplier : 1) * falloff;
    const killed = applyDamage(bestActor, damage, now);
    emit(match, {
      type: 'hit', actorId: actor.id, targetId: bestActor.id,
      part: bestPart, damage, killed,
    });
    if (killed) {
      actor.kills += 1;
      actor.money = Math.min(MATCH.maxMoney, actor.money + MATCH.killReward);
      emit(match, { type: 'kill', actorId: actor.id, targetId: bestActor.id });
      if (match.bomb.state === 'carried' && match.bomb.carrierId === bestActor.id) {
        // The charge drops where its carrier fell; another Jackal who
        // touches it picks it up (stepPickups).
        match.bomb.state = 'dropped';
        match.bomb.x = bestActor.x;
        match.bomb.z = bestActor.z;
        match.bomb.carrierId = null;
        emit(match, { type: 'bombDropped', x: bestActor.x, z: bestActor.z });
      }
    }
  }
  return true;
}

// Ray versus one actor: head sphere first (it is smaller and above), then
// the body cylinder, approximated as a vertical segment with a radius.
function rayHitsActor(origin, dir, actor) {
  const headY = actor.y + (actor.crouching ? 1.06 : 1.52);
  const head = raySphere(origin, dir, actor.x, headY, actor.z, 0.24);
  const bodyTop = actor.y + (actor.crouching ? 0.92 : 1.38);
  const body = raySphere(origin, dir, actor.x, actor.y + bodyTop * 0.55, actor.z, 0.46);
  // The body sphere is fat; require its hit to land below the neck so a
  // near-head shot is scored as a headshot, not both.
  if (head && (!body || head.distance <= body.distance + 0.25)) {
    return { distance: head.distance, part: 'head' };
  }
  if (body) return { distance: body.distance, part: 'body' };
  if (head) return { distance: head.distance, part: 'head' };
  return null;
}

function raySphere(origin, dir, cx, cy, cz, radius) {
  const ox = cx - origin.x;
  const oy = cy - origin.y;
  const oz = cz - origin.z;
  const tca = ox * dir.x + oy * dir.y + oz * dir.z;
  if (tca < 0) return null;
  const d2 = ox * ox + oy * oy + oz * oz - tca * tca;
  const r2 = radius * radius;
  if (d2 > r2) return null;
  const distance = tca - Math.sqrt(r2 - d2);
  if (distance < 0.2) return null;
  return { distance };
}

// A dropped charge is picked up by the first living Jackal who walks over it.
export function stepPickups(match) {
  if (match.bomb.state !== 'dropped') return;
  for (const actor of match.actors) {
    if (!actor.alive || actor.team !== 'jackal') continue;
    if (Math.hypot(actor.x - match.bomb.x, actor.z - match.bomb.z) < 1.1) {
      match.bomb.state = 'carried';
      match.bomb.carrierId = actor.id;
      emit(match, { type: 'bombPickup', actorId: actor.id });
      return;
    }
  }
}

// Grenades in flight and smoke on the ground. Projectiles are simple
// ballistic arcs with one bounce; a frag bursts for area damage with a
// line-of-sight falloff, a smoke blooms into a vision-blocking cloud that
// match.smokes carries for bots.js and the renderer.
export function createGrenades() {
  return { flying: [], smokes: [] };
}

export function throwGrenade(match, grenades, actor, kind, aim, now) {
  const count = kind === 'frag' ? actor.frags : actor.smokes;
  if (count <= 0 || !actor.alive) return false;
  if (kind === 'frag') actor.frags -= 1; else actor.smokes -= 1;
  const speed = 15;
  grenades.flying.push({
    kind,
    team: actor.team,
    throwerId: actor.id,
    x: actor.x, y: actor.y + 1.5, z: actor.z,
    vx: aim.x * speed, vy: 4.6 + aim.y * 5, vz: aim.z * speed,
    fuseAt: now + GRENADES[kind].fuseSeconds,
  });
  emit(match, { type: 'throw', actorId: actor.id, kind });
  return true;
}

export function stepGrenades(match, grenades, dt, now) {
  for (let i = grenades.flying.length - 1; i >= 0; i -= 1) {
    const g = grenades.flying[i];
    g.vy -= 14 * dt;
    g.x += g.vx * dt;
    g.y += g.vy * dt;
    g.z += g.vz * dt;
    if (g.y < 0.15) {
      g.y = 0.15;
      g.vy = Math.abs(g.vy) * 0.35;
      g.vx *= 0.7;
      g.vz *= 0.7;
    }
    if (now >= g.fuseAt) {
      grenades.flying.splice(i, 1);
      if (g.kind === 'frag') explodeFrag(match, g, now);
      else {
        grenades.smokes.push({ x: g.x, z: g.z, radius: GRENADES.smoke.radius, until: now + GRENADES.smoke.smokeSeconds });
        match.smokes = grenades.smokes;
        emit(match, { type: 'smoke', x: g.x, z: g.z });
      }
    }
  }
  for (let i = grenades.smokes.length - 1; i >= 0; i -= 1) {
    if (now >= grenades.smokes[i].until) grenades.smokes.splice(i, 1);
  }
  match.smokes = grenades.smokes;
}

function explodeFrag(match, g, now) {
  emit(match, { type: 'fragExplode', x: g.x, z: g.z, throwerId: g.throwerId });
  for (const actor of match.actors) {
    if (!actor.alive) continue;
    const d = Math.hypot(actor.x - g.x, actor.z - g.z);
    if (d > GRENADES.frag.radius) continue;
    const centreY = actor.y + 0.9;
    if (!hasLineOfSight(g.x, 0.7, g.z, actor.x, centreY, actor.z) && d > 1.4) continue;
    const share = clamp(1 - d / (GRENADES.frag.radius + 0.6), 0.12, 1);
    const killed = applyDamage(actor, GRENADES.frag.damage * share, now);
    if (killed) {
      const thrower = match.actors.find((a) => a.id === g.throwerId);
      if (thrower && thrower !== actor) {
        thrower.kills += 1;
        emit(match, { type: 'kill', actorId: thrower.id, targetId: actor.id });
      }
      if (match.bomb.state === 'carried' && match.bomb.carrierId === actor.id) {
        match.bomb.state = 'dropped';
        match.bomb.x = actor.x;
        match.bomb.z = actor.z;
        match.bomb.carrierId = null;
      }
    }
  }
}
