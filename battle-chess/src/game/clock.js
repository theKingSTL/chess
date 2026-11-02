// Game clock. `now` is game seconds: it advances by real time times `speed`, so a fast battle plays every
// sprite, projectile and wait at the same faster rate. Choreography awaits `wait(seconds)` or `until(test)`;
// both settle inside `tick`, on the frame loop, so the sprites and the scripts read one time.

export function createClock() {
  const waiters = [];
  const clock = {
    now: 0,
    speed: 1,
    tick(realDt) {
      clock.now += Math.min(realDt, 0.1) * clock.speed;
      for (let i = waiters.length - 1; i >= 0; i--) {
        const w = waiters[i];
        let done;
        try {
          done = w.test(clock.now);
        } catch (error) {
          waiters.splice(i, 1);
          w.reject(error);
          continue;
        }
        if (done) {
          waiters.splice(i, 1);
          w.resolve();
        }
      }
    },
    wait(seconds) {
      const end = clock.now + Math.max(0, seconds);
      return clock.until(() => clock.now >= end);
    },
    until(test) {
      if (test(clock.now)) return Promise.resolve();
      return new Promise((resolve, reject) => waiters.push({ test, resolve, reject }));
    },
    // Rejects every pending wait with an AbortError, which unwinds whatever battle is playing.
    abort() {
      const error = new Error('aborted');
      error.name = 'AbortError';
      while (waiters.length) waiters.pop().reject(error);
    },
  };
  return clock;
}

export const lerp = (a, b, t) => a + (b - a) * t;
export const clamp01 = (t) => Math.max(0, Math.min(1, t));
export const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
export const easeOutCubic = (t) => 1 - (1 - t) ** 3;
