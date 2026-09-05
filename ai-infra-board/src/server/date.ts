import { DateTime } from "luxon";
import { APP_TIMEZONE } from "./config";

export function todayISODate(zone = APP_TIMEZONE): string {
  return DateTime.now().setZone(zone).toISODate() ?? DateTime.now().toISODate() ?? "1970-01-01";
}

export function normalizeDateInput(input?: string, zone = APP_TIMEZONE): string {
  if (!input || input === "today") {
    return todayISODate(zone);
  }
  if (input === "yesterday") {
    return DateTime.now().setZone(zone).minus({ days: 1 }).toISODate() ?? todayISODate(zone);
  }
  const parsed = DateTime.fromISO(input, { zone });
  if (!parsed.isValid) {
    throw new Error(`Invalid date: ${input}`);
  }
  return parsed.toISODate() ?? input;
}

export function dayWindowUTC(date: string, zone = APP_TIMEZONE): { start: Date; end: Date } {
  const localStart = DateTime.fromISO(date, { zone }).startOf("day");
  if (!localStart.isValid) {
    throw new Error(`Invalid date: ${date}`);
  }
  return {
    start: localStart.toUTC().toJSDate(),
    end: localStart.plus({ days: 1 }).toUTC().toJSDate()
  };
}

export function dateRangeWindowUTC(
  startDate: string,
  endDate: string,
  zone = APP_TIMEZONE
): { start: Date; end: Date } {
  const start = DateTime.fromISO(startDate, { zone }).startOf("day");
  const end = DateTime.fromISO(endDate, { zone }).startOf("day");
  if (!start.isValid || !end.isValid || end < start) {
    throw new Error(`Invalid date range: ${startDate}..${endDate}`);
  }
  return {
    start: start.toUTC().toJSDate(),
    end: end.plus({ days: 1 }).toUTC().toJSDate()
  };
}

export function recentHalfYearRange(zone = APP_TIMEZONE): { start: string; end: string } {
  const end = DateTime.now().setZone(zone).startOf("day");
  const start = end.minus({ months: 6 });
  return {
    start: start.toISODate() ?? todayISODate(zone),
    end: end.toISODate() ?? todayISODate(zone)
  };
}

export function enumerateDates(startDate: string, endDate: string, zone = APP_TIMEZONE): string[] {
  const start = DateTime.fromISO(startDate, { zone }).startOf("day");
  const end = DateTime.fromISO(endDate, { zone }).startOf("day");
  if (!start.isValid || !end.isValid || end < start) {
    throw new Error(`Invalid date range: ${startDate}..${endDate}`);
  }
  const dates: string[] = [];
  for (let cursor = start; cursor <= end; cursor = cursor.plus({ days: 1 })) {
    dates.push(cursor.toISODate() ?? cursor.toISO() ?? startDate);
  }
  return dates;
}

export function localDateForTimestamp(value: string, zone = APP_TIMEZONE): string {
  const date = DateTime.fromISO(value, { zone: "utc" }).setZone(zone);
  if (!date.isValid) {
    return new Date(value).toISOString().slice(0, 10);
  }
  return date.toISODate() ?? value.slice(0, 10);
}

export function toDateOnly(value: Date | string): string {
  if (value instanceof Date) {
    return DateTime.fromJSDate(value).toISODate() ?? value.toISOString().slice(0, 10);
  }
  return value.slice(0, 10);
}

export function toISO(value: Date | string | null): string | null {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return new Date(value).toISOString();
}
