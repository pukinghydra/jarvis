// Wording of item pushes: one action, how long it takes, the first step.
// Tapping opens that one thing in Focus. Pure.

import { localTimeStr } from "./time.ts";

export type PushItem = {
  id: string; title: string; kind?: string | null; emoji?: string | null; minutes?: number | null;
  first_step?: string | null; location?: string | null; due_at?: string | null; all_day?: boolean | null;
};

export function reminderPush(i: PushItem, again: boolean) {
  const title = `${i.emoji ? `${i.emoji} ` : ""}${i.title}${i.minutes ? ` · ${i.minutes} min` : ""}`.slice(0, 120);
  const parts: string[] = [];
  const isEvent = i.kind === "event" && i.due_at && !i.all_day;
  if (again) parts.push("Still open. Tap and do it now");
  if (isEvent) parts.push(`At ${localTimeStr(new Date(i.due_at!))}`);
  if (i.first_step) parts.push(`First: ${i.first_step}`);
  else if (!again && !isEvent) parts.push("Tap to start");
  if (i.location) parts.push(`@ ${i.location}`);
  return { title, body: parts.join(" · ").slice(0, 400), url: `/?tab=today&item=${i.id}`, tag: `item-${i.id}` };
}
