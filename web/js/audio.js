// Audio output through an AudioWorklet.
//
// iOS only lets a page start audio from a user gesture, so `unlock()` is
// called from the tap that opens the file picker. Until then, samples are
// dropped.

export function createAudio({ sourceRate = 44100 } = {}) {
  let ctx = null;
  let node = null;
  let starting = null;
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
      if (!starting) starting = setup().catch((e) => {
        console.warn(`audio unavailable: ${e.message}`);
        ctx = null;
        node = null;
      });
      // resume() must be called inside the gesture on iOS, before any await.
      ctx?.resume?.();
      return starting.then(() => ctx?.resume());
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
