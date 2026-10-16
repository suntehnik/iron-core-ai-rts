import { AI_TARIFFS } from '../config/tariffs';
import { SPEECH_LOCALE, getLanguage } from '../i18n';

export interface ASRResult {
  text: string;
  isFinal: boolean;
  /** seconds of speech captured so far (billed as ASR on the final result) */
  seconds: number;
}

/**
 * Browser speech services. ASR and TTS are billed as separate services (brief §10),
 * so we measure recognised-speech and synthesised-speech durations.
 */
export class VoiceService {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private recognition: any = null;
  private listening = false;
  private startedAt = 0;
  private onResult: ((r: ASRResult) => void) | null = null;
  private onError: ((error: string) => void) | null = null;
  private onEnd: (() => void) | null = null;

  constructor() {
    if (typeof window === 'undefined') return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    const SpeechRecognition = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    this.recognition = new SpeechRecognition();
    this.recognition.continuous = false;
    this.recognition.interimResults = true;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.recognition.onresult = (event: any) => {
      let interim = '';
      let final = '';
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) final += event.results[i][0].transcript;
        else interim += event.results[i][0].transcript;
      }
      const seconds = (performance.now() - this.startedAt) / 1000;
      if (final) this.onResult?.({ text: final.trim(), isFinal: true, seconds });
      else if (interim) this.onResult?.({ text: interim.trim(), isFinal: false, seconds });
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.recognition.onerror = (event: any) => this.onError?.(String(event.error || 'error'));
    this.recognition.onend = () => {
      this.listening = false;
      this.onEnd?.();
    };
  }

  isSupported(): boolean {
    return !!this.recognition;
  }

  isListening(): boolean {
    return this.listening;
  }

  startListening(onResult: (r: ASRResult) => void, onError?: (e: string) => void, onEnd?: () => void) {
    if (!this.recognition || this.listening) return;
    this.onResult = onResult;
    this.onError = onError || null;
    this.onEnd = onEnd || null;
    try {
      this.recognition.lang = SPEECH_LOCALE[getLanguage()];
      this.recognition.start();
      this.listening = true;
      this.startedAt = performance.now();
    } catch (e) {
      console.warn('Speech recognition start failed:', e);
    }
  }

  stopListening() {
    if (!this.recognition || !this.listening) return;
    try {
      this.recognition.stop();
    } catch {
      /* ignore */
    }
    this.listening = false;
  }

  static estimateSpeechSeconds(text: string): number {
    return Math.max(0.6, text.length / AI_TARIFFS.TTS_CHARS_PER_SEC);
  }

  /** Speaks text; reports the real synthesised duration when playback ends. */
  speak(text: string, onEnd?: (seconds: number) => void): boolean {
    if (typeof window === 'undefined' || !window.speechSynthesis) return false;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    const lang = getLanguage();
    utterance.lang = SPEECH_LOCALE[lang];
    utterance.rate = 1.08;
    utterance.pitch = 0.95;
    const voice = window.speechSynthesis.getVoices().find(v => v.lang.toLowerCase().startsWith(lang));
    if (voice) utterance.voice = voice;
    let started = 0;
    utterance.onstart = () => {
      started = performance.now();
    };
    const finish = () => {
      const seconds = started ? (performance.now() - started) / 1000 : VoiceService.estimateSpeechSeconds(text);
      onEnd?.(seconds);
    };
    utterance.onend = finish;
    utterance.onerror = finish;
    window.speechSynthesis.speak(utterance);
    return true;
  }

  stopSpeaking() {
    if (typeof window !== 'undefined' && window.speechSynthesis) window.speechSynthesis.cancel();
  }
}

export const voiceService = new VoiceService();
