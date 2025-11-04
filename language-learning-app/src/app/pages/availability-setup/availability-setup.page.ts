import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { RouterModule } from '@angular/router';
import { AvailabilitySetupComponent } from '../../components/availability-setup/availability-setup.component';

@Component({
  selector: 'app-availability-setup-page',
  templateUrl: './availability-setup.page.html',
  styleUrls: ['./availability-setup.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, RouterModule, AvailabilitySetupComponent]
})
export class AvailabilitySetupPage {
  constructor() {}
}
