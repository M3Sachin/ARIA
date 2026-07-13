export interface AudioCaptureCallbacks {
  onPCMData: (pcm: ArrayBuffer) => void;
  onAmplitude: (rms: number) => void;
}

export class AudioCapture {
  private ctx: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private worklet: AudioWorkletNode | null = null;
  private analyser: AnalyserNode | null = null;
  private stream: MediaStream | null = null;
  private rafId: number | null = null;
  private freqBuf: Uint8Array<ArrayBuffer> | null = null;

  async start(callbacks: AudioCaptureCallbacks): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    // Use the browser's native rate; the worklet handles downsampling.
    this.ctx = new AudioContext();
    await this.ctx.audioWorklet.addModule("/worklets/pcm-processor.js");

    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 256;
    this.freqBuf = new Uint8Array(this.analyser.frequencyBinCount);

    this.source = this.ctx.createMediaStreamSource(this.stream);
    this.worklet = new AudioWorkletNode(this.ctx, "pcm-processor", {
      processorOptions: {
        inputSampleRate: this.ctx.sampleRate,
        outputSampleRate: 16000,
      },
    });

    this.worklet.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
      callbacks.onPCMData(e.data);
    };

    this.source.connect(this.analyser);
    this.source.connect(this.worklet);
    // Do NOT connect worklet to destination — no mic echo.

    const tick = () => {
      if (!this.analyser || !this.freqBuf) return;
      this.analyser.getByteFrequencyData(this.freqBuf);
      const sum = this.freqBuf.reduce((s, v) => s + v * v, 0);
      const rms = Math.sqrt(sum / this.freqBuf.length) / 255;
      callbacks.onAmplitude(rms);
      this.rafId = requestAnimationFrame(tick);
    };
    tick();
  }

  stop(): void {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.source?.disconnect();
    this.worklet?.disconnect();
    this.analyser?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.ctx?.close();
    this.ctx = null;
    this.source = null;
    this.worklet = null;
    this.analyser = null;
    this.stream = null;
    this.freqBuf = null;
    this.rafId = null;
  }

  getAnalyser(): AnalyserNode | null {
    return this.analyser;
  }
}
