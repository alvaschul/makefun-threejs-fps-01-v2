// FREIGHTLINE geometry: pure collision and line-of-sight maths over the map's
// axis-aligned boxes. No three.js and no DOM, so the simulation, the bots and
// the Node logic test all share exactly these answers.
//
// An actor is a circle of radius ACTOR_RADIUS on the ground plane, with a
// height that changes when crouching. A box blocks movement always, blocks
// sight when it is taller than the eye line being tested, and blocks a shot
// when the shot's ray passes through it below its top.

import { MAP } from './data.js';

export const ACTOR_RADIUS = 0.42;
export const STAND_HEIGHT = 1.72;
export const CROUCH_HEIGHT = 1.18;
export const EYE_STAND = 1.58;
export const EYE_CROUCH = 1.04;

const boxes = MAP.boxes;

export function boxContains(box, x, z, pad = 0) {
  return (
    x >= box.x - box.w / 2 - pad && x <= box.x + box.w / 2 + pad &&
    z >= box.z - box.d / 2 - pad && z <= box.z + box.d / 2 + pad
  );
}

// Push a circle at (x, z) out of every box it overlaps, axis by axis. Returns
// through the passed object so hot loops allocate nothing.
export function resolveCollisions(out, x, z, radius = ACTOR_RADIUS) {
  out.x = x;
  out.z = z;
  for (let i = 0; i < boxes.length; i += 1) {
    const box = boxes[i];
    const minX = box.x - box.w / 2 - radius;
    const maxX = box.x + box.w / 2 + radius;
    const minZ = box.z - box.d / 2 - radius;
    const maxZ = box.z + box.d / 2 + radius;
    if (out.x > minX && out.x < maxX && out.z > minZ && out.z < maxZ) {
      const pushLeft = out.x - minX;
      const pushRight = maxX - out.x;
      const pushBack = out.z - minZ;
      const pushFront = maxZ - out.z;
      const smallest = Math.min(pushLeft, pushRight, pushBack, pushFront);
      if (smallest === pushLeft) out.x = minX;
      else if (smallest === pushRight) out.x = maxX;
      else if (smallest === pushBack) out.z = minZ;
      else out.z = maxZ;
    }
  }
  const limit = MAP.half - radius;
  if (out.x < -limit) out.x = -limit;
  if (out.x > limit) out.x = limit;
  if (out.z < -limit) out.z = -limit;
  if (out.z > limit) out.z = limit;
  return out;
}

// Does the straight ground line from a to b pass through any box's footprint?
// Used for waypoint-edge validation and bot path smoothing.
export function segmentBlocked(ax, az, bx, bz, pad = 0.1) {
  for (let i = 0; i < boxes.length; i += 1) {
    if (segmentHitsBox(ax, az, bx, bz, boxes[i], pad)) return boxes[i];
  }
  return null;
}

export function segmentHitsBox(ax, az, bx, bz, box, pad = 0) {
  const minX = box.x - box.w / 2 - pad;
  const maxX = box.x + box.w / 2 + pad;
  const minZ = box.z - box.d / 2 - pad;
  const maxZ = box.z + box.d / 2 + pad;
  const dx = bx - ax;
  const dz = bz - az;
  let tMin = 0;
  let tMax = 1;
  if (Math.abs(dx) < 1e-9) {
    if (ax < minX || ax > maxX) return false;
  } else {
    let t1 = (minX - ax) / dx;
    let t2 = (maxX - ax) / dx;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
    if (tMin > tMax) return false;
  }
  if (Math.abs(dz) < 1e-9) {
    if (az < minZ || az > maxZ) return false;
  } else {
    let t1 = (minZ - az) / dz;
    let t2 = (maxZ - az) / dz;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
    if (tMin > tMax) return false;
  }
  return true;
}

// Line of sight between two eye points in 3D: a box blocks when the segment
// passes through its footprint at a height below the box's top. Low walls
// (h 1.1) therefore hide a crouched actor but not a standing one's head.
export function hasLineOfSight(ax, ay, az, bx, by, bz) {
  for (let i = 0; i < boxes.length; i += 1) {
    const box = boxes[i];
    if (box.h <= Math.min(ay, by) && !segmentHitsBox(ax, az, bx, bz, box, 0)) continue;
    if (!segmentHitsBox(ax, az, bx, bz, box, 0)) continue;
    // Height of the sight line where it crosses the box's near face: sample
    // the segment finely enough for yard-scale boxes and test the height.
    for (let s = 1; s < 8; s += 1) {
      const t = s / 8;
      const x = ax + (bx - ax) * t;
      const z = az + (bz - az) * t;
      if (boxContains(box, x, z, 0)) {
        const y = ay + (by - ay) * t;
        if (y < box.h) return false;
      }
    }
  }
  return true;
}

// Ray versus the world for shot resolution: returns the nearest hit among
// the boxes (as a 3D slab test) in the shared scratch result, or null. The
// caller tests actors first and compares distances.
const rayHit = { distance: 0, x: 0, y: 0, z: 0, box: null };
export function raycastBoxes(ox, oy, oz, dx, dy, dz, maxDistance) {
  let best = maxDistance;
  let bestBox = null;
  for (let i = 0; i < boxes.length; i += 1) {
    const box = boxes[i];
    const minX = box.x - box.w / 2;
    const maxX = box.x + box.w / 2;
    const minY = 0;
    const maxY = box.h;
    const minZ = box.z - box.d / 2;
    const maxZ = box.z + box.d / 2;
    let tMin = 0;
    let tMax = best;
    let ok = true;
    const axes = [
      [ox, dx, minX, maxX],
      [oy, dy, minY, maxY],
      [oz, dz, minZ, maxZ],
    ];
    for (let a = 0; a < 3 && ok; a += 1) {
      const [o, d, lo, hi] = axes[a];
      if (Math.abs(d) < 1e-9) {
        if (o < lo || o > hi) ok = false;
      } else {
        let t1 = (lo - o) / d;
        let t2 = (hi - o) / d;
        if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
        tMin = Math.max(tMin, t1);
        tMax = Math.min(tMax, t2);
        if (tMin > tMax) ok = false;
      }
    }
    if (ok && tMin < best && tMin > 0.001) {
      best = tMin;
      bestBox = box;
    }
  }
  if (!bestBox) return null;
  rayHit.distance = best;
  rayHit.x = ox + dx * best;
  rayHit.y = oy + dy * best;
  rayHit.z = oz + dz * best;
  rayHit.box = bestBox;
  return rayHit;
}

// Waypoint routing: breadth-first over the edge list, returning node ids.
import { WAYPOINTS, EDGES } from './data.js';
const nodeById = new Map(WAYPOINTS.map((node) => [node.id, node]));
const neighbours = new Map(WAYPOINTS.map((node) => [node.id, []]));
for (const [a, b] of EDGES) {
  neighbours.get(a).push(b);
  neighbours.get(b).push(a);
}
export function waypoint(id) {
  return nodeById.get(id);
}
export function nearestWaypoint(x, z) {
  let best = null;
  let bestDistance = Infinity;
  for (const node of WAYPOINTS) {
    const d = Math.hypot(node.x - x, node.z - z);
    if (d < bestDistance) { bestDistance = d; best = node; }
  }
  return best;
}
export function findRoute(fromId, toId) {
  if (fromId === toId) return [fromId];
  const prev = new Map([[fromId, null]]);
  const queue = [fromId];
  while (queue.length > 0) {
    const current = queue.shift();
    for (const next of neighbours.get(current)) {
      if (!prev.has(next)) {
        prev.set(next, current);
        if (next === toId) {
          const route = [toId];
          let step = current;
          while (step !== null) { route.unshift(step); step = prev.get(step); }
          return route;
        }
        queue.push(next);
      }
    }
  }
  return [fromId];
}
