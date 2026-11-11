// A short buzz on Done. Android/Chrome: the Vibration API. iPhone (Safari and
// home-screen apps have no vibrate()): iOS 18+ gives a haptic tick when a
// <input type="checkbox" switch> is toggled, so a hidden one is clicked.
// Must run inside the tap itself. Older iPhones: silently nothing.
let label = null;
function iosSwitch() {
  if (!label) {
    label = document.createElement("label");
    label.setAttribute("aria-hidden", "true");
    label.style.cssText = "position:fixed;left:-9999px;top:0;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.setAttribute("switch", "");
    input.tabIndex = -1;
    label.appendChild(input);
    document.body.appendChild(label);
  }
  label.click();
}

export function haptic() {
  try {
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function" && navigator.vibrate([18, 40, 28])) return;
    iosSwitch();
  } catch { /* no haptics here */ }
}
