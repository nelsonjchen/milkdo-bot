export const PACIFIC_TIME_ZONE = "America/Los_Angeles";

export interface PacificTimeSnapshot {
  date: string;
  time: string;
  display: string;
}

export type TodoistDueArgs =
  | { dueDate: string }
  | { dueString: string };

export type DueDateResolution =
  | {
      ok: true;
      date: string;
      time?: string;
      todoistArgs: TodoistDueArgs;
      display: string;
    }
  | {
      ok: false;
      error: string;
    };

const WEEKDAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

function getPart(
  parts: Intl.DateTimeFormatPart[],
  type: Intl.DateTimeFormatPartTypes
): string {
  const part = parts.find((value) => value.type === type);
  if (!part) {
    throw new Error(`Missing ${type} from formatted date`);
  }
  return part.value;
}

function getPacificDateParts(now: Date): { year: number; month: number; day: number; weekday: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: PACIFIC_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(now);

  const weekdayName = getPart(parts, "weekday").toLowerCase().slice(0, 3);
  const weekday = WEEKDAYS.findIndex((value) => value.slice(0, 3) === weekdayName);

  return {
    year: Number(getPart(parts, "year")),
    month: Number(getPart(parts, "month")),
    day: Number(getPart(parts, "day")),
    weekday,
  };
}

function toIsoDate(year: number, month: number, day: number): string {
  return `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
}

function isValidCalendarDate(date: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) {
    return false;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utcDate = new Date(Date.UTC(year, month - 1, day));

  return utcDate.getUTCFullYear() === year
    && utcDate.getUTCMonth() === month - 1
    && utcDate.getUTCDate() === day;
}

function addDays(date: string, amount: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) {
    throw new Error(`Invalid ISO date: ${date}`);
  }

  const utcDate = new Date(Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]) + amount,
  ));

  return toIsoDate(
    utcDate.getUTCFullYear(),
    utcDate.getUTCMonth() + 1,
    utcDate.getUTCDate(),
  );
}

function normalizeTime(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim().toLowerCase();
  const match = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/.exec(trimmed);
  if (!match) {
    return undefined;
  }

  let hour = Number(match[1]);
  const minute = Number(match[2] ?? "0");
  const meridiem = match[3];

  if (minute > 59) {
    return undefined;
  }

  if (meridiem) {
    if (hour < 1 || hour > 12) {
      return undefined;
    }
    if (meridiem === "am" && hour === 12) {
      hour = 0;
    } else if (meridiem === "pm" && hour !== 12) {
      hour += 12;
    }
  } else if (hour > 23) {
    return undefined;
  }

  return `${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`;
}

function resolveDateInput(dateInput: string | undefined, now: Date): string | undefined {
  const current = getPacificDateParts(now);
  const currentDate = toIsoDate(current.year, current.month, current.day);

  if (!dateInput || dateInput.trim() === "") {
    return currentDate;
  }

  const trimmed = dateInput.trim();
  if (isValidCalendarDate(trimmed)) {
    return trimmed;
  }

  const relativeDate = trimmed.toLowerCase();
  if (relativeDate === "today") {
    return currentDate;
  }
  if (relativeDate === "tomorrow") {
    return addDays(currentDate, 1);
  }
  if (relativeDate === "yesterday") {
    return addDays(currentDate, -1);
  }

  const weekdayMatch = /^(next\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)$/.exec(relativeDate);
  if (weekdayMatch) {
    const requestedWeekday = WEEKDAYS.indexOf(weekdayMatch[2] as typeof WEEKDAYS[number]);
    let daysAhead = (requestedWeekday - current.weekday + 7) % 7;
    if (weekdayMatch[1] && daysAhead === 0) {
      daysAhead = 7;
    }
    return addDays(currentDate, daysAhead);
  }

  return undefined;
}

export function getPacificTimeSnapshot(now: Date = new Date()): PacificTimeSnapshot {
  const dateParts = getPacificDateParts(now);
  const date = toIsoDate(dateParts.year, dateParts.month, dateParts.day);
  const timeParts = new Intl.DateTimeFormat("en-US", {
    timeZone: PACIFIC_TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  }).formatToParts(now);
  const time = `${getPart(timeParts, "hour")}:${getPart(timeParts, "minute")}:${getPart(timeParts, "second")} ${getPart(timeParts, "dayPeriod")}`;
  const display = new Intl.DateTimeFormat("en-US", {
    timeZone: PACIFIC_TIME_ZONE,
    dateStyle: "full",
    timeStyle: "long",
  }).format(now);

  return { date, time, display };
}

export function formatPacificDueDate(date: string, time?: string): string {
  if (!isValidCalendarDate(date)) {
    return date;
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) {
    return date;
  }

  const calendarDate = new Date(Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    12,
  ));
  const dateDisplay = new Intl.DateTimeFormat("en-US", {
    timeZone: PACIFIC_TIME_ZONE,
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(calendarDate);

  if (!time) {
    return `${dateDisplay} (Pacific time)`;
  }

  const timeMatch = /^(\d{2}):(\d{2})$/.exec(time);
  if (!timeMatch) {
    return `${dateDisplay} at ${time} (Pacific time)`;
  }

  const hour = Number(timeMatch[1]);
  const minute = timeMatch[2];
  const displayHour = hour % 12 || 12;
  const meridiem = hour < 12 ? "AM" : "PM";
  return `${dateDisplay} at ${displayHour}:${minute} ${meridiem} (Pacific time)`;
}

export function resolveDueDate(
  dateInput: string | undefined,
  timeInput: string | undefined,
  now: Date = new Date(),
): DueDateResolution {
  const date = resolveDateInput(dateInput, now);
  if (!date) {
    return {
      ok: false,
      error: `I couldn't interpret the due date "${dateInput}". Use a date such as tomorrow or 2026-09-18.`,
    };
  }

  const time = normalizeTime(timeInput);
  if (timeInput && !time) {
    return {
      ok: false,
      error: `I couldn't interpret the due time "${timeInput}". Use a time such as 17:00 or 5 PM.`,
    };
  }

  const todoistArgs: TodoistDueArgs = time
    ? { dueString: `${date} at ${time} ${PACIFIC_TIME_ZONE}` }
    : { dueDate: date };

  return {
    ok: true,
    date,
    ...(time ? { time } : {}),
    todoistArgs,
    display: formatPacificDueDate(date, time),
  };
}
