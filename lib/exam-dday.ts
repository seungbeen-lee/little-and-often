export const DEFAULT_EXAM_DATE = "2026-11-07";
const DAY_IN_MS = 24 * 60 * 60 * 1000;

export function isValidDayDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (year < 1900 || year > 9999) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function datePartsInKorea(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(date);
  const value = (type: "year" | "month" | "day") => Number(parts.find((part) => part.type === type)?.value);
  return { year: value("year"), month: value("month"), day: value("day") };
}

export function dayCountdown(targetDate = DEFAULT_EXAM_DATE, now = new Date()) {
  const [year, month, day] = (isValidDayDate(targetDate) ? targetDate : DEFAULT_EXAM_DATE).split("-").map(Number);
  const today = datePartsInKorea(now);
  const todayAtUtc = Date.UTC(today.year, today.month - 1, today.day);
  const examAtUtc = Date.UTC(year, month - 1, day);
  const difference = Math.round((examAtUtc - todayAtUtc) / DAY_IN_MS);
  const count = String(Math.abs(difference)).padStart(2, "0");
  return difference === 0 ? "D-day" : `D${difference > 0 ? "-" : "+"}${count}`;
}

export function examDdayTitle(now = new Date()) {
  return `합격 ${dayCountdown(DEFAULT_EXAM_DATE, now)}`;
}
