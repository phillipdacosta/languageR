import { Component, Input, ViewEncapsulation } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { TranslateModule } from '@ngx-translate/core';

@Component({
  selector: 'app-mobile-recent-students',
  templateUrl: './mobile-recent-students.component.html',
  styleUrls: ['./mobile-recent-students.component.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, TranslateModule],
  encapsulation: ViewEncapsulation.None
})
export class MobileRecentStudentsComponent {
  @Input() recentStudents: { name: string; avatar: string | null }[] = [];
  @Input() staggerReady = false;
  @Input() staggerDone = false;
}
