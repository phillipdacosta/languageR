/**
 * Strips a small subset of HTML to plain text for React Native <Text>.
 * (Web uses full rich-text; mobile keeps things lightweight without a heavy HTML dep.)
 */
export function stripSimpleHtml(html: string): string {
  if (!html || typeof html !== 'string') return '';
  const withBreaks = html
    .replace(/<br\s*\/?>/gi, '\n')
    // Opening <li> → bullet (closing </li> already adds newline below)
    .replace(/<li[^>]*>/gi, '\n• ')
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n')
    .replace(/<\/(ul|ol|table)>/gi, '\n\n')
    .replace(/<[^>]+>/g, '');
  return withBreaks
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
