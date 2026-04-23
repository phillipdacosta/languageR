/** API values must match web tutor-onboarding experienceLevels / scheduleOptions `.value` */

export const TUTOR_EXPERIENCE_OPTIONS: { value: string; labelKey: string }[] = [
  { value: 'New to teaching (0-1 years)', labelKey: 'ONBOARDING.TUTOR_OB.EXP_NEW' },
  { value: 'Some experience (1-3 years)', labelKey: 'ONBOARDING.TUTOR_OB.EXP_SOME' },
  { value: 'Experienced (3-5 years)', labelKey: 'ONBOARDING.TUTOR_OB.EXP_EXPERIENCED' },
  { value: 'Very experienced (5+ years)', labelKey: 'ONBOARDING.TUTOR_OB.EXP_VERY' },
  { value: 'Native speaker with teaching experience', labelKey: 'ONBOARDING.TUTOR_OB.EXP_NATIVE' },
];

export const TUTOR_SCHEDULE_OPTIONS: { value: string; labelKey: string }[] = [
  { value: 'Weekdays only', labelKey: 'ONBOARDING.TUTOR_OB.SCHED_WEEKDAYS' },
  { value: 'Weekends only', labelKey: 'ONBOARDING.TUTOR_OB.SCHED_WEEKENDS' },
  { value: 'Evenings only', labelKey: 'ONBOARDING.TUTOR_OB.SCHED_EVENINGS' },
  { value: 'Flexible schedule', labelKey: 'ONBOARDING.TUTOR_OB.SCHED_FLEXIBLE' },
  { value: 'Full-time availability', labelKey: 'ONBOARDING.TUTOR_OB.SCHED_FULLTIME' },
];
