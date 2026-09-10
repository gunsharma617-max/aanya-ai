import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Activity, ArrowDownToLine, ArrowLeft, ArrowRight, ArrowUp, ArrowUpRight, AudioLines, Bell, Check, ChevronDown, ChevronRight, CircleHelp, Clock3, Copy, Ellipsis, Expand, ExternalLink, Globe2, History, Keyboard, Layers3, Mail, MapPin, Maximize2, MessageSquare, Mic, MicOff, Orbit, Phone, Plus, Radio, Search, Settings2, Share2, ShieldCheck, Sparkles, Square, Trash2, Volume2, VolumeX, X, Play as Youtube, Zap, Camera, Smartphone } from 'lucide-react';
import AanyaOrb from './components/AanyaOrb';
import { useAssistant } from './lib/useAssistant';
import { browserActions, executeAction, type ActionId } from './lib/actions';
import type { Preferences } from './lib/assistant';

type Panel = 'settings' | 'actions' | 'history' | 'help' | null;
const actionIcons: Record<ActionId, typeof Search> = { google: Search, youtube: Youtube, maps: MapPin, phone: Phone, email: Mail, share: Share2, clipboard: Copy, vibrate: Smartphone, fullscreen: Expand, notifications: Bell, camera: Camera };
const stateCopy = { idle: 'Ready when you are', listening: 'Listening to you', thinking: 'Connecting the dots', speaking: 'A thought, just for you', error: 'Let’s reconnect' };

function BrandMark({ small = false }: { small?: boolean }) {
  return <span className={`brand-mark ${small ? 'brand-mark-small' : ''}`} aria-hidden="true"><svg viewBox="0 0 36 36" fill="none"><path d="M18 5 31 29H5L18 5Z" stroke="currentColor" strokeWidth="1.4" /><path d="m18 13 8 16M18 13l-8 16M13 23h10" stroke="currentColor" strokeWidth="1.4" /><path d="M18 1v4M33 30l-3-1M3 30l3-1" stroke="currentColor" /></svg></span>;
}
function Toggle({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} className={`toggle ${checked ? 'on' : ''}`} onClick={onChange}><span /></button>;
}
function Modal({ title, subtitle, children, onClose, wide = false }: { title: string; subtitle?: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose); closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const oldOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
    ref.current?.focus();
    const handle = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current();
      if (e.key === 'Tab') {
        const nodes = ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input, select, textarea, a[href], [tabindex="0"]');
        if (!nodes?.length) return;
        const first = nodes[0], last = nodes[nodes.length - 1];
        if (e.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', handle);
    return () => { document.body.style.overflow = oldOverflow; document.removeEventListener('keydown', handle); previous?.focus(); };
  }, []);
  return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}><div className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby="modal-title" tabIndex={-1} ref={ref}><header className="modal-heading"><div><div className="eyebrow">YOUR AANYA EXPERIENCE</div><h2 id="modal-title">{title}</h2>{subtitle && <p>{subtitle}</p>}</div><button className="icon-button" aria-label="Close dialog" onClick={onClose}><X size={20} /></button></header><div className="modal-body">{children}</div></div></div>;
}

export default function App() {
  const assistant = useAssistant();
  const { messages, preferences, state, error, interim, streaming, wakeActive, connected } = assistant;
  const [panel, setPanel] = useState<Panel>(null);
  const [input, setInput] = useState('');
  const [action, setAction] = useState<ActionId | null>(null);
  const [actionInput, setActionInput] = useState('');
  const [actionResult, setActionResult] = useState('');
  const [actionError, setActionError] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [toast, setToast] = useState('');
  const [menu, setMenu] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [mobileChat, setMobileChat] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [settingsTab, setSettingsTab] = useState<'general' | 'connection'>('general');
  const [apiBase, setApiBase] = useState(preferences.apiBase);
  const [historyQuery, setHistoryQuery] = useState('');
  const [time, setTime] = useState(new Date());
  const inputRef = useRef<HTMLInputElement>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const autoScroll = useRef(true);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const active = streaming || state === 'speaking';

  useEffect(() => { const timer = setInterval(() => setTime(new Date()), 30000); return () => clearInterval(timer); }, []);
  useEffect(() => { if (autoScroll.current && transcriptRef.current) transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight; }, [messages, mobileChat]);
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);
  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); setPanel(null); inputRef.current?.focus(); }
      if (e.key === 'Escape') { setMenu(false); if (expanded) setExpanded(false); if (mobileChat) setMobileChat(false); }
    };
    window.addEventListener('keydown', handle); return () => window.removeEventListener('keydown', handle);
  }, [expanded, mobileChat]);

  function notify(message: string) { setToast(message); if (toastTimer.current) clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(''), 4200); }
  function send(text: string) { if (!text.trim()) return; autoScroll.current = true; void assistant.send(text); setInput(''); }
  function openPanel(next: Panel) { setPanel(next); setAction(null); setActionInput(''); setActionResult(''); setConfirmClear(false); setMenu(false); }
  function chooseAction(id: ActionId) { setAction(id); setActionInput(id === 'clipboard' ? location.href : ''); setActionResult(''); setActionError(false); }
  async function runAction() {
    if (!action) return; setActionBusy(true); setActionResult('');
    try { setActionResult(await executeAction(action, actionInput)); setActionError(false); }
    catch (e) { setActionError(true); setActionResult(e instanceof Error ? e.message : 'This action is unavailable on your device.'); }
    finally { setActionBusy(false); }
  }
  function exportChat() {
    const content = messages.map(m => `${m.role === 'assistant' ? 'AANYA' : 'YOU'}${m.preview ? ' (preview)' : ''}\n${m.content}\n`).join('\n');
    const blob = new Blob([content], { type: 'text/plain' }); const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url; link.download = `aanya-conversation-${new Date().toISOString().slice(0, 10)}.txt`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000); setMenu(false); notify('Your conversation has been exported.');
  }
  async function copyMessage(content: string) { try { await navigator.clipboard.writeText(content); notify('Copied to your clipboard.'); } catch { notify('Clipboard is unavailable. Select the text to copy it.'); } }
  function saveConnection() {
    const value = apiBase.trim().replace(/\/$/, '');
    try {
      if (value) { const url = new URL(value); if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) throw new Error(); if (url.username || url.password || url.search || url.hash) throw new Error(); }
      assistant.updatePreferences({ apiBase: value, preview: false }); notify('Server address saved. Your next message will use live AI.'); setPanel(null);
    } catch { notify('Use a valid HTTPS server URL without credentials, query parameters, or fragments.'); }
  }
  const selectedAction = browserActions.find(a => a.id === action);
  const historyMessages = messages.filter(m => m.id !== 'welcome' && m.role === 'user' && m.content.toLowerCase().includes(historyQuery.toLowerCase()));

  const conversation = <>
    <div className="conversation-heading"><div className="conversation-title"><MessageSquare size={17} /><h2>Conversation</h2><span className="small-dot" /></div><div className="conversation-tools"><button className="icon-button" aria-label={expanded ? 'Collapse conversation' : 'Expand conversation'} onClick={() => setExpanded(!expanded)}><Maximize2 size={15} /></button><div className="menu-anchor"><button className="icon-button" aria-label="Conversation options" aria-expanded={menu} onClick={() => setMenu(!menu)}><Ellipsis size={19} /></button>{menu && <div className="popover"><button onClick={exportChat}><ArrowDownToLine size={15} /> Export conversation</button><button onClick={() => { setConfirmClear(true); setMenu(false); }}><Trash2 size={15} /> Clear conversation</button></div>}</div><button className="icon-button mobile-close" aria-label="Close conversation" onClick={() => { setMobileChat(false); setExpanded(false); }}><X size={18} /></button></div></div>
    <div className="session-line"><span><span className="live-dot" /> {preferences.preview ? 'PREVIEW SESSION' : connected ? 'LIVE SESSION' : 'NEW SESSION'}</span><span>Just you & Aanya</span></div>
    <div className="transcript" ref={transcriptRef} onScroll={() => { const el = transcriptRef.current; if (el) autoScroll.current = el.scrollHeight - el.scrollTop - el.clientHeight < 70; }} aria-label="Conversation messages" role="log" aria-live="polite" aria-relevant="additions text">
      <div className="date-divider"><span />Today<span /></div>
      {messages.map((message, index) => <article key={message.id} className={`message message-${message.role}`}>
        <div className="message-meta">{message.role === 'assistant' ? <span className="mini-orb"><img src="/images/aanya-core.png" alt="" /></span> : <span className="user-avatar-small">YOU</span>}<span>{message.role === 'assistant' ? 'Aanya' : 'You'}</span>{message.preview && <small>PREVIEW</small>}<time>{new Date(message.time).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false })}</time></div>
        <div className="message-content">{message.content || <span className="typing-dots"><i /><i /><i /></span>}{streaming && index === messages.length - 1 && message.content && <span className="stream-cursor" />}</div>
        {message.role === 'assistant' && message.content && message.id !== 'welcome' && <button className="copy-message" aria-label="Copy Aanya’s response" onClick={() => void copyMessage(message.content)}><Copy size={12} /><span>Copy</span></button>}
      </article>)}
      {messages.length === 1 && <div className="conversation-suggestions"><span>A LITTLE INSPIRATION</span><button onClick={() => send('What can you do?')}>What can you do?<ArrowUpRight size={14} /></button><button onClick={() => send('Give me a little inspiration')}>Let’s get inspired<ArrowUpRight size={14} /></button></div>}
    </div>
    {confirmClear && <div className="clear-confirm"><span>Clear this conversation from this device?</span><div><button className="text-button" onClick={() => setConfirmClear(false)}>Keep it</button><button className="danger-button" onClick={() => { assistant.clearConversation(); setConfirmClear(false); notify('A fresh start. Your conversation is cleared.'); }}>Clear</button></div></div>}
    <div className="conversation-bottom"><span><ShieldCheck size={13} /> Stored on this device</span><button aria-label="New conversation" onClick={() => setConfirmClear(true)}><Plus size={15} /><span>New chat</span></button></div>
  </>;

  return <div className={`app-shell ${preferences.motion ? '' : 'reduce-motion'}`}>
    <aside className="sidebar" aria-label="Main navigation">
      <button className="logo-button" aria-label="Aanya home" onClick={() => { setPanel(null); setMobileChat(false); }}><BrandMark /></button>
      <div className="nav-group"><button className={`nav-button ${!panel ? 'selected' : ''}`} aria-label="Assistant home" data-tooltip="Assistant" onClick={() => { setPanel(null); setMobileChat(false); }}><Orbit size={23} /><span /></button><button className={`nav-button ${panel === 'history' ? 'selected' : ''}`} aria-label="Conversation history" data-tooltip="History" onClick={() => openPanel('history')}><MessageSquare size={21} /></button><button className={`nav-button ${panel === 'actions' ? 'selected' : ''}`} aria-label="Quick actions" data-tooltip="Quick actions" onClick={() => openPanel('actions')}><Layers3 size={22} /></button><button className="nav-button" aria-label="Voice preferences" data-tooltip="Voice studio" onClick={() => { setSettingsTab('general'); openPanel('settings'); }}><AudioLines size={23} /></button></div>
      <div className="nav-bottom"><div className="sidebar-divider" /><button className={`nav-button ${panel === 'settings' ? 'selected' : ''}`} aria-label="Settings" data-tooltip="Settings" onClick={() => { setSettingsTab('general'); openPanel('settings'); }}><Settings2 size={21} /></button><button className={`nav-button ${panel === 'help' ? 'selected' : ''}`} aria-label="Help and information" data-tooltip="Help & info" onClick={() => openPanel('help')}><CircleHelp size={21} /></button><button className="profile-avatar" aria-label="Your preferences" onClick={() => openPanel('settings')}>GS<span /></button></div>
    </aside>

    <div className="app-main">
      <header className="topbar"><a className="wordmark" href="#" onClick={e => { e.preventDefault(); setPanel(null); setMobileChat(false); }}><span>AANYA<span className="wordmark-dot">.</span></span><span className="wordmark-sub">PERSONAL INTELLIGENCE</span></a><div className="topbar-tagline"><span />More than an assistant. A presence.</div><div className="topbar-right"><span className="system-status"><span className="live-dot" />Ready to assist</span><span className="topbar-divider" /><button className="language-button" onClick={() => { const language = preferences.language === 'en-IN' ? 'hi-IN' : 'en-IN'; assistant.updatePreferences({ language }); notify(`Voice language switched to ${language === 'en-IN' ? 'English (India)' : 'Hindi (India)'}.`); }} aria-label="Switch voice language"><Globe2 size={16} /><span>{preferences.language === 'en-IN' ? 'EN' : 'HI'}</span><ChevronDown size={12} /></button><button className="mobile-settings icon-button" aria-label="Settings" onClick={() => openPanel('settings')}><Settings2 size={19} /></button></div></header>

      <main className="workspace">
        <div className="page-heading"><div><div className="eyebrow page-eyebrow">YOUR SPACE, REIMAGINED</div><h1>My assistant<span className="title-period">.</span></h1></div><div className="workspace-date"><Clock3 size={14} /><span>{time.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}</span><span className="date-dot">·</span><span>{time.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false })}</span></div></div>
        <div className="workspace-grid">
          <section className="assistant-space" aria-label="Aanya voice assistant">
            <div className="assistant-topline"><span><span className="live-dot" />AANYA IS HERE</span><button onClick={() => { setSettingsTab('general'); openPanel('settings'); }}><AudioLines size={13} />{preferences.preview ? 'DEVICE VOICE' : 'LEDA VOICE'}<ChevronDown size={11} /></button></div>
            <div className="hero-intro"><div className="hero-kicker">A LITTLE INTELLIGENCE. LIMITLESS POSSIBILITY.</div><h2>Hello, <span>Boss.</span><span className="greeting-spark">✧</span></h2><p>Your thoughts. Your world. A little more extraordinary.</p></div>
            <AanyaOrb state={state} motion={preferences.motion} onActivate={assistant.toggleMic} />
            <div className={`state-display display-${state}`} role="status"><div className={`waveform ${state !== 'idle' ? 'waveform-active' : ''}`} aria-hidden="true">{Array.from({ length: 9 }, (_, i) => <i key={i} style={{ '--bar': i } as React.CSSProperties} />)}</div><span>{wakeActive && state === 'idle' ? 'Waiting for “Hey Aanya”' : stateCopy[state]}</span></div>
            <p className="voice-invitation">{interim || (state === 'listening' ? 'Go ahead. I’m all ears.' : state === 'speaking' ? 'Tap the mic to jump in. I’ll pause.' : state === 'thinking' ? 'Making a little room for a good answer.' : <>Tap the mic, or say <button onClick={() => { assistant.updatePreferences({ wake: true }); }}>“Hey Aanya”<ArrowUpRight size={11} /></button></>)}</p>
            <div className="quick-prompts"><button className="prompt-card" onClick={() => send('Help me plan my day')}><span className="prompt-icon"><Sparkles size={17} /></span><div><strong>Plan my day</strong><span>Make space for what matters</span></div><ArrowUpRight size={14} /></button><button className="prompt-card" onClick={() => { openPanel('actions'); chooseAction('google'); }}><span className="prompt-icon"><Globe2 size={17} /></span><div><strong>Explore anything</strong><span>Follow your curiosity</span></div><ArrowUpRight size={14} /></button><button className="prompt-card" onClick={() => openPanel('actions')}><span className="prompt-icon"><Zap size={17} /></span><div><strong>Quick actions</strong><span>A little less effort</span></div><ArrowUpRight size={14} /></button></div>
            {error && <div className="error-banner" role="alert"><Activity size={16} /><span>{error}</span><button aria-label="Dismiss error" onClick={assistant.dismissError}><X size={15} /></button></div>}
            <form className={`voice-dock ${state === 'listening' ? 'dock-listening' : ''}`} onSubmit={e => { e.preventDefault(); send(input); }}><button type="button" className={`dock-icon ${!preferences.voice ? 'muted' : ''}`} aria-label={preferences.voice ? 'Mute assistant voice' : 'Enable assistant voice'} aria-pressed={preferences.voice} onClick={assistant.toggleVoice}>{preferences.voice ? <Volume2 size={20} /> : <VolumeX size={20} />}</button><span className="dock-separator" /><Keyboard className="input-keyboard" size={18} /><input ref={inputRef} aria-label="Message Aanya" placeholder={state === 'listening' ? 'Listening to you…' : 'Ask anything. I’m here.'} value={input} onChange={e => setInput(e.target.value)} maxLength={8000} /><kbd>⌘ K</kbd>{input.trim() ? <button type="submit" className="send-button" aria-label="Send message"><ArrowUp size={22} /></button> : <button type="button" className={`mic-button ${state === 'listening' ? 'listening' : ''}`} aria-label={state === 'listening' ? 'Stop microphone' : active ? 'Interrupt and start listening' : 'Start microphone'} onClick={assistant.toggleMic}>{state === 'listening' ? <MicOff size={22} /> : <Mic size={22} />}<span /></button>}{active && <button type="button" className="stop-button" aria-label="Stop response and audio" onClick={assistant.interrupt}><Square size={14} fill="currentColor" /></button>}</form>
            <div className="dock-caption"><span><ShieldCheck size={12} />Your voice. Your control.</span><span>Built to listen. Designed to understand.</span></div>
            <button className="mobile-conversation-button" onClick={() => setMobileChat(true)}><MessageSquare size={16} />Conversation<span>{messages.length > 1 ? messages.length - 1 : 'Say hello'}</span><ArrowRight size={15} /></button>
          </section>
          <aside className={`right-column ${mobileChat ? 'mobile-chat-open' : ''} ${expanded ? 'chat-expanded' : ''}`} ar
