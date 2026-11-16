// FREIGHTLINE rng: one seeded generator for the whole simulation. A match
// seeded the same way plays the same way, which is what makes the headless
// logic test and the staged screenshots deterministic. mulberry32 is small,
// fast, and good enough for bot jitter and spread rolls.

export function mulberry32(seed) {
  let a = seed | 0;
  return function random() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick(random, items) {
  return items[Math.min(items.length - 1, Math.floor(random() * items.length))];
}

export function clamp(value, low, high) {
  return value < low ? low : value > high ? high : value;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function distance2d(ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  return Math.hypot(dx, dz);
}
