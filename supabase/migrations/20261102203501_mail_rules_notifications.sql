-- Rule 4 from VIC: all notification mail is noise (GitHub, Supabase, Vercel,
-- Anthropic, Microsoft/Azure, Google, Apple, app stores, banks, shipping
-- status, social media), except payments or real deadlines only he can act
-- on. Code applies it (mail-rules-core.ts); this adds it to the rules text,
-- but only if VIC has not edited the text since it was seeded.
update public.settings
   set value = to_jsonb($r$1. Massutskick är brus: nyhetsbrev, reklam, mallade notiser och allt som skickas till många (copy-paste). / Mass or copy-paste mail (newsletters, marketing, templated notifications) is noise.
2. Vinted: allt från Vinted är brus UTOM en retur jag måste skicka (returförfrågan, "retur", "skicka tillbaka", returetikett, sista dag för retur). Den är viktig och blir en uppgift "Skicka Vinted-retur: <vara>" med deadline. / Everything from Vinted is noise except a return I have to send.
3. Redan besvarat: har jag svarat i samma tråd efter att mejlet kom är det klart. Visa det inte som viktigt och skriv inget utkast. / If I already replied in the thread after it arrived, it is handled.
4. Alla notismejl är brus: GitHub, Supabase, Vercel, Anthropic/Claude, Microsoft-konto/Azure, Google, Apple, appbutiker, bankernas "ny inloggning / kontoutdrag klart", leveransstatus och notiser från sociala medier. Undantag: Vinted-returer (regel 2) och allt som ber mig betala eller har en riktig deadline som bara jag kan agera på (t.ex. faktura som förfaller, Skatteverket). / All notification mail is noise, except Vinted returns and anything asking me to pay or with a real deadline only I can act on.$r$::text), updated_at = now()
 where key = 'mail_rules'
   and value = to_jsonb($r$1. Massutskick är brus: nyhetsbrev, reklam, mallade notiser och allt som skickas till många (copy-paste). / Mass or copy-paste mail (newsletters, marketing, templated notifications) is noise.
2. Vinted: allt från Vinted är brus UTOM en retur jag måste skicka (returförfrågan, "retur", "skicka tillbaka", returetikett, sista dag för retur). Den är viktig och blir en uppgift "Skicka Vinted-retur: <vara>" med deadline. / Everything from Vinted is noise except a return I have to send.
3. Redan besvarat: har jag svarat i samma tråd efter att mejlet kom är det klart. Visa det inte som viktigt och skriv inget utkast. / If I already replied in the thread after it arrived, it is handled.$r$::text);
