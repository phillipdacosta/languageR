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

  // Map country names to ISO 3166-1 alpha-2 country codes
  private countryNameToCode: Map<string, string> = new Map([
    ['Afghanistan', 'af'],
    ['Albania', 'al'],
    ['Algeria', 'dz'],
    ['Argentina', 'ar'],
    ['Armenia', 'am'],
    ['Australia', 'au'],
    ['Austria', 'at'],
    ['Azerbaijan', 'az'],
    ['Bahrain', 'bh'],
    ['Bangladesh', 'bd'],
    ['Belarus', 'by'],
    ['Belgium', 'be'],
    ['Bolivia', 'bo'],
    ['Bosnia and Herzegovina', 'ba'],
    ['Brazil', 'br'],
    ['Bulgaria', 'bg'],
    ['Cambodia', 'kh'],
    ['Canada', 'ca'],
    ['Chile', 'cl'],
    ['China', 'cn'],
    ['Colombia', 'co'],
    ['Costa Rica', 'cr'],
    ['Croatia', 'hr'],
    ['Cuba', 'cu'],
    ['Czech Republic', 'cz'],
    ['Denmark', 'dk'],
    ['Dominican Republic', 'do'],
    ['Ecuador', 'ec'],
    ['Egypt', 'eg'],
    ['El Salvador', 'sv'],
    ['Estonia', 'ee'],
    ['Ethiopia', 'et'],
    ['Finland', 'fi'],
    ['France', 'fr'],
    ['Georgia', 'ge'],
    ['Germany', 'de'],
    ['Ghana', 'gh'],
    ['Greece', 'gr'],
    ['Guatemala', 'gt'],
    ['Honduras', 'hn'],
    ['Hong Kong', 'hk'],
    ['Hungary', 'hu'],
    ['Iceland', 'is'],
    ['India', 'in'],
    ['Indonesia', 'id'],
    ['Iran', 'ir'],
    ['Iraq', 'iq'],
    ['Ireland', 'ie'],
    ['Israel', 'il'],
    ['Italy', 'it'],
    ['Jamaica', 'jm'],
    ['Japan', 'jp'],
    ['Jordan', 'jo'],
    ['Kazakhstan', 'kz'],
    ['Kenya', 'ke'],
    ['Kuwait', 'kw'],
    ['Latvia', 'lv'],
    ['Lebanon', 'lb'],
    ['Libya', 'ly'],
    ['Lithuania', 'lt'],
    ['Luxembourg', 'lu'],
    ['Malaysia', 'my'],
    ['Mexico', 'mx'],
    ['Morocco', 'ma'],
    ['Netherlands', 'nl'],
    ['New Zealand', 'nz'],
    ['Nicaragua', 'ni'],
    ['Nigeria', 'ng'],
    ['North Korea', 'kp'],
    ['Norway', 'no'],
    ['Oman', 'om'],
    ['Pakistan', 'pk'],
    ['Palestine', 'ps'],
    ['Panama', 'pa'],
    ['Paraguay', 'py'],
    ['Peru', 'pe'],
    ['Philippines', 'ph'],
    ['Poland', 'pl'],
    ['Portugal', 'pt'],
    ['Puerto Rico', 'pr'],
    ['Qatar', 'qa'],
    ['Romania', 'ro'],
    ['Russia', 'ru'],
    ['Saudi Arabia', 'sa'],
    ['Serbia', 'rs'],
    ['Singapore', 'sg'],
    ['Slovakia', 'sk'],
    ['Slovenia', 'si'],
    ['South Africa', 'za'],
    ['South Korea', 'kr'],
    ['Spain', 'es'],
    ['Sri Lanka', 'lk'],
    ['Sweden', 'se'],
    ['Switzerland', 'ch'],
    ['Syria', 'sy'],
    ['Taiwan', 'tw'],
    ['Thailand', 'th'],
    ['Tunisia', 'tn'],
    ['Turkey', 'tr'],
    ['Ukraine', 'ua'],
    ['United Arab Emirates', 'ae'],
    ['United Kingdom', 'gb'],
    ['United States', 'us'],
    ['Uruguay', 'uy'],
    ['Uzbekistan', 'uz'],
    ['Venezuela', 've'],
    ['Vietnam', 'vn'],
    ['Yemen', 'ye'],
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
   * Get the country code (ISO 3166-1 alpha-2) for a given country name
   * @param countryName - The name of the country (e.g., "United States", "France")
   * @returns The lowercase ISO country code (e.g., "us", "fr") or null if not found
   */
  getCountryCodeFromCountryName(countryName: string): string | null {
    if (!countryName) return null;
    
    const normalized = countryName.trim();
    const code = this.countryNameToCode.get(normalized);
    
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
   * Get the path to the flag SVG file from a country name
   * @param countryName - The name of the country
   * @returns The path to the flag SVG or null if not found
   */
  getFlagPathFromCountryName(countryName: string): string | null {
    const code = this.getCountryCodeFromCountryName(countryName);
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
   * Check if a flag exists for a given country name
   * @param countryName - The name of the country
   * @returns true if a flag exists, false otherwise
   */
  hasFlagForCountry(countryName: string): boolean {
    return this.getCountryCodeFromCountryName(countryName) !== null;
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

  /**
   * Get all available country name to code mappings
   * @returns Array of {country, code} objects
   */
  getAllCountryMappings(): Array<{ country: string; code: string }> {
    return Array.from(this.countryNameToCode.entries()).map(([country, code]) => ({
      country,
      code
    }));
  }
}

