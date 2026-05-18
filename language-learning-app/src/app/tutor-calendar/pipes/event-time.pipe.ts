import { Pipe, PipeTransform, inject } from '@angular/core';
import { formatTimeInTz } from '../../shared/timezone.utils';
import { TranslateService } from '@ngx-translate/core';

@Pipe({
  name: 'eventTime',
  standalone: true,
  pure: true,
})
export class EventTimePipe implements PipeTransform {
  private readonly translate = inject(TranslateService);

  transform(
    event: any,
    timezone?: string,
    timeFormat?: '12h' | '24h',
    localeOverride?: string,
  ): string {
    if (!event?.start || !event?.end) return '';

    const startTime = new Date(event.start);
    const endTime = new Date(event.end);
    const durationMs = endTime.getTime() - startTime.getTime();
    const durationMinutes = Math.round(durationMs / (1000 * 60));

    const locale = localeOverride || this.translate.currentLang || 'en';
    const formattedTime = formatTimeInTz(startTime, timezone, locale, timeFormat !== '24h');
    return `${formattedTime} (${durationMinutes}min)`;
  }
}
