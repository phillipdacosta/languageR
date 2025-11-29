import { Injectable } from '@angular/core';

export interface Country {
  name: string;
  code: string; // ISO 3166-1 alpha-2 code
}

/**
 * Service to map country names to ISO country codes for SVG flag display
 * Works with the SVG flags in assets/flags/
 */
@Injectable({
  providedIn: 'root'
})
export class CountryService {
  // List of countries that we have SVG flags for
  private countries: Country[] = [
    { name: 'Argentina', code: 'es' }, // Using Spanish flag as proxy
    { name: 'Australia', code: 'gb' }, // Using GB flag as proxy
    { name: 'Brazil', code: 'pt' }, // Using Portuguese flag
    { name: 'Canada', code: 'gb' }, // Using GB flag
    { name: 'China', code: 'cn' },
    { name: 'Czech Republic', code: 'cz' },
    { name: 'Denmark', code: 'dk' },
    { name: 'Finland', code: 'fi' },
    { name: 'France', code: 'fr' },
    { name: 'Germany', code: 'de' },
    { name: 'Greece', code: 'gr' },
    { name: 'Hungary', code: 'hu' },
    { name: 'India', code: 'in' },
    { name: 'Indonesia', code: 'id' },
    { name: 'Israel', code: 'il' },
    { name: 'Italy', code: 'it' },
    { name: 'Japan', code: 'jp' },
    { name: 'Kenya', code: 'ke' },
    { name: 'Malaysia', code: 'my' },
    { name: 'Mexico', code: 'es' }, // Using Spanish flag
    { name: 'Netherlands', code: 'nl' },
    { name: 'Norway', code: 'no' },
    { name: 'Philippines', code: 'ph' },
    { name: 'Poland', code: 'pl' },
    { name: 'Portugal', code: 'pt' },
    { name: 'Russia', code: 'ru' },
    { name: 'Saudi Arabia', code: 'sa' },
    { name: 'South Korea', code: 'kr' },
    { name: 'Spain', code: 'es' },
    { name: 'Sweden', code: 'se' },
    { name: 'Thailand', code: 'th' },
    { name: 'Turkey', code: 'tr' },
    { name: 'United Kingdom', code: 'gb' },
    { name: 'United States', code: 'gb' }, // Using GB flag
    { name: 'Vietnam', code: 'vn' },
    // Add more countries as needed
    { name: 'Other', code: '' } // No flag for "Other"
  ];

  constructor() {}

  /**
   * Get all countries sorted alphabetically
   */
  getAllCountries(): Country[] {
    return this.countries.sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Get country code for a given country name
   */
  getCountryCode(countryName: string): string | null {
    const country = this.countries.find(c => c.name === countryName);
    return country?.code || null;
  }

  /**
   * Get SVG flag path for a country name
   */
  getFlagPath(countryName: string): string | null {
    const code = this.getCountryCode(countryName);
    if (!code) return null;
    return `/assets/flags/${code}.svg`;
  }

  /**
   * Check if a country has a flag
   */
  hasFlag(countryName: string): boolean {
    const code = this.getCountryCode(countryName);
    return !!code && code.length > 0;
  }
}

