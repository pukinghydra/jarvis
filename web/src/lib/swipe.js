import { useRef } from "react";

// Swipe left to close a popup. Spread the returned props on the popup's
// panel: it follows the finger while you drag left and closes past 90px (or
// 25% of a narrow panel, or a quick flick); otherwise it snaps back. Vertical scrolling
// inside the popup is left alone.
export function useSwipeClose(onClose) {
  const s = useRef(null);
  const el = (e) => e.currentTarget;

  const onTouchStart = (e) => {
    const t = e.touches[0];
    s.current = { x: t.clientX, y: t.clientY, t: Date.now(), dx: 0, horizontal: null };
  };
  const onTouchMove = (e) => {
    const st = s.current;
    if (!st) return;
    const t = e.touches[0];
    const dx = t.clientX - st.x, dy = t.clientY - st.y;
    if (st.horizontal === null && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) st.horizontal = Math.abs(dx) > Math.abs(dy);
    if (!st.horizontal) return;
    st.dx = Math.min(0, dx);
    const node = el(e);
    node.style.transition = "none";
    node.style.transform = `translateX(${st.dx}px)`;
    node.style.opacity = String(Math.max(0.3, 1 + st.dx / node.offsetWidth));
  };
  const onTouchEnd = (e) => {
    const st = s.current;
    s.current = null;
    if (!st || !st.horizontal) return;
    const node = el(e);
    const fast = st.dx < -30 && Date.now() - st.t < 300;
    if (st.dx < -Math.min(90, node.offsetWidth * 0.25) || fast) {
      node.style.transition = "transform .15s ease-out, opacity .15s ease-out";
      node.style.transform = "translateX(-110%)";
      node.style.opacity = "0";
      setTimeout(onClose, 140);
    } else {
      node.style.transition = "transform .2s ease-out, opacity .2s ease-out";
      node.style.transform = "";
      node.style.opacity = "";
    }
  };
  return { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel: onTouchEnd };
}
