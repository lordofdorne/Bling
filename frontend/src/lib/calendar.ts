// A calendar file (.ics) for an upcoming Hotline, built in the browser so
// fans can add it to Apple, Google or Outlook calendars. RFC 5545.

const stamp = (date: Date) =>
  date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");

/** Escapes text values (RFC 5545 §3.3.11). */
const text = (value: string) =>
  value.replace(/[\\;,]/g, (match) => `\\${match}`).replace(/\r?\n/g, "\\n");

export function hotlineEvent({
  username,
  displayName,
  start,
  url,
  now = new Date(),
}: {
  username: string;
  displayName: string;
  start: Date;
  url: string;
  now?: Date;
}) {
  const end = new Date(start.getTime() + 60 * 60_000);
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Bling//Hotline//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${username}-${start.getTime()}@blinghotline.com`,
    `DTSTAMP:${stamp(now)}`,
    `DTSTART:${stamp(start)}`,
    `DTEND:${stamp(end)}`,
    `SUMMARY:${text(`${displayName}'s Hotline on Bling`)}`,
    `DESCRIPTION:${text(`Request a call: ${url}`)}`,
    `URL:${url}`,
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}

/** Hands the browser an .ics file to open or save. */
export function downloadCalendarFile(contents: string, filename: string) {
  const blob = new Blob([contents], { type: "text/calendar;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}
