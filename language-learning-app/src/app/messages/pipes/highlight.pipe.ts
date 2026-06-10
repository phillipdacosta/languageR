import { Pipe, PipeTransform } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

@Pipe({
  name: 'highlight',
  standalone: false,
})
export class HighlightPipe implements PipeTransform {
  constructor(private sanitizer: DomSanitizer) {}

  transform(text: string, query: string): SafeHtml {
    const plain = this.stripMarkup(text);
    if (!plain) return '';
    if (!query || !query.trim()) return plain;

    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const html = plain.replace(
      new RegExp(`(${escaped})`, 'gi'),
      '<mark class="search-highlight">$1</mark>',
    );
    return this.sanitizer.bypassSecurityTrustHtml(html);
  }

  private stripMarkup(text: string): string {
    return (text || '')
      .replace(/<[^>]*>/g, ' ')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/[*_~`#]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }
}
