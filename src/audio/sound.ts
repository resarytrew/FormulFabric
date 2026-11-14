class SoundEngine {
  private ctx: AudioContext | null = null;
  public muted = false;

  private ensureCtx(): AudioContext | null {
    if (this.muted) return null;
    if (!this.ctx && typeof window !== 'undefined') {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  private playTone(
    freq: number,
    duration: number,
    type: OscillatorType = 'triangle',
    gainVal = 0.08,
    endFreq?: number,
  ) {
    const ctx = this.ensureCtx();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    if (endFreq !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), now + duration);
    }
    gain.gain.setValueAtTime(gainVal, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + duration);
  }

  playPlace() {
    this.playTone(320, 0.09, 'triangle', 0.09, 480);
  }

  playRemove() {
    this.playTone(260, 0.08, 'sine', 0.07, 150);
  }

  playRotate() {
    this.playTone(420, 0.06, 'sine', 0.06, 540);
  }

  playStep() {
    this.playTone(180 + Math.random() * 25, 0.045, 'triangle', 0.035, 140);
  }

  playTransform() {
    this.playTone(520, 0.1, 'sine', 0.06, 680);
  }

  playWeld() {
    this.playTone(240, 0.12, 'sawtooth', 0.05, 640);
  }

  playDeliver() {
    const ctx = this.ensureCtx();
    if (!ctx) return;
    this.playTone(523.25, 0.14, 'triangle', 0.08, 659.25);
    setTimeout(() => this.playTone(783.99, 0.18, 'triangle', 0.08), 75);
  }

  playError() {
    this.playTone(170, 0.24, 'sawtooth', 0.08, 95);
  }

  playDestroy() {
    this.playTone(300, 0.14, 'sawtooth', 0.06, 90);
  }

  playVictory() {
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((n, idx) => {
      setTimeout(() => this.playTone(n, 0.25, 'triangle', 0.09), idx * 90);
    });
  }
}

export const sound = new SoundEngine();
