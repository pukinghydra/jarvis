// One emoji per thing, so each is recognisable at a glance. Jarvis/Claude
// sets item.emoji; older items get one from their words or lane.
const WORDS = [
  [/tiktok|film|video|reel/i, "🎥"], [/insta/i, "📸"], [/ring|call|samtal|telefon|phone/i, "📞"],
  [/möte|meeting|mötet|seb|bank/i, "🤝"], [/betala|pay|faktura|invoice|amex|kivra|räkning|ellevio/i, "💳"],
  [/maps|google|adress|address/i, "🗺️"],
  [/skicka|send|post(a|en)?\b|paket|retur|return|vinted/i, "📦"], [/mail|mejl|svara|reply|email/i, "✉️"],
  [/köp|buy|handla|shop/i, "🛒"], [/städ|clean/i, "🧽"], [/tvätt|laundry/i, "🧺"], [/träna|gym|run|löp/i, "🏃"],
  [/läkare|doctor|tandläkare|dentist|apotek/i, "🩺"], [/födelsedag|birthday|bday/i, "🎂"], [/middag|dinner|lunch|fika/i, "🍽️"],
  [/skatt|moms|vat|fortnox|bokför/i, "🧾"], [/foto|photo|bild/i, "📷"], [/jacka|kappa|coat|jacket|plagg|sweater|tröja/i, "🧥"],
];
const LANE = { thriftin: "🛍️", buy: "🛒", money: "💳", people: "💬", life: "🌿", inbox: "✉️" };

export function emojiFor(item, laneSlug) {
  if (item?.emoji) return item.emoji;
  const text = `${item?.title ?? ""}`;
  for (const [re, e] of WORDS) if (re.test(text)) return e;
  if (item?.kind === "birthday") return "🎂";
  if (item?.kind === "event") return "📅";
  return LANE[laneSlug] ?? "✨";
}
