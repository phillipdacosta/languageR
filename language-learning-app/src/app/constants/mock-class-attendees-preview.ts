/**
 * Stand-in enrollments when a group class has no `confirmedStudents` from the API yet
 * (Up Next, class detail sidebar stack — visual preview only).
 * Shape matches `app-class-attendees` (firstName / lastName / picture).
 */
export const MOCK_CLASS_ATTENDEES_PREVIEW = [
  { firstName: 'Sarah', lastName: 'Chen', picture: 'https://i.pravatar.cc/128?img=47' },
  { firstName: 'Marcus', lastName: 'Johnson', picture: 'https://i.pravatar.cc/128?img=12' },
  { firstName: 'Elena', lastName: 'Vasquez', picture: 'https://i.pravatar.cc/128?img=45' },
  { firstName: 'James', lastName: 'Okonkwo', picture: 'https://i.pravatar.cc/128?img=33' },
] as const;
