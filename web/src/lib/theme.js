// Light by day, the same soft colours on dark from 21:00 to 07:00
// (Stockholm time), so the screen is easy on the eyes at night.
const hourNow = () => Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Stockholm", hour: "2-digit", hourCycle: "h23" }).format(new Date()));
export const isNight = (h = hourNow()) => h >= 21 || h < 7;

export function startTheme() {
  const apply = () => {
    const dark = isNight();
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#17161C" : "#FAF6F0");
  };
  apply();
  const t = setInterval(apply, 60_000);
  document.addEventListener("visibilitychange", apply);
  return () => { clearInterval(t); document.removeEventListener("visibilitychange", apply); };
}
