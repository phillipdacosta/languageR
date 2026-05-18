/**
 * Matches web lessons + event-details banners (`lessons.page.scss` / `event-details.page.scss`).
 * Dark mode: web uses rgba fills over lesson cards `#1c1c1e`; RN cards are `#2C2C2E`, so we use
 * equivalent opaque blends so the banner reads the same as web.
 */
export const lessonFeedbackBanner = {
  tutor: {
    light: {
      background: '#fff7ed',
      border: '#ffffff',
      iconBackground: '#ffedd5',
      icon: '#c2410c',
    },
    dark: {
      background: '#3d291d',
      border: '#ffffff',
      iconBackground: '#5e361b',
      icon: '#fbbf24',
    },
  },
  student: {
    light: {
      background: '#f0f4ff',
      border: '#ffffff',
      iconBackground: '#e0e7ff',
      icon: '#4b5eaa',
    },
    dark: {
      background: '#222f39',
      border: '#ffffff',
      iconBackground: '#274154',
      icon: '#4298d2',
    },
  },
  /** Web `.lgc-feedback-banner-title` / `-sub` in ion-palette-dark */
  textDark: { title: '#f5f5f7', sub: '#8e8e93' },
  textLight: { title: '#222222', sub: '#717171' },
} as const;
