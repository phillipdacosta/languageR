import { Component, Input, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ModalController } from '@ionic/angular';

interface Student {
  _id: string;
  name: string;
  email: string;
  picture?: string;
  userType?: 'student' | 'tutor';
}

@Component({
  selector: 'app-student-selection-actionsheet',
  templateUrl: './student-selection-actionsheet.component.html',
  styleUrls: ['./student-selection-actionsheet.component.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule]
})
export class StudentSelectionActionsheetComponent implements OnInit {
  @Input() students: Student[] = [];
  @Input() selectedStudentIds: string[] = [];
  @Input() maxStudents: number = 2;
  

  selectedIds: string[] = [];

  constructor(private modalController: ModalController) {}

  ngOnInit() {
    this.selectedIds = [...this.selectedStudentIds];
  }

  formatStudentName(student: Student): string {
    const nameParts = student.name.split(' ');
    const firstName = nameParts[0] || '';
    const lastName = nameParts.length > 1 ? nameParts[nameParts.length - 1] : '';
    return lastName 
      ? `${firstName} ${lastName.charAt(0).toUpperCase()}.`
      : firstName;
  }

  isStudentSelected(studentId: string): boolean {
    return this.selectedIds.includes(studentId);
  }

  isStudentDisabled(studentId: string): boolean {
    const isSelected = this.isStudentSelected(studentId);
    return !isSelected && this.selectedIds.length >= this.maxStudents;
  }

  toggleStudentSelection(studentId: string) {
    if (this.isStudentDisabled(studentId)) {
      return;
    }

    const index = this.selectedIds.indexOf(studentId);
    if (index > -1) {
      this.selectedIds.splice(index, 1);
    } else {
      this.selectedIds.push(studentId);
    }
  }

  onDone() {
    this.modalController.dismiss({ selectedIds: this.selectedIds });
  }

  onCancel() {
    this.modalController.dismiss();
  }
}
