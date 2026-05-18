import { Pipe, PipeTransform } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

@Pipe({
  name: 'highlight',
  standalone: false,
})
export class HighlightPipe implements PipeTransform {
  constructor(private sanitizer: DomSanitizer) {}

  transform(text: string, query: string): SafeHtml {
    if (!text) return '';
    if (!query || !query.trim()) return text;

    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const html = text.replace(
      new RegExp(`(${escaped})`, 'gi'),
      '<mark class="search-highlight">$1</mark>',
    );
    return this.sanitizer.bypassSecurityTrustHtml(html);
  }
}
