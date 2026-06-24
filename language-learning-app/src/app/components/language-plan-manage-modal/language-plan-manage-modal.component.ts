import { CommonModule } from '@angular/common';
import { Component, Input, OnInit } from '@angular/core';
import { IonicModule, ModalController } from '@ionic/angular';
import { SharedModule } from '../../shared/shared.module';

export type LanguagePlanManageAction = 'pause' | 'resume' | 'skip' | 'select' | 'promote' | 'restore';
export type LanguagePlanManageMode = 'manage' | 'select';

export interface LanguagePlanManageItem {
  language: string;
  statusLabel: string;
  statusTone: 'active' | 'paused' | 'unframed' | 'complete' | 'neutral';
  description: string;
  canPause: boolean;
  canResume: boolean;
  canSkip: boolean;
  /** Unframed (own pace) plan — offer to build a structured plan again. */
  canBuildPlan: boolean;
  /** Was a structured plan before going own pace. When true, the CTA is a
   *  "Restore plan" (reuse saved goal) instead of "Build a plan" (start fresh). */
  hadStructuredPlan: boolean;
}

@Component({
  selector: 'app-language-plan-manage-modal',
  standalone: true,
  imports: [CommonModule, IonicModule, SharedModule],
  templateUrl: './language-plan-manage-modal.component.html',
  styleUrls: ['./language-plan-manage-modal.component.scss'],
})
export class LanguagePlanManageModalComponent implements OnInit {
  @Input() mode: LanguagePlanManageMode = 'manage';
  @Input() subtitle = '';
  @Input() planItems: LanguagePlanManageItem[] = [];
  /** Current surfaced journey language — used in select mode to gate Done. */
  @Input() currentLanguage = '';
  /** Async apply hook — modal stays open until this resolves (select mode). */
  @Input() onApplySelection?: (language: string) => Promise<void>;

  selectedLanguage = '';
  isApplying = false;
  canConfirm = false;

  constructor(private modalController: ModalController) {}

  ngOnInit(): void {
    this.selectedLanguage = this.currentLanguage || '';
    this.refreshCanConfirm();
  }

  dismiss(): void {
    if (this.isApplying) return;
    void this.modalController.dismiss();
  }

  chooseAction(action: LanguagePlanManageAction, plan: LanguagePlanManageItem): void {
    void this.modalController.dismiss({ action, language: plan.language });
  }

  selectLanguage(language: string): void {
    if (this.mode !== 'select' || this.isApplying) return;
    this.selectedLanguage = language;
    this.refreshCanConfirm();
  }

  async confirmSelection(): Promise<void> {
    if (!this.canConfirm || this.isApplying) return;
    this.isApplying = true;
    try {
      if (this.onApplySelection) {
        await this.onApplySelection(this.selectedLanguage);
      }
      await this.modalController.dismiss({
        action: 'select' as LanguagePlanManageAction,
        language: this.selectedLanguage,
      });
    } catch {
      this.isApplying = false;
      this.refreshCanConfirm();
    }
  }

  private refreshCanConfirm(): void {
    const current = (this.currentLanguage || '').trim().toLowerCase();
    const next = (this.selectedLanguage || '').trim().toLowerCase();
    this.canConfirm = !!next && next !== current && !this.isApplying;
  }
}
