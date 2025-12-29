import { Component, Input } from '@angular/core';
import { PopoverController } from '@ionic/angular';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { Lesson } from '../../services/lesson.service';

@Component({
  selector: 'app-class-menu-popover',
  standalone: true,
  imports: [CommonModule, IonicModule],
  template: `
    <ion-list>
      <ion-item button (click)="selectAction('invite')" *ngIf="isClass">
        <ion-icon name="person-add-outline" slot="start"></ion-icon>
        <ion-label>Invite student</ion-label>
      </ion-item>
      <ion-item button (click)="selectAction('reschedule')" *ngIf="!hasLessonStarted()">
        <ion-icon name="calendar-outline" slot="start"></ion-icon>
        <ion-label>Reschedule lesson</ion-label>
      </ion-item>
      <ion-item button (click)="selectAction('cancel')" class="ion-text-danger">
        <ion-icon name="close-circle-outline" slot="start"></ion-icon>
        <ion-label>Cancel lesson</ion-label>
      </ion-item>
    </ion-list>
  `,
  styles: [`
    ion-list {
      margin: 0;
      padding: 0;
    }
    ion-item {
      --padding-start: 16px;
      --padding-end: 16px;
    }
    .ion-text-danger {
      --color: var(--ion-color-danger);
    }
  `]
})
export class ClassMenuPopoverComponent {
  @Input() classId!: string;
  @Input() lesson!: Lesson;
  @Input() isClass: boolean = false;

  constructor(private popoverController: PopoverController) {}

  hasLessonStarted(): boolean {
    if (!this.lesson) return false;
    
    const status = (this.lesson as any)?.status;
    
    // Cannot reschedule if lesson is in progress, completed, or cancelled
    if (status === 'in_progress' || status === 'completed' || status === 'cancelled') {
      return true;
    }
    
    // Cannot reschedule if the start time has passed
    const now = new Date();
    const startTime = new Date(this.lesson.startTime);
    
    return now >= startTime;
  }

  selectAction(action: 'invite' | 'reschedule' | 'cancel') {
    this.popoverController.dismiss({ action });
  }
}

