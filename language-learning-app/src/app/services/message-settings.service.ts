import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

export interface MessageSettings {
  showIncomingPreview: boolean;
}

const STORAGE_KEY = 'message_settings_v1';

const DEFAULT_SETTINGS: MessageSettings = {
  showIncomingPreview: true,
};

@Injectable({
  providedIn: 'root',
})
export class MessageSettingsService {
  private readonly settingsSubject = new BehaviorSubject<MessageSettings>(this.loadSettings());
  readonly settings$ = this.settingsSubject.asObservable();

  get showIncomingPreview(): boolean {
    return this.settingsSubject.value.showIncomingPreview;
  }

  setShowIncomingPreview(enabled: boolean): void {
    this.patchSettings({ showIncomingPreview: enabled });
  }

  private patchSettings(partial: Partial<MessageSettings>): void {
    const next = { ...this.settingsSubject.value, ...partial };
    this.settingsSubject.next(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Ignore quota / private-mode storage failures.
    }
  }

  private loadSettings(): MessageSettings {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { ...DEFAULT_SETTINGS };
      const parsed = JSON.parse(raw) as Partial<MessageSettings>;
      return {
        showIncomingPreview:
          parsed.showIncomingPreview !== undefined ? !!parsed.showIncomingPreview : true,
      };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }
}
