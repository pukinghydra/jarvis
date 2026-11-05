import { useSwipeClose } from "../lib/swipe.js";
import { snoozeOptions } from "../lib/snooze.js";
import { dayLabel, time } from "../lib/time.js";

// "Not now": pick when it comes back. No guilt, no score change.
export default function SnoozeSheet({ onPick, onClose }) {
  const swipe = useSwipeClose(onClose);
  const opts = snoozeOptions();
  return (
    <div className="sheet-bg" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} {...swipe}>
        <div className="sheet-top"><h3>⏰ When should it come back?</h3><button className="close-x" onClick={onClose} aria-label="Close">✕</button></div>
        {opts.map((o) => (
          <button key={o.key} className="opt" onClick={() => onPick(o.at)}>{o.label}<span>{dayLabel(o.at)} {time(o.at)}</span></button>
        ))}
      </div>
    </div>
  );
}
