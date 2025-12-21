import { Pipe, PipeTransform } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

@Pipe({
  name: 'markdownLink',
  standalone: false
})
export class MarkdownLinkPipe implements PipeTransform {
  constructor(private sanitizer: DomSanitizer) {}

  transform(value: string): SafeHtml {
    if (!value) return '';
    
    // Convert markdown links [text](url) to HTML <a> tags
    const htmlContent = value.replace(
      /\[([^\]]+)\]\(([^)]+)\)/g,
      '<a href="$2">$1</a>'
    );
    
    // Use bypassSecurityTrustHtml to allow the HTML to be rendered
    return this.sanitizer.bypassSecurityTrustHtml(htmlContent);
  }
}

