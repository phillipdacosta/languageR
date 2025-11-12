import { Injectable } from '@angular/core';

/**
 * Maps language names to ISO 3166-1 alpha-2 country codes for flag icons
 * Note: Some languages are associated with multiple countries (e.g., Spanish -> ES, MX, AR, etc.)
 * We use the primary/most common country for each language
 */
@Injectable({
  providedIn: 'root'
})
export class FlagService {
  private languageToCountryCode: Map<string, string> = new Map([
    // Major languages - format: [language, countryCode]
    ['Spanish', 'es'],
    ['English', 'gb'],
    ['French', 'fr'],
    ['German', 'de'],
    ['Italian', 'it'],
    ['Portuguese', 'pt'],
    ['Russian', 'ru'],
    ['Chinese', 'cn'],
    ['Japanese', 'jp'],
    ['Korean', 'kr'],
    ['Arabic', 'sa'],
    ['Hindi', 'in'],
    ['Dutch', 'nl'],
    ['Swedish', 'se'],
    ['Norwegian', 'no'],
    ['Danish', 'dk'],
    ['Finnish', 'fi'],
    ['Polish', 'pl'],
    ['Czech', 'cz'],
    ['Hungarian', 'hu'],
    ['Turkish', 'tr'],
    ['Greek', 'gr'],
    ['Hebrew', 'il'],
    ['Thai', 'th'],
    ['Vietnamese', 'vn'],
    ['Indonesian', 'id'],
    ['Malay', 'my'],
    ['Tagalog', 'ph'],
    ['Swahili', 'ke'],
  ]);

  /**
   * Get the country code (ISO 3166-1 alpha-2) for a given language name
   * @param languageName - The name of the language (e.g., "Spanish", "French")
   * @returns The lowercase ISO country code (e.g., "es", "fr") or null if not found
   */
  getCountryCode(languageName: string): string | null {
    if (!languageName) return null;
    
    // Normalize the language name (trim, capitalize first letter)
    const normalized = languageName.trim();
    const code = this.languageToCountryCode.get(normalized);
    
    return code || null;
  }

  /**
   * Get the path to the flag SVG file
   * @param languageName - The name of the language
   * @returns The path to the flag SVG or null if not found
   */
  getFlagPath(languageName: string): string | null {
    const code = this.getCountryCode(languageName);
    if (!code) return null;
    
    return `/assets/flags/${code}.svg`;
  }

  /**
   * Check if a flag exists for a given language
   * @param languageName - The name of the language
   * @returns true if a flag exists, false otherwise
   */
  hasFlag(languageName: string): boolean {
    return this.getCountryCode(languageName) !== null;
  }

  /**
   * Get all available language-country mappings
   * @returns Array of {language, code} objects
   */
  getAllMappings(): Array<{ language: string; code: string }> {
    return Array.from(this.languageToCountryCode.entries()).map(([language, code]) => ({
      language,
      code
    }));
  }
}

