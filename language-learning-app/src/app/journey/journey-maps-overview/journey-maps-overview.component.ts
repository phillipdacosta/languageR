import { Component, Input, ViewEncapsulation } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';
import { journeyBackgroundUrl } from '../journey-map-assets';
import {
  JourneyMapPreviewComponent,
  JourneyMapPreviewPhase
} from '../journey-map-preview.component';

export interface JourneyMapsOverviewItem {
  level: string;
  theme: string;
  imageUrl: string;
  rungKey: string;
}

/** All-chapters rail from the onboarding journey intro (slide 3). */
@Component({
  selector: 'app-journey-maps-overview',
  standalone: true,
  encapsulation: ViewEncapsulation.None,
  imports: [CommonModule, TranslateModule, JourneyMapPreviewComponent],
  templateUrl: './journey-maps-overview.component.html',
  styleUrls: ['./journey-maps-overview.component.scss']
})
export class JourneyMapsOverviewComponent {
  @Input() startingChapterIndex = 0;
  @Input() titleLead = '';
  @Input() titleTail = '';
  @Input() bodyCaption = '';
  /** Tutor-only note explaining map placement vs lesson analysis level. */
  @Input() placementNote = '';
  /** When set (snapshot contexts), overrides onboarding "You start here" badge. */
  @Input() startHereBadgeLabel = '';
  /** Live progress for the student's current chapter (snapshot / lesson contexts). */
  @Input() liveChapterTheme = '';
  @Input() liveChapterLevel = 'A1';
  @Input() livePhases: JourneyMapPreviewPhase[] = [];
  @Input() liveCurrentPhaseIndex = 0;

  readonly journeyMapPreviews: JourneyMapsOverviewItem[] = [
    { level: 'A1', theme: 'a1-desert', imageUrl: journeyBackgroundUrl('a1-desert', 5), rungKey: 'JOURNEY.INTRO.MAP_RUNG_START' },
    { level: 'A2', theme: 'a2-coast', imageUrl: journeyBackgroundUrl('a2-coast', 5), rungKey: 'JOURNEY.INTRO.MAP_RUNG_2' },
    { level: 'B1', theme: 'b1-lake', imageUrl: journeyBackgroundUrl('b1-lake', 5), rungKey: 'JOURNEY.INTRO.MAP_RUNG_3' },
    { level: 'B2', theme: 'b2-snow', imageUrl: journeyBackgroundUrl('b2-snow', 5), rungKey: 'JOURNEY.INTRO.MAP_RUNG_4' },
    { level: 'C1', theme: 'c1-cherry', imageUrl: journeyBackgroundUrl('c1-cherry', 5), rungKey: 'JOURNEY.INTRO.MAP_RUNG_5' },
    { level: 'C2', theme: 'c2-tuscany', imageUrl: journeyBackgroundUrl('c2-tuscany', 5), rungKey: 'JOURNEY.INTRO.MAP_RUNG_SUMMIT' }
  ];
}
