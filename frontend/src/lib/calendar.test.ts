import { describe, expect, it } from "vitest";
import { hotlineEvent } from "./calendar";

describe("hotlineEvent", () => {
  it("builds a one-hour UTC event with escaped text", () => {
    const ics = hotlineEvent({
      username: "alice",
      displayName: "Alice, the; host \\ co",
      start: new Date("2026-10-17T00:00:00Z"),
      url: "https://blinghotline.com/u/alice",
      now: new Date("2026-10-11T12:30:45.123Z"),
    });
    const lines = ics.split("\r\n");
    expect(lines).toContain("DTSTART:20261017T000000Z");
    expect(lines).toContain("DTEND:20261017T010000Z");
    expect(lines).toContain("DTSTAMP:20261011T123045Z");
    // Commas, semicolons and backslashes are escaped with a backslash.
    expect(lines).toContain(
      "SUMMARY:Alice\\, the\\; host \\\\ co's Hotline on Bling",
    );
    expect(lines).toContain("URL:https://blinghotline.com/u/alice");
    expect(lines[0]).toBe("BEGIN:VCALENDAR");
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });
});
