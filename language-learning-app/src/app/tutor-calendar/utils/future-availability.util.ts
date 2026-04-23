import { EventInput } from '@fullcalendar/core';

export type FutureAvailabilityDayMode = 'visible6to23' | 'fullDay';

export function startOfLocalDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/**
 * Intersection of [selected calendar day] with [now, +∞) inside the chosen day window.
 * Returns null if the day is entirely in the past or no future window remains.
 */
export function futureAvailabilityRange(
  selectedDayDate: Date,
  now: Date,
  mode: FutureAvailabilityDayMode
): { winStart: Date; winEnd: Date } | null {
  const dayMidnight = startOfLocalDay(selectedDayDate);
  const todayMidnight = startOfLocalDay(now);

  if (dayMidnight.getTime() < todayMidnight.getTime()) {
    return null;
  }

  let winStart: Date;
  let winEnd: Date;

  if (mode === 'visible6to23') {
    winStart = new Date(selectedDayDate);
    winStart.setHours(6, 0, 0, 0);
    winEnd = new Date(selectedDayDate);
    winEnd.setHours(23, 0, 0, 0);
  } else {
    winStart = new Date(dayMidnight);
    winEnd = new Date(dayMidnight);
    winEnd.setDate(winEnd.getDate() + 1);
  }

  if (dayMidnight.getTime() === todayMidnight.getTime()) {
    winStart = new Date(Math.max(winStart.getTime(), now.getTime()));
  }

  if (winStart.getTime() >= winEnd.getTime()) {
    return null;
  }

  return { winStart, winEnd };
}

export function overlapMinutes(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): number {
  const s = Math.max(aStart.getTime(), bStart.getTime());
  const e = Math.min(aEnd.getTime(), bEnd.getTime());
  if (s >= e) {
    return 0;
  }
  return Math.round((e - s) / 60000);
}

function dayBoundsForMode(selectedDayDate: Date, mode: FutureAvailabilityDayMode): { boundsStart: Date; boundsEnd: Date } {
  if (mode === 'visible6to23') {
    const boundsStart = new Date(selectedDayDate);
    boundsStart.setHours(6, 0, 0, 0);
    const boundsEnd = new Date(selectedDayDate);
    boundsEnd.setHours(23, 0, 0, 0);
    return { boundsStart, boundsEnd };
  }
  const boundsStart = startOfLocalDay(selectedDayDate);
  const boundsEnd = new Date(boundsStart);
  boundsEnd.setDate(boundsEnd.getDate() + 1);
  return { boundsStart, boundsEnd };
}

/** Free hours (availability minus lessons/classes) in the future portion of the day. */
export function computeFutureFreeHoursFromEvents(
  events: EventInput[] | null | undefined,
  selectedDayDate: Date,
  now: Date,
  mode: FutureAvailabilityDayMode
): number {
  if (!events?.length) {
    return 0;
  }

  const range = futureAvailabilityRange(selectedDayDate, now, mode);
  if (!range) {
    return 0;
  }

  const { winStart, winEnd } = range;
  const { boundsStart, boundsEnd } = dayBoundsForMode(selectedDayDate, mode);

  let totalAvailableMinutes = 0;
  let totalBookedMinutes = 0;

  for (const event of events) {
    if (!event.start || !event.end) {
      continue;
    }

    const eventStart = new Date(event.start as string | number | Date);
    const eventEnd = new Date(event.end as string | number | Date);
    if (isNaN(eventStart.getTime()) || isNaN(eventEnd.getTime())) {
      continue;
    }

    if (eventStart >= boundsEnd || eventEnd <= boundsStart) {
      continue;
    }

    const clampedStart = eventStart.getTime() < boundsStart.getTime() ? boundsStart : eventStart;
    const clampedEnd = eventEnd.getTime() > boundsEnd.getTime() ? boundsEnd : eventEnd;

    const futureMins = overlapMinutes(clampedStart, clampedEnd, winStart, winEnd);
    if (futureMins <= 0) {
      continue;
    }

    const extended = (event.extendedProps as any) || {};
    const isAvailability = extended.type === 'available';
    const isLesson = Boolean(extended.lessonId);
    const isClass = Boolean(extended.classId || extended.isClass);

    if (isAvailability) {
      totalAvailableMinutes += futureMins;
    } else if (isLesson || isClass) {
      totalBookedMinutes += futureMins;
    }
  }

  const freeMinutes = Math.max(0, totalAvailableMinutes - totalBookedMinutes);
  return Math.round((freeMinutes / 60) * 10) / 10;
}

/** Free hours for the full day window (includes past times today) — for visibility / “has availability”. */
export function computeGrossFreeHoursFromEvents(
  events: EventInput[] | null | undefined,
  selectedDayDate: Date,
  mode: FutureAvailabilityDayMode
): number {
  if (!events?.length) {
    return 0;
  }

  const { boundsStart, boundsEnd } = dayBoundsForMode(selectedDayDate, mode);
  const winStart = boundsStart;
  const winEnd = boundsEnd;

  let totalAvailableMinutes = 0;
  let totalBookedMinutes = 0;

  for (const event of events) {
    if (!event.start || !event.end) {
      continue;
    }

    const eventStart = new Date(event.start as string | number | Date);
    const eventEnd = new Date(event.end as string | number | Date);
    if (isNaN(eventStart.getTime()) || isNaN(eventEnd.getTime())) {
      continue;
    }

    if (eventStart >= boundsEnd || eventEnd <= boundsStart) {
      continue;
    }

    const clampedStart = eventStart.getTime() < boundsStart.getTime() ? boundsStart : eventStart;
    const clampedEnd = eventEnd.getTime() > boundsEnd.getTime() ? boundsEnd : eventEnd;

    const mins = overlapMinutes(clampedStart, clampedEnd, winStart, winEnd);
    if (mins <= 0) {
      continue;
    }

    const extended = (event.extendedProps as any) || {};
    const isAvailability = extended.type === 'available';
    const isLesson = Boolean(extended.lessonId);
    const isClass = Boolean(extended.classId || extended.isClass);

    if (isAvailability) {
      totalAvailableMinutes += mins;
    } else if (isLesson || isClass) {
      totalBookedMinutes += mins;
    }
  }

  const freeMinutes = Math.max(0, totalAvailableMinutes - totalBookedMinutes);
  return Math.round((freeMinutes / 60) * 10) / 10;
}

/** Total availability hours in the future portion of the day (no booking subtraction). */
export function computeFutureTotalAvailabilityHoursFromEvents(
  events: EventInput[] | null | undefined,
  selectedDayDate: Date,
  now: Date,
  mode: FutureAvailabilityDayMode
): number {
  if (!events?.length) {
    return 0;
  }

  const range = futureAvailabilityRange(selectedDayDate, now, mode);
  if (!range) {
    return 0;
  }

  const { winStart, winEnd } = range;
  const { boundsStart, boundsEnd } = dayBoundsForMode(selectedDayDate, mode);

  let totalAvailableMinutes = 0;

  for (const event of events) {
    if (!event.start || !event.end) {
      continue;
    }

    const eventStart = new Date(event.start as string | number | Date);
    const eventEnd = new Date(event.end as string | number | Date);
    if (isNaN(eventStart.getTime()) || isNaN(eventEnd.getTime())) {
      continue;
    }

    if (eventStart >= boundsEnd || eventEnd <= boundsStart) {
      continue;
    }

    const clampedStart = eventStart.getTime() < boundsStart.getTime() ? boundsStart : eventStart;
    const clampedEnd = eventEnd.getTime() > boundsEnd.getTime() ? boundsEnd : eventEnd;

    const extended = (event.extendedProps as any) || {};
    const isAvailability = extended.type === 'available';
    if (!isAvailability) {
      continue;
    }

    totalAvailableMinutes += overlapMinutes(clampedStart, clampedEnd, winStart, winEnd);
  }

  return Math.round((totalAvailableMinutes / 60) * 10) / 10;
}
