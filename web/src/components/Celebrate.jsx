import { useEffect } from "react";

// A short burst of confetti and a kind word after Done. Gone in ~1.4 s.
const WORDS = ["Nice!", "Done!", "Yes!", "Boom!", "Good job!", "Sorted!"];
const COLORS = ["#FF6B5B", "#1E9461", "#6C4CE0", "#E06A2C", "#3570D6", "#D2457E", "#B98900"];

export default function Celebrate({ streak, onEnd }) {
  useEffect(() => { const t = setTimeout(onEnd, 1400); return () => clearTimeout(t); }, [onEnd]);
  const word = WORDS[Math.floor(Math.random() * WORDS.length)];
  const bits = Array.from({ length: 26 }, (_, i) => {
    const a = (i / 26) * Math.PI * 2, d = 120 + Math.random() * 120;
    return { "--x": `${Math.cos(a) * d}px`, "--y": `${Math.sin(a) * d - 60}px`, "--r": `${Math.random() * 540}deg`, background: COLORS[i % COLORS.length], animationDelay: `${Math.random() * 80}ms` };
  });
  return (
    <div className="cheer" aria-live="polite">
      {bits.map((s, i) => <i key={i} className="confetti" style={s} />)}
      <div className="cheer-card"><b>🎉</b><span>{word}</span>{streak ? <small>🔥 {streak} day streak</small> : null}</div>
    </div>
  );
}
