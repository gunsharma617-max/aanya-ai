import { useEffect, useRef, useState } from 'react';
import { createRecognition, loadMessages, loadPreferences, normalizeWakeWord, streamChat, streamPreview, takeSentences, VoiceQueue, welcome, type AssistantState, type Message, type Preferences, type Recognition } from './assistant';

export function useAssistant() {
  const [messages, setMessages] = useState<Message[]>(loadMessages);
  const [preferences, setPreferences] = useState<Preferences>(loadPreferences);
  const [phase, setPhase] = useState<AssistantState>('idle');
  const [speaking, setSpeaking] = useState(false);
  const [interim, setInterim] = useState('');
  const [error, setError] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [wakeActive, setWakeActive] = useState(false);
  const [connected, setConnected] = useState(false);
  const prefsRef = useRef(preferences);
  const messagesRef = useRef(messages);
  const abortRef = useRef<AbortController | null>(null);
  const recognitionRef = useRef<Recognition | null>(null);
  const queueRef = useRef<VoiceQueue | null>(null);
  const requestId = useRef(0);
  const wakeRef = useRef(false);
  const restartTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);
  const sendRef = useRef<(text: string) => void>(() => undefined);
  const listenRef = useRef<(wake?: boolean) => void>(() => undefined);
  prefsRef.current = preferences;
  messagesRef.current = messages;
  if (!queueRef.current) queueRef.current = new VoiceQueue(value => { if (alive.current) setSpeaking(value); }, message => { if (alive.current) setError(message); });
  queueRef.current.configure(preferences);

  useEffect(() => { try { localStorage.setItem('aanya.preferences', JSON.stringify(preferences)); } catch { /* Optional persistence. */ } if (!preferences.voice) queueRef.current?.cancel(); }, [preferences]);
  useEffect(() => {
    const timer = setTimeout(() => { try { localStorage.setItem('aanya.messages', JSON.stringify(messages.slice(-80))); } catch { /* Optional persistence. */ } }, 350);
    return () => clearTimeout(timer);
  }, [messages]);
  useEffect(() => {
    alive.current = true;
    const suspend = () => { if (document.hidden) { stopRecognition(); interrupt(); } };
    document.addEventListener('visibilitychange', suspend);
    return () => {
      alive.current = false; requestId.current++; abortRef.current?.abort();
      stopRecognition(); queueRef.current?.dispose();
      document.removeEventListener('visibilitychange', suspend);
    };
  }, []);

  function stopRecognition() {
    wakeRef.current = false;
    if (alive.current) setWakeActive(false);
    if (restartTimer.current) clearTimeout(restartTimer.current);
    restartTimer.current = null;
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    if (recognition) { recognition.onend = null; recognition.onresult = null; recognition.onerror = null; try { recognition.abort(); } catch { /* Not running. */ } }
    if (alive.current) setInterim('');
  }

  function interrupt() {
    requestId.current++; abortRef.current?.abort(); abortRef.current = null;
    queueRef.current?.cancel();
    if (alive.current) { setStreaming(false); setPhase('idle'); }
  }

  async function send(text: string) {
    const clean = text.trim().slice(0, 8000);
    if (!clean) return;
    stopRecognition(); interrupt(); setError('');
    const id = ++requestId.current;
    const user: Message = { id: crypto.randomUUID(), role: 'user', content: clean, time: Date.now() };
    const answer: Message = { id: crypto.randomUUID(), role: 'assistant', content: '', time: Date.now(), preview: prefsRef.current.preview };
    const history = [...messagesRef.current, user];
    messagesRef.current = [...history, answer]; setMessages(messagesRef.current);
    setPhase('thinking'); setStreaming(true);
    const controller = new AbortController(); abortRef.current = controller;
    const settings = { ...prefsRef.current };
    void queueRef.current?.unlock();
    let sentenceBuffer = '';
    const onDelta = (delta: string) => {
      if (id !== requestId.current || !alive.current) return;
      if (!settings.preview) setConnected(true);
      setMessages(prev => prev.map(m => m.id === answer.id ? { ...m, content: m.content + delta } : m));
      sentenceBuffer += delta;
      const { sentences, rest } = takeSentences(sentenceBuffer); sentenceBuffer = rest;
      sentences.forEach(sentence => queueRef.current?.enqueue(sentence));
    };
    try {
      if (settings.preview) await streamPreview(clean, controller.signal, onDelta);
      else await streamChat(history, settings.apiBase, controller.signal, onDelta);
      if (id !== requestId.current || !alive.current) return;
      if (sentenceBuffer.trim()) queueRef.current?.enqueue(sentenceBuffer);
      setPhase('idle');
    } catch (e) {
      if (id !== requestId.current || !alive.current || controller.signal.aborted) return;
      setError(e instanceof Error ? e.message : 'Something interrupted the connection. Please try again.');
      setPhase('error'); setConnected(false); queueRef.current?.cancel();
      setMessages(prev => prev.filter(m => m.id !== answer.id || m.content));
    } finally {
      if (id === requestId.current && alive.current) { setStreaming(false); abortRef.current = null; }
    }
  }
  sendRef.current = send;

  function listen(wakeOnly = false) {
    stopRecognition(); interrupt(); setError('');
    const recognition = createRecognition();
    if (!recognition) { setError('Voice input isn’t supported in this browser. Try Chrome on Android, or type your message below.'); setPhase('error'); return; }
    recognitionRef.current = recognition;
    recognition.lang = prefsRef.current.language;
    recognition.continuous = true; recognition.interimResults = true;
    wakeRef.current = wakeOnly; setWakeActive(wakeOnly);
    setPhase(wakeOnly ? 'idle' : 'listening');
    let awaitingCommand = !wakeOnly;
    recognition.onresult = event => {
      let interimText = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]; const text = result[0].transcript.trim();
        if (!result.isFinal) { interimText += text; continue; }
        const normalized = normalizeWakeWord(text);
        if (!awaitingCommand && !normalized.detected) continue;
        if (normalized.detected) { awaitingCommand = true; setPhase('listening'); if ('vibrate' in navigator) navigator.vibrate(40); }
        if (normalized.command) { sendRef.current(normalized.command); return; }
        setInterim('I’m listening. What’s on your mind?');
      }
      if (interimText && (awaitingCommand || normalizeWakeWord(interimText).detected)) setInterim(interimText);
    };
    recognition.onerror = event => {
      if (event.error === 'aborted') return;
      if (event.error === 'no-speech') { if (!wakeRef.current) { setPhase('idle'); setInterim(''); } return; }
      const errors: Record<string, string> = {
        'not-allowed': 'Microphone access was denied. Allow microphone access in your browser’s site settings, then try again.',
        'audio-capture': 'No microphone was found. Connect a microphone or type your message.',
        network: 'Speech recognition needs a network connection. Check your connection or use the keyboard.',
        'service-not-allowed': 'This browser cannot access speech recognition. Try Chrome or use text input.',
      };
      stopRecognition(); setError(errors[event.error] || 'Microphone input stopped. Tap the microphone to try again.'); setPhase('error');
    };
    recognition.onend = () => {
      if (!alive.current || recognitionRef.current !== recognition) return;
      if (wakeRef.current && !document.hidden) {
        restartTimer.current = setTimeout(() => { if (wakeRef.current && !document.hidden) { try { recognition.start(); } catch { stopRecognition(); setPhase('idle'); } } }, 600);
      } else { recognitionRef.current = null; setPhase('idle'); setInterim(''); }
    };
    try { recognition.start(); void queueRef.current?.unlock(); }
    catch { stopRecognition(); setError('Couldn’t start the microphone. Use HTTPS and check your microphone permission.'); setPhase('error'); }
  }
  listenRef.current = listen;

  function toggleMic() {
    if (phase === 'listening' || wakeActive) {
      const recognition = recognitionRef.current;
      wakeRef.current = false; setWakeActive(false);
      try { recognition?.stop(); } catch { stopRecognition(); }
      setPhase('idle'); setInterim('');
    } else listen();
  }
  function updatePreferences(update: Partial<Preferences>) {
    if (update.preview !== undefined || update.apiBase !== undefined || update.language !== undefined) { stopRecognition(); interrupt(); setConnected(false); }
    setPreferences(prev => ({ ...prev, ...update }));
    if (update.wake !== undefined) {
      if (update.wake) listen(true);
      else { stopRecognition(); setPhase('idle'); }
    }
  }
  function clearConversation() { stopRecognition(); interrupt(); setMessages([{ ...welcome, time: Date.now() }]); messagesRef.current = [welcome]; setError(''); }
  function dismissError() { setError(''); if (phase === 'error') setPhase('idle'); }
  function toggleVoice() { const enabled = !preferences.voice; updatePreferences({ voice: enabled }); if (enabled) void queueRef.current?.unlock(); }

  return { messages, preferences, state: (phase === 'listening' || phase === 'error' ? phase : speaking ? 'speaking' : phase) as AssistantState, error, interim, streaming, wakeActive, connected, send, listen, toggleMic, interrupt, updatePreferences, clearConversation, dismissError, toggleVoice };
}
