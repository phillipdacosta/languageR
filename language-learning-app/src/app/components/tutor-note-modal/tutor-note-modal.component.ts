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

  canSave(): boolean {
    return !!(this.selectedTag || this.noteText.trim() || this.homework.trim());
  }

  saveNote() {
    this.noteSaved.emit({
      quickImpression: this.selectedTag,
      text: this.noteText,
      homework: this.homework
    });
  }

  dismiss() {
    this.modalDismissed.emit();
  }
}

