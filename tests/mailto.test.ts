import { suite, eq, ok } from "./t.ts";
// @ts-ignore plain JS from the web app
import { mailtoForEmail, replyMailto } from "../web/src/lib/mailto.js";

const { test, run } = suite();
export { run };

const parse = (href: string) => {
  const [head, query] = href.split("?");
  const p = new URLSearchParams(query.replace(/\+/g, "%2B"));
  return { to: head.replace(/^mailto:/, ""), subject: p.get("subject"), body: p.get("body") };
};

test("mailto: reply to the sender, Re: subject, draft first, original quoted under it", () => {
  const href = mailtoForEmail({
    from_name: "Johanna Albrektson", from_address: "johanna.albrektson@nabo.se", subject: "lån seb eller handelsbanken",
    received_at: "2026-11-02T08:43:00Z", body: "Hej Victor,\nKan du skicka avtalet?", draft_text: "Hej Johanna,\n\nDet gör jag.\n\nMvh\nVictor", draft_language: "sv",
  });
  ok(href && href.startsWith("mailto:johanna.albrektson@nabo.se?"), String(href));
  const m = parse(href!);
  eq(m.subject, "Re: lån seb eller handelsbanken");
  ok(m.body!.startsWith("Hej Johanna,\r\n\r\nDet gör jag."), "draft first, CRLF lines");
  ok(m.body!.includes("Från: Johanna Albrektson <johanna.albrektson@nabo.se>"), "Swedish quote header for a Swedish draft");
  ok(m.body!.includes("Ämne: lån seb eller handelsbanken"));
  ok(m.body!.endsWith("Kan du skicka avtalet?"), "original under it");
});

test("mailto: SV:/Re: subjects kept; English labels otherwise; no draft or bad address = no link", () => {
  eq(parse(replyMailto({ to: "a@b.se", subject: "SV: Hej", body: "x" })!).subject, "SV: Hej");
  ok(parse(replyMailto({ to: "a@b.se", subject: "Hi", body: "x", original: { body: "y", from_address: "a@b.se" }, lang: "en" })!).body!.includes("From: a@b.se"));
  eq(mailtoForEmail({ from_address: "a@b.se", subject: "x", draft_text: "" }), null);
  eq(replyMailto({ to: "a@b.se?cc=evil@x.se", subject: "x", body: "y" }), null, "no smuggled cc via the address");
  eq(replyMailto({ to: "", subject: "x", body: "y" }), null);
});

test("mailto: a huge thread is cut so the link stays a sane length", () => {
  const href = replyMailto({ to: "a@b.se", subject: "x", body: "Hej", original: { body: "z".repeat(20000), from_address: "a@b.se" } })!;
  ok(href.length < 6000, `length ${href.length}`);
  ok(parse(href).body!.endsWith("…"));
});
