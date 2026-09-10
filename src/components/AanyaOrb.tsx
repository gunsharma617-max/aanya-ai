import type { AssistantState } from '../lib/assistant';

export default function AanyaOrb({ state, motion, onActivate }: { state: AssistantState; motion: boolean; onActivate: () => void }) {
  return <button className={`orb-stage state-${state} ${!motion ? 'motion-off' : ''}`} aria-label={state === 'listening' ? 'Stop listening' : 'Talk to Aanya'} onClick={onActivate}>
    <span className="orb-atmosphere" />
    <span className="orb-coordinate coordinate-top">NEURAL CORE / 01</span>
    <span className="orb-coordinate coordinate-left">28.6139° N</span>
    <span className="orb-coordinate coordinate-right">77.2090° E</span>
    <span className="orbit orbit-outer" />
    <span className="orbit orbit-dashed" />
    <span className="orb-cross cross-top" /><span className="orb-cross cross-bottom" /><span className="orb-cross cross-left" /><span className="orb-cross cross-right" />
    <span className="orb-visual"><img src="/images/aanya-core.png" alt="A luminous dimensional cyan glass sphere filled with flowing energy" draggable="false" /><span className="orb-core-light" /><span className="orb-shell" /></span>
    <svg className="orb-orbits" viewBox="0 0 540 450" fill="none" aria-hidden="true">
      <defs><linearGradient id="ringGradient"><stop stopColor="#29dcea" stopOpacity=".04" /><stop offset=".4" stopColor="#81f6ff" stopOpacity=".7" /><stop offset=".7" stopColor="#47d6ef" stopOpacity=".3" /><stop offset="1" stopColor="#29dcea" stopOpacity=".03" /></linearGradient></defs>
      <ellipse cx="270" cy="232" rx="219" ry="70" transform="rotate(-24 270 232)" stroke="url(#ringGradient)" strokeWidth="1" />
      <ellipse cx="270" cy="232" rx="229" ry="77" transform="rotate(-24 270 232)" stroke="#4cd4ed" strokeOpacity=".16" strokeWidth=".5" />
      <ellipse cx="270" cy="232" rx="205" ry="64" transform="rotate(37 270 232)" stroke="url(#ringGradient)" strokeWidth=".65" />
      <ellipse cx="270" cy="232" rx="174" ry="190" transform="rotate(-24 270 232)" stroke="#69eaff" strokeOpacity=".07" strokeDasharray="2 7" />
      <circle cx="80" cy="320" r="2.5" fill="#b1f8ff" /><circle cx="444" cy="143" r="2" fill="#6cdeee" />
    </svg>
    <span className="energy-wave wave-one" /><span className="energy-wave wave-two" />
    {Array.from({ length: 12 }, (_, i) => <span key={i} className={`orb-particle particle-${i}`} style={{ '--i': i } as React.CSSProperties} />)}
    <span className="orb-ground" />
    <span className="orb-coordinate coordinate-bottom">AANYA INTELLIGENCE ENGINE</span>
  </button>;
}
