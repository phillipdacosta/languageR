import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { ToastController } from '@ionic/angular';

@Component({
  selector: 'app-terms-privacy',
  templateUrl: './terms-privacy.page.html',
  styleUrls: ['./terms-privacy.page.scss'],
})
export class TermsPrivacyPage implements OnInit {
  lastUpdated = new Date('2025-01-01'); // Update this when terms change

  constructor(
    private router: Router,
    private toastController: ToastController
  ) { }

  ngOnInit() {
  }

  async acknowledge() {
    // Save acknowledgment to localStorage
    localStorage.setItem('terms_acknowledged', 'true');
    localStorage.setItem('terms_acknowledged_date', new Date().toISOString());

    const toast = await this.toastController.create({
      message: 'Thank you for reviewing our Terms & Privacy Policy',
      duration: 2000,
      color: 'success',
      position: 'bottom'
    });
    await toast.present();

    // Navigate back or to home
    this.router.navigate(['/']);
  }
}
