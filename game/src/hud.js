// FREIGHTLINE hud: every DOM readout — health and armour, ammunition, money,
// the round timer and phase, the team score, the kill feed, the centre
// message, the buy menu, and the start / round / match overlays. main.js
// pushes state in through these setters; the HUD never reaches back into
// the simulation.

import { BUY_ITEMS } from './data.js';

export function createHud() {
  const el = (id) => document.getElementById(id);
  const health = el('health-value');
  const armour = el('armour-value');
  const healthBar = el('health-bar-fill');
  const ammoMag = el('ammo-mag');
  const ammoReserve = el('ammo-reserve');
  const ammoBox = el('ammo');
  const money = el('money-value');
  const timer = el('timer-value');
  const phase = el('phase-value');
  const score = el('score-value');
  const round = el('round-value');
  const feed = el('killfeed');
  const centre = el('centre-message');
  const channel = el('channel');
  const channelFill = el('channel-fill');
  const channelLabel = el('channel-label');
  const hitmarker = el('hitmarker');
  const damageFlash = el('damage-flash');
  const buyMenu = el('buy-menu');
  const overlay = el('overlay');
  const overlayTitle = el('overlay-title');
  const overlayCopy = el('overlay-copy');
  const playButton = el('play');
  const weaponName = el('weapon-name');
  const grenadeCount = el('grenade-value');
  const bombState = el('bomb-value');

  let centreUntil = 0;
  let hitUntil = 0;
  let flashUntil = 0;

  function buyRow(item, owned, afford) {
    const row = document.createElement('div');
    row.className = 'buy-row' + (owned ? ' owned' : afford ? '' : ' poor');
    row.innerHTML = `<kbd>${item.key}</kbd><span class="buy-label"></span><span class="buy-price">$${item.price}</span>`;
    row.querySelector('.buy-label').textContent = item.label + (owned ? ' — held' : '');
    return row;
  }

  return {
    onPlay(callback) {
      playButton.addEventListener('click', callback);
    },
    setVitals(healthNow, armourNow) {
      health.textContent = String(Math.max(0, Math.ceil(healthNow)));
      armour.textContent = String(Math.max(0, Math.ceil(armourNow)));
      healthBar.style.width = `${Math.max(0, Math.min(100, healthNow))}%`;
      healthBar.style.background = healthNow <= 30 ? 'var(--danger)' : 'var(--accent)';
    },
    setAmmo(mag, reserve, empty) {
      ammoMag.textContent = String(mag);
      ammoReserve.textContent = `/ ${reserve}`;
      ammoBox.classList.toggle('empty', empty);
    },
    setWeapon(name, frags, smokes) {
      weaponName.textContent = name;
      grenadeCount.textContent = `Frag ×${frags} · Smoke ×${smokes}`;
    },
    setMoney(value) {
      money.textContent = `$${value}`;
    },
    setClock(secondsLeft, phaseName, roundNow, wardenScore, jackalScore) {
      const total = Math.max(0, Math.ceil(secondsLeft));
      const minutes = Math.floor(total / 60);
      const seconds = total % 60;
      timer.textContent = `${minutes}:${String(seconds).padStart(2, '0')}`;
      timer.classList.toggle('urgent', total <= 10 && (phaseName === 'LIVE' || phaseName === 'PLANTED'));
      phase.textContent = phaseName;
      round.textContent = `ROUND ${roundNow}`;
      score.innerHTML = `<span class="warden">${wardenScore}</span> — <span class="jackal">${jackalScore}</span>`;
    },
    setBomb(text) {
      bombState.textContent = text;
    },
    feedLine(text, kind = '') {
      const line = document.createElement('div');
      line.className = `feed-line ${kind}`;
      line.textContent = text;
      feed.prepend(line);
      while (feed.children.length > 5) feed.lastChild.remove();
      window.setTimeout(() => { line.classList.add('fade'); }, 4200);
      window.setTimeout(() => { line.remove(); }, 5000);
    },
    centreMessage(text, seconds = 2.2) {
      centre.textContent = text;
      centre.classList.add('on');
      centreUntil = performance.now() + seconds * 1000;
    },
    hitMarker(kill) {
      hitmarker.classList.add('on');
      hitmarker.classList.toggle('kill', kill);
      hitUntil = performance.now() + (kill ? 220 : 110);
    },
    damage() {
      damageFlash.classList.add('on');
      flashUntil = performance.now() + 180;
    },
    setChannel(label, share) {
      if (share <= 0) {
        channel.classList.remove('on');
        return;
      }
      channel.classList.add('on');
      channelLabel.textContent = label;
      channelFill.style.width = `${Math.min(100, share * 100)}%`;
    },
    showBuy(playerMoney, actor) {
      buyMenu.innerHTML = '';
      const title = document.createElement('div');
      title.className = 'buy-title';
      title.textContent = 'BUY — press the number key';
      buyMenu.appendChild(title);
      for (const item of BUY_ITEMS) {
        let owned = false;
        if (item.kind === 'weapon') owned = actor.primaryId === item.id;
        if (item.kind === 'gear' && item.id === 'vest') owned = actor.hasVest && actor.armour > 40;
        if (item.kind === 'gear' && item.id === 'kit') owned = actor.hasKit;
        if (item.kind === 'grenade' && item.id === 'frag') owned = actor.frags >= item.max;
        if (item.kind === 'grenade' && item.id === 'smoke') owned = actor.smokes >= item.max;
        buyMenu.appendChild(buyRow(item, owned, playerMoney >= item.price));
      }
      const moneyLine = document.createElement('div');
      moneyLine.id = 'buy-money';
      moneyLine.textContent = `$${playerMoney}`;
      buyMenu.appendChild(moneyLine);
      buyMenu.classList.add('on');
    },
    hideBuy() {
      buyMenu.classList.remove('on');
    },
    showOverlay(kind, data = {}) {
      overlay.hidden = false;
      if (kind === 'start') {
        overlayTitle.textContent = 'FREIGHTLINE';
        overlayCopy.textContent = 'Wardens defend the caches. Jackals bring the charge. First to 5 rounds — click to take your post.';
        playButton.textContent = 'Click to play';
      } else if (kind === 'paused') {
        overlayTitle.textContent = 'Paused';
        overlayCopy.textContent = 'The yard waits. Click to return to your post.';
        playButton.textContent = 'Resume';
      } else if (kind === 'dead') {
        overlayTitle.textContent = 'You are down';
        overlayCopy.textContent = data.text || 'Your team fights on — watch the round out.';
        playButton.textContent = 'Spectate';
      } else if (kind === 'match') {
        overlayTitle.textContent = data.won ? 'Match won' : 'Match lost';
        overlayCopy.textContent = data.text || '';
        playButton.textContent = 'Play again';
      }
    },
    hideOverlay() {
      overlay.hidden = true;
    },
    tick() {
      const now = performance.now();
      if (centreUntil && now > centreUntil) {
        centre.classList.remove('on');
        centreUntil = 0;
      }
      if (hitUntil && now > hitUntil) {
        hitmarker.classList.remove('on');
        hitmarker.classList.remove('kill');
        hitUntil = 0;
      }
      if (flashUntil && now > flashUntil) {
        damageFlash.classList.remove('on');
        flashUntil = 0;
      }
    },
  };
}
