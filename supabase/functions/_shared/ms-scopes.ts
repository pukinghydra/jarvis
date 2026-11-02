// What Jarvis asks Microsoft for: read mail and write drafts
// (Mail.ReadWrite), who the account is (User.Read), and keep access
// (offline_access). No Mail.Send (it can't send) and no Calendars.Read: VIC's
// calendars are iCloud, read through their share links (calendar.ts).
export const SCOPES = "offline_access User.Read Mail.ReadWrite";
