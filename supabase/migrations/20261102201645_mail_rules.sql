-- VIC's mail rules (mail-rules-core.ts): mass mail is noise, Vinted is noise
-- except a return he has to send, and mail he already answered is handled.
--
-- emails: what Jarvis needs to apply them.
--   conversation_id  Outlook thread id (answered check against Sent Items)
--   bulk_reason      mass-mail header found (List-Unsubscribe, Precedence...)
--   last_verb        Outlook PidTagLastVerbExecuted: 102/103 replied, 104 forwarded
--   answered_at      when Jarvis saw he answered (status -> handled)
--   handled_reason   replied | forwarded | (null = marked by hand)
--   draft_deleted_at Jarvis deleted its own draft (answered / turned noise)
alter table public.emails
  add column if not exists conversation_id text,
  add column if not exists bulk_reason text,
  add column if not exists last_verb int,
  add column if not exists answered_at timestamptz,
  add column if not exists handled_reason text,
  add column if not exists draft_deleted_at timestamptz;

create index if not exists emails_conversation on public.emails (conversation_id);
create index if not exists emails_open on public.emails (received_at) where status in ('new', 'drafted');

-- The rules as text (owner edits them in Settings > Mail rules, or by voice
-- with add_mail_rule); they go to Claude as VIC's own instructions.
-- mail_ignore: senders that are always noise ("ignorera allt från X").
insert into public.settings (key, value) values
  ('mail_rules', to_jsonb($rules$1. Massutskick är brus: nyhetsbrev, reklam, mallade notiser och allt som skickas till många (copy-paste). / Mass or copy-paste mail (newsletters, marketing, templated notifications) is noise.
2. Vinted: allt från Vinted är brus UTOM en retur jag måste skicka (returförfrågan, "retur", "skicka tillbaka", returetikett, sista dag för retur). Den är viktig och blir en uppgift "Skicka Vinted-retur: <vara>" med deadline. / Everything from Vinted is noise except a return I have to send.
3. Redan besvarat: har jag svarat i samma tråd efter att mejlet kom är det klart. Visa det inte som viktigt och skriv inget utkast. / If I already replied in the thread after it arrived, it is handled.$rules$::text)),
  ('mail_ignore', '[]'::jsonb)
on conflict (key) do nothing;
