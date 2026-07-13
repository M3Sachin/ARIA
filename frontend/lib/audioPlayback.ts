const PLAYBACK_SAMPLE_RATE = 24000;

export class AudioPlayback {
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private gain: GainNode | null = null;
  private nextStart = 0;
  private freqBuf: Uint8Array<ArrayBuffer> | null = null;

  init(): void {
    if (this.ctx) return;
    this.ctx = new AudioContext({ sampleRate: PLAYBACK_SAMPLE_RATE });
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 512;
    this.freqBuf = new Uint8Array(this.analyser.frequencyBinCount);
    this.gain = this.ctx.createGain();
    this.gain.connect(this.analyser);
    this.analyser.connect(this.ctx.destination);
    this.nextStart = this.ctx.currentTime;
  }

  /** Enqueue a raw 16-bit PCM chunk (24 kHz, mono) for gapless playback. */
  enqueue(pcm16: ArrayBuffer): void {
    if (!this.ctx || !this.gain) return;
    if (this.ctx.state === "suspended") this.ctx.resume();

    const int16 = new Int16Array(pcm16);
    const f32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) {
      f32[i] = int16[i] / 32768;
    }

    const buf = this.ctx.createBuffer(1, f32.length, PLAYBACK_SAMPLE_RATE);
    buf.copyToChannel(f32, 0);

    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.gain);

    const startAt = Math.max(this.ctx.currentTime, this.nextStart);
    src.start(startAt);
    this.nextStart = startAt + buf.duration;
  }

  /** Flush the queue immediately (e.g. on user interrupt). */
  flush(): void {
    if (!this.ctx) return;
    this.nextStart = this.ctx.currentTime;
  }

  resume(): void {
    this.ctx?.resume();
  }

  /** Returns a 0-1 amplitude reading driven by the live output FFT. */
  getAmplitude(): number {
    if (!this.analyser || !this.freqBuf) return 0;
    this.analyser.getByteFrequencyData(this.freqBuf);
    const sum = this.freqBuf.reduce((s, v) => s + v * v, 0);
    return Math.sqrt(sum / this.freqBuf.length) / 255;
  }

  getAnalyser(): AnalyserNode | null {
    return this.analyser;
  }

  destroy(): void {
    this.ctx?.close();
    this.ctx = null;
    this.analyser = null;
    this.gain = null;
    this.freqBuf = null;
  }
}
