// Audio output through an AudioWorklet.
//
// iOS only lets a page start audio from a user gesture, so `unlock()` is
// called from the tap that opens the file picker. Until then, samples are
// dropped. iOS also suspends or interrupts the context later (the file
// picker covering the page, headphones plugged or unplugged, a call), so the
// page calls `unlock()` again on any tap while `needsResume` is true.
//
// On iOS, Web Audio counts as "ambient" sound by default and the silent
// switch mutes it on the speaker (not on headphones). Declaring a playback
// audio session (Safari 16.4+) makes it play like a media app.

/** Ask for media-style playback, so the silent switch doesn't mute the game. */
export function requestPlaybackSession(nav = globalThis.navigator) {
  try {
    if (nav?.audioSession && nav.audioSession.type !== 'playback') nav.audioSession.type = 'playback';
  } catch {
    // older Safari or a browser without the Audio Session API
  }
}

export function createAudio({ sourceRate = 44100 } = {}) {
  let ctx = null;
  let node = null;
  let starting = null;
  let unlocking = Promise.resolve();
  let muted = false;

  async function setup() {
    const AC = globalThis.AudioContext ?? globalThis.webkitAudioContext;
    if (!AC) throw new Error('no Web Audio in this browser');
    try {
      ctx = new AC({ sampleRate: sourceRate, latencyHint: 'interactive' });
    } catch {
      ctx = new AC({ latencyHint: 'interactive' });
    }
    await ctx.audioWorklet.addModule(new URL('./audio-worklet.js', import.meta.url));
    node = new AudioWorkletNode(ctx, 'ff7-core-audio', {
      numberOfInputs: 0,
      outputChannelCount: [2],
      processorOptions: { sourceRate },
    });
    node.connect(ctx.destination);
  }

  return {
    /** Call from a user gesture (tap/click). Safe to call repeatedly. */
    unlock() {
      requestPlaybackSession();
      if (!starting) starting = setup().catch((e) => {
        console.warn(`audio unavailable: ${e.message}`);
        ctx = null;
        node = null;
      });
      // resume() must be called inside the gesture on iOS, before any await.
      ctx?.resume?.();
      unlocking = starting.then(() => ctx?.resume());
      return unlocking;
    },
    /** Settles when the latest unlock() has finished, including its resume after start-up (#50). */
    get unlocking() {
      return unlocking;
    },
    push(samples) {
      if (node && !muted) node.port.postMessage({ samples }, [samples.buffer]);
    },
    setMuted(v) {
      muted = Boolean(v);
    },
    get muted() {
      return muted;
    },
    get state() {
      return ctx?.state ?? 'off';
    },
    /** The AudioContext, or null before the first unlock (tests, #8). */
    get context() {
      return ctx;
    },
    /** True when audio was started but is now suspended or interrupted. */
    get needsResume() {
      return Boolean(ctx) && !muted && ctx.state !== 'running' && ctx.state !== 'closed';
    },
    /** { underruns, overflows, buffered } from the worklet, or null. */
    stats() {
      if (!node) return Promise.resolve(null);
      return new Promise((resolve) => {
        const prev = node.port.onmessage;
        node.port.onmessage = ({ data }) => {
          node.port.onmessage = prev;
          resolve(data);
        };
        node.port.postMessage({ stats: true });
      });
    },
  };
}
