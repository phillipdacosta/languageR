import { Component, OnInit, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, ModalController } from '@ionic/angular';
import { 
  getTimezonesWithOffsets, 
  getTimezonesByRegion, 
  detectUserTimezone,
  TimezoneOption,
  TIMEZONE_REGIONS
} from '../../shared/timezone.constants';

@Component({
  selector: 'app-timezone-selector',
  templateUrl: './timezone-selector.component.html',
  styleUrls: ['./timezone-selector.component.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule]
})
export class TimezoneSelectorComponent implements OnInit {
  @Input() selectedTimezone: string = '';
  searchTerm: string = '';
  timezonesByRegion: Record<string, TimezoneOption[]> = {};
  filteredTimezonesByRegion: Record<string, TimezoneOption[]> = {};
  regionKeys: string[] = [];
  
  constructor(private modalController: ModalController) {}

  ngOnInit() {
    // Get timezones with offsets populated, then group by region
    const timezonesWithOffsets = getTimezonesWithOffsets();
    this.timezonesByRegion = getTimezonesByRegion();
    this.filteredTimezonesByRegion = { ...this.timezonesByRegion };
    this.regionKeys = Object.keys(this.timezonesByRegion);
    
    // If no timezone selected, detect current one
    if (!this.selectedTimezone) {
      this.selectedTimezone = detectUserTimezone();
    }
  }

  /**
   * Filter timezones based on search term
   */
  onSearchChange(event: any) {
    const searchTerm = event.detail.value?.toLowerCase() || '';
    
    if (!searchTerm) {
      this.filteredTimezonesByRegion = { ...this.timezonesByRegion };
      return;
    }
    
    // Filter timezones in each region
    const filtered: Record<string, TimezoneOption[]> = {};
    
    Object.keys(this.timezonesByRegion).forEach(region => {
      const regionTimezones = this.timezonesByRegion[region].filter(tz => 
        tz.label.toLowerCase().includes(searchTerm) ||
        tz.value.toLowerCase().includes(searchTerm) ||
        tz.offset.toLowerCase().includes(searchTerm)
      );
      
      if (regionTimezones.length > 0) {
        filtered[region] = regionTimezones;
      }
    });
    
    this.filteredTimezonesByRegion = filtered;
  }

  /**
   * Select a timezone
   */
  selectTimezone(timezone: TimezoneOption) {
    this.selectedTimezone = timezone.value;
    // Auto-save when selected (like country selector)
    this.save();
  }

  /**
   * Save and close
   */
  save() {
    this.modalController.dismiss({
      timezone: this.selectedTimezone
    });
  }

  /**
   * Cancel and close
   */
  cancel() {
    this.modalController.dismiss();
  }

  /**
   * Check if timezone is selected
   */
  isSelected(timezone: TimezoneOption): boolean {
    return this.selectedTimezone === timezone.value;
  }

  /**
   * Get filtered region keys (only regions with timezones after filtering)
   */
  getFilteredRegionKeys(): string[] {
    return Object.keys(this.filteredTimezonesByRegion);
  }

  /**
   * Get all filtered timezones as a flat list (for simple list display)
   */
  getAllFilteredTimezones(): TimezoneOption[] {
    const all: TimezoneOption[] = [];
    Object.values(this.filteredTimezonesByRegion).forEach(regionTimezones => {
      all.push(...regionTimezones);
    });
    return all;
  }
}

