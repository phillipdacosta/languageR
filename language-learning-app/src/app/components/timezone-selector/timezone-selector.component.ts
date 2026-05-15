import {
  AfterViewInit,
  ChangeDetectorRef,
  Component,
  DestroyRef,
  OnDestroy,
  OnInit,
  Input,
  ViewChild,
  inject,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, ModalController, IonSearchbar } from '@ionic/angular';
import { TranslateService } from '@ngx-translate/core';
import { merge } from 'rxjs';
import {
  getTimezonesByRegion,
  detectUserTimezone,
  TimezoneOption,
} from '../../shared/timezone.constants';
import { getTimezoneLabel } from '../../shared/timezone.utils';

@Component({
  selector: 'app-timezone-selector',
  templateUrl: './timezone-selector.component.html',
  styleUrls: ['./timezone-selector.component.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule],
})
export class TimezoneSelectorComponent implements OnInit, AfterViewInit, OnDestroy {
  /** Profile (or parent) timezone when the modal opens; used to enable/disable Change. */
  @Input() selectedTimezone: string = '';
  @ViewChild('timezoneSearch') timezoneSearch?: IonSearchbar;

  searchTerm = '';
  timezonesByRegion: Record<string, TimezoneOption[]> = {};
  flatFilteredTimezones: TimezoneOption[] = [];
  /** Timezone saved when the modal opened (normalized). */
  savedTimezone = '';
  /** Highlighted row; applied when the user taps Change. */
  pendingTimezone = '';
  /** Shown under the description (reflects pending selection). */
  currentTimezoneSummary = '';

  /** Bound in the template; refreshed on language change (Ionic modal + overlay CD). */
  modalHeading = '';
  modalDescription = '';
  modalCurrentTzLine = '';
  searchPlaceholderText = '';
  noResultsLabel = '';
  changeButtonLabel = '';

  private searchFocusTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly modalController = inject(ModalController);
  private readonly translate = inject(TranslateService);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly destroyRef = inject(DestroyRef);

  ngOnInit(): void {
    this.timezonesByRegion = getTimezonesByRegion();
    const fromInput = this.selectedTimezone?.trim();
    this.savedTimezone = fromInput || detectUserTimezone();
    this.pendingTimezone = this.savedTimezone;
    this.rebuildFlatList();
    this.refreshModalI18n();

    merge(this.translate.onLangChange, this.translate.onFallbackLangChange)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.refreshModalI18n());
  }

  ngAfterViewInit(): void {
    this.scheduleSearchFocus();
  }

  ngOnDestroy(): void {
    if (this.searchFocusTimer != null) {
      clearTimeout(this.searchFocusTimer);
      this.searchFocusTimer = null;
    }
  }

  private scheduleSearchFocus(): void {
    if (this.searchFocusTimer != null) {
      clearTimeout(this.searchFocusTimer);
    }
    this.searchFocusTimer = setTimeout(() => {
      this.searchFocusTimer = null;
      void this.timezoneSearch?.setFocus();
    }, 280);
  }

  onSearchInput(): void {
    this.rebuildFlatList();
  }

  private rebuildFlatList(): void {
    const q = this.searchTerm.toLowerCase().trim();
    if (!q) {
      this.flatFilteredTimezones = this.flattenRegions(this.timezonesByRegion);
      return;
    }
    const filtered: Record<string, TimezoneOption[]> = {};
    Object.keys(this.timezonesByRegion).forEach((region) => {
      const regionTimezones = this.timezonesByRegion[region].filter(
        (tz) =>
          tz.label.toLowerCase().includes(q) ||
          tz.value.toLowerCase().includes(q) ||
          tz.offset.toLowerCase().includes(q)
      );
      if (regionTimezones.length > 0) {
        filtered[region] = regionTimezones;
      }
    });
    this.flatFilteredTimezones = this.flattenRegions(filtered);
  }

  private flattenRegions(regions: Record<string, TimezoneOption[]>): TimezoneOption[] {
    const all: TimezoneOption[] = [];
    Object.values(regions).forEach((regionTimezones) => {
      all.push(...regionTimezones);
    });
    return all;
  }

  private refreshCurrentTimezoneSummary(): void {
    const id = this.pendingTimezone?.trim();
    if (!id) {
      this.currentTimezoneSummary = '';
      return;
    }
    const flat = this.flattenRegions(this.timezonesByRegion);
    const match = flat.find((t) => t.value === id);
    if (match) {
      this.currentTimezoneSummary = `${match.label} · ${match.offset}`;
    } else {
      this.currentTimezoneSummary = getTimezoneLabel(id);
    }
  }

  private refreshModalI18n(): void {
    this.modalHeading = this.translate.instant('PROFILE_SCREEN.TIMEZONE_MODAL_TITLE');
    this.modalDescription = this.translate.instant('PROFILE_SCREEN.TIMEZONE_MODAL_DESC');
    this.searchPlaceholderText = this.translate.instant('PROFILE_SCREEN.TIMEZONE_SEARCH_PLACEHOLDER');
    this.noResultsLabel = this.translate.instant('ONBOARDING.COUNTRY_MODAL.NO_RESULTS');
    this.changeButtonLabel = this.translate.instant('PROFILE_SCREEN.CHANGE');
    this.updateModalCurrentTzLine();
    this.cdr.markForCheck();
  }

  private updateModalCurrentTzLine(): void {
    this.refreshCurrentTimezoneSummary();
    this.modalCurrentTzLine = this.currentTimezoneSummary
      ? this.translate.instant('PROFILE_SCREEN.TIMEZONE_MODAL_CURRENT', {
          value: this.currentTimezoneSummary,
        })
      : '';
  }

  selectPendingTimezone(timezone: TimezoneOption): void {
    this.pendingTimezone = timezone.value;
    this.updateModalCurrentTzLine();
    this.cdr.markForCheck();
  }

  confirmChange(): void {
    if (this.pendingTimezone === this.savedTimezone) {
      void this.modalController.dismiss();
      return;
    }
    void this.modalController.dismiss({ timezone: this.pendingTimezone });
  }

  cancel(): void {
    void this.modalController.dismiss();
  }

  isSelected(timezone: TimezoneOption): boolean {
    return this.pendingTimezone === timezone.value;
  }

  trackByTimezone(_index: number, timezone: TimezoneOption): string {
    return timezone.value;
  }
}
