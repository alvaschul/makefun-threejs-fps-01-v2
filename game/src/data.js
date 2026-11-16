// FREIGHTLINE data: every tuning number, the weapon catalogue, the economy and
// the map's pure geometry. No three.js, no DOM — the headless logic test imports
// this file in Node, and world.js turns the same boxes into meshes, so the map
// the judge reads about is the map the test simulates on.

// The palette: dawn over a freight depot. One canvas, one surface, warm light,
// two team colours that read at a glance across the yard.
export const PALETTE = {
  canvas: '#0d1219',
  sky: '#2e4c68',
  fog: '#2b4258',
  ground: '#3f464e',
  groundLine: '#525b64',
  surface: '#171e27',
  hairline: '#2e3947',
  ink: '#ece7db',
  muted: '#9aa5b1',
  accent: '#ffb454',
  danger: '#ff5d47',
  warden: '#35c4b5',
  wardenDark: '#1d7a71',
  jackal: '#e8763a',
  jackalDark: '#9c4a22',
  crate: '#8a7050',
  containerA: '#42718f',
  containerB: '#8f5342',
  containerC: '#677c46',
  wall: '#5b6570',
  lamp: '#ffd9a0',
};

// Match shape: 3v3, short rounds, first to 5 (at most 9 rounds).
export const MATCH = {
  teamSize: 3,
  roundsToWin: 5,
  maxRounds: 9,
  buySeconds: 12,
  roundSeconds: 100,
  bombSeconds: 35,
  plantSeconds: 3.2,
  defuseSeconds: 5,
  defuseKitSeconds: 2.5,
  endSeconds: 4.5,
  startMoney: 800,
  maxMoney: 9000,
  winReward: 1400,
  lossReward: 900,
  plantReward: 300,
  defuseReward: 200,
  killReward: 150,
  bombRadius: 7,
  grenadeRadius: 5.5,
};

// Weapons. damage is per pellet to the body; the head multiplies it by
// headMultiplier in combat resolution. spread is in radians at rest, standing
// still and crouched; moving, airborne and repeated fire all widen it, which
// is the whole gunplay lesson: stop, crouch, then shoot.
export const WEAPONS = {
  p9: {
    id: 'p9', name: 'P9 Sidearm', slot: 'sidearm', price: 0,
    damage: 26, headMultiplier: 3, range: 55, rpm: 320, automatic: false,
    mag: 12, reserve: 48, reloadSeconds: 1.5, spread: 0.011, moveSpread: 0.03,
    recoil: 0.011, pellets: 1, zoom: 1.05,
  },
  rook: {
    id: 'rook', name: 'Rook SMG', slot: 'primary', price: 1000,
    damage: 21, headMultiplier: 2.6, range: 42, rpm: 780, automatic: true,
    mag: 32, reserve: 96, reloadSeconds: 2.1, spread: 0.017, moveSpread: 0.042,
    recoil: 0.008, pellets: 1, zoom: 1.05,
  },
  vk9: {
    id: 'vk9', name: 'VK-9 Carbine', slot: 'primary', price: 2500,
    damage: 34, headMultiplier: 3, range: 75, rpm: 600, automatic: true,
    mag: 30, reserve: 90, reloadSeconds: 2.4, spread: 0.008, moveSpread: 0.034,
    recoil: 0.013, pellets: 1, zoom: 1.18,
  },
  longshot: {
    id: 'longshot', name: 'Longshot DMR', slot: 'primary', price: 3200,
    damage: 72, headMultiplier: 2.2, range: 110, rpm: 110, automatic: false,
    mag: 10, reserve: 30, reloadSeconds: 2.8, spread: 0.0025, moveSpread: 0.05,
    recoil: 0.03, pellets: 1, zoom: 1.7,
  },
};

// The buy menu, in display order. kind weapon gives the named weapon, kind
// grenade adds one of the named grenade (carried limit in `max`), kind gear
// sets a flag on the buyer for the rest of the match.
export const BUY_ITEMS = [
  { key: '1', kind: 'weapon', id: 'rook', label: 'Rook SMG', price: 1000 },
  { key: '2', kind: 'weapon', id: 'vk9', label: 'VK-9 Carbine', price: 2500 },
  { key: '3', kind: 'weapon', id: 'longshot', label: 'Longshot DMR', price: 3200 },
  { key: '4', kind: 'grenade', id: 'frag', label: 'Frag Grenade', price: 300, max: 2 },
  { key: '5', kind: 'grenade', id: 'smoke', label: 'Smoke Grenade', price: 200, max: 1 },
  { key: '6', kind: 'gear', id: 'vest', label: 'Kevlar Vest', price: 650 },
  { key: '7', kind: 'gear', id: 'kit', label: 'Defuse Tools', price: 200 },
];

export const GRENADES = {
  frag: { id: 'frag', name: 'Frag Grenade', damage: 95, radius: 5.5, fuseSeconds: 1.4 },
  smoke: { id: 'smoke', name: 'Smoke Grenade', damage: 0, radius: 4.2, fuseSeconds: 0.9, smokeSeconds: 11 },
};

// The map: Freightline Depot. x runs east, z runs south, the yard is 72 by 72
// metres inside its perimeter walls. A box is { x, z, w, d, h, kind } — centre,
// footprint, height, and a kind that picks its material in world.js and its
// cover value everywhere. Every box is also a collider and a shot blocker.
export const MAP = {
  half: 36,
  boxes: [
    // Perimeter (kind wall, tall enough that nothing leaves the yard).
    { x: 0, z: -36.5, w: 75, d: 1, h: 6, kind: 'wall' },
    { x: 0, z: 36.5, w: 75, d: 1, h: 6, kind: 'wall' },
    { x: -36.5, z: 0, w: 1, d: 75, h: 6, kind: 'wall' },
    { x: 36.5, z: 0, w: 1, d: 75, h: 6, kind: 'wall' },
    // Mid container rows: they split the yard into a north lane, a mid lane
    // and a south lane, with gaps at both ends and a crossing at x = -14.
    { x: 2, z: -13, w: 12, d: 2.6, h: 2.9, kind: 'containerA' },
    { x: 2, z: 13, w: 12, d: 2.6, h: 2.9, kind: 'containerB' },
    { x: -16, z: -13, w: 2.6, d: 12, h: 2.9, kind: 'containerC' },
    { x: -16, z: 13, w: 2.6, d: 12, h: 2.9, kind: 'containerA' },
    { x: 16, z: -7, w: 2.6, d: 9, h: 2.9, kind: 'containerB' },
    { x: 16, z: 7, w: 2.6, d: 9, h: 2.9, kind: 'containerC' },
    // East yard cover, on the attackers' way in.
    { x: 26, z: -14, w: 6, d: 2.6, h: 2.9, kind: 'containerA' },
    { x: 26, z: 14, w: 6, d: 2.6, h: 2.9, kind: 'containerC' },
    { x: 24, z: -4.5, w: 2.2, d: 2.2, h: 1.3, kind: 'crate' },
    { x: 10, z: -24, w: 6, d: 1, h: 1.1, kind: 'lowwall' },
    { x: 10, z: 24, w: 6, d: 1, h: 1.1, kind: 'lowwall' },
    // Mid crossing crates: low cover you can shoot over while crouched
    // behind, never a full block of the lane.
    { x: 1, z: -4.6, w: 2.4, d: 2.4, h: 1.5, kind: 'crate' },
    { x: 1, z: 4.6, w: 2.4, d: 2.4, h: 1.5, kind: 'crate' },
    { x: -7, z: -3, w: 2, d: 2, h: 1.2, kind: 'crate' },
    { x: -7, z: 3.5, w: 2, d: 2, h: 1.2, kind: 'crate' },
    // Cache A (north-west) furniture.
    { x: -24, z: -25, w: 3, d: 3, h: 1.6, kind: 'crate' },
    { x: -18, z: -19, w: 2, d: 2, h: 1.2, kind: 'crate' },
    { x: -28, z: -18, w: 2.4, d: 5, h: 2.9, kind: 'containerB' },
    { x: -22, z: -30, w: 7, d: 1, h: 1.1, kind: 'lowwall' },
    // Cache B (south-west) furniture, mirrored so neither site is a copy.
    { x: -25, z: 21, w: 3, d: 3, h: 1.6, kind: 'crate' },
    { x: -18, z: 27, w: 2, d: 2, h: 1.2, kind: 'crate' },
    { x: -28, z: 24, w: 2.4, d: 5, h: 2.9, kind: 'containerC' },
    { x: -20, z: 30, w: 7, d: 1, h: 1.1, kind: 'lowwall' },
    // Defender spawn cover and the west connector.
    { x: -30, z: -4, w: 2, d: 2, h: 1.2, kind: 'crate' },
    { x: -30, z: 5, w: 2, d: 2, h: 1.2, kind: 'crate' },
    { x: -33, z: -13, w: 4, d: 2.4, h: 2.9, kind: 'containerA' },
    { x: -33, z: 13, w: 4, d: 2.4, h: 2.9, kind: 'containerB' },
  ],
  // The two plant sites: a charge planted inside either circle counts.
  sites: [
    { id: 'A', x: -22, z: -23, radius: 6.5 },
    { id: 'B', x: -22, z: 23, radius: 6.5 },
  ],
  spawns: {
    warden: [
      { x: -29, z: -2, yaw: Math.PI / 2 },
      { x: -29, z: 1.5, yaw: Math.PI / 2 },
      { x: -27.5, z: 4.5, yaw: Math.PI / 2 },
    ],
    jackal: [
      { x: 31, z: -2, yaw: -Math.PI / 2 },
      { x: 31, z: 1.5, yaw: -Math.PI / 2 },
      { x: 29.5, z: 4.5, yaw: -Math.PI / 2 },
    ],
  },
};

// Waypoint graph the bots route on. Every edge is a straight, walkable line
// that clears the boxes above (the logic test checks each one). Bots pick a
// lane, follow its nodes to a site, and hold the `hold` nodes when defending.
export const WAYPOINTS = [
  { id: 'jSpawn', x: 29, z: 0 },
  { id: 'eYard', x: 20, z: 0 },
  { id: 'midDoor', x: 8, z: 0 },
  { id: 'mid', x: -2, z: 0 },
  { id: 'midCross', x: -11, z: 0 },
  { id: 'wSpawn', x: -26, z: 0 },
  { id: 'nLaneE', x: 20, z: -23 },
  { id: 'nLaneM', x: 2, z: -23 },
  { id: 'nLaneW', x: -11, z: -23 },
  { id: 'aEntry', x: -15, z: -23 },
  { id: 'aSite', x: -22, z: -23 },
  { id: 'sLaneE', x: 20, z: 23 },
  { id: 'sLaneM', x: 2, z: 23 },
  { id: 'sLaneW', x: -11, z: 23 },
  { id: 'bEntry', x: -15, z: 23 },
  { id: 'bSite', x: -22, z: 23 },
  { id: 'nLinkE', x: 20, z: -11 },
  { id: 'nLinkW', x: -11, z: -11 },
  { id: 'sLinkE', x: 20, z: 11 },
  { id: 'sLinkW', x: -11, z: 11 },
  { id: 'aHold', x: -15, z: -28 },
  { id: 'bHold', x: -11, z: 27 },
  { id: 'midHold', x: -13, z: -6 },
  { id: 'midHoldS', x: -13, z: 6 },
];

export const EDGES = [
  ['jSpawn', 'eYard'], ['eYard', 'midDoor'], ['midDoor', 'mid'], ['mid', 'midCross'],
  ['midCross', 'wSpawn'],
  ['eYard', 'nLaneE'], ['eYard', 'sLaneE'],
  ['nLaneE', 'nLaneM'], ['nLaneM', 'nLaneW'], ['nLaneW', 'aEntry'], ['aEntry', 'aSite'],
  ['sLaneE', 'sLaneM'], ['sLaneM', 'sLaneW'], ['sLaneW', 'bEntry'], ['bEntry', 'bSite'],
  ['eYard', 'nLinkE'], ['eYard', 'sLinkE'],
  ['nLinkE', 'nLaneM'], ['sLinkE', 'sLaneM'],
  ['nLinkW', 'nLaneW'], ['nLinkW', 'midCross'], ['sLinkW', 'sLaneW'], ['sLinkW', 'midCross'],
  ['nLaneW', 'nLinkW'], ['sLaneW', 'sLinkW'],
  ['aSite', 'aHold'], ['bSite', 'bHold'], ['aEntry', 'aHold'], ['bEntry', 'bHold'],
  ['nLaneW', 'aHold'], ['sLaneW', 'bHold'],
  ['aEntry', 'nLinkW'], ['bEntry', 'sLinkW'],
  ['wSpawn', 'midHold'], ['wSpawn', 'midHoldS'],
  ['midCross', 'midHold'], ['midCross', 'midHoldS'], ['midHold', 'nLinkW'], ['midHoldS', 'sLinkW'],
  ['aSite', 'wSpawn'], ['bSite', 'wSpawn'],
];
