import { Component } from '@angular/core';
import { Router } from '@angular/router';

@Component({
  selector: 'app-role-select',
  templateUrl: './role-select.page.html',
  styleUrls: ['./role-select.page.scss'],
  standalone: false,
})
export class RoleSelectPage {
  selectedRole: 'student' | 'tutor' | null = null;

  constructor(private router: Router) {}

  selectRole(role: 'student' | 'tutor') {
    this.selectedRole = role;
  }

  next() {
    if (!this.selectedRole) return;
    localStorage.setItem('selectedUserType', this.selectedRole);
    // Plain navigate (no replaceUrl) so the user can `back` from onboarding
    // to /role-select if they want to change their mind.
    if (this.selectedRole === 'tutor') {
      this.router.navigate(['/tutor-onboarding']);
    } else {
      this.router.navigate(['/onboarding']);
    }
  }
}
