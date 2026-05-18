import { Injectable } from '@angular/core';
import { CanDeactivate } from '@angular/router';
import { AlertController } from '@ionic/angular';
import { TranslateService } from '@ngx-translate/core';

export interface HasUnsavedChanges {
  hasUnsavedChanges: boolean;
  saveAvailability(): Promise<void>;
}

@Injectable({ providedIn: 'root' })
export class UnsavedChangesGuard implements CanDeactivate<HasUnsavedChanges> {
  constructor(
    private alertController: AlertController,
    private translate: TranslateService
  ) {}

  async canDeactivate(component: HasUnsavedChanges): Promise<boolean> {
    if (!component.hasUnsavedChanges) return true;

    return new Promise<boolean>(async (resolve) => {
      const alert = await this.alertController.create({
        header: this.translate.instant('ALERTS.CALENDAR.UNSAVED_HEADER'),
        message: this.translate.instant('ALERTS.CALENDAR.UNSAVED_MSG'),
        buttons: [
          {
            text: this.translate.instant('ALERTS.CALENDAR.DONT_SAVE'),
            role: 'destructive',
            handler: () => resolve(true),
          },
          {
            text: this.translate.instant('ALERTS.CALENDAR.SAVE'),
            handler: async () => {
              try {
                await component.saveAvailability();
              } catch (_) {}
              resolve(true);
            },
          },
        ],
      });
      await alert.present();
    });
  }
}
