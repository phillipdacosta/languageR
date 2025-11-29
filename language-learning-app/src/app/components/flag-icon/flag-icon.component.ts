import { Component, Input, OnInit, OnChanges, SimpleChanges } from '@angular/core';
import { FlagService } from '../../services/flag.service';

@Component({
  selector: 'app-flag-icon',
  template: `
    <img 
      *ngIf="flagPath" 
      [src]="flagPath" 
      [alt]="altText"
      [class]="cssClass"
      [style.width.px]="size"
      [style.height.px]="size"
      (error)="onImageError()"
      class="flag-icon"
      [class.flag-icon-error]="hasError">
    <div 
      *ngIf="!flagPath || hasError" 
      class="flag-placeholder"
      [class]="cssClass"
      [style.width.px]="size"
      [style.height.px]="size">
      <span class="flag-placeholder-text">{{ placeholderText }}</span>
    </div>
  `,
  styles: [`
    .flag-icon {
      display: inline-block;
      object-fit: cover;
      border-radius: 2px;
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
    }

    .flag-icon-error {
      display: none;
    }

    .flag-placeholder {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: #e5e7eb;
      border-radius: 2px;
      border: 1px solid #d1d5db;
    }

    .flag-placeholder-text {
      font-size: 10px;
      font-weight: 600;
      color: #6b7280;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
  `],
  standalone: false
})
export class FlagIconComponent implements OnInit, OnChanges {
  @Input() language: string = '';
  @Input() country: string = ''; // Added for country name support
  @Input() size: number = 20;
  @Input() cssClass: string = '';
  @Input() altText: string = '';

  flagPath: string | null = null;
  hasError: boolean = false;
  placeholderText: string = '';

  constructor(private flagService: FlagService) {}

  ngOnInit() {
    this.updateFlag();
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['language'] || changes['country']) {
      this.updateFlag();
    }
  }

  private updateFlag() {
    this.hasError = false;
    
    // Prioritize country input over language input
    if (this.country) {
      this.flagPath = this.flagService.getFlagPathFromCountryName(this.country);
      
      // Generate placeholder text from country name
      this.placeholderText = this.country
        .split(' ')
        .map(word => word.charAt(0))
        .join('')
        .substring(0, 2)
        .toUpperCase();
      
      // Set default alt text if not provided
      if (!this.altText) {
        this.altText = `${this.country} flag`;
      }
    } else if (this.language) {
      this.flagPath = this.flagService.getFlagPath(this.language);
      
      // Generate placeholder text from language name
      this.placeholderText = this.language
        .split(' ')
        .map(word => word.charAt(0))
        .join('')
        .substring(0, 2)
        .toUpperCase();
      
      // Set default alt text if not provided
      if (!this.altText) {
        this.altText = `${this.language} flag`;
      }
    } else {
      this.placeholderText = '??';
    }
  }

  onImageError() {
    this.hasError = true;
  }
}

