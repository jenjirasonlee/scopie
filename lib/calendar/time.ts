// Converting between UTC instants and wall-clock date and time in an organization's time
// zone (an IANA name such as "Europe/Amsterdam"), with Intl only. Shared by the calendar and
// the content form, on the server and in the browser.

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let format = formatters.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, format);
  }
  return format;
}

/** The time zone when it's a valid IANA name, otherwise UTC. */
export function safeTimeZone(timeZone: string | null | undefined): string {
  if (!timeZone) return 'UTC';
  try {
    formatter(timeZone);
    return timeZone;
  } catch {
    return 'UTC';
  }
}

/** Wall-clock fields of `instant` in `timeZone`. */
function wallClock(instant: Date, timeZone: string) {
  const parts: Record<string, number> = {};
  for (const part of formatter(timeZone).formatToParts(instant)) {
    if (part.type !== 'literal') parts[part.type] = Number(part.value);
  }
  return parts as Record<'year' | 'month' | 'day' | 'hour' | 'minute' | 'second', number>;
}

/** How far `timeZone` is ahead of UTC at `instant`, in milliseconds. */
function offsetAt(instant: number, timeZone: string): number {
  const w = wallClock(new Date(instant), timeZone);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  return asUtc - Math.floor(instant / 1000) * 1000;
}

const pad = (value: number, length = 2) => String(value).padStart(length, '0');

/**
 * The UTC instant for a wall-clock date ("2026-10-08") and time ("09:00") in `timeZone`.
 * A time that doesn't exist (skipped when clocks go forward) moves forward by the gap; a
 * time that happens twice (when clocks go back) resolves to the later one.
 */
export function zonedDateTimeToUtc(date: string, time: string, timeZone: string): Date {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const t = /^(\d{2}):(\d{2})$/.exec(time);
  if (!d || !t) throw new RangeError(`Invalid date or time: ${date} ${time}`);
  const guess = Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3]), Number(t[1]), Number(t[2]));
  const zone = safeTimeZone(timeZone);
  // The offsets in force a day either side cover any change of clocks on this date.
  const offsets = [offsetAt(guess - 86_400_000, zone), offsetAt(guess + 86_400_000, zone)];
  const valid = offsets
    .map((offset) => guess - offset)
    .filter((instant, i) => offsetAt(instant, zone) === offsets[i]);
  if (valid.length) return new Date(Math.max(...valid));
  return new Date(guess - Math.min(...offsets));
}

/** The wall-clock date ("YYYY-MM-DD") and time ("HH:MM") of `instant` in `timeZone`. */
export function utcToZonedParts(instant: Date, timeZone: string): { date: string; time: string } {
  const w = wallClock(instant, safeTimeZone(timeZone));
  return {
    date: `${pad(w.year, 4)}-${pad(w.month)}-${pad(w.day)}`,
    time: `${pad(w.hour)}:${pad(w.minute)}`,
  };
}
