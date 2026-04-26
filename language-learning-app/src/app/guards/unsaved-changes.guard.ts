import { Injectable } from '@angular/core';
import { CanDeactivate } from '@angular/router';
import { AlertController } from '@ionic/angular';

export interface HasUnsavedChanges {
  hasUnsavedChanges: boolean;
  saveAvailability(): Promise<void>;
}

@Injectable({ providedIn: 'root' })
export class UnsavedChangesGuard implements CanDeactivate<HasUnsavedChanges> {
  constructor(private alertController: AlertController) {}

  async canDeactivate(component: HasUnsavedChanges): Promise<boolean> {
    if (!component.hasUnsavedChanges) return true;

    return new Promise<boolean>(async (resolve) => {
      const alert = await this.alertController.create({
        header: 'Selection not saved',
        message: 'You have selected time slots that are not saved.',
        buttons: [
          {
            text: "Don't save",
            role: 'destructive',
            handler: () => resolve(true),
          },
          {
            text: 'Save',
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
