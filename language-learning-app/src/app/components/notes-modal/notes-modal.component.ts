import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ModalController } from '@ionic/angular';

@Component({
  selector: 'app-notes-modal',
  standalone: true,
  imports: [CommonModule, IonicModule],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>Lesson Notes</ion-title>
        <ion-buttons slot="end">
          <ion-button (click)="dismiss()">
            <ion-icon name="close"></ion-icon>
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>
    
    <ion-content class="notes-content">
      <div class="notes-header">
        <h2>{{ subject }}</h2>
        <p class="notes-time">{{ time }}</p>
      </div>
      
      <div class="notes-body">
        <pre class="notes-text">{{ formattedNotes }}</pre>
      </div>
    </ion-content>
    
    <ion-footer>
      <ion-toolbar>
        <ion-button expand="block" (click)="dismiss()">Close</ion-button>
      </ion-toolbar>
    </ion-footer>
  `,
  styles: [`
    .notes-content {
      --padding-start: 20px;
      --padding-end: 20px;
      --padding-top: 20px;
      --padding-bottom: 20px;
    }
    
    .notes-header {
      margin-bottom: 24px;
      padding-bottom: 16px;
      border-bottom: 1px solid #e5e7eb;
      
      h2 {
        font-size: 20px;
        font-weight: 700;
        color: #111827;
        margin: 0 0 8px 0;
      }
      
      .notes-time {
        font-size: 14px;
        color: #6b7280;
        margin: 0;
      }
    }
    
    .notes-body {
      background: #f9fafb;
      border-radius: 12px;
      padding: 20px;
      max-height: calc(70vh - 120px);
      overflow-y: auto;
    }
    
    .notes-text {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      font-size: 14px;
      line-height: 1.7;
      color: #1f2937;
      white-space: pre-wrap;
      word-wrap: break-word;
      margin: 0;
      background: transparent;
      border: none;
      
      // Custom scrollbar
      &::-webkit-scrollbar {
        width: 8px;
      }
      
      &::-webkit-scrollbar-track {
        background: #e5e7eb;
        border-radius: 4px;
      }
      
      &::-webkit-scrollbar-thumb {
        background: #9ca3af;
        border-radius: 4px;
        
        &:hover {
          background: #6b7280;
        }
      }
    }
    
    ion-footer {
      ion-toolbar {
        --padding-start: 20px;
        --padding-end: 20px;
        --padding-top: 12px;
        --padding-bottom: 12px;
      }
      
      ion-button {
        --border-radius: 10px;
        height: 44px;
        font-weight: 600;
        text-transform: none;
        font-size: 15px;
      }
    }
  `]
})
export class NotesModalComponent {
  @Input() lesson: any;
  @Input() notes: string = '';
  @Input() subject: string = 'Lesson';
  @Input() time: string = '';

  constructor(private modalController: ModalController) {}

  get formattedNotes(): string {
    if (!this.notes) {
      return 'No notes available for this lesson.';
    }
    
    // Notes are plain text with \n line breaks
    // The <pre> tag with white-space: pre-wrap will preserve formatting
    return this.notes;
  }

  dismiss() {
    this.modalController.dismiss();
  }
}








