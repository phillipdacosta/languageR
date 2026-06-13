import { Injectable } from '@angular/core';
import { ToastController, ToastButton } from '@ionic/angular';
import { PlatformService } from './platform.service';

export type AppToastVariant = 'success' | 'error' | 'warning' | 'info';

export interface AppToastButton {
  text: string;
  role?: 'cancel' | 'destructive';
  handler?: () => void | boolean | Promise<void | boolean>;
}

export interface AppToastOptions {
  message: string;
  variant?: AppToastVariant;
  duration?: number;
  position?: 'top' | 'bottom' | 'middle';
  buttons?: AppToastButton[];
}

const VARIANT_ICON: Record<AppToastVariant, string> = {
  success: 'checkmark-circle',
  error: 'close-circle',
  warning: 'alert-circle',
  info: 'information-circle',
};

const DEFAULT_DURATION: Record<AppToastVariant, number> = {
  success: 2500,
  error: 4000,
  warning: 3200,
  info: 2500,
};

@Injectable({
  providedIn: 'root',
})
export class ToastService {
  constructor(
    private readonly toastController: ToastController,
    private readonly platformService: PlatformService,
  ) {}

  showSuccess(message: string, duration?: number): Promise<void> {
    return this.present({ message, variant: 'success', duration });
  }

  showError(message: string, duration?: number, buttons?: AppToastButton[]): Promise<void> {
    return this.present({ message, variant: 'error', duration, buttons });
  }

  showWarning(message: string, duration?: number): Promise<void> {
    return this.present({ message, variant: 'warning', duration });
  }

  showInfo(message: string, duration?: number): Promise<void> {
    return this.present({ message, variant: 'info', duration });
  }

  /** Maps legacy Ionic toast `color` values during migration. */
  showLegacy(
    message: string,
    color: string = 'primary',
    duration = 3000,
    options: Pick<AppToastOptions, 'position' | 'buttons'> = {},
  ): Promise<void> {
    return this.present({
      message,
      variant: this.mapLegacyColor(color),
      duration,
      position: options.position,
      buttons: options.buttons,
    });
  }

  private async present(options: AppToastOptions): Promise<void> {
    const variant = options.variant ?? 'info';
    const duration = options.duration ?? DEFAULT_DURATION[variant];
    const cssClasses = ['app-toast', `app-toast--${variant}`];

    if (!this.platformService.isWeb()) {
      cssClasses.push('app-toast--above-tab-bar');
    }

    const toast = await this.toastController.create({
      message: options.message,
      duration: options.buttons?.length ? 0 : duration,
      position: options.position ?? 'bottom',
      icon: VARIANT_ICON[variant],
      cssClass: cssClasses,
      mode: 'ios',
      buttons: this.mapButtons(options.buttons),
    });

    await toast.present();
  }

  private mapButtons(buttons: AppToastButton[] | undefined): ToastButton[] | undefined {
    if (!buttons?.length) {
      return undefined;
    }

    return buttons.map((button) => ({
      text: button.text,
      role: button.role,
      handler: button.handler,
    }));
  }

  private mapLegacyColor(color: string): AppToastVariant {
    switch (color) {
      case 'success':
        return 'success';
      case 'danger':
        return 'error';
      case 'warning':
        return 'warning';
      default:
        return 'info';
    }
  }
}
