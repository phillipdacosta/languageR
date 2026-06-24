export type JourneyMapPreviewIllustrationKind = 'paused' | 'empty';

export const JOURNEY_MAP_PREVIEW_ILLUSTRATION_LIGHT: Record<JourneyMapPreviewIllustrationKind, string> = {
  paused: 'assets/journey/journey-paused.png',
  empty: 'assets/journey/journey-empty.png',
};

export const JOURNEY_MAP_PREVIEW_ILLUSTRATION_DARK: Record<JourneyMapPreviewIllustrationKind, string> = {
  paused: 'assets/journey/journey-paused-dark.png',
  empty: 'assets/journey/journey-empty-dark.png',
};

export const JOURNEY_MAP_PREVIEW_ALL_ILLUSTRATIONS: string[] = [
  ...Object.values(JOURNEY_MAP_PREVIEW_ILLUSTRATION_LIGHT),
  ...Object.values(JOURNEY_MAP_PREVIEW_ILLUSTRATION_DARK),
];

export const TRIAL_INSIGHTS_EMPTY_IMAGE = 'assets/trial-insights-empty.png';

/** Static bitmaps on lessons/:id (event-details) — safe to warm globally. */
export const EVENT_DETAILS_STATIC_IMAGES: readonly string[] = [
  TRIAL_INSIGHTS_EMPTY_IMAGE,
  ...JOURNEY_MAP_PREVIEW_ALL_ILLUSTRATIONS,
];
