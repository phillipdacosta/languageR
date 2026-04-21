/**
 * Stand-in enrollments when a group class has no `attendees` from the API yet (Up Next preview only).
 * Shape matches web `app-class-attendees` (firstName / lastName / picture).
 */
export const MOCK_CLASS_ATTENDEES_PREVIEW = [
  { firstName: 'Sarah', lastName: 'Chen', picture: 'https://i.pravatar.cc/128?img=47' },
  { firstName: 'Marcus', lastName: 'Johnson', picture: 'https://i.pravatar.cc/128?img=12' },
  { firstName: 'Elena', lastName: 'Vasquez', picture: 'https://i.pravatar.cc/128?img=45' },
  { firstName: 'James', lastName: 'Okonkwo', picture: 'https://i.pravatar.cc/128?img=33' },
] as const;

export function resolveClassAttendeesForPreview(lesson: {
  isClass?: boolean;
  attendees?: unknown;
}): { firstName: string; lastName: string; picture?: string; name?: string }[] {
  if (!lesson?.isClass) return [];
  const a = lesson.attendees;
  if (Array.isArray(a) && a.length > 0) return a as { firstName: string; lastName: string; picture?: string; name?: string }[];
  return [...MOCK_CLASS_ATTENDEES_PREVIEW];
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
