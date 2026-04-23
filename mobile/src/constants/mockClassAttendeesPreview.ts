/**
 * Stand-in enrollments when a group class has no `attendees` from the API yet (Up Next preview only).
 * Shape matches web `app-class-attendees` (firstName / lastName / picture).
 *
 * `auth0Id`s point at seeded User documents (see
 * `backend/scripts/seed-mock-class-students.js`). Run that script once so the
 * GOING broadcast flow can be tested end-to-end against a class with no real
 * confirmed students.
 */
export const MOCK_CLASS_ATTENDEES_PREVIEW = [
  {
    auth0Id: 'mock-student-sarah',
    firstName: 'Sarah',
    lastName: 'Chen',
    picture: 'https://i.pravatar.cc/128?img=47',
  },
  {
    auth0Id: 'mock-student-marcus',
    firstName: 'Marcus',
    lastName: 'Johnson',
    picture: 'https://i.pravatar.cc/128?img=12',
  },
  {
    auth0Id: 'mock-student-elena',
    firstName: 'Elena',
    lastName: 'Vasquez',
    picture: 'https://i.pravatar.cc/128?img=45',
  },
  {
    auth0Id: 'mock-student-james',
    firstName: 'James',
    lastName: 'Okonkwo',
    picture: 'https://i.pravatar.cc/128?img=33',
  },
] as const;

export type MockClassAttendee = {
  auth0Id?: string;
  firstName: string;
  lastName: string;
  picture?: string;
  name?: string;
};

export function resolveClassAttendeesForPreview(lesson: {
  isClass?: boolean;
  attendees?: unknown;
}): MockClassAttendee[] {
  if (!lesson?.isClass) return [];
  const a = lesson.attendees;
  if (Array.isArray(a) && a.length > 0) return a as MockClassAttendee[];
  return MOCK_CLASS_ATTENDEES_PREVIEW.map((m) => ({ ...m }));
}

export function attendeeStackInitials(a: {
  firstName?: string;
  lastName?: string;
  name?: string;
}): string {
  const fn = (a.firstName || '').trim();
  const ln = (a.lastName || '').trim();
  if (fn && ln) return `${fn.charAt(0)}${ln.charAt(0)}`.toUpperCase();
  const name = (a.name || '').trim();
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0].charAt(0)}${parts[parts.length - 1].charAt(0)}`.toUpperCase();
  if (name) return name.slice(0, 2).toUpperCase();
  return '?';
}
