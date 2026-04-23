/**
 * Stand-in enrollments when a group class has no `confirmedStudents` from the API yet
 * (Up Next, class detail sidebar stack — visual preview only).
 * Shape matches `app-class-attendees` (firstName / lastName / picture).
 *
 * The `auth0Id`s point at seeded User documents (see
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
