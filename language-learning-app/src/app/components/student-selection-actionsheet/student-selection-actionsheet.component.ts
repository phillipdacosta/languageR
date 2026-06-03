import { Component, Input, OnInit, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { animate, style, transition, trigger } from '@angular/animations';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, ModalController } from '@ionic/angular';
import { TranslateModule, TranslateService } from '@ngx-translate/core';

export interface SelectableStudent {
  _id: string;
  /** Auth0 ID — used as the receiverId for direct messages. */
  auth0Id?: string;
  name: string;
  email: string;
  picture?: string;
  alreadyHasAccess?: boolean;
}

interface DisplayStudent extends SelectableStudent {
  selected: boolean;
}

interface StudentAvatarDisplay {
  id: string;
  imageUrl: string | null;
  initials: string;
}

@Component({
  selector: 'app-student-selection-actionsheet',
  templateUrl: './student-selection-actionsheet.component.html',
  styleUrls: ['./student-selection-actionsheet.component.scss'],
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, IonicModule, FormsModule, TranslateModule],
  animations: [
    trigger('avatarEnter', [
      transition(':enter', [
        style({ opacity: 0, transform: 'scale(0.65) translateX(18px)' }),
        animate(
          '260ms cubic-bezier(0.32, 0.72, 0, 1)',
          style({ opacity: 1, transform: 'scale(1) translateX(0)' })
        ),
      ]),
      transition(':leave', [
        animate(
          '180ms ease-in',
          style({ opacity: 0, transform: 'scale(0.65) translateX(-10px)' })
        ),
      ]),
    ]),
  ],
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
  @Input() enableMassMessage = false;
  @Input() maxMessageChars = 2000;

  searchQuery = '';
  messageText = '';
  messageCharCount = 0;

  // Precomputed view state (no getters/method calls in the template).
  displayStudents: DisplayStudent[] = [];
  selectedDisplays: StudentAvatarDisplay[] = [];
  extraSelectedCount = 0;
  confirmText = '';
  isConfirmDisabled = true;
  isRemoveAllAction = false;
  allSelected = false;
  hasStudents = false;
  noResults = false;
  shareHeading = '';

  private selectedIds = new Set<string>();

  constructor(
    private modalController: ModalController,
    private cdr: ChangeDetectorRef,
    private translate: TranslateService,
  ) {}

  ngOnInit() {
    this.selectedIds = new Set(
      this.selectedStudentIds.map((id) => this.normalizeId(id)).filter(Boolean)
    );
    this.hasStudents = this.students.length > 0;
    this.shareHeading = this.translate.instant('CREATE_MATERIAL.SHARE_MODAL_SHARE_HEADING', {
      title: this.materialTitle || 'material',
    });
    this.messageCharCount = this.messageText.length;
    this.recompute();
  }

  trackById(_index: number, s: DisplayStudent): string {
    return s._id;
  }

  trackByAvatarId(_index: number, row: StudentAvatarDisplay): string {
    return row.id;
  }

  onSearchChange(value: string): void {
    this.searchQuery = value;
    this.recompute();
  }

  clearSearch(): void {
    this.searchQuery = '';
    this.recompute();
  }

  toggle(id: string): void {
    const sid = this.normalizeId(id);
    if (this.selectedIds.has(sid)) {
      this.selectedIds.delete(sid);
    } else {
      if (this.maxStudents > 0 && this.selectedIds.size >= this.maxStudents) {
        return;
      }
      this.selectedIds.add(sid);
    }
    this.recompute();
  }

  toggleAll(): void {
    if (this.allSelected) {
      this.selectedIds.clear();
    } else {
      const limit = this.maxStudents > 0 ? this.maxStudents : this.students.length;
      this.selectedIds = new Set(
        this.students.slice(0, limit).map((s) => this.normalizeId(s._id))
      );
    }
    this.recompute();
  }

  onMessageTextChange(): void {
    this.messageCharCount = this.messageText.length;
  }

  onDone(): void {
    const selectedIdArray = Array.from(this.selectedIds);
    // Build auth0Id list for messaging (falls back to _id if auth0Id missing).
    const selectedAuth0Ids = selectedIdArray.map((id) => {
      const student = this.students.find((s) => this.normalizeId(s._id) === id);
      return student?.auth0Id ? student.auth0Id.trim() : id;
    });

    this.modalController.dismiss({
      selectedIds: selectedIdArray,
      selectedAuth0Ids,
      messageText: this.enableMassMessage ? this.messageText.trim() : undefined,
    });
  }

  onCancel(): void {
    this.modalController.dismiss(null, 'cancel');
  }

  private recompute(): void {
    const q = this.searchQuery.trim().toLowerCase();
    const filtered = q
      ? this.students.filter(
          (s) =>
            s.name.toLowerCase().includes(q) || (s.email || '').toLowerCase().includes(q)
        )
      : this.students;

    this.displayStudents = filtered.map((s) => ({
      ...s,
      selected: this.selectedIds.has(this.normalizeId(s._id)),
    }));
    this.noResults = filtered.length === 0;

    const selected = this.students.filter((s) => this.selectedIds.has(this.normalizeId(s._id)));
    this.selectedDisplays = selected.slice(0, 5).map((s) => ({
      id: this.normalizeId(s._id),
      imageUrl: s.picture || null,
      initials: this.computeInitials(s.name),
    }));
    this.extraSelectedCount = Math.max(0, selected.length - 5);

    const n = this.selectedIds.size;
    const limit = this.maxStudents > 0 ? Math.min(this.maxStudents, this.students.length) : this.students.length;
    this.allSelected = this.students.length > 0 && n >= limit;
    this.isRemoveAllAction = this.allowRemoveAll && n === 0;
    this.isConfirmDisabled = n === 0 && !this.allowRemoveAll;
    this.confirmText = this.buildConfirmText(n);

    this.cdr.markForCheck();
  }

  private buildConfirmText(n: number): string {
    if (n === 0 && this.allowRemoveAll) return this.removeAllLabel;
    if (n === 0) return this.confirmLabel;
    if (this.isManageMode) return `${this.confirmLabel} (${n})`;
    return `${this.confirmLabel} with ${n} student${n !== 1 ? 's' : ''}`;
  }

  private normalizeId(id: string): string {
    return String(id ?? '').trim();
  }

  private computeInitials(name: string): string {
    const parts = (name || '').split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      return `${parts[0].charAt(0)}${parts[parts.length - 1].charAt(0)}`.toUpperCase();
    }
    return (name || '?').slice(0, 2).toUpperCase();
  }
}
