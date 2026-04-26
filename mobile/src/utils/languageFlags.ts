/**
 * Flag emojis keyed by canonical English language name as it is stored on
 * `Lesson.subject` / `User.languages*`. Mirrors the LANG_FLAGS map in
 * ProfileScreen and FlagService.languageToCountryCode on web — keep in sync.
 */
export const LANGUAGE_NAME_TO_FLAG: Record<string, string> = {
  English: '🇬🇧',
  Spanish: '🇪🇸',
  French: '🇫🇷',
  Portuguese: '🇧🇷',
  German: '🇩🇪',
  Italian: '🇮🇹',
  Russian: '🇷🇺',
  Chinese: '🇨🇳',
  Japanese: '🇯🇵',
  Korean: '🇰🇷',
  Arabic: '🇸🇦',
  Hindi: '🇮🇳',
  Dutch: '🇳🇱',
  Polish: '🇵🇱',
  Turkish: '🇹🇷',
  Swedish: '🇸🇪',
  Norwegian: '🇳🇴',
  Danish: '🇩🇰',
  Finnish: '🇫🇮',
  Greek: '🇬🇷',
  Czech: '🇨🇿',
  Romanian: '🇷🇴',
  Ukrainian: '🇺🇦',
  Vietnamese: '🇻🇳',
  Thai: '🇹🇭',
  Indonesian: '🇮🇩',
  Malay: '🇲🇾',
  Hebrew: '🇮🇱',
  Persian: '🇮🇷',
};

export function getLanguageFlag(languageName: string | null | undefined): string | null {
  if (!languageName) return null;
  return LANGUAGE_NAME_TO_FLAG[languageName.trim()] || null;
}
