// FREIGHTLINE main: boot, the fixed-step simulation loop, and the wiring
// between the pure simulation (match / actors / bots / combat) and the
// presentation (world meshes, viewmodel, HUD, audio, effects).
//
// The simulation steps at a fixed 60 Hz from an accumulator and renders at
// the display's rate; rendering only reads simulation state. Every shot —
// the player's and the bots' — resolves through combat.tryFire, every
// purchase through match.buy, and every event the simulation emits is
// drained once per step into sound, feed lines and effects.
//
// ?shot=buy|mid|plant|end with &seed=N stages a deterministic frame for a
// screenshot: it plays the real simulation forward with a simple autopilot
// for the player, freezes on a composed frame, and sets window.__shotReady.

import * as THREE from 'three';
import { PALETTE, MATCH } from './data.js';
import { mulberry32, clamp } from './rng.js';
import { createMatch, stepMatch, buy, botBuy, phaseSecondsLeft, actorById, stepPlant, stepDefuse } from './match.js';
import { createBrain, createIntent, stepBot, hear } from './bots.js';
import { stepMovement, currentWeapon, eyeHeight, jump } from './actors.js';
import { tryFire, startReload, stepReload, switchWeapon, createGrenades, throwGrenade, stepGrenades, stepPickups, magOf, reserveOf } from './combat.js';
import { createWorld, createActorMesh } from './world.js';
import { createInput } from './input.js';
import { createHud } from './hud.js';
import { createAudio } from './audio.js';
import { createEffects } from './effects.js';
import { createViewmodel } from './viewmodel.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '7', 10) || 7;
const random = mulberry32(seed * 1000 + 17);

// --- Presentation boot -------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.05, 160);
scene.add(camera);

const world = createWorld(scene);
const effects = createEffects(scene);
const hud = createHud();
const audio = createAudio();
const viewmodel = createViewmodel(camera);

// --- Simulation boot ---------------------------------------------------
let match = createMatch(random);
let grenades = createGrenades();
match.smokes = grenades.smokes;
for (const actor of match.actors) {
  if (!actor.isPlayer) createBrain(match, actor);
}
const meshes = new Map();
for (const actor of match.actors) {
  if (!actor.isPlayer) meshes.set(actor.id, createActorMesh(scene, actor));
}
const playerIntent = createIntent();
const botIntent = createIntent();

let started = false;
let frozen = false;
let shotAutopilot = false;
let accumulator = 0;
let lastTime = performance.now();
let lastPhase = match.phase;
let lastRound = match.round;
let beepSecond = -1;
let playerWasAlive = true;
const pressed = new Set();

const input = createInput(renderer.domElement, onLockChange);
hud.onPlay(() => {
  audio.unlock();
  if (match.phase === 'matchover') restartMatch();
  if (shot) return;
  started = true;
  input.requestLock();
});

function restartMatch() {
  match = createMatch(random);
  grenades = createGrenades();
  match.smokes = grenades.smokes;
  for (const actor of match.actors) if (!actor.isPlayer) createBrain(match, actor);
  lastPhase = match.phase;
  lastRound = match.round;
  playerWasAlive = true;
}

function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    started = true;
    hud.hideOverlay();
  } else if (started && match.phase !== 'matchover') {
    if (!match.player.alive) hud.showOverlay('dead', {});
    else hud.showOverlay('paused', {});
  }
}

window.addEventListener('keydown', (event) => {
  if (event.repeat) return;
  pressed.add(event.code);
  if (event.code === 'KeyM') {
    const muted = audio.toggleMute();
    hud.centreMessage(muted ? 'Sound off' : 'Sound on', 0.8);
  }
});
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- Per-step simulation ------------------------------------------------
const aimScratch = { x: 0, y: 0, z: 0 };
function aimDirection(actor, targetX, targetZ, targetHeight = 1.25) {
  const eye = actor.y + eyeHeight(actor);
  const dx = targetX - actor.x;
  const dy = targetHeight - eye;
  const dz = targetZ - actor.z;
  const length = Math.hypot(dx, dy, dz) || 1;
  aimScratch.x = dx / length;
  aimScratch.y = dy / length;
  aimScratch.z = dz / length;
  return aimScratch;
}

function faceTowards(actor, targetX, targetZ, dt) {
  const wanted = Math.atan2(-(targetX - actor.x), -(targetZ - actor.z));
  let delta = wanted - actor.yaw;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  const turn = clamp(delta, -5.2 * dt, 5.2 * dt);
  actor.yaw += turn;
}

function stepPlayer(dt) {
  const player = match.player;
  const now = match.time;
  if (shotAutopilot) return; // staging drives the player through stepBots
  if (!player.alive) return;
  const keys = input.state.keys;
  if (match.phase === 'buy') {
    // Purchases are the player's whole job in the buy phase; movement is
    // frozen, as in the genre, so a buy mistake cannot be walked off.
    for (const code of pressed) {
      if (code.startsWith('Digit')) {
        const item = ['rook', 'vk9', 'longshot', 'frag', 'smoke', 'vest', 'kit'][Number(code.slice(5)) - 1];
        if (item) {
          const refusal = buy(match, player, item);
          if (refusal) audio.denied();
          else audio.buy();
        }
      }
    }
    return;
  }
  if (match.phase !== 'live' && match.phase !== 'planted') return;

  const forward = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
  const strafe = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
  const sin = Math.sin(player.yaw);
  const cos = Math.cos(player.yaw);
  let wishX = (-sin * forward + cos * strafe);
  let wishZ = (-cos * forward - sin * strafe);
  const wishLength = Math.hypot(wishX, wishZ);
  if (wishLength > 0) { wishX /= wishLength; wishZ /= wishLength; }
  player.crouching = keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('KeyC');
  if (pressed.has('Space')) jump(player);
  stepMovement(player, wishX, wishZ, dt, now);

  // The defuse channel is the player's E hold, inside combat range of the
  // charge; planting is a Jackal job, so the player never plants.
  stepDefuse(match, player, keys.has('KeyE'), dt);
  if (match.defuse.actorId === player.id && match.defuse.progress > 0) {
    hud.setChannel('DEFUSING', match.defuse.progress / (player.hasKit ? MATCH.defuseKitSeconds : MATCH.defuseSeconds));
  }

  if (pressed.has('KeyR')) startReload(match, player, now);
  if (pressed.has('KeyQ')) switchWeapon(match, player, player.current === 'primary' ? 'sidearm' : 'primary');
  if (pressed.has('Digit1') && player.primaryId) switchWeapon(match, player, 'primary');
  if (pressed.has('Digit2')) switchWeapon(match, player, 'sidearm');
  const aim = aimDirectionFromCamera(player);
  if (pressed.has('KeyG')) throwGrenade(match, grenades, player, 'frag', aim, now);
  if (pressed.has('KeyF')) throwGrenade(match, grenades, player, 'smoke', aim, now);

  const weapon = currentWeapon(player);
  const wantsFire = input.state.firing && (weapon.automatic || pressed.has('__mouse'));
  if (input.state.firing && !weapon.automatic && !player.wasFiring) {
    if (tryFire(match, player, aim, input.state.aiming, now, random)) viewmodel.fire(now);
  } else if (wantsFire || (input.state.firing && weapon.automatic)) {
    if (tryFire(match, player, aim, input.state.aiming, now, random)) viewmodel.fire(now);
  }
  player.wasFiring = input.state.firing;
}

function aimDirectionFromCamera(player) {
  // The camera is synced to the player every frame; between frames the aim
  // is recomputed from yaw and pitch so simulation never reads the camera.
  const cp = Math.cos(player.pitch);
  aimScratch.x = -Math.sin(player.yaw) * cp;
  aimScratch.y = Math.sin(player.pitch);
  aimScratch.z = -Math.cos(player.yaw) * cp;
  return aimScratch;
}

function stepBots(dt) {
  const now = match.time;
  for (const actor of match.actors) {
    if ((actor.isPlayer && !shotAutopilot) || !actor.alive) continue;
    stepBot(match, actor, botIntent, now, dt, random);
    if (match.phase === 'buy' || match.phase === 'end' || match.phase === 'matchover') continue;
    if (botIntent.hasAim) faceTowards(actor, botIntent.aimX, botIntent.aimZ, dt);
    actor.crouching = botIntent.crouch;
    let wishX = 0;
    let wishZ = 0;
    if (botIntent.hasMove) {
      const dx = botIntent.moveX - actor.x;
      const dz = botIntent.moveZ - actor.z;
      const length = Math.hypot(dx, dz);
      if (length > 0.25) { wishX = dx / length; wishZ = dz / length; }
    }
    stepMovement(actor, wishX, wishZ, dt, now);
    if (botIntent.reload) startReload(match, actor, now);
    if (botIntent.plant) stepPlant(match, actor, true, dt);
    if (botIntent.defuse) stepDefuse(match, actor, true, dt);
    if (botIntent.fire) {
      const target = actorById(match, actor.brain ? actor.brain.targetId : null);
      if (target) {
        const aim = aimDirection(actor, target.x, target.z, target.crouching ? 0.95 : 1.3);
        tryFire(match, actor, aim, false, now, random);
      }
    }
    if (botIntent.throwFrag) {
      const target = actorById(match, actor.brain ? actor.brain.targetId : null);
      if (target) throwGrenade(match, grenades, actor, 'frag', aimDirection(actor, target.x, target.z, 2.2), now);
    }
  }
}

function step(dt) {
  // Bots shop once, at the top of each buy phase.
  if (match.phase === 'buy' && lastPhase !== 'buy') {
    for (const actor of match.actors) if (!actor.isPlayer) {
      // A tiny seeded preference so the two rifle bots do not mirror-buy.
      actor.randomPick = random() < 0.25 ? 'dmr' : 'carbine';
      botBuy(match, actor);
    }
  }
  stepPlayer(dt);
  stepBots(dt);
  for (const actor of match.actors) stepReload(match, actor, match.time);
  stepGrenades(match, grenades, dt, match.time);
  stepPickups(match);
  stepMatch(match, dt);
  drainEvents();
  pressed.clear();
  if (match.phase !== lastPhase) {
    onPhaseChange(lastPhase, match.phase);
    lastPhase = match.phase;
  }
  if (match.round !== lastRound) lastRound = match.round;
}

function onPhaseChange(from, to) {
  const player = match.player;
  if (to === 'live') hud.centreMessage(`Round ${match.round} — ${match.targetSite} is the target`, 1.6);
  if (to === 'buy') {
    hud.centreMessage(`Round ${match.round}`, 1.4);
    for (const actor of match.actors) if (!actor.isPlayer || shotAutopilot) createBrain(match, actor);
    grenades.flying.length = 0;
    if (!shot) hud.showOverlay('paused', {});
    if (document.pointerLockElement) document.exitPointerLock();
    hud.centreMessage(`Round ${match.round} — buy phase`, 1.4);
  }
  if (to === 'matchover') {
    const won = match.matchWinner === 'warden';
    hud.showOverlay('match', {
      won,
      text: `Final score — Wardens ${match.score.warden}, Jackals ${match.score.jackal}.`,
    });
    if (document.pointerLockElement) document.exitPointerLock();
  }
  void from;
  void player;
}

// --- Events: simulation -> sound, feed, effects -------------------------
function drainEvents() {
  for (const event of match.events) {
    switch (event.type) {
      case 'shot': {
        const shooter = actorById(match, event.actorId);
        const distanceShare = shooter && !shooter.isPlayer
          ? clamp(Math.hypot(shooter.x - match.player.x, shooter.z - match.player.z) / 60, 0, 1) : 0;
        audio.shot(event.weaponId, distanceShare);
        effects.tracer(event.from, event.to, match.time);
        effects.impact(event.to, match.time, random);
        if (shooter) for (const other of match.actors) hear(match, other, shooter.x, shooter.z, 26);
        break;
      }
      case 'hit': {
        if (event.actorId === match.player.id) {
          hud.hitMarker(event.killed);
          audio.hit(event.part === 'head');
          if (event.killed) audio.kill();
        }
        if (event.targetId === match.player.id) {
          hud.damage();
          audio.hurt();
        }
        break;
      }
      case 'kill': {
        const killer = actorById(match, event.actorId);
        const victim = actorById(match, event.targetId);
        if (killer && victim) {
          hud.feedLine(`${killer.name} ▸ ${victim.name}`, victim.team === 'jackal' ? 'good' : 'bad');
        }
        break;
      }
      case 'dryFire': if (event.actorId === match.player.id) audio.dryFire(); break;
      case 'reloadStart': if (event.actorId === match.player.id) audio.reload(); break;
      case 'reloadEnd': if (event.actorId === match.player.id) audio.reloadEnd(); break;
      case 'throw': audio.throwWhoosh(); break;
      case 'fragExplode': audio.frag(); effects.explosion({ x: event.x, z: event.z }, match.time, random); break;
      case 'smoke': audio.smoke(); effects.smoke({ x: event.x, z: event.z }, 4.2, match.time, 11); break;
      case 'planted':
        audio.planted();
        hud.centreMessage(`Charge planted at ${event.site} — defuse it`, 2.4);
        hud.feedLine(`Charge planted at ${event.site}`, 'bad');
        break;
      case 'defused': audio.defused(); break;
      case 'explode': audio.explosion(); effects.explosion({ x: event.x, z: event.z }, match.time, random); break;
      case 'bombDropped': hud.feedLine('Charge dropped', ''); break;
      case 'bombPickup': hud.feedLine('Charge recovered', 'bad'); break;
      case 'roundEnd': {
        const won = event.winner === 'warden';
        audio.roundWin(won);
        hud.centreMessage(won ? `Round won — ${event.reason}` : `Round lost — ${event.reason}`, 3);
        break;
      }
      default: break;
    }
  }
  match.events.length = 0;
}

// --- Rendering ------------------------------------------------------------
function syncPresentation() {
  const player = match.player;
  // Camera: the player's eyes while alive; after death, the first living
  // teammate's shoulder, so the round can be watched out.
  let view = player;
  if (!player.alive) {
    view = match.actors.find((actor) => actor.team === 'warden' && actor.alive) || player;
  }
  const look = input.takeLook();
  if (player.alive && input.state.locked) {
    player.yaw -= look.x * 0.0021;
    player.pitch = clamp(player.pitch - look.y * 0.0021, -1.45, 1.45);
  }
  camera.position.set(view.x, view.y + eyeHeight(view) + (view === player ? 0 : 0.4), view.z);
  camera.rotation.set(view.pitch, view.yaw, 0, 'YXZ');
  if (view !== player) {
    // Spectate: pull the camera back and up off the teammate's shoulder.
    camera.position.x -= Math.sin(view.yaw) * 2.6;
    camera.position.z -= Math.cos(view.yaw) * 2.6;
    camera.position.y += 0.8;
  }
  // Actor meshes.
  for (const actor of match.actors) {
    if (actor.isPlayer) continue;
    const mesh = meshes.get(actor.id);
    if (!mesh) continue;
    mesh.group.visible = actor.alive;
    if (!actor.alive) continue;
    mesh.group.position.set(actor.x, actor.y, actor.z);
    mesh.group.rotation.y = -actor.yaw + Math.PI;
    const crouchShare = actor.crouching ? 0.78 : 1;
    mesh.group.scale.y = crouchShare;
    mesh.barFill.scale.x = Math.max(0.01, actor.health / 100);
    mesh.barFill.position.x = -(1 - actor.health / 100) * 0.43;
    mesh.group.traverse((child) => {
      if (child.name === 'barFill' || child.geometry && child.geometry.type === 'PlaneGeometry') {
        child.lookAt(camera.position.x, child.getWorldPosition(new THREE.Vector3()).y, camera.position.z);
      }
    });
  }
  // The charge: on its carrier's back, on the ground, or planted.
  const bomb = match.bomb;
  if (bomb.state === 'carried') {
    const carrier = actorById(match, bomb.carrierId);
    if (carrier) {
      world.bomb.visible = true;
      world.bomb.position.set(carrier.x, carrier.y + 1.15, carrier.z);
    }
  } else if (bomb.state === 'dropped' || bomb.state === 'planted') {
    world.bomb.visible = true;
    world.bomb.position.set(bomb.x, 0, bomb.z);
  } else {
    world.bomb.visible = false;
  }
  if (bomb.state === 'planted') {
    const left = MATCH.bombSeconds - (match.time - bomb.plantedAt);
    world.beaconMaterial.emissiveIntensity = (Math.floor(match.time * (left < 10 ? 6 : 2)) % 2 === 0) ? 2.4 : 0.2;
    const second = Math.ceil(left);
    if (second !== beepSecond && left > 0) {
      beepSecond = second;
      if (left < 10 || second % 2 === 0) audio.beep(left);
    }
  }
  // Viewmodel and HUD.
  const weapon = currentWeapon(player);
  viewmodel.show(weapon.id);
  viewmodel.step(FIXED_STEP, match.time, {
    moving: player.speed > 0.4, aiming: input.state.aiming,
    reloading: player.reloadingUntil > match.time, weaponId: weapon.id,
  });
  camera.fov += (((input.state.aiming && player.alive) ? 75 / weapon.zoom : 75) - camera.fov) * 0.22;
  camera.updateProjectionMatrix();
  hud.setVitals(player.health, player.armour);
  hud.setAmmo(magOf(player), reserveOf(player), magOf(player) === 0);
  hud.setWeapon(weapon.name.toUpperCase(), player.frags, player.smokes);
  hud.setMoney(player.money);
  const phaseName = { buy: 'BUY', live: 'LIVE', planted: 'PLANTED', end: 'ROUND OVER', matchover: 'MATCH OVER' }[match.phase];
  hud.setClock(phaseSecondsLeft(match), phaseName, match.round, match.score.warden, match.score.jackal);
  hud.setBomb(
    match.bomb.state === 'planted' ? `CHARGE AT ${match.bomb.siteId} — ${Math.max(0, Math.ceil(MATCH.bombSeconds - (match.time - bomb.plantedAt)))}s`
      : match.bomb.state === 'dropped' ? 'CHARGE DROPPED'
        : match.bomb.state === 'defused' ? 'CHARGE DEFUSED' : '',
  );
  if (match.phase === 'buy' && player.alive) hud.showBuy(player.money, player);
  else hud.hideBuy();
  if (match.defuse.progress === 0 && !(match.plant.progress > 0)) hud.setChannel('', 0);
  if (!player.alive && playerWasAlive) {
    playerWasAlive = false;
    if (!shot) hud.showOverlay('dead', {});
  }
  if (player.alive) playerWasAlive = true;
  hud.tick();
  effects.step(match.time, FIXED_STEP);
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen) {
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
  }
  syncPresentation();
  renderer.render(scene, camera);
}

// --- Screenshot staging ---------------------------------------------------
// The autopilot is deliberately simple: it buys a carbine, walks the mid
// lane, and fires at the first Jackal it sees. Shots are staged from real
// simulation states, never from posed meshes.
function runShot(name) {
  hud.hideOverlay();
  started = true;
  // Fast-forward the buy phase.
  match.phase = 'live';
  match.phaseAt = match.time;
  const player = match.player;
  buy(match, player, 'vk9');
  buy(match, player, 'vest');
  buy(match, player, 'frag');
  switchWeapon(match, player, 'primary');
  player.money = 800;
  const settle = (seconds) => {
    const stepsCount = Math.floor(seconds / FIXED_STEP);
    for (let i = 0; i < stepsCount; i += 1) step(FIXED_STEP);
  };
  if (name === 'buy') {
    match.phase = 'buy';
    match.phaseAt = match.time;
    player.x = -25; player.z = -2;
    player.yaw = -Math.PI / 2; // east, across the yard from Warden spawn
    settle(0.2);
  } else if (name === 'mid') {
    // The autopilot takes the player's post and walks the mid lane into
    // the Jackal swing — a real firefight, played by the real rules.
    shotAutopilot = true;
    createBrain(match, player);
    player.x = 6; player.z = -4;
    settle(7);
    shotAutopilot = false;
  } else if (name === 'plant') {
    // Play rounds out under autopilot until a charge is planted (a round
    // can end by elimination first; the next round simply plays on).
    shotAutopilot = true;
    createBrain(match, player);
    let guard = 0;
    while (match.bomb.state !== 'planted' && guard < 180 * 60 && match.phase !== 'matchover') {
      step(FIXED_STEP);
      guard += 1;
    }
    shotAutopilot = false;
    if (player.alive && match.bomb.state === 'planted') {
      // Compose the frame: the player covers the planted charge.
      player.x = match.bomb.x + 7;
      player.z = match.bomb.z + 3;
      player.yaw = Math.atan2(-(match.bomb.x - player.x), -(match.bomb.z - player.z));
      settle(0.4);
    } else {
      // The player is down: let the retake develop so the spectate camera
      // rides a Warden closing on the charge.
      settle(1.6);
    }
  } else {
    // 'end': the autopilot plays a round out to its conclusion.
    shotAutopilot = true;
    createBrain(match, player);
    let guard = 0;
    while (match.phase !== 'end' && match.phase !== 'matchover' && guard < 180 * 60) {
      step(FIXED_STEP);
      guard += 1;
    }
    shotAutopilot = false;
    settle(0.3);
  }
  syncPresentation();
  let painted = 0;
  const paint = () => {
    requestAnimationFrame(paint);
    syncPresentation();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 3) {
      window.__shotReady = true;
      frozen = true;
    }
  };
  requestAnimationFrame(paint);
}

syncPresentation();
if (shot) runShot(shot);
else requestAnimationFrame(frame);
