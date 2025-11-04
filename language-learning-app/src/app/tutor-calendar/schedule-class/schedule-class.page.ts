import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { IonicModule, ToastController } from '@ionic/angular';
import { Router, RouterModule } from '@angular/router';
import { ClassService } from '../../services/class.service';
import { UserService } from '../../services/user.service';

@Component({
  selector: 'app-schedule-class',
  templateUrl: './schedule-class.page.html',
  styleUrls: ['./schedule-class.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, FormsModule, ReactiveFormsModule, RouterModule]
})
export class ScheduleClassPage {
  form = this.fb.group({
    name: ['', [Validators.required, Validators.maxLength(80)]],
    maxStudents: [1, [Validators.required, Validators.min(1), Validators.max(50)]],
    date: ['', Validators.required],
    time: ['', Validators.required],
    isPublic: [false],
    recurrenceType: ['none'],
    recurrenceCount: [1]
  });

  submitting = false;

  constructor(
    private fb: FormBuilder,
    private router: Router,
    private toast: ToastController,
    private classService: ClassService,
    private userService: UserService
  ) {}

  async submit() {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.submitting = true;
    try {
      // Compose a start/end ISO from date+time (default 60 minutes)
      const { date, time, name, maxStudents, isPublic } = this.form.value;
      const start = new Date(`${date}T${time}`);
      const end = new Date(start);
      end.setMinutes(end.getMinutes() + 60);

      const payload = {
        name: name as string,
        capacity: Number(maxStudents),
        isPublic: !!isPublic,
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        recurrence: {
          type: (this.form.value.recurrenceType as any) || 'none',
          count: Number(this.form.value.recurrenceCount) || 1
        }
      };

      this.classService.createClass(payload).subscribe({
        next: async (resp) => {
          console.log('📚 Class created:', resp);
          const t = await this.toast.create({ message: 'Class created and calendar updated', duration: 1500, color: 'success' });
          await t.present();
          // Ensure availability is fresh for calendar page
          this.userService.getAvailability().subscribe({
            next: () => this.router.navigate(['/tabs/tutor-calendar'])
          });
        },
        error: async (err) => {
          console.error('❌ Error creating class:', err);
          const t = await this.toast.create({ message: 'Failed to create class', duration: 1800, color: 'danger' });
          await t.present();
        }
      });
    } finally {
      this.submitting = false;
    }
  }
}


