// AudioWorklet: plays the core's stereo samples from a ring buffer.
//
// The page posts Float32 interleaved stereo at the core's rate
// (processorOptions.sourceRate). If the context runs at another rate the
// samples are resampled linearly. Underruns (an empty buffer while playing)
// are counted and reported for the benchmark page.

class CoreAudio extends AudioWorkletProcessor {
  constructor({ processorOptions }) {
    super();
    const seconds = 0.5;
    this.cap = Math.ceil(processorOptions.sourceRate * seconds);
    this.left = new Float32Array(this.cap);
    this.right = new Float32Array(this.cap);
    this.read = 0; // fractional read position
    this.count = 0; // frames buffered
    this.write = 0;
    this.step = processorOptions.sourceRate / sampleRate;
    // Wait for ~3 video frames of sound before starting, to absorb jitter.
    this.startAt = Math.ceil(processorOptions.sourceRate * 0.05);
    this.started = false;
    this.underruns = 0;
    this.overflows = 0;
    this.port.onmessage = ({ data }) => {
      if (data.samples) this.push(data.samples);
      else if (data.stats) this.port.postMessage({ underruns: this.underruns, overflows: this.overflows, buffered: this.count });
    };
  }

  push(s) {
    const frames = s.length >> 1;
    for (let i = 0; i < frames; i++) {
      if (this.count === this.cap) {
        // Drop the oldest frame: the emulator ran ahead of the speakers.
        this.read = (this.read + 1) % this.cap;
        this.count--;
        this.overflows++;
      }
      this.left[this.write] = s[2 * i];
      this.right[this.write] = s[2 * i + 1];
      this.write = (this.write + 1) % this.cap;
      this.count++;
    }
  }

  process(_inputs, outputs) {
    const out = outputs[0];
    const l = out[0];
    const r = out[1] ?? out[0];
    if (!this.started) {
      if (this.count < this.startAt) return true;
      this.started = true;
    }
    for (let i = 0; i < l.length; i++) {
      if (this.count < 2) {
        l.fill(0, i);
        r.fill(0, i);
        this.underruns++;
        this.started = false; // re-buffer before playing again
        break;
      }
      const i0 = Math.floor(this.read);
      const i1 = (i0 + 1) % this.cap;
      const f = this.read - i0;
      l[i] = this.left[i0] + (this.left[i1] - this.left[i0]) * f;
      r[i] = this.right[i0] + (this.right[i1] - this.right[i0]) * f;
      let next = this.read + this.step;
      const whole = Math.floor(next) - i0;
      this.count -= whole;
      if (next >= this.cap) next -= this.cap;
      this.read = next;
    }
    return true;
  }
}

registerProcessor('ff7-core-audio', CoreAudio);
