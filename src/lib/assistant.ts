export type AssistantState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'error';
export type Message = { id: string; role: 'user' | 'assistant'; content: string; time: number; preview?: boolean };
export type Preferences = { voice: boolean; wake: boolean; language: 'en-IN' | 'hi-IN'; preview: boolean; apiBase: string; motion: boolean };
export const defaultPreferences: Preferences = { voice: true, wake: false, language: 'en-IN', preview: true, apiBase: '', motion: true };
export const welcome: Message = { id: 'welcome', role: 'assistant', content: 'Hello, Boss. I’m Aanya.\n\nA little clarity, a fresh perspective, or your next big idea. I’m here for all of it.\n\nWhat’s on your mind?', time: Date.now() };

export function loadPreferences(): Preferences {
  try { return { ...defaultPreferences, ...JSON.parse(localStorage.getItem('aanya.preferences') || '{}') }; }
  catch { return defaultPreferences; }
}
export function loadMessages(): Message[] {
  try {
    const messages = JSON.parse(localStorage.getItem('aanya.messages') || 'null');
    if (Array.isArray(messages) && messages.every(m => typeof m.id === 'string' && typeof m.content === 'string' && ['assistant', 'user'].includes(m.role))) return messages.length ? messages : [welcome];
  } catch { /* Storage may be unavailable in private browsing. */ }
  return [welcome];
}
export function normalizeWakeWord(text: string): { detected: boolean; command: string } {
  const match = text.match(/^(?:hey|hi|hello|हे|हाय)\s*[,.!]?\s*(?:aanya|anya|ania|aaniya|anaya|आन्या|आनिया|अन्या)\b[\s,.!?]*/i) || text.match(/^(?:हे|हाय)\s*(?:आन्या|आनिया|अन्या)[\s,.!?]*/);
  return { detected: Boolean(match), command: match ? text.slice(match[0].length).trim() : text.trim() };
}

export interface Recognition {
  lang: string; continuous: boolean; interimResults: boolean;
  onresult: ((event: { resultIndex: number; results: { length: number; [n: number]: { isFinal: boolean; [n: number]: { transcript: string } } } }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void; stop(): void; abort(): void;
}
export function createRecognition(): Recognition | null {
  const scope = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  const Constructor = scope.SpeechRecognition || scope.webkitSpeechRecognition;
  return Constructor ? new Constructor() : null;
}

export async function streamChat(messages: Message[], base: string, signal: AbortSignal, onDelta: (text: string) => void) {
  const response = await fetch(`${base.replace(/\/$/, '')}/api/chat`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, signal,
    body: JSON.stringify({ messages: messages.filter(m => m.id !== 'welcome' && m.content.trim()).slice(-40).map(({ role, content }) => ({ role, content })) }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || 'The AI server is unavailable. Check your server connection in Settings.');
  }
  if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream')) throw new Error('No AI server is connected at this address. Open Settings to connect your existing Aanya backend, or use Preview mode.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '', received = false, completed = false;
  const process = (event: string) => {
    const data = event.split(/\r?\n/).filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).join('\n');
    if (!data || data === '[DONE]') { if (data) completed = true; return; }
    const parsed = JSON.parse(data);
    if (parsed.error) throw new Error(typeof parsed.error === 'string' ? parsed.error : 'The AI stream encountered an error.');
    if (parsed.done) completed = true;
    if (typeof parsed.delta === 'string') { received = true; onDelta(parsed.delta); }
  };
  try {
    while (!completed) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let match: RegExpMatchArray | null;
      while ((match = buffer.match(/\r?\n\r?\n/))) {
        const index = match.index!;
        process(buffer.slice(0, index));
        buffer = buffer.slice(index + match[0].length);
      }
      if (done) { if (buffer.trim()) process(buffer); break; }
    }
    if (!received && !signal.aborted) throw new Error('Aanya received an empty response. Please try again.');
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}

export function takeSentences(buffer: string): { sentences: string[]; rest: string } {
  const sentences: string[] = [];
  let cursor = 0;
  const pattern = /[.!?।]+[”"']*(?=\s|$)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(buffer))) {
    const candidate = buffer.slice(cursor, pattern.lastIndex).trim();
    if (/\b(?:Mr|Mrs|Ms|Dr|Prof|St|vs|etc)\.$/i.test(candidate) || (match[0] === '.' && /\d/.test(buffer[match.index - 1] || '') && /\d/.test(buffer[pattern.lastIndex] || ''))) continue;
    if (candidate) sentences.push(candidate);
    cursor = pattern.lastIndex;
  }
  return { sentences, rest: buffer.slice(cursor) };
}

export class VoiceQueue {
  private context: AudioContext | null = null;
  private source: AudioBufferSourceNode | null = null;
  private pending: string[] = [];
  private controller: AbortController | null = null;
  private generation = 0;
  private running = false;
  private finishAudio: (() => void) | null = null;
  private settings = defaultPreferences;
  constructor(private onSpeaking: (value: boolean) => void, private onError: (message: string) => void) {}
  configure(settings: Preferences) { this.settings = settings; }
  async unlock() {
    if (this.settings.preview) return;
    try { this.context ||= new AudioContext(); if (this.context.state === 'suspended') await this.context.resume(); }
    catch { this.onError('Audio is not available in this browser. Text replies will still work.'); }
  }
  enqueue(text: string) {
    if (!this.settings.voice || !text.trim()) return;
    this.pending.push(text.trim());
    if (!this.running) void this.drain();
  }
  private async drain() {
    this.running = true;
    const generation = this.generation;
    while (this.pending.length && generation === this.generation) {
      const text = this.pending.shift()!;
      try {
        if (this.settings.preview) {
          if (!('speechSynthesis' in window)) throw new Error('Your browser does not support preview speech. Live Gemini voice is available with a connected server.');
          await new Promise<void>((resolve, reject) => {
            const utterance = new SpeechSynthesisUtterance(text);
            utterance.lang = this.settings.language; utterance.rate = 1; utterance.pitch = 1.05;
            const voice = speechSynthesis.getVoices().find(v => v.lang === this.settings.language);
            if (voice) utterance.voice = voice;
            this.finishAudio = resolve;
            utterance.onstart = () => { if (generation === this.generation) this.onSpeaking(true); };
            utterance.onend = () => resolve();
            utterance.onerror = e => e.error === 'interrupted' || e.error === 'canceled' ? resolve() : reject(new Error('Preview voice could not play. You can continue with text.'));
            speechSynthesis.speak(utterance);
          });
        } else {
          this.controller = new AbortController();
          const response = await fetch(`${this.settings.apiBase.replace(/\/$/, '')}/api/tts`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: this.controller.signal, body: JSON.stringify({ text, voice: 'Leda' }) });
          if (!response.ok || !response.headers.get('content-type')?.startsWith('audio/')) throw new Error('Gemini voice is unavailable. Your text conversation is still active.');
          const bytes = await response.arrayBuffer();
          if (generation !== this.generation) return;
          this.context ||= new AudioContext();
          const audio = await this.context.decodeAudioData(bytes);
          if (generation !== this.generation) return;
          if (this.context.state === 'suspended') {
            await this.context.resume();
            if (this.context.state === 'suspended') throw new Error('Tap the sound control to enable audio playback.');
          }
          await new Promise<void>(resolve => {
            const source = this.context!.createBufferSource();
            this.source = source; this.finishAudio = resolve;
            source.buffer = audio; source.connect(this.context!.destination);
            source.onended = () => { source.disconnect(); resolve(); };
            this.onSpeaking(true); source.start();
          });
        }
      } catch (error) {
        if (generation === this.generation && !(error instanceof DOMException && error.name === 'AbortError')) this.onError(error instanceof Error ? error.message : 'Audio playback failed.');
      }
      if (generation === this.generation) this.onSpeaking(false);
    }
    if (generation === this.generation) { this.running = false; this.finishAudio = null; }
  }
  cancel() {
    this.generation++; this.pending = []; this.running = false;
    this.controller?.abort(); this.controller = null;
    if (this.source) { try { this.source.stop(); this.source.disconnect(); } catch { /* Already ended. */ } this.source = null; }
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    this.finishAudio?.(); this.finishAudio = null; this.onSpeaking(false);
  }
  dispose() { this.cancel(); void this.context?.close().catch(() => undefined); this.context = null; }
}

export function previewReply(text: string): string {
  const command = text.toLowerCase();
  if (/plan|day|productive|schedule/.test(command)) return 'Let’s make room for what matters, Boss.\n\n01  Pick your one essential task.\nChoose the thing that will make today feel like a win.\n\n02  Protect a little focus time.\nGive it 45 distraction-free minutes, then take a short break.\n\n03  Leave space to recharge.\nA walk, a good meal, a moment that’s just yours.\n\nWhat’s the first thing you’d like to make progress on?';
  if (/inspir|idea|creativ/.test(command)) return 'Here’s a thought, Boss: you don’t need the whole path figured out to take the next step.\n\nTry a small creative reset. Notice one everyday frustration, imagine a better way, and sketch the simplest version in five minutes. Great ideas often start with a better question.\n\nWhat would you love to create?';
  if (/weather/.test(command)) return 'I don’t have live weather in this preview, Boss. Open Quick actions → Google and search “weather near me” for a current forecast.\n\nConnect your existing AI server in Settings to enable live conversations. Live location and weather still require a supported data source.';
  if (/who|your name|hello|hey|hi\b/.test(command)) return 'Hello, Boss. I’m Aanya, your personal AI companion. I’m here to help you think clearly, explore ideas, and make everyday tasks feel a little lighter.\n\nYou’re trying the interface preview right now. Connect your existing NVIDIA and Gemini server in Settings for live intelligence and my Leda voice.\n\nWhere shall we begin?';
  if (/search|youtube|map|open|call|email/.test(command)) return 'I can help you get there, Boss. Use Quick actions to search Google, open YouTube or Maps, place a call, or draft an email. You stay in control: external actions only open after your confirmation.\n\nThis preview doesn’t make live AI requests. Connect your server in Settings for a full conversation.';
  return 'I’m with you, Boss. A good place to start is to break this into one clear goal, one small next step, and what you need to get there.\n\nThis is a sample response from the interface preview, not a live AI answer. Your existing NVIDIA brain and Gemini voice can be connected in Settings without putting API keys in the browser.\n\nTry “Plan my day” to explore the experience, or open Quick actions to do something useful right now.';
}

export async function streamPreview(text: string, signal: AbortSignal, onDelta: (text: string) => void) {
  const words = previewReply(text).match(/\S+\s*/g) || [];
  for (const word of words) {
    if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    await new Promise<void>((resolve, reject) => {
      const onAbort = () => { clearTimeout(timer); reject(new DOMException('Cancelled', 'AbortError')); };
      const timer = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve(); }, 30);
      signal.addEventListener('abort', onAbort, { once: true });
    });
    onDelta(word);
  }
      }
