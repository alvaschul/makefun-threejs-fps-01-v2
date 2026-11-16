// FREIGHTLINE match: the round state machine and the economy — the heart of
// the tactical loop. Phases: buy (frozen, menu open) -> live (fight, maybe
// plant) -> planted (defuse race) -> end (pause, pay out) -> next buy, until
// one team reaches MATCH.roundsToWin or the round cap is spent.
//
// Wardens (the player's team) defend the two caches. Jackals attack: their
// carrier plants the breach charge on a cache; it detonates after
// MATCH.bombSeconds unless a Warden defuses it. A round ends by elimination,
// detonation, defuse, or the clock running out with no plant.

import { MATCH, MAP, BUY_ITEMS, WEAPONS } from './data.js';
import { createActor, placeAtSpawn } from './actors.js';
import { distance2d } from './rng.js';

export function createMatch(random) {
  const actors = [];
  const names = {
    warden: ['You', 'Sable', 'Otter'],
    jackal: ['Vex', 'Mamba', 'Rooker'],
  };
  for (let i = 0; i < MATCH.teamSize; i += 1) {
    actors.push(createActor(`w${i}`, 'warden', names.warden[i], i === 0));
  }
  for (let i = 0; i < MATCH.teamSize; i += 1) {
    actors.push(createActor(`j${i}`, 'jackal', names.jackal[i], false));
  }
  const match = {
    random,
    actors,
    player: actors[0],
    phase: 'buy',
    phaseAt: 0,
    round: 1,
    score: { warden: 0, jackal: 0 },
    money: { warden: MATCH.startMoney, jackal: MATCH.startMoney },
    // The player's purse is tracked per-actor for bots and per-team here is
    // wrong for a shop — so money lives on each actor instead.
    bomb: { state: 'carried', carrierId: 'j0', x: 0, z: 0, siteId: null, plantedAt: 0, progress: 0, planterId: null },
    defuse: { actorId: null, progress: 0 },
    plant: { actorId: null, progress: 0 },
    targetSite: 'A',
    winner: null,
    endReason: '',
    matchWinner: null,
    time: 0,
    events: [],
  };
  for (const actor of actors) actor.money = MATCH.startMoney;
  startRound(match);
  return match;
}

export function teamActors(match, team) {
  return match.actors.filter((actor) => actor.team === team);
}

export function aliveCount(match, team) {
  return teamActors(match, team).reduce((count, actor) => count + (actor.alive ? 1 : 0), 0);
}

export function emit(match, event) {
  match.events.push(event);
}

// Begin a round: keep bought guns and gear, reset health, grenades persist
// only if unspent, the charge goes to the first living Jackal, and the
// attacking plan (which cache) is drawn fresh — the defence must watch both.
export function startRound(match) {
  match.phase = 'buy';
  match.phaseAt = match.time;
  match.winner = null;
  match.endReason = '';
  match.plant = { actorId: null, progress: 0 };
  match.defuse = { actorId: null, progress: 0 };
  match.targetSite = match.random() < 0.5 ? 'A' : 'B';
  for (const team of ['warden', 'jackal']) {
    const spawns = MAP.spawns[team];
    teamActors(match, team).forEach((actor, index) => placeAtSpawn(actor, spawns[index % spawns.length]));
  }
  const carrier = teamActors(match, 'jackal')[0];
  match.bomb = { state: 'carried', carrierId: carrier.id, x: carrier.x, z: carrier.z, siteId: null, plantedAt: 0, progress: 0, planterId: null };
  emit(match, { type: 'round', round: match.round, site: match.targetSite });
}

export function siteById(id) {
  return MAP.sites.find((site) => site.id === id);
}

export function actorById(match, id) {
  return match.actors.find((actor) => actor.id === id);
}

// The shop. One rule for player and bots alike: only during the buy phase,
// only while alive, never twice for a gun you hold or gear you wear, and
// grenades respect their carry limits. Returns a refusal reason or null.
export function buy(match, actor, itemId) {
  if (match.phase !== 'buy') return 'buy phase over';
  if (!actor.alive) return 'dead';
  const item = BUY_ITEMS.find((entry) => entry.id === itemId || entry.kind === 'weapon' && entry.id === itemId);
  if (!item) return 'no such item';
  if (actor.money < item.price) return 'cannot afford';
  if (item.kind === 'weapon') {
    if (actor.primaryId === item.id) return 'already held';
    actor.primaryId = item.id;
    const w = WEAPONS[item.id];
    actor.mag.primary = w.mag;
    actor.reserve.primary = w.reserve;
    actor.current = 'primary';
  } else if (item.kind === 'grenade') {
    if (item.id === 'frag' && actor.frags >= item.max) return 'frag limit';
    if (item.id === 'smoke' && actor.smokes >= item.max) return 'smoke limit';
    if (item.id === 'frag') actor.frags += 1; else actor.smokes += 1;
  } else if (item.kind === 'gear') {
    if (item.id === 'vest') {
      if (actor.hasVest && actor.armour > 40) return 'vest is fresh';
      actor.hasVest = true;
      actor.armour = 100;
    }
    if (item.id === 'kit') {
      if (actor.hasKit) return 'already held';
      actor.hasKit = true;
    }
  }
  actor.money -= item.price;
  emit(match, { type: 'buy', actorId: actor.id, item: item.id });
  return null;
}

// Bot shopping: a small honest policy — save on a lost pistol round, buy a
// rifle when the purse allows, a vest before a second grenade, tools for one
// Warden per round. It runs through buy(), so bots obey the same refusals.
export function botBuy(match, actor) {
  if (actor.team === 'warden' && !actor.hasKit && actor.id === 'w1') buy(match, actor, 'kit');
  if (actor.money >= 2500 + 650) {
    buy(match, actor, 'vk9');
    buy(match, actor, 'vest');
  } else if (actor.money >= 2500) {
    buy(match, actor, actor.randomPick === 'dmr' ? 'longshot' : 'vk9');
  } else if (actor.money >= 1650) {
    buy(match, actor, 'rook');
    buy(match, actor, 'vest');
  } else if (actor.money >= 1000) {
    buy(match, actor, 'rook');
  }
  if (actor.money >= 600) buy(match, actor, 'frag');
  if (actor.money >= 300) buy(match, actor, 'smoke');
  if (actor.money >= 650 && !actor.hasVest) buy(match, actor, 'vest');
  // A bought primary goes straight into the hands: a bot that shops for a
  // carbine and then fights the round with its pistol has wasted the money.
  if (actor.primaryId) actor.current = 'primary';
}

export function endRound(match, winner, reason) {
  if (match.phase === 'end' || match.phase === 'matchover') return;
  match.phase = 'end';
  match.phaseAt = match.time;
  match.winner = winner;
  match.endReason = reason;
  match.score[winner] += 1;
  for (const actor of match.actors) {
    if (actor.team === winner) actor.money = Math.min(MATCH.maxMoney, actor.money + MATCH.winReward);
    else actor.money = Math.min(MATCH.maxMoney, actor.money + MATCH.lossReward);
  }
  // The plant bonus is paid at plant time (stepPlant), not here.
  emit(match, { type: 'roundEnd', winner, reason, score: { ...match.score } });
  if (match.score.warden >= MATCH.roundsToWin || match.score.jackal >= MATCH.roundsToWin || match.round >= MATCH.maxRounds) {
    // Higher score wins; a tie at the cap (impossible with an odd round
    // cap, but harmless) goes to the team that won the last round.
    match.matchWinner = match.score.warden === match.score.jackal
      ? winner
      : (match.score.warden > match.score.jackal ? 'warden' : 'jackal');
    if (match.score.warden === match.score.jackal) match.matchWinner = winner;
  }
}

// The phase clock and the objective, stepped once per fixed step. Combat
// itself (shots, grenades) lives in combat.js and calls into here for the
// plant and defuse holds, which are channelled actions: stand in the site,
// hold the key, stop if you move, shoot, or take damage.
export function stepMatch(match, dt) {
  match.time += dt;
  const elapsed = match.time - match.phaseAt;
  if (match.phase === 'buy' && elapsed >= MATCH.buySeconds) {
    match.phase = 'live';
    match.phaseAt = match.time;
    emit(match, { type: 'live' });
  } else if (match.phase === 'live') {
    if (elapsed >= MATCH.roundSeconds) {
      endRound(match, 'warden', 'time — the charge never landed');
    }
  } else if (match.phase === 'planted') {
    if (match.time - match.bomb.plantedAt >= MATCH.bombSeconds) {
      match.bomb.state = 'exploded';
      emit(match, { type: 'explode', x: match.bomb.x, z: match.bomb.z });
      endRound(match, 'jackal', 'the charge detonated');
    }
  } else if (match.phase === 'end' && elapsed >= MATCH.endSeconds) {
    if (match.matchWinner) {
      match.phase = 'matchover';
      emit(match, { type: 'matchEnd', winner: match.matchWinner });
    } else {
      match.round += 1;
      startRound(match);
    }
  }
  // Elimination checks, every phase where fighting happens.
  if (match.phase === 'live' || match.phase === 'planted') {
    const wardens = aliveCount(match, 'warden');
    const jackals = aliveCount(match, 'jackal');
    if (jackals === 0) endRound(match, 'warden', 'attack eliminated');
    else if (wardens === 0) {
      // If the charge is already planted, elimination does not save the
      // defence in the genre — but with nobody left to defuse, it falls to
      // the detonation clock only when planted; otherwise Wardens' deaths
      // hand the round to the attack at once.
      if (match.phase === 'live') endRound(match, 'jackal', 'defence eliminated');
    }
  }
}

// Channelled plant: only the carrier, only inside the target site (either
// site, in fact — a plant is a plant), only while standing still.
export function stepPlant(match, actor, holding, dt) {
  if (match.phase !== 'live' || match.bomb.state !== 'carried' || match.bomb.carrierId !== actor.id) {
    match.plant = { actorId: null, progress: 0 };
    return;
  }
  const site = MAP.sites.find((s) => distance2d(actor.x, actor.z, s.x, s.z) <= s.radius);
  if (!holding || !site || actor.speed > 0.4) {
    match.plant = { actorId: actor.id, progress: 0 };
    return;
  }
  if (match.plant.actorId !== actor.id) match.plant = { actorId: actor.id, progress: 0 };
  match.plant.progress += dt;
  if (match.plant.progress >= MATCH.plantSeconds) {
    match.bomb.state = 'planted';
    match.bomb.x = actor.x;
    match.bomb.z = actor.z;
    match.bomb.siteId = site.id;
    match.bomb.plantedAt = match.time;
    match.bomb.planterId = actor.id;
    actor.money = Math.min(MATCH.maxMoney, actor.money + MATCH.plantReward);
    match.phase = 'planted';
    match.phaseAt = match.time;
    match.plant = { actorId: null, progress: 0 };
    emit(match, { type: 'planted', site: site.id, x: actor.x, z: actor.z });
  }
}

export function stepDefuse(match, actor, holding, dt) {
  if (match.phase !== 'planted' || actor.team !== 'warden') {
    match.defuse = { actorId: null, progress: 0 };
    return;
  }
  const near = distance2d(actor.x, actor.z, match.bomb.x, match.bomb.z) <= 2.2;
  if (!holding || !near || actor.speed > 0.4) {
    match.defuse = { actorId: actor.id, progress: 0 };
    return;
  }
  if (match.defuse.actorId !== actor.id) match.defuse = { actorId: actor.id, progress: 0 };
  const needed = actor.hasKit ? MATCH.defuseKitSeconds : MATCH.defuseSeconds;
  match.defuse.progress += dt;
  if (match.defuse.progress >= needed) {
    match.bomb.state = 'defused';
    actor.money = Math.min(MATCH.maxMoney, actor.money + MATCH.defuseReward);
    emit(match, { type: 'defused', actorId: actor.id });
    endRound(match, 'warden', 'charge defused');
  }
}

export function phaseSecondsLeft(match) {
  const elapsed = match.time - match.phaseAt;
  if (match.phase === 'buy') return Math.max(0, MATCH.buySeconds - elapsed);
  if (match.phase === 'live') return Math.max(0, MATCH.roundSeconds - elapsed);
  if (match.phase === 'planted') return Math.max(0, MATCH.bombSeconds - (match.time - match.bomb.plantedAt));
  return 0;
}
