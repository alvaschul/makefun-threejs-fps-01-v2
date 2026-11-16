// FREIGHTLINE audio: every sound is synthesised in WebAudio — no audio
// files, nothing fetched. Short filtered noise and square blips shaped by
// envelopes: gunfire per weapon family, reload clicks, hits, the charge's
// beep quickening as it counts down, the detonation, and round stingers.
// The context is created lazily on the first user gesture (the Play click).

export function createAudio() {
  let ctx = null;
  let master = null;
  let muted = false;

  function ensure() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return true;
    }
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return false;
    ctx = new AudioContextClass();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
    return true;
  }

  function noiseBuffer() {
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 0.4, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    return buffer;
  }
  let cachedNoise = null;

  function burst({ at = 0, duration = 0.12, frequency = 1200, gain = 0.5, type = 'lowpass' }) {
    if (!ctx || muted) return;
    if (!cachedNoise) cachedNoise = noiseBuffer();
    const source = ctx.createBufferSource();
    source.buffer = cachedNoise;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = frequency;
    const env = ctx.createGain();
    const start = ctx.currentTime + at;
    env.gain.setValueAtTime(gain, start);
    env.gain.exponentialRampToValueAtTime(0.001, start + duration);
    source.connect(filter).connect(env).connect(master);
    source.start(start);
    source.stop(start + duration + 0.02);
  }

  function tone({ at = 0, frequency = 440, duration = 0.1, gain = 0.2, type = 'square', slide = 0 }) {
    if (!ctx || muted) return;
    const osc = ctx.createOscillator();
    osc.type = type;
    const start = ctx.currentTime + at;
    osc.frequency.setValueAtTime(frequency, start);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, frequency + slide), start + duration);
    const env = ctx.createGain();
    env.gain.setValueAtTime(gain, start);
    env.gain.exponentialRampToValueAtTime(0.001, start + duration);
    osc.connect(env).connect(master);
    osc.start(start);
    osc.stop(start + duration + 0.02);
  }

  return {
    unlock() { ensure(); },
    toggleMute() {
      muted = !muted;
      return muted;
    },
    shot(weaponId, distanceShare = 0) {
      if (!ensure()) return;
      const far = Math.min(0.7, distanceShare);
      if (weaponId === 'longshot') {
        burst({ duration: 0.28, frequency: 900 - far * 300, gain: 0.8 - far * 0.4 });
        tone({ frequency: 120, duration: 0.2, gain: 0.4 - far * 0.2, type: 'triangle', slide: -60 });
      } else if (weaponId === 'rook') {
        burst({ duration: 0.07, frequency: 1800 - far * 600, gain: 0.4 - far * 0.2 });
      } else {
        burst({ duration: 0.13, frequency: 1400 - far * 500, gain: 0.6 - far * 0.3 });
        tone({ frequency: 160, duration: 0.09, gain: 0.25 - far * 0.12, type: 'triangle', slide: -70 });
      }
    },
    dryFire() { tone({ frequency: 900, duration: 0.04, gain: 0.12 }); },
    reload() {
      tone({ frequency: 500, duration: 0.05, gain: 0.16 });
      tone({ at: 0.16, frequency: 340, duration: 0.05, gain: 0.16 });
    },
    reloadEnd() { tone({ frequency: 700, duration: 0.06, gain: 0.2 }); tone({ at: 0.07, frequency: 980, duration: 0.05, gain: 0.16 }); },
    hit(head) {
      tone({ frequency: head ? 1560 : 1180, duration: 0.06, gain: 0.22 });
    },
    kill() {
      tone({ frequency: 660, duration: 0.09, gain: 0.2 });
      tone({ at: 0.09, frequency: 990, duration: 0.12, gain: 0.2 });
    },
    hurt() { burst({ duration: 0.1, frequency: 500, gain: 0.3 }); },
    throwWhoosh() { burst({ duration: 0.16, frequency: 700, gain: 0.14, type: 'bandpass' }); },
    frag() {
      burst({ duration: 0.55, frequency: 420, gain: 0.95 });
      tone({ frequency: 70, duration: 0.5, gain: 0.6, type: 'sine', slide: -30 });
    },
    smoke() { burst({ duration: 0.5, frequency: 900, gain: 0.2, type: 'highpass' }); },
    beep(rate) { tone({ frequency: 1320, duration: 0.05, gain: 0.14 }); void rate; },
    planted() {
      tone({ frequency: 880, duration: 0.1, gain: 0.2 });
      tone({ at: 0.12, frequency: 880, duration: 0.1, gain: 0.2 });
      tone({ at: 0.24, frequency: 1174, duration: 0.16, gain: 0.22 });
    },
    defused() {
      tone({ frequency: 1174, duration: 0.1, gain: 0.2 });
      tone({ at: 0.12, frequency: 880, duration: 0.18, gain: 0.2 });
    },
    explosion() {
      burst({ duration: 1.1, frequency: 300, gain: 1 });
      tone({ frequency: 52, duration: 1, gain: 0.7, type: 'sine', slide: -18 });
    },
    buy() { tone({ frequency: 1046, duration: 0.06, gain: 0.16 }); tone({ at: 0.06, frequency: 1568, duration: 0.08, gain: 0.14 }); },
    denied() { tone({ frequency: 220, duration: 0.11, gain: 0.18 }); },
    roundWin(win) {
      const base = win ? 523 : 392;
      tone({ frequency: base, duration: 0.14, gain: 0.2, type: 'triangle' });
      tone({ at: 0.14, frequency: base * 1.25, duration: 0.14, gain: 0.2, type: 'triangle' });
      tone({ at: 0.28, frequency: base * 1.5, duration: 0.24, gain: 0.22, type: 'triangle' });
    },
  };
}
