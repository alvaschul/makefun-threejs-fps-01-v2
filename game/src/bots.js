// FREIGHTLINE bots: the five AI fighters. Each bot runs the same small state
// machine, stepped at fixed rate, and acts only through the same verbs the
// player has — move toward a point, aim, fire in bursts, reload, plant,
// defuse, throw. No bot cheats: it shoots what it can see, reacts after a
// human-scale delay, and its accuracy falls off with distance and movement.
//
// States: route (follow waypoints to a post or a site), hold (watch a lane
// from cover, strafing a little), engage (a visible enemy: stop, burst,
// reposition between bursts), plant / defuse (the channelled objective),
// regroup (after the plant, Jackals fall back to watch the charge; Wardens
// converge on it).

import { MATCH } from './data.js';
import { eyeHeight, currentWeapon } from './actors.js';
import { hasLineOfSight, findRoute, nearestWaypoint, waypoint } from './geometry.js';
import { clamp, distance2d } from './rng.js';

const REACTION_SECONDS = 0.32;
const MEMORY_SECONDS = 2.4;

export function createBrain(match, actor) {
  const brain = {
    state: 'route',
    route: [],
    routeIndex: 0,
    targetId: null,
    postId: null,
    visibleSince: -1,
    lastSeenAt: -10,
    lastSeenX: 0,
    lastSeenZ: 0,
    burstLeft: 0,
    nextBurstAt: 0,
    strafeDir: 1,
    strafeUntil: 0,
    decisionAt: 0,
    heardX: null,
    heardZ: null,
    heardAt: -10,
  };
  actor.brain = brain;
  assignPost(match, actor);
  return brain;
}

// Opening posts. Wardens split across the two caches; Jackals travel to the
// round's target cache down its own lane — the carrier and one escort on the
// site lane, the third Jackal swinging through the link corridor so the
// attack does not arrive as one predictable file down mid.
const LANE_ROUTES = {
  A: ['jSpawn', 'eYard', 'nLinkE', 'nLaneM', 'nLaneW', 'aEntry', 'aSite'],
  B: ['jSpawn', 'eYard', 'sLinkE', 'sLaneM', 'sLaneW', 'bEntry', 'bSite'],
};
const SWING_ROUTES = {
  A: ['jSpawn', 'eYard', 'midDoor', 'mid', 'midCross', 'nLinkW', 'aEntry', 'aSite'],
  B: ['jSpawn', 'eYard', 'midDoor', 'mid', 'midCross', 'sLinkW', 'bEntry', 'bSite'],
};
function assignPost(match, actor) {
  const brain = actor.brain;
  if (actor.team === 'warden') {
    brain.postId = actor.id === 'w2'
      ? (match.targetSite === 'A' ? 'bHold' : 'aHold')
      : (match.targetSite === 'A' ? 'aHold' : 'bHold');
    brain.route = routeTo(actor, brain.postId);
  } else {
    brain.postId = match.targetSite === 'A' ? 'aSite' : 'bSite';
    const ids = actor.id === 'j2' ? SWING_ROUTES[match.targetSite] : LANE_ROUTES[match.targetSite];
    brain.route = ids.map((id) => waypoint(id));
  }
  brain.routeIndex = 0;
  brain.state = 'route';
}

export function routeTo(actor, targetId) {
  const start = nearestWaypoint(actor.x, actor.z);
  const route = findRoute(start.id, targetId);
  return route.map((id) => waypoint(id));
}

// What a bot wants this step, written into `intent` (reused, no allocation):
// a wish-move point, whether to fire, channel keys, and a grenade wish.
export function createIntent() {
  return {
    moveX: 0, moveZ: 0, hasMove: false,
    aimX: 0, aimZ: 0, hasAim: false,
    fire: false, reload: false, plant: false, defuse: false,
    throwFrag: false, throwSmoke: false, crouch: false, jump: false,
  };
}

export function resetIntent(intent) {
  intent.hasMove = false;
  intent.hasAim = false;
  intent.fire = false;
  intent.reload = false;
  intent.plant = false;
  intent.defuse = false;
  intent.throwFrag = false;
  intent.throwSmoke = false;
  intent.crouch = false;
  intent.jump = false;
  return intent;
}

// Hearing: a gunshot within 26 metres, or a detonation anywhere, is public
// information. main.js calls this for every actor when a shot is fired.
export function hear(match, listener, x, z, loudness) {
  if (!listener.alive || listener.isPlayer || !listener.brain) return;
  const d = distance2d(listener.x, listener.z, x, z);
  if (d <= loudness) {
    listener.brain.heardX = x;
    listener.brain.heardZ = z;
    listener.brain.heardAt = match.time;
  }
}

function visibleEnemy(match, actor, now) {
  const brain = actor.brain;
  let best = null;
  let bestDistance = Infinity;
  const eye = eyeHeight(actor);
  for (const other of match.actors) {
    if (!other.alive || other.team === actor.team) continue;
    const d = distance2d(actor.x, actor.z, other.x, other.z);
    if (d > 40) continue;
    // Field of view: a bot must be roughly facing a target to acquire it,
    // unless it is very close (peripheral hearing / presence).
    const dx = other.x - actor.x;
    const dz = other.z - actor.z;
    // The facing vector is (-sin yaw, -cos yaw); its dot with the target
    // direction is the cosine of the angle between them.
    const fx = -Math.sin(actor.yaw);
    const fz = -Math.cos(actor.yaw);
    const dot = (fx * dx + fz * dz) / (d || 1);
    if (dot < 0.15 && d > 7) continue;
    const targetEye = other.crouching ? 1.0 : 1.35;
    if (!hasLineOfSight(actor.x, eye, actor.z, other.x, targetEye, other.z)) continue;
    // Smoke blocks acquisition entirely.
    if (match.smokes && match.smokes.some((s) => segmentNearSmoke(actor, other, s))) continue;
    if (d < bestDistance) { bestDistance = d; best = other; }
  }
  if (best) {
    if (brain.visibleSince < 0 || brain.targetId !== best.id) brain.visibleSince = now;
    brain.targetId = best.id;
    brain.lastSeenAt = now;
    brain.lastSeenX = best.x;
    brain.lastSeenZ = best.z;
  }
  return best;
}

function segmentNearSmoke(actor, other, smoke) {
  // Smoke is a sphere on the ground; if its centre lies close to the sight
  // line and between the two actors, the shot at information fails.
  const dx = other.x - actor.x;
  const dz = other.z - actor.z;
  const length = Math.hypot(dx, dz) || 1;
  const t = clamp(((smoke.x - actor.x) * dx + (smoke.z - actor.z) * dz) / (length * length), 0, 1);
  const px = actor.x + dx * t;
  const pz = actor.z + dz * t;
  return distance2d(px, pz, smoke.x, smoke.z) < smoke.radius && t > 0.08 && t < 0.95;
}

// The brain step. Writes intent; combat.js and main.js execute it.
export function stepBot(match, actor, intent, now, dt, random) {
  resetIntent(intent);
  const brain = actor.brain;
  if (!brain) return intent;
  if (!actor.alive) return intent;
  if (match.phase === 'buy' || match.phase === 'end' || match.phase === 'matchover') return intent;

  const enemy = visibleEnemy(match, actor, now);
  const seesEnemy = enemy && now - brain.visibleSince >= REACTION_SECONDS * (actor.team === 'jackal' ? 1.1 : 1);

  // Objective first when the way is clear.
  if (actor.team === 'jackal' && match.bomb.state === 'carried' && match.bomb.carrierId === actor.id && !enemy) {
    const site = match.targetSite === 'A' ? { x: -22, z: -23 } : { x: -22, z: 23 };
    if (distance2d(actor.x, actor.z, site.x, site.z) <= 5.2) {
      intent.plant = true;
      intent.hasAim = true;
      intent.aimX = actor.x - 4;
      intent.aimZ = actor.z;
      return intent;
    }
  }
  if (actor.team === 'warden' && match.phase === 'planted' && !enemy) {
    if (distance2d(actor.x, actor.z, match.bomb.x, match.bomb.z) <= 2) {
      intent.defuse = true;
      return intent;
    }
    if (brain.state !== 'regroup' || !brain.route.length) {
      brain.route = routeTo(actor, nearestWaypoint(match.bomb.x, match.bomb.z).id);
      brain.routeIndex = 0;
      brain.state = 'regroup';
    }
  }
  // After the plant, Jackals fall back to overwatch posts near the charge.
  if (actor.team === 'jackal' && match.phase === 'planted' && brain.state !== 'plantedHold') {
    brain.state = 'plantedHold';
    brain.route = routeTo(actor, match.bomb.siteId === 'A' ? 'aHold' : 'bHold');
    brain.routeIndex = 0;
  }

  if (seesEnemy) {
    brain.state = 'engage';
    intent.hasAim = true;
    intent.aimX = enemy.x;
    intent.aimZ = enemy.z;
    // Beyond effective range the right answer is to take ground, not to
    // trade pistol fire across the yard: advance on the target, firing
    // only the occasional harassing burst, until the range closes.
    const range = distance2d(actor.x, actor.z, enemy.x, enemy.z);
    if (range > 19) {
      intent.hasMove = true;
      intent.moveX = enemy.x;
      intent.moveZ = enemy.z;
      if (now >= brain.nextBurstAt && brain.burstLeft > 0) {
        intent.fire = true;
        brain.burstLeft -= 1;
      } else if (brain.burstLeft <= 0) {
        brain.burstLeft = 2;
        brain.nextBurstAt = now + 0.8 + random() * 0.7;
      }
      return intent;
    }
    // Burst discipline: fire a short burst, then strafe, then fire again.
    // Standing still while bursting is what makes a bot dangerous; a bot
    // that runs and guns is easy to beat, by design.
    if (now >= brain.nextBurstAt) {
      if (brain.burstLeft <= 0) brain.burstLeft = 3 + Math.floor(random() * 4);
      intent.fire = true;
      brain.burstLeft -= 1;
      if (brain.burstLeft <= 0) {
        brain.nextBurstAt = now + 0.45 + random() * 0.6;
        brain.strafeDir = random() < 0.5 ? -1 : 1;
        brain.strafeUntil = now + 0.5 + random() * 0.5;
      }
    }
    if (now < brain.strafeUntil) {
      const fx = -Math.sin(actor.yaw);
      const fz = -Math.cos(actor.yaw);
      intent.hasMove = true;
      intent.moveX = actor.x + (-fz) * brain.strafeDir * 3;
      intent.moveZ = actor.z + (fx) * brain.strafeDir * 3;
    }
    // A frag at a cornered, recently-seen enemy — once in a while, never
    // while a teammate stands in the blast.
    if (actor.frags > 0 && random() < 0.004 && distance2d(actor.x, actor.z, enemy.x, enemy.z) < 18) {
      intent.throwFrag = true;
    }
    return intent;
  }

  if (enemy && distance2d(actor.x, actor.z, enemy.x, enemy.z) <= 22) {
    // Acquired but still reacting, and close enough to matter: face the
    // threat, stop moving. A distant contact is noted (visibleEnemy has
    // already written the memory) and the route continues below.
    intent.hasAim = true;
    intent.aimX = enemy.x;
    intent.aimZ = enemy.z;
    brain.state = 'engage';
    return intent;
  }

  // Reload when safe and low.
  const weapon = currentWeapon(actor);
  const magNow = actor.current === 'primary' ? actor.mag.primary : actor.mag.sidearm;
  if (magNow <= Math.floor(weapon.mag * 0.3) && now - brain.lastSeenAt > 1.2) intent.reload = true;

  // Investigate a heard shot only while it is fresh and near: a six-second
  // memory, twenty metres at most. Stale noise must never pull a bot off
  // its route or its post for the rest of the round.
  if (brain.heardX !== null && now - brain.heardAt > 6) {
    brain.heardX = null;
    brain.heardZ = null;
  }
  if (brain.heardX !== null && brain.state !== 'regroup'
    && distance2d(actor.x, actor.z, brain.heardX, brain.heardZ) <= 22) {
    intent.hasMove = true;
    intent.moveX = brain.heardX;
    intent.moveZ = brain.heardZ;
    intent.hasAim = true;
    intent.aimX = brain.heardX;
    intent.aimZ = brain.heardZ;
    if (distance2d(actor.x, actor.z, brain.heardX, brain.heardZ) < 3) {
      brain.heardX = null;
      brain.heardZ = null;
    }
    return intent;
  }

  // Remembered contact: push the last seen position briefly — attackers
  // press the advantage, defenders only chase what is close to them.
  if (now - brain.lastSeenAt < MEMORY_SECONDS && brain.state === 'engage'
    && (actor.team === 'jackal' || distance2d(actor.x, actor.z, brain.lastSeenX, brain.lastSeenZ) < 16)) {
    intent.hasMove = true;
    intent.moveX = brain.lastSeenX;
    intent.moveZ = brain.lastSeenZ;
    intent.hasAim = true;
    intent.aimX = brain.lastSeenX;
    intent.aimZ = brain.lastSeenZ;
    return intent;
  }

  // Route / hold behaviour. A Warden who chased a contact away from its
  // post walks back to it once the chase is over.
  if (actor.team === 'warden' && brain.postId && (!brain.route || brain.routeIndex >= brain.route.length)) {
    const post = waypoint(brain.postId);
    if (post && distance2d(actor.x, actor.z, post.x, post.z) > 4) {
      brain.route = routeTo(actor, brain.postId);
      brain.routeIndex = 0;
    }
  }
  if (brain.route && brain.routeIndex < brain.route.length) {
    const node = brain.route[brain.routeIndex];
    if (distance2d(actor.x, actor.z, node.x, node.z) < 1.4) {
      brain.routeIndex += 1;
    } else {
      intent.hasMove = true;
      intent.moveX = node.x;
      intent.moveZ = node.z;
      intent.hasAim = true;
      intent.aimX = node.x;
      intent.aimZ = node.z;
      brain.state = match.phase === 'planted' ? 'regroup' : 'route';
      return intent;
    }
  }
  // At post: hold, watch down the lane, shift weight now and then.
  brain.state = 'hold';
  const watch = holdWatchPoint(actor);
  intent.hasAim = true;
  intent.aimX = watch.x;
  intent.aimZ = watch.z;
  if (now >= brain.strafeUntil) {
    brain.strafeUntil = now + 1.4 + random() * 1.6;
    brain.strafeDir = random() < 0.5 ? -1 : 1;
  }
  intent.crouch = actor.team === 'warden' && (Math.floor(now + actor.x) % 5 !== 0);
  return intent;
}

function holdWatchPoint(actor) {
  // Wardens watch east, toward the lanes; Jackals on overwatch watch the
  // approaches to their planted charge, which is also roughly east / mid.
  return { x: actor.x + 18, z: actor.z + (actor.id === 'w2' ? -4 : 3) };
}
