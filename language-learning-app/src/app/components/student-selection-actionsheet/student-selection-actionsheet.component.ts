import { Component, Input, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, ModalController } from '@ionic/angular';
import { TranslateModule } from '@ngx-translate/core';

export interface SelectableStudent {
  _id: string;
  name: string;
  email: string;
  picture?: string;
  alreadyHasAccess?: boolean;
}

@Component({
  selector: 'app-student-selection-actionsheet',
  templateUrl: './student-selection-actionsheet.component.html',
  styleUrls: ['./student-selection-actionsheet.component.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, FormsModule, TranslateModule]
})
export class StudentSelectionActionsheetComponent implements OnInit {
  @Input() students: SelectableStudent[] = [];
  @Input() selectedStudentIds: string[] = [];
  /** Legacy — kept for backwards compatibility. 0 = unlimited. */
  @Input() maxStudents = 0;
  @Input() title = 'Share with students';
  @Input() subtitle = 'Select the students you want to share this quiz with.';
  @Input() isLoading = false;
  @Input() confirmLabel = 'Share';
  @Input() isManageMode = false;
  @Input() alreadySharedCount = 0;
  @Input() materialTitle = '';
  @Input() statusBannerText = '';
  @Input() allowRemoveAll = false;
  @Input() removeAllLabel = 'Remove all sharing';

  selectedIds: string[] = [];
  searchQuery = '';

  constructor(private modalController: ModalController) {}

  ngOnInit() {
    this.selectedIds = [...this.selectedStudentIds];
  }

  get filteredStudents(): SelectableStudent[] {
    const q = this.searchQuery.trim().toLowerCase();
    if (!q) return this.students;
    return this.students.filter(s =>
      s.name.toLowerCase().includes(q) || s.email.toLowerCase().includes(q)
    );
  }

  get confirmText(): string {
    const n = this.selectedIds.length;
    if (n === 0 && this.allowRemoveAll) {
      return this.removeAllLabel;
    }
    if (n === 0) return this.confirmLabel;
    if (this.isManageMode) {
      return `${this.confirmLabel} (${n})`;
    }
    return `${this.confirmLabel} with ${n} student${n !== 1 ? 's' : ''}`;
  }

  get isConfirmDisabled(): boolean {
    return this.selectedIds.length === 0 && !this.allowRemoveAll;
  }

  get isRemoveAllAction(): boolean {
    return this.allowRemoveAll && this.selectedIds.length === 0;
  }

  isSelected(id: string): boolean {
    return this.selectedIds.includes(id);
  }

  toggle(id: string) {
    const i = this.selectedIds.indexOf(id);
    if (i > -1) {
      this.selectedIds.splice(i, 1);
    } else {
      this.selectedIds.push(id);
    }
  }

  toggleAll() {
    if (this.selectedIds.length === this.students.length) {
      this.selectedIds = [];
    } else {
      this.selectedIds = this.students.map(s => s._id);
    }
  }

  get allSelected(): boolean {
    return this.students.length > 0 && this.selectedIds.length === this.students.length;
  }

  onDone() {
    this.modalController.dismiss({ selectedIds: this.selectedIds });
  }

  onCancel() {
    this.modalController.dismiss(null, 'cancel');
  }
}
