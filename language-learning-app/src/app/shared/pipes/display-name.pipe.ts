import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
  name: 'displayName',
  standalone: false
})
export class DisplayNamePipe implements PipeTransform {
  /**
   * Formats a name as "FirstName LastInitial."
   * Examples:
   *   - "John", "Doe" => "John D."
   *   - "John Doe" => "John D."
   *   - "John" => "John"
   */
  transform(firstName?: string | null, lastName?: string | null, fullName?: string | null): string {
    // If we have firstName and lastName, use them
    if (firstName && lastName) {
      const lastInitial = lastName.charAt(0).toUpperCase();
      return `${firstName} ${lastInitial}.`;
    }
    
    // If only firstName is provided
    if (firstName && !lastName) {
      return firstName;
    }
    
    // Fallback: try to parse from fullName
    if (fullName) {
      const parts = fullName.trim().split(' ').filter(p => p.length > 0);
      if (parts.length >= 2) {
        const first = parts[0];
        const last = parts[parts.length - 1];
        const lastInitial = last.charAt(0).toUpperCase();
        return `${first} ${lastInitial}.`;
      }
      // If only one name, return as is
      return fullName;
    }
    
    return '';
  }
}

