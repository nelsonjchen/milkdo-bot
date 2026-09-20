import { describe, expect, it } from "vitest";
import {
  PACIFIC_TIME_ZONE,
  formatPacificDueDate,
  getPacificTimeSnapshot,
  resolveDueDate,
} from "./dueDates";
import { getSystemPrompt } from "./systemPrompt";

describe("Pacific due dates", () => {
  it("puts the current Pacific date and time in the system prompt", () => {
    const prompt = getSystemPrompt({ now: new Date("2026-09-15T00:30:00.000Z") });

    expect(prompt.content).toContain("current Pacific date is 2026-09-14");
    expect(prompt.content).toContain("current Pacific time is 5:30:00 PM");
    expect(prompt.content).toContain(`timezone is ${PACIFIC_TIME_ZONE}`);
  });

  it("uses the Pacific calendar date after UTC midnight", () => {
    const now = new Date("2026-09-15T00:30:00.000Z");

    expect(getPacificTimeSnapshot(now).date).toBe("2026-09-14");
    expect(resolveDueDate(undefined, undefined, now)).toMatchObject({
      ok: true,
      date: "2026-09-14",
      todoistArgs: { dueDate: "2026-09-14" },
    });
  });

  it("handles Pacific daylight-saving time", () => {
    const beforeTransition = new Date("2026-03-08T09:59:00.000Z");
    const afterTransition = new Date("2026-03-08T10:01:00.000Z");

    expect(getPacificTimeSnapshot(beforeTransition).display).toContain("PST");
    expect(getPacificTimeSnapshot(afterTransition).display).toContain("PDT");
  });

  it("resolves relative dates from the supplied Pacific clock", () => {
    const now = new Date("2026-09-14T18:42:00.000Z");
    const result = resolveDueDate("tomorrow", "5 PM", now);

    expect(result).toMatchObject({
      ok: true,
      date: "2026-09-15",
      time: "17:00",
      todoistArgs: {
        dueString: `2026-09-15 at 17:00 ${PACIFIC_TIME_ZONE}`,
      },
    });
  });

  it("does not silently accept invalid dates or times", () => {
    expect(resolveDueDate("2026-02-30", undefined)).toMatchObject({ ok: false });
    expect(resolveDueDate("2026-09-18", "25:00")).toMatchObject({ ok: false });
  });

  it("formats user-facing dates in Pacific time", () => {
    expect(formatPacificDueDate("2026-09-18", "17:00")).toBe(
      "Friday, September 18, 2026 at 5:00 PM (Pacific time)",
    );
  });
});
