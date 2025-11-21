import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { IonicModule, ToastController, ModalController } from '@ionic/angular';
import { Router, RouterModule } from '@angular/router';
import { ClassService } from '../../services/class.service';
import { UserService } from '../../services/user.service';
import { LessonService } from '../../services/lesson.service';
import { TutorAvailabilityViewerComponent } from '../../components/tutor-availability-viewer/tutor-availability-viewer.component';
import { Subscription } from 'rxjs';
import { filter, take } from 'rxjs/operators';

interface Student {
  _id: string;
  name: string;
  email: string;
  picture?: string;
  userType?: 'student' | 'tutor';
}

@Component({
  selector: 'app-schedule-class',
  templateUrl: './schedule-class.page.html',
  styleUrls: ['./schedule-class.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, FormsModule, ReactiveFormsModule, RouterModule, TutorAvailabilityViewerComponent]
})
export class ScheduleClassPage implements OnInit, OnDestroy {
  classType: 'one' | 'recurring' = 'one';
  students: Student[] = [];
  loadingStudents = false;
  showStudentDropdown = false;
  showMultiStudentDropdown = false;
  private userSubscription?: Subscription;

  form = this.fb.group({
    studentId: [''],
    studentIds: [[] as string[]], // For multiple student selection
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
    private userService: UserService,
    private lessonService: LessonService,
    private modalController: ModalController
  ) {
    // Update validators based on class type
    this.updateFormValidators();
  }

  ngOnInit() {
    console.log('🚀 ScheduleClassPage ngOnInit() called');
    // Wait for user to be loaded before loading students
    this.userSubscription = this.userService.currentUser$
      .pipe(
        filter(user => !!user?.id),
        take(1)
      )
      .subscribe(user => {
        console.log('✅ User loaded in ngOnInit:', user?.id);
        if (user?.id) {
          this.loadStudents();
        }
      });
    
    // Also try immediate load in case user is already available
    const currentUser = this.userService.getCurrentUserValue();
    if (currentUser?.id) {
      console.log('✅ User already available, loading students immediately');
      this.loadStudents();
    }
  }

  ngOnDestroy() {
    if (this.userSubscription) {
      this.userSubscription.unsubscribe();
    }
  }

  onClassTypeChange() {
    this.updateFormValidators();
    if (this.classType === 'one') {
      this.form.patchValue({ recurrenceType: 'none', studentIds: [] });
      this.showMultiStudentDropdown = false;
    } else {
      this.form.patchValue({ studentId: '' });
      this.showStudentDropdown = false;
    }
  }

  private updateFormValidators() {
    if (this.classType === 'one') {
      this.form.get('studentId')?.setValidators([Validators.required]);
      this.form.get('recurrenceType')?.clearValidators();
      this.form.get('recurrenceCount')?.clearValidators();
    } else {
      this.form.get('studentId')?.clearValidators();
      this.form.get('recurrenceType')?.setValidators([Validators.required]);
      this.form.get('recurrenceCount')?.setValidators([Validators.required, Validators.min(1)]);
    }
    this.form.get('studentId')?.updateValueAndValidity();
    this.form.get('recurrenceType')?.updateValueAndValidity();
    this.form.get('recurrenceCount')?.updateValueAndValidity();
  }

  isSingleStudentSelected(): boolean {
    return !!this.form.value.studentId;
  }

  loadStudents() {
    console.log('🚀 loadStudents() called');
    this.loadingStudents = true;
    const currentUser = this.userService.getCurrentUserValue();
    console.log('👤 Current user from service:', currentUser);
    
    if (!currentUser?.id) {
      console.log('❌ No current user ID found');
      this.loadingStudents = false;
      return;
    }

    console.log('📞 Calling getMyLessons with userId:', currentUser.id);
    this.lessonService.getMyLessons(currentUser.id).subscribe({
      next: (response) => {
        if (response.success && response.lessons) {
          console.log('📚 All lessons received:', response.lessons.length);
          console.log('👤 Current user ID:', currentUser.id);
          
          // Extract unique students from lessons where current user is the tutor
          const studentMap = new Map<string, Student>();
          
          response.lessons.forEach((lesson, index) => {
            // Normalize tutorId - handle both object and string formats
            let tutorId: string | undefined;
            if (lesson.tutorId) {
              if (typeof lesson.tutorId === 'object' && lesson.tutorId !== null) {
                tutorId = (lesson.tutorId as any)._id?.toString() || (lesson.tutorId as any)._id;
              } else if (typeof lesson.tutorId === 'string') {
                tutorId = lesson.tutorId;
              } else {
                // Fallback: try to convert to string
                tutorId = String(lesson.tutorId);
              }
            }
            
            // Normalize current user ID for comparison
            const currentUserId = currentUser.id?.toString();
            
            // Debug logging for first few lessons
            if (index < 3) {
              console.log(`📋 Lesson ${index + 1}:`, {
                tutorId,
                tutorIdType: typeof tutorId,
                currentUserId,
                currentUserIdType: typeof currentUserId,
                tutorIdRaw: lesson.tutorId,
                hasStudentId: !!lesson.studentId,
                studentIdType: typeof lesson.studentId
              });
            }
            
            // Compare IDs (handle both string and ObjectId formats)
            if (tutorId && currentUserId) {
              // Normalize both to strings for comparison
              const normalizedTutorId = String(tutorId).trim();
              const normalizedCurrentUserId = String(currentUserId).trim();
              const isMatch = normalizedTutorId === normalizedCurrentUserId;
              
              if (index < 3) {
                console.log(`🔍 Comparison ${index + 1}:`, {
                  normalizedTutorId,
                  normalizedCurrentUserId,
                  isMatch
                });
              }
              
              if (isMatch && lesson.studentId && typeof lesson.studentId === 'object') {
                const student = lesson.studentId as any;
                console.log('✅ Found lesson with student:', student.name, student.email);
                
                const studentId = student._id?.toString() || student._id;
                if (studentId && !studentMap.has(studentId)) {
                  studentMap.set(studentId, {
                    _id: studentId,
                    name: student.name || 'Unknown',
                    email: student.email || '',
                    picture: student.picture,
                    userType: 'student'
                  });
                }
              } else if (isMatch && !lesson.studentId) {
                console.log('⚠️ Lesson matched but no studentId:', lesson);
              }
            } else {
              if (index < 3) {
                console.log(`❌ Lesson ${index + 1} - Missing IDs:`, { tutorId, currentUserId });
              }
            }
          });
          
          this.students = Array.from(studentMap.values());
          console.log('👥 Unique students found:', this.students.length, this.students.map(s => s.name));
          
          // If no students found, log all lessons for debugging
          if (this.students.length === 0 && response.lessons.length > 0) {
            console.log('🔍 No students found. All lessons:', response.lessons.map((l: any, i: number) => ({
              index: i,
              tutorId: l.tutorId,
              tutorIdType: typeof l.tutorId,
              tutorId_id: (l.tutorId as any)?._id,
              studentId: l.studentId,
              studentIdType: typeof l.studentId,
              studentId_id: (l.studentId as any)?._id,
              studentName: (l.studentId as any)?.name
            })));
          }
          
          // Sort by name
          this.students.sort((a, b) => a.name.localeCompare(b.name));
        } else {
          console.log('⚠️ No lessons found or response not successful');
        }
        this.loadingStudents = false;
      },
      error: (error) => {
        console.error('❌ Error loading students:', error);
        this.loadingStudents = false;
      }
    });
  }

  async openAvailabilityPicker() {
    const currentUser = this.userService.getCurrentUserValue();
    if (!currentUser?.id) {
      return;
    }

    const modal = await this.modalController.create({
      component: TutorAvailabilityViewerComponent,
      componentProps: {
        tutorId: currentUser.id,
        tutorName: currentUser.name || 'You',
        currentUserAuth0Id: currentUser.auth0Id,
        tutorAuth0Id: currentUser.auth0Id,
        inline: false,
        selectionMode: true  // Enable selection mode for own availability
      },
      cssClass: 'availability-picker-modal'
    });

    await modal.present();
    
    const { data } = await modal.onWillDismiss();
    if (data?.selectedDate && data?.selectedTime) {
      // Fill in the form with the selected date/time
      this.form.patchValue({
        date: data.selectedDate,
        time: data.selectedTime
      });
    }
  }

  async submit() {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.submitting = true;
    try {
      const { date, time, name, maxStudents, isPublic, studentId, recurrenceType, recurrenceCount } = this.form.value;
      const start = new Date(`${date}T${time}`);
      const end = new Date(start);
      end.setMinutes(end.getMinutes() + 60);

      if (this.classType === 'one') {
        if (!studentId) {
          const t = await this.toast.create({ message: 'Please select a student', duration: 1800, color: 'danger' });
          await t.present();
          this.submitting = false;
          return;
        }

        // Create a single lesson for one student
        const currentUser = this.userService.getCurrentUserValue();
        if (!currentUser?.id) {
          const t = await this.toast.create({ message: 'User not found', duration: 1800, color: 'danger' });
          await t.present();
          return;
        }

        // Use lesson service to create a lesson
        const lessonPayload = {
          tutorId: currentUser.id,
          studentId: studentId as string,
          startTime: start.toISOString(),
          endTime: end.toISOString(),
          subject: name as string,
          price: 0, // Default price, can be updated later
          duration: 60
        };

        this.lessonService.createLesson(lessonPayload).subscribe({
          next: async (resp) => {
            console.log('📚 Lesson created:', resp);
            const t = await this.toast.create({ message: 'Lesson scheduled successfully', duration: 1500, color: 'success' });
            await t.present();
            this.userService.getAvailability().subscribe({
              next: () => this.router.navigate(['/tabs/tutor-calendar'])
            });
          },
          error: async (err) => {
            console.error('❌ Error creating lesson:', err);
            const t = await this.toast.create({ message: 'Failed to schedule lesson', duration: 1800, color: 'danger' });
            await t.present();
          }
        });
      } else {
        // Create a recurring class
        const payload = {
          name: name as string,
          capacity: Number(maxStudents),
          isPublic: !!isPublic,
          startTime: start.toISOString(),
          endTime: end.toISOString(),
          recurrence: {
            type: (recurrenceType as any) || 'none',
            count: Number(recurrenceCount) || 1
          },
          invitedStudentIds: this.form.value.studentIds || []
        };

        this.classService.createClass(payload).subscribe({
          next: async (resp) => {
            console.log('📚 Class created:', resp);
            const t = await this.toast.create({ message: 'Class created and calendar updated', duration: 1500, color: 'success' });
            await t.present();
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
      }
    } finally {
      this.submitting = false;
    }
  }

  getSelectedStudentName(): string {
    const student = this.getSelectedStudent();
    return student?.name || '';
  }

  getSelectedStudent(): Student | undefined {
    const studentId = this.form.value.studentId;
    if (!studentId) return undefined;
    return this.students.find(s => s._id === studentId);
  }

  getSelectedStudentPicture(): string | undefined {
    const student = this.getSelectedStudent();
    return student?.picture;
  }

  getSelectedStudentType(): string {
    const student = this.getSelectedStudent();
    return student?.userType || 'student';
  }

  toggleStudentDropdown() {
    if (this.loadingStudents || this.students.length === 0) {
      return;
    }
    this.showStudentDropdown = !this.showStudentDropdown;
  }

  toggleStudentSelection(studentId: string) {
    // If clicking the already selected student, deselect it
    if (this.form.value.studentId === studentId) {
      this.clearStudent();
    } else {
      this.selectStudent(studentId);
    }
  }

  selectStudent(studentId: string) {
    this.form.patchValue({ studentId });
    this.showStudentDropdown = false;
    this.form.controls.studentId.markAsTouched();
  }

  clearStudent(event?: Event) {
    if (event) {
      event.stopPropagation(); // Prevent dropdown from opening
    }
    this.form.patchValue({ studentId: '' });
    this.form.controls.studentId.markAsTouched();
  }

  // Multi-select methods
  toggleMultiStudentDropdown() {
    if (this.loadingStudents || this.students.length === 0) {
      return;
    }
    this.showMultiStudentDropdown = !this.showMultiStudentDropdown;
  }

  toggleMultiStudentSelection(studentId: string) {
    const currentIds = this.form.value.studentIds || [];
    const index = currentIds.indexOf(studentId);
    
    if (index > -1) {
      // Remove if already selected
      currentIds.splice(index, 1);
    } else {
      // Add if not selected
      currentIds.push(studentId);
    }
    
    this.form.patchValue({ studentIds: [...currentIds] });
    this.form.controls.studentIds.markAsTouched();
    // Don't close dropdown - allow multiple selections
  }

  isStudentSelected(studentId: string): boolean {
    const currentIds = this.form.value.studentIds || [];
    return currentIds.includes(studentId);
  }

  getSelectedStudents(): Student[] {
    const selectedIds = this.form.value.studentIds || [];
    return this.students.filter(s => selectedIds.includes(s._id));
  }

  getSelectedStudentsCount(): number {
    return (this.form.value.studentIds || []).length;
  }

  clearAllStudents(event?: Event) {
    if (event) {
      event.stopPropagation();
    }
    this.form.patchValue({ studentIds: [] });
    this.form.controls.studentIds.markAsTouched();
  }
}


