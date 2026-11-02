// Tiny synthesized sound set (WebAudio, no files). Starts on the first user gesture, as browsers require.
export function createAudio() {
  let ctx = null;
  let master = null;
  let enabled = true;
  const ensure = () => {
    if (!enabled) return null;
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.35;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  };

  function tone({ type = 'square', from = 440, to = from, time = 0.1, gain = 0.3, delay = 0 }) {
    const c = ensure();
    if (!c) return;
    const t0 = c.currentTime + delay;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t0 + time);
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + time);
    osc.connect(g).connect(master);
    osc.start(t0);
    osc.stop(t0 + time + 0.02);
  }

  function noise({ time = 0.15, gain = 0.4, filter = 1800, delay = 0, q = 0.8 }) {
    const c = ensure();
    if (!c) return;
    const t0 = c.currentTime + delay;
    const buffer = c.createBuffer(1, Math.ceil(c.sampleRate * time), c.sampleRate);
    const d = buffer.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const src = c.createBufferSource();
    src.buffer = buffer;
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = filter;
    bp.Q.value = q;
    const g = c.createGain();
    g.gain.value = gain;
    src.connect(bp).connect(g).connect(master);
    src.start(t0);
  }

  const sounds = {
    select: () => tone({ from: 880, to: 1320, time: 0.06, gain: 0.12 }),
    deny: () => tone({ type: 'sawtooth', from: 180, to: 120, time: 0.12, gain: 0.12 }),
    step: () => noise({ time: 0.05, gain: 0.18, filter: 500 }),
    land: () => noise({ time: 0.12, gain: 0.35, filter: 300 }),
    swing: () => noise({ time: 0.12, gain: 0.25, filter: 3200, q: 2 }),
    hit: () => {
      noise({ time: 0.16, gain: 0.5, filter: 900 });
      tone({ type: 'square', from: 220, to: 70, time: 0.14, gain: 0.2 });
    },
    gun: () => {
      noise({ time: 0.22, gain: 0.7, filter: 1400, q: 0.5 });
      tone({ type: 'triangle', from: 160, to: 40, time: 0.2, gain: 0.3 });
    },
    magic: () => {
      tone({ type: 'sine', from: 520, to: 1560, time: 0.5, gain: 0.15 });
      tone({ type: 'sine', from: 780, to: 2340, time: 0.5, gain: 0.08, delay: 0.05 });
    },
    thunder: () => {
      noise({ time: 0.6, gain: 0.8, filter: 200, q: 0.3 });
      noise({ time: 0.12, gain: 0.5, filter: 4000 });
    },
    death: () => {
      tone({ type: 'square', from: 440, to: 110, time: 0.4, gain: 0.14 });
      tone({ type: 'square', from: 330, to: 82, time: 0.45, gain: 0.1, delay: 0.08 });
    },
    teleport: () => tone({ type: 'sine', from: 300, to: 1800, time: 0.35, gain: 0.12 }),
    check: () => {
      tone({ from: 660, time: 0.12, gain: 0.15 });
      tone({ from: 660, time: 0.12, gain: 0.15, delay: 0.16 });
    },
    promote: () => [523, 659, 784, 1047].forEach((f, i) => tone({ type: 'triangle', from: f, time: 0.18, gain: 0.15, delay: i * 0.09 })),
    victory: () => [523, 659, 784, 659, 784, 1047].forEach((f, i) => tone({ type: 'square', from: f, time: 0.2, gain: 0.12, delay: i * 0.14 })),
    draw: () => [392, 349, 330].forEach((f, i) => tone({ type: 'triangle', from: f, time: 0.25, gain: 0.12, delay: i * 0.2 })),
  };

  return {
    play(name) {
      try {
        sounds[name]?.();
      } catch {
        /* audio is optional */
      }
    },
    unlock: ensure,
    set enabled(on) {
      enabled = on;
      if (!on && ctx) ctx.suspend();
    },
    get enabled() {
      return enabled;
    },
  };
}
