import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { Router, RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';

@Component({
  selector: 'app-admin-dashboard',
  templateUrl: './admin-dashboard.page.html',
  styleUrls: ['./admin-dashboard.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, RouterOutlet, RouterLink, RouterLinkActive]
})
export class AdminDashboardPage implements OnInit {

  constructor(private router: Router) {}

  ngOnInit() {
    // No need to manage selectedTab anymore - routerLinkActive handles it
  }
}

