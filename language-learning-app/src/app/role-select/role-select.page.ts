import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { AlertController } from '@ionic/angular';
import { TranslateService } from '@ngx-translate/core';
import { AuthService } from '../services/auth.service';

@Component({
  selector: 'app-role-select',
  templateUrl: './role-select.page.html',
  styleUrls: ['./role-select.page.scss'],
  standalone: false,
})
export class RoleSelectPage {
  selectedRole: 'student' | 'tutor' | null = null;

  constructor(
    private router: Router,
    private authService: AuthService,
    private alertController: AlertController,
    private translateService: TranslateService,
  ) {}

  selectRole(role: 'student' | 'tutor') {
    this.selectedRole = role;
  }

  goBack(): void {
    void this.router.navigate(['/signup-language']);
  }

  async handleLogout(): Promise<void> {
    const alert = await this.alertController.create({
      header: this.translateService.instant('ONBOARDING.ALERTS.LOGOUT'),
      message: this.translateService.instant('ONBOARDING.ALERTS.LOGOUT_CONFIRM'),
      buttons: [
        {
          text: this.translateService.instant('ONBOARDING.ALERTS.CANCEL'),
          role: 'cancel',
        },
        {
          text: this.translateService.instant('ONBOARDING.ALERTS.LOGOUT'),
          handler: async () => {
            await this.authService.logout();
          },
        },
      ],
    });
    await alert.present();
  }

  next() {
    if (!this.selectedRole) return;
    localStorage.setItem('selectedUserType', this.selectedRole);
    if (this.selectedRole === 'tutor') {
      this.router.navigate(['/tutor-onboarding']);
    } else {
      this.router.navigate(['/onboarding']);
    }
  }
}
