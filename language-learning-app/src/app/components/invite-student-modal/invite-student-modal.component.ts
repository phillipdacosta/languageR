import { Component, Input, OnInit } from '@angular/core';
import { ModalController, ToastController } from '@ionic/angular';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { FormsModule } from '@angular/forms';
import { HttpClientModule } from '@angular/common/http';
import { UserService } from '../../services/user.service';
import { ClassService } from '../../services/class.service';
import { LessonService } from '../../services/lesson.service';
import { trigger, state, style, transition, animate, group, query } from '@angular/animations';

interface Student {
  _id: string;
  name: string;
  email: string;
  picture?: string;
  userType?: 'student' | 'tutor';
  invitationStatus?: 'pending' | 'accepted' | 'declined' | null;
}

@Component({
  selector: 'app-invite-student-modal',
  templateUrl: './invite-student-modal.component.html',
  styleUrls: ['./invite-student-modal.component.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, FormsModule, HttpClientModule],
  animations: [
    trigger('slideInOut', [
      transition(':enter', [
        style({ 
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          opacity: 0, 
          transform: 'translateX({{ direction }}%)' 
        }),
        animate('300ms ease-out', style({ 
          opacity: 1, 
          transform: 'translateX(0)' 
        }))
      ], { params: { direction: 100 } }),
      transition(':leave', [
        style({ 
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0
        }),
        animate('300ms ease-out', style({ 
          opacity: 0, 
          transform: 'translateX({{ direction }}%)' 
        }))
      ], { params: { direction: -100 } })
    ])
  ]
})
export class InviteStudentModalComponent implements OnInit {
  @Input() className!: string;
  @Input() classId!: string;
  @Input() classData?: any; // Class object with invitedStudents

  students: Student[] = [];
  filteredStudents: Student[] = []; // For search filtering
  searchTerm: string = ''; // Search input
  loadingStudents = false;
  showStudentDropdown = false;
  selectedStudents: string[] = [];
  inviting = false;
  removing = false;
  
  // Removal confirmation state
  showRemovalConfirmation = false;
  studentToRemove: Student | null = null;
  animationState: 'main' | 'confirmation' = 'main';
  dropdownStateBeforeRemoval = false; // Store dropdown state

  constructor(
    private modalController: ModalController,
    private userService: UserService,
    private classService: ClassService,
    private toastController: ToastController,
    private lessonService: LessonService
  ) {}

  ngOnInit() {
    this.loadStudents();
  }

  dismiss() {
    this.modalController.dismiss();
  }

  filterStudents() {
    if (!this.searchTerm || this.searchTerm.trim() === '') {
      this.filteredStudents = [...this.students];
    } else {
      const term = this.searchTerm.toLowerCase().trim();
      this.filteredStudents = this.students.filter(student =>
        student.name.toLowerCase().includes(term) ||
        student.email.toLowerCase().includes(term)
      );
    }
  }

  loadStudents() {
    this.loadingStudents = true;
    const currentUser = this.userService.getCurrentUserValue();
    
    if (!currentUser?.id) {
      console.error('No current user found');
      this.loadingStudents = false;
      return;
    }
    
    console.log('🔍 Loading students for invite modal...');
    console.log('📋 Class data:', this.classData);
    
    this.lessonService.getMyLessons(currentUser.id).subscribe({
      next: (response: any) => {
        console.log('✅ Lessons loaded:', response?.lessons?.length || 0);
        
        if (response && response.success && response.lessons) {
          // Extract unique students from lessons
          const studentMap = new Map<string, Student>();
          
          response.lessons.forEach((lesson: any) => {
            const studentData = lesson.studentId;
            if (studentData && typeof studentData === 'object') {
              // Check if this student has been invited to the class
              let invitationStatus: 'pending' | 'accepted' | 'declined' | null = null;
              
              if (this.classData?.invitedStudents) {
                const invitation = this.classData.invitedStudents.find((inv: any) => {
                  const invitedId = typeof inv.studentId === 'object' ? inv.studentId._id : inv.studentId;
                  return invitedId === studentData._id;
                });
                
                if (invitation) {
                  invitationStatus = invitation.status;
                  console.log(`📧 Student ${studentData.name} invitation status:`, invitationStatus);
                }
              }
              
              studentMap.set(studentData._id, {
                _id: studentData._id,
                name: this.formatStudentDisplayName(studentData),
                email: studentData.email,
                picture: studentData.picture,
                userType: studentData.userType || 'student',
                invitationStatus: invitationStatus
              });
            }
          });
          
          this.students = Array.from(studentMap.values());
          this.students.sort((a, b) => a.name.localeCompare(b.name));
          this.filteredStudents = [...this.students]; // Initialize filtered list
          console.log('👥 Students extracted:', this.students.length);
          
          // Pre-select students who have been invited (pending or accepted)
          this.selectedStudents = this.students
            .filter(s => s.invitationStatus === 'pending' || s.invitationStatus === 'accepted')
            .map(s => s._id);
          
          
          console.log('✅ Pre-selected students:', this.selectedStudents.length);
        }
        this.loadingStudents = false;
      },
      error: async (error) => {
        console.error('❌ Error loading students:', error);
        this.loadingStudents = false;
        
        const toast = await this.toastController.create({
          message: 'Failed to load students',
          duration: 2000,
          color: 'danger',
          position: 'bottom'
        });
        await toast.present();
      }
    });
  }

  toggleStudentDropdown() {
    if (this.loadingStudents || this.students.length === 0) return;
    this.showStudentDropdown = !this.showStudentDropdown;
  }

  toggleStudentSelection(studentId: string) {
    // Don't allow deselecting students who have already accepted
    const student = this.students.find(s => s._id === studentId);
    if (student?.invitationStatus === 'accepted') {
      return; // Cannot deselect accepted students
    }
    
    const index = this.selectedStudents.indexOf(studentId);
    if (index === -1) {
      this.selectedStudents.push(studentId);
    } else {
      this.selectedStudents.splice(index, 1);
    }
  }

  isStudentSelected(studentId: string): boolean {
    return this.selectedStudents.includes(studentId);
  }

  getSelectedStudentsCount(): number {
    return this.selectedStudents.length;
  }

  getSelectedStudents(): Student[] {
    return this.students.filter(s => this.selectedStudents.includes(s._id));
  }

  clearAllStudents(event: Event) {
    event.stopPropagation();
    // Keep students who have already accepted
    this.selectedStudents = this.selectedStudents.filter(id => {
      const student = this.students.find(s => s._id === id);
      return student?.invitationStatus === 'accepted';
    });
  }
  
  getStudentInvitationLabel(student: Student): string {
    if (student.invitationStatus === 'accepted') {
      return 'Already Accepted';
    } else if (student.invitationStatus === 'pending') {
      return 'Invitation Pending';
    }
    return '';
  }
  
  // Format student display name as "First L."
  formatStudentDisplayName(studentOrName: any): string {
    // Handle if it's a student object with firstName and lastName
    if (typeof studentOrName === 'object' && studentOrName) {
      const firstName = studentOrName.firstName;
      const lastName = studentOrName.lastName;
      
      if (firstName && lastName) {
        return `${this.capitalize(firstName)} ${lastName.charAt(0).toUpperCase()}.`;
      } else if (firstName) {
        return this.capitalize(firstName);
      }
      
      // Fall back to name field if firstName/lastName not available
      const rawName = studentOrName.name || studentOrName.email;
      if (!rawName) return 'Student';
      return this.formatStudentDisplayName(rawName); // Recursively handle the string
    }
    
    // Handle if it's just a string name
    const rawName = studentOrName;
    if (!rawName || typeof rawName !== 'string') {
      return 'Student';
    }

    const name = rawName.trim();

    // If it's an email, use the part before @ as a fallback
    if (name.includes('@')) {
      const base = name.split('@')[0];
      if (!base) return 'Student';
      const parts = base.split(/[.\s_]+/).filter(Boolean);
      const first = parts[0];
      const lastInitial = parts.length > 1 ? parts[parts.length - 1][0] : '';
      return lastInitial
        ? `${this.capitalize(first)} ${lastInitial.toUpperCase()}.`
        : this.capitalize(first);
    }

    const parts = name.split(' ').filter(Boolean);
    if (parts.length === 1) {
      return this.capitalize(parts[0]);
    }

    const first = this.capitalize(parts[0]);
    const last = parts[parts.length - 1];
    const lastInitial = last ? last[0].toUpperCase() : '';
    return lastInitial ? `${first} ${lastInitial}.` : first;
  }

  private capitalize(value: string): string {
    if (!value) return '';
    return value.charAt(0).toUpperCase() + value.slice(1);
  }
  
  getNewInvitationsCount(): number {
    return this.selectedStudents.filter(id => {
      const student = this.students.find(s => s._id === id);
      return !student?.invitationStatus; // Only count students without existing invitations
    }).length;
  }
  
  getAcceptedCount(): number {
    return this.selectedStudents.filter(id => {
      const student = this.students.find(s => s._id === id);
      return student?.invitationStatus === 'accepted';
    }).length;
  }
  
  getPendingCount(): number {
    return this.selectedStudents.filter(id => {
      const student = this.students.find(s => s._id === id);
      return student?.invitationStatus === 'pending';
    }).length;
  }
  
  getInviteButtonText(): string {
    const newCount = this.getNewInvitationsCount();
    const acceptedCount = this.getAcceptedCount();
    const pendingCount = this.getPendingCount();
    
    // If all selected are accepted, show different message
    if (acceptedCount > 0 && newCount === 0 && pendingCount === 0) {
      return `${acceptedCount} Already Confirmed`;
    }
    
    // Only show count for NEW invitations (not pending - pending means already invited)
    // Pending invitations shouldn't trigger a new invitation send
    if (newCount > 0) {
      return `Send ${newCount} Invitation${newCount !== 1 ? 's' : ''}`;
    }
    
    // If only pending or accepted (no new), don't show invitation count
    if (pendingCount > 0 || acceptedCount > 0) {
      return 'Send Invitations';
    }
    
    // Default
    return 'Send Invitations';
  }
  
  shouldDisableInviteButton(): boolean {
    const newCount = this.getNewInvitationsCount();
    
    // Only enable if there are NEW invitations to send (not already invited/pending)
    // Disable if no new invitations, or inviting in progress, or nothing selected
    return newCount === 0 || this.inviting || this.selectedStudents.length === 0;
  }

  async invite() {
    // Don't send if only accepted students are selected
    if (this.shouldDisableInviteButton()) {
      return;
    }

    this.inviting = true;
    try {
      // Only send invitations for NEW students (not already invited/pending/accepted)
      const studentsToInvite = this.selectedStudents.filter(id => {
        const student = this.students.find(s => s._id === id);
        return !student?.invitationStatus; // Only students without any invitation status
      });
      
      if (studentsToInvite.length === 0) {
        const toast = await this.toastController.create({
          message: 'No new invitations to send',
          duration: 2000,
          color: 'warning',
          position: 'bottom'
        });
        await toast.present();
        this.inviting = false;
        return;
      }
      
      const response = await this.classService.inviteStudentsToClass(this.classId, studentsToInvite).toPromise();
      
      if (response && response.success) {
        const toast = await this.toastController.create({
          message: response.message || `Successfully invited ${response.newInvitationsCount} student${response.newInvitationsCount !== 1 ? 's' : ''}`,
          duration: 3000,
          color: 'success',
          position: 'bottom'
        });
        await toast.present();
        
        this.modalController.dismiss({ invited: true, count: response.newInvitationsCount });
      }
    } catch (error: any) {
      console.error('Error inviting students:', error);
      const errorMessage = error?.error?.message || 'Failed to invite students';
      const toast = await this.toastController.create({
        message: errorMessage,
        duration: 3000,
        color: 'danger',
        position: 'bottom'
      });
      await toast.present();
    } finally {
      this.inviting = false;
    }
  }

  removeStudent(event: Event, student: Student) {
    event.stopPropagation(); // Prevent toggling selection
    
    if (this.removing) return;
    
    // Store the current dropdown state
    this.dropdownStateBeforeRemoval = this.showStudentDropdown;
    
    // Close dropdown
    this.showStudentDropdown = false;
    
    // Store the student and show confirmation view
    this.studentToRemove = student;
    this.showRemovalConfirmation = true;
    this.animationState = 'confirmation';
  }
  
  cancelRemoval() {
    this.showRemovalConfirmation = false;
    this.animationState = 'main';
    
    // Restore the dropdown state after animation completes
    setTimeout(() => {
      this.studentToRemove = null;
      this.showStudentDropdown = this.dropdownStateBeforeRemoval;
      this.dropdownStateBeforeRemoval = false;
    }, 350);
  }
  
  async confirmRemoval() {
    if (!this.studentToRemove || this.removing) return;
    
    this.removing = true;
    const student = this.studentToRemove;
    
    try {
      const response = await this.classService.removeStudentFromClass(this.classId, student._id).toPromise();
      
      if (response && response.success) {
        const toast = await this.toastController.create({
          message: `${student.name} has been removed from the class`,
          duration: 3000,
          color: 'success',
          position: 'bottom'
        });
        await toast.present();
        
        // Update classData by removing the student from invitedStudents
        if (this.classData?.invitedStudents) {
          this.classData.invitedStudents = this.classData.invitedStudents.filter((inv: any) => {
            const invitedId = typeof inv.studentId === 'object' ? inv.studentId._id : inv.studentId;
            return invitedId !== student._id;
          });
        }
        
        // Remove from selectedStudents if they were selected
        this.selectedStudents = this.selectedStudents.filter(id => id !== student._id);
        
        // Go back to main view
        this.showRemovalConfirmation = false;
        this.animationState = 'main';
        
        // Clear student and reload after animation
        setTimeout(() => {
          this.studentToRemove = null;
          this.loadStudents();
        }, 350);
      }
    } catch (error: any) {
      console.error('Error removing student:', error);
      const errorMessage = error?.error?.message || 'Failed to remove student';
      const toast = await this.toastController.create({
        message: errorMessage,
        duration: 3000,
        color: 'danger',
        position: 'bottom'
      });
      await toast.present();
    } finally {
      this.removing = false;
    }
  }
  
  getRemovalStatusText(): string {
    if (!this.studentToRemove) return '';
    return this.studentToRemove.invitationStatus === 'accepted' ? 'has already accepted' : 'has been invited';
  }
  
  getRemovalActionText(): string {
    if (!this.studentToRemove) return '';
    return this.studentToRemove.invitationStatus === 'accepted' ? 'remove them from this class' : 'cancel their invitation';
  }
}

