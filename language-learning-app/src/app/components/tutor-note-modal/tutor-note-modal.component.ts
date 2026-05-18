import { Component, Input, Output, EventEmitter } from '@angular/core';
import { IonicModule } from '@ionic/angular';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { QuillModule } from 'ngx-quill';

@Component({
  selector: 'app-tutor-note-modal',
  standalone: true,
  imports: [CommonModule, IonicModule, FormsModule, QuillModule],
  templateUrl: './tutor-note-modal.component.html',
  styleUrls: ['./tutor-note-modal.component.scss']
})
export class TutorNoteModalComponent {
  @Input() lessonId!: string;
  @Input() studentName!: string;
  @Input() lessonSubject!: string;
  @Input() duration!: number;
  
  @Output() noteSaved = new EventEmitter<{
    quickImpression: string;
    text: string;
    homework: string;
    capturedCorrections: CapturedCorrection[];
  }>();
  @Output() modalDismissed = new EventEmitter<void>();

  quickTags = [
    '⭐ Excellent',
    '✅ Good Progress',
    '🎯 Needs Focus',
    '💪 Keep Practicing'
  ];

  selectedTag: string = '';
  noteText: string = '';
  homework: string = '';

  // Optional structured corrections — feeds the student's spaced-repetition
  // deck. Lazily expanded on first "+ Add correction" click so the modal
  // stays simple by default.
  showCorrections = false;
  corrections: CapturedCorrection[] = [];

  quillModules = {
    toolbar: [
      ['bold', 'italic'],
      [{ 'list': 'bullet' }]
    ]
  };

  selectTag(tag: string) {
    this.selectedTag = this.selectedTag === tag ? '' : tag;
  }

  getPlainTextLength(): number {
    const div = document.createElement('div');
    div.innerHTML = this.noteText || '';
    return (div.textContent || div.innerText || '').length;
  }

  addCorrectionRow() {
    if (!this.showCorrections) {
      this.showCorrections = true;
    }
    this.corrections.push({ original: '', corrected: '', explanation: '' });
  }

  removeCorrectionRow(index: number) {
    this.corrections.splice(index, 1);
    if (this.corrections.length === 0) {
      this.showCorrections = false;
    }
  }

  trackByIndex(index: number) {
    return index;
  }

  private validCorrections(): CapturedCorrection[] {
    return this.corrections
      .map(c => ({
        original: (c.original || '').trim(),
        corrected: (c.corrected || '').trim(),
        explanation: (c.explanation || '').trim()
      }))
      .filter(c => c.original.length >= 2 && c.corrected.length >= 2 && c.original.toLowerCase() !== c.corrected.toLowerCase());
  }

  canSave(): boolean {
    return !!(
      this.selectedTag ||
      this.noteText.trim() ||
      this.homework.trim() ||
      this.validCorrections().length > 0
    );
  }

  saveNote() {
    this.noteSaved.emit({
      quickImpression: this.selectedTag,
      text: this.noteText,
      homework: this.homework,
      capturedCorrections: this.validCorrections()
    });
  }

  dismiss() {
    this.modalDismissed.emit();
  }
}

export interface CapturedCorrection {
  original: string;
  corrected: string;
  explanation?: string;
}

