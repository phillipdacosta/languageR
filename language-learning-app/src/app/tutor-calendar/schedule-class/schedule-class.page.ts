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
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { QuillEditorComponent } from 'ngx-quill';

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
  imports: [CommonModule, IonicModule, FormsModule, ReactiveFormsModule, RouterModule, TutorAvailabilityViewerComponent, QuillEditorComponent]
})
export class ScheduleClassPage implements OnInit, OnDestroy {
  classType: 'one' | 'recurring' = 'recurring'; // Default to multiple students
  students: Student[] = [];
  loadingStudents = false;
  showStudentDropdown = false;
  showMultiStudentDropdown = false;
  showEarningsBreakdown = false; // Toggle for earnings breakdown visibility
  private userSubscription?: Subscription;
  
  // Pricing properties
  readonly STANDARD_LESSON_DURATION = 50; // Base duration for tutor rates (50 minutes, not 60)
  readonly PLATFORM_FEE_PERCENTAGE = 20; // 20% platform fee - competitive and fair
  tutorStandardRate: number = 25; // Tutor's rate for a standard 50-minute lesson
  suggestedPrice: number = 0;
  currentUser: any = null;

  form = this.fb.group({
    studentId: [''],
    studentIds: [[] as string[]], // For multiple student selection
    name: ['', [Validators.required, Validators.maxLength(80)]],
    description: ['', [Validators.required, Validators.minLength(20)]],
    maxStudents: [2, [Validators.required, Validators.min(2), Validators.max(50)]], // Default to 2 for group classes
    minStudents: [2, [Validators.required, Validators.min(2)]], // Minimum students for class to run (default to 2 for group classes)
    flexibleMinimum: [false], // Run class even if minimum not met
    level: ['', Validators.required], // Class level
    duration: ['', Validators.required], // Lesson duration in minutes
    date: ['', Validators.required],
    time: ['', Validators.required],
    isPublic: [false],
    thumbnail: [''],
    recurrenceType: ['none'],
    recurrenceCount: [1],
    useSuggestedPricing: [true], // Default to using suggested pricing
    customPrice: [null as number | null] // Custom price if not using suggested
  });

  levelOptions = [
    { value: 'any', label: 'Any Level' },
    { value: 'beginner', label: 'Beginner' },
    { value: 'intermediate', label: 'Intermediate' },
    { value: 'advanced', label: 'Advanced' }
  ];

  durationOptions = [
    { value: 25, label: '25 minutes' },
    { value: 50, label: '50 minutes' }
  ];

  submitting = false;
  thumbnailFile: File | null = null;
  thumbnailPreview: string | null = null;
  isUploadingThumbnail = false;

  quillConfig = {
    toolbar: [
      ['bold', 'italic', 'underline', 'strike'],
      [{ 'list': 'ordered'}, { 'list': 'bullet' }],
      [{ 'header': [1, 2, 3, false] }],
      ['link'],
      ['clean']
    ],
    placeholder: 'Describe what students will learn in this class, what materials they need, and any prerequisites...'
  };

  constructor(
    private fb: FormBuilder,
    private router: Router,
    private toast: ToastController,
    private classService: ClassService,
    private userService: UserService,
    private lessonService: LessonService,
    private modalController: ModalController,
    private http: HttpClient
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
        this.currentUser = user;
        // Load tutor's standard rate (for 50-minute lessons)
        this.tutorStandardRate = user?.onboardingData?.hourlyRate || 25;
        console.log('💰 Tutor standard rate (50-min):', this.tutorStandardRate);
        
        if (user?.id) {
          this.loadStudents();
        }
        
        // Calculate initial suggested price if level and duration are set
        this.calculateSuggestedPrice();
      });
    
    // Also try immediate load in case user is already available
    const currentUser = this.userService.getCurrentUserValue();
    if (currentUser?.id) {
      console.log('✅ User already available, loading students immediately');
      this.currentUser = currentUser;
      this.tutorStandardRate = currentUser?.onboardingData?.hourlyRate || 25;
      this.loadStudents();
      this.calculateSuggestedPrice();
    }
    
    // Subscribe to form changes to recalculate pricing
    this.form.get('level')?.valueChanges.subscribe(() => {
      this.calculateSuggestedPrice();
    });
    
    this.form.get('duration')?.valueChanges.subscribe(() => {
      this.calculateSuggestedPrice();
    });
    
    // Update minStudents max validator when maxStudents changes
    this.form.get('maxStudents')?.valueChanges.subscribe((maxStudents) => {
      const minStudentsControl = this.form.get('minStudents');
      if (minStudentsControl && maxStudents) {
        minStudentsControl.setValidators([
          Validators.required, 
          Validators.min(2), // Minimum 2 students for group classes
          Validators.max(maxStudents)
        ]);
        minStudentsControl.updateValueAndValidity();
        
        // Auto-adjust if minStudents exceeds new maxStudents
        const currentMin = minStudentsControl.value || 1;
        if (currentMin > maxStudents) {
          minStudentsControl.setValue(maxStudents);
        }
      }
    });
    
    // Set recommended minimum when duration or level changes
    this.form.get('duration')?.valueChanges.subscribe(() => {
      if (this.classType === 'recurring') {
        const recommended = this.getRecommendedMinimum();
        this.form.patchValue({ minStudents: recommended });
      }
    });
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
                  // Format display name as "FirstName LastInitial."
                  let displayName = student.name || student.email || 'Unknown';
                  
                  // Try to use firstName and lastName if available
                  if (student.firstName) {
                    const firstName = student.firstName;
                    const lastName = student.lastName || '';
                    displayName = lastName 
                      ? `${firstName} ${lastName.charAt(0).toUpperCase()}.`
                      : firstName;
                  } else if (student.name) {
                    // Parse from full name
                    const nameParts = student.name.trim().split(' ');
                    if (nameParts.length > 1) {
                      const firstName = nameParts[0];
                      const lastName = nameParts[nameParts.length - 1];
                      displayName = `${firstName} ${lastName.charAt(0).toUpperCase()}.`;
                    } else {
                      displayName = student.name;
                    }
                  }
                  
                  studentMap.set(studentId, {
                    _id: studentId,
                    name: displayName,
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
    console.log('🔍 [Schedule Class] Opening availability picker with user:', currentUser);
    
    if (!currentUser?.id) {
      console.error('❌ [Schedule Class] Cannot open availability picker: currentUser.id is missing', currentUser);
      const toast = await this.toast.create({
        message: 'Unable to load availability. Please try again.',
        duration: 3000,
        color: 'danger'
      });
      await toast.present();
      return;
    }

    console.log('✅ [Schedule Class] Valid user ID:', currentUser.id);

    // Get selected duration from form (only for recurring/multiple-students classes)
    const selectedDuration = this.classType === 'recurring' && this.form.value.duration 
      ? Number(this.form.value.duration) 
      : 25; // Default to 25

    console.log('📅 [Schedule Class] Creating modal with props:', {
      tutorId: currentUser.id,
      tutorName: currentUser.name || 'You',
      currentUserAuth0Id: currentUser.auth0Id,
      tutorAuth0Id: currentUser.auth0Id,
      selectedDuration
    });

    const modal = await this.modalController.create({
      component: TutorAvailabilityViewerComponent,
      componentProps: {
        tutorId: currentUser.id,
        tutorName: currentUser.name || 'You',
        currentUserAuth0Id: currentUser.auth0Id,
        tutorAuth0Id: currentUser.auth0Id,
        inline: true,  // Use inline mode
        selectionMode: true,  // Enable selection mode for own availability
        dismissOnSelect: true,  // Dismiss modal when slot is selected
        showDurationSelector: false, // Don't show duration selector (we set it from form)
        selectedDuration: selectedDuration // Pass the selected duration from form
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

  onThumbnailSelected(event: any) {
    const file = event.target.files[0];
    if (file) {
      // Validate file type
      if (!file.type.startsWith('image/')) {
        this.toast.create({
          message: 'Please select a valid image file',
          duration: 2000,
          color: 'danger'
        }).then(t => t.present());
        return;
      }
      
      // Validate file size (max 5MB)
      if (file.size > 5 * 1024 * 1024) {
        this.toast.create({
          message: 'Image size must be less than 5MB',
          duration: 2000,
          color: 'danger'
        }).then(t => t.present());
        return;
      }
      
      this.thumbnailFile = file;
      
      // Create preview
      const reader = new FileReader();
      reader.onload = (e: any) => {
        this.thumbnailPreview = e.target.result;
      };
      reader.readAsDataURL(file);
    }
  }

  removeThumbnail() {
    this.thumbnailFile = null;
    this.thumbnailPreview = null;
    this.form.patchValue({ thumbnail: '' });
  }

  async uploadThumbnailToGCS(file: File): Promise<string> {
    const formData = new FormData();
    formData.append('thumbnail', file);

    // Get current user for auth token
    const currentUser = this.userService.getCurrentUserValue();
    if (!currentUser || !currentUser.email) {
      throw new Error('User not authenticated');
    }

    // Create headers with ONLY Authorization - don't set Content-Type for FormData
    // Browser will automatically set Content-Type with boundary for multipart/form-data
    const userEmail = currentUser.email;
    const authToken = `Bearer dev-token-${userEmail.replace('@', '-').replace(/\./g, '-')}`;
    const headers = new HttpHeaders({
      'Authorization': authToken
      // Don't set Content-Type - let browser handle it for multipart/form-data
    });
    
    const response = await this.http.post<{ success: boolean; imageUrl: string }>(
      `${environment.backendUrl}/api/classes/upload-thumbnail`,
      formData,
      { headers }
    ).toPromise();

    if (!response || !response.success) {
      throw new Error('Failed to upload thumbnail');
    }

    return response.imageUrl;
  }

  async submit() {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    // Validate thumbnail for public classes
    if (this.classType === 'recurring' && this.form.value.isPublic && !this.thumbnailFile && !this.form.value.thumbnail) {
      const t = await this.toast.create({
        message: 'Please upload a thumbnail image for your public class',
        duration: 2000,
        color: 'warning'
      });
      await t.present();
      return;
    }

    this.submitting = true;
    
    try {
      // Upload thumbnail to GCS if it's a public class and a file is selected
      if (this.classType === 'recurring' && this.form.value.isPublic && this.thumbnailFile) {
        this.isUploadingThumbnail = true;
        
        try {
          const thumbnailUrl = await this.uploadThumbnailToGCS(this.thumbnailFile);
          this.form.patchValue({ thumbnail: thumbnailUrl });
          this.isUploadingThumbnail = false;
        } catch (uploadError) {
          console.error('Error uploading thumbnail:', uploadError);
          this.isUploadingThumbnail = false;
          const t = await this.toast.create({
            message: 'Failed to upload thumbnail. Please try again.',
            duration: 2000,
            color: 'danger'
          });
          await t.present();
          this.submitting = false;
          return;
        }
      }

      const { date, time, name, description, maxStudents, level, duration, isPublic, thumbnail, studentId, recurrenceType, recurrenceCount } = this.form.value;
      const start = new Date(`${date}T${time}`);
      const end = new Date(start);
      // Use selected duration for recurring classes, default to 60 for one-time lessons
      const lessonDuration = this.classType === 'recurring' && duration ? Number(duration) : 60;
      end.setMinutes(end.getMinutes() + lessonDuration);
      
      // Validate that the class time is in the future
      const now = new Date();
      if (end <= now) {
        const t = await this.toast.create({ 
          message: 'Please select a future date and time for your class', 
          duration: 2500, 
          color: 'warning' 
        });
        await t.present();
        this.submitting = false;
        return;
      }
      
      console.log('Creating class with times:', {
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        duration: lessonDuration,
        isPublic,
        name
      });

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
          description: description as string,
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
        const finalPrice = this.getFinalPrice();
        const payload = {
          name: name as string,
          description: description as string,
          capacity: Number(maxStudents),
          minStudents: Number(this.form.value.minStudents) || 2,
          flexibleMinimum: !!this.form.value.flexibleMinimum,
          level: level as string,
          duration: Number(duration),
          isPublic: !!isPublic,
          thumbnail: thumbnail || undefined,
          price: finalPrice,
          useSuggestedPricing: this.form.value.useSuggestedPricing,
          suggestedPrice: this.suggestedPrice,
          startTime: start.toISOString(),
          endTime: end.toISOString(),
          recurrence: {
            type: (recurrenceType as any) || 'none',
            count: Number(recurrenceCount) || 1
          },
          invitedStudentIds: this.form.value.studentIds || []
        };

        console.log('📤 Sending class creation payload:', payload);

        this.classService.createClass(payload).subscribe({
          next: async (resp: any) => {
            console.log('✅ Class created successfully:', resp);
            const createdClass = resp.class || resp.classes?.[0];
            if (createdClass) {
              console.log('📊 Class details:', {
                id: createdClass._id,
                name: createdClass.name,
                isPublic: createdClass.isPublic,
                duration: createdClass.duration,
                level: createdClass.level,
                startTime: createdClass.startTime,
                endTime: createdClass.endTime
              });
            }
            const t = await this.toast.create({ 
              message: `Class "${payload.name}" created successfully!`, 
              duration: 2000, 
              color: 'success' 
            });
            await t.present();
            this.userService.getAvailability().subscribe({
              next: () => this.router.navigate(['/tabs/tutor-calendar'])
            });
          },
          error: async (err) => {
            console.error('❌ Error creating class:', err);
            console.error('❌ Error details:', {
              status: err.status,
              message: err.error?.message || err.message,
              error: err.error
            });
            const errorMessage = err.error?.message || 'Failed to create class';
            const t = await this.toast.create({ 
              message: errorMessage, 
              duration: 3000, 
              color: 'danger' 
            });
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
      // Check if we can add more students
      if (!this.canSelectMoreStudents()) {
        this.showMaxStudentsReachedToast();
        return;
      }
      // Add if not selected
      currentIds.push(studentId);
    }
    
    this.form.patchValue({ studentIds: [...currentIds] });
    this.form.controls.studentIds.markAsTouched();
    // Don't close dropdown - allow multiple selections
  }

  canSelectMoreStudents(): boolean {
    const currentIds = this.form.value.studentIds || [];
    const maxStudents = this.form.value.maxStudents || 2;
    return currentIds.length < maxStudents;
  }

  isStudentDisabled(studentId: string): boolean {
    const currentIds = this.form.value.studentIds || [];
    const isSelected = currentIds.indexOf(studentId) > -1;
    // Student is disabled if not selected AND max capacity reached
    return !isSelected && !this.canSelectMoreStudents();
  }

  async showMaxStudentsReachedToast() {
    const maxStudents = this.form.value.maxStudents || 2;
    const toast = await this.toast.create({
      message: `Maximum of ${maxStudents} student${maxStudents > 1 ? 's' : ''} can be selected`,
      duration: 2000,
      position: 'top',
      color: 'warning'
    });
    await toast.present();
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

  // ============ PRICING METHODS ============
  
  calculateSuggestedPrice() {
    const level = this.form.get('level')?.value;
    const duration = this.form.get('duration')?.value;
    
    if (!level || !duration) {
      this.suggestedPrice = 0;
      return;
    }

    // Level multipliers based on expertise required
    const levelMultipliers: { [key: string]: number } = {
      'any': 0.8,
      'beginner': 0.9,
      'intermediate': 1.0,
      'advanced': 1.2
    };

    const baseRate = this.tutorStandardRate;
    const durationNum = Number(duration);
    const durationMultiplier = durationNum / this.STANDARD_LESSON_DURATION; // Divide by 50, not 60
    const groupDiscount = 0.80; // 20% off per student (better reward for tutors)
    const groupRewardMultiplier = 1.10; // 10% bonus for managing group dynamics
    const levelMultiplier = levelMultipliers[level] || 1.0;

    // Calculate: standardRate * (duration/50) * groupDiscount * groupRewardMultiplier * levelMultiplier
    this.suggestedPrice = Math.round(
      baseRate * durationMultiplier * groupDiscount * groupRewardMultiplier * levelMultiplier * 100
    ) / 100;

    console.log('💰 Calculated suggested price:', {
      baseRate,
      duration,
      level,
      groupDiscount,
      groupRewardMultiplier,
      suggestedPrice: this.suggestedPrice
    });
  }

  getFinalPrice(): number {
    if (this.classType !== 'recurring') return 0;
    
    return this.form.get('useSuggestedPricing')?.value
      ? this.suggestedPrice
      : (this.form.get('customPrice')?.value || 0);
  }

  calculatePotentialRevenue(): number {
    const price = this.getFinalPrice();
    const maxStudents = this.form.value.maxStudents || 0;
    return Math.round(price * maxStudents * 100) / 100;
  }

  calculateRevenueIncrease(): number {
    if (!this.tutorStandardRate || !this.form.value.duration) return 0;
    
    const classRevenue = this.calculatePotentialRevenue();
    const durationNum = Number(this.form.value.duration);
    const oneOnOneRevenue = this.tutorStandardRate * (durationNum / this.STANDARD_LESSON_DURATION);
    
    if (oneOnOneRevenue === 0) return 0;
    
    return Math.round(((classRevenue - oneOnOneRevenue) / oneOnOneRevenue) * 100);
  }

  onPricingToggleChange() {
    const customPriceControl = this.form.get('customPrice');
    const useSuggested = this.form.get('useSuggestedPricing')?.value;
    
    if (useSuggested) {
      // Using suggested pricing - clear custom price and remove validators
      customPriceControl?.clearValidators();
      customPriceControl?.setValue(null);
    } else {
      // Using custom pricing - add validators and pre-fill with suggested price
      customPriceControl?.setValidators([Validators.required, Validators.min(1)]);
      customPriceControl?.setValue(this.suggestedPrice);
    }
    customPriceControl?.updateValueAndValidity();
  }

  getLevelLabel(level: string | null | undefined): string {
    if (!level) return '';
    const levelOption = this.levelOptions.find(opt => opt.value === level);
    return levelOption?.label || level;
  }

  // ============ EARNINGS CALCULATOR METHODS ============
  
  calculateNetEarnings(gross: number): number {
    return Math.round(gross * (1 - this.PLATFORM_FEE_PERCENTAGE / 100) * 100) / 100;
  }

  calculate1on1Earnings(): number {
    if (!this.form.value.duration) return 0;
    const duration = Number(this.form.value.duration);
    // Calculate based on standard 50-minute lesson rate, not hourly
    const multiplier = duration / this.STANDARD_LESSON_DURATION;
    return Math.round(this.tutorStandardRate * multiplier * 100) / 100;
  }

  calculate1on1EarningsGross(): number {
    return this.calculate1on1Earnings();
  }

  calculate1on1EarningsNet(): number {
    return this.calculateNetEarnings(this.calculate1on1EarningsGross());
  }

  calculateGroupEarnings(studentCount: number): number {
    const pricePerStudent = this.getFinalPrice();
    return Math.round(pricePerStudent * studentCount * 100) / 100;
  }

  calculateGroupEarningsNet(studentCount: number): number {
    const gross = this.calculateGroupEarnings(studentCount);
    return this.calculateNetEarnings(gross);
  }

  getEarningsDifference(studentCount: number): string {
    const oneOnOne = this.calculate1on1Earnings();
    const group = this.calculateGroupEarnings(studentCount);
    const diff = group - oneOnOne;
    const sign = diff >= 0 ? '+' : '';
    return `${sign}$${Math.abs(diff).toFixed(2)}`;
  }

  isBreakEven(studentCount: number): boolean {
    const oneOnOne = this.calculate1on1Earnings();
    const group = this.calculateGroupEarnings(studentCount);
    return Math.abs(group - oneOnOne) < 0.5; // Within 50 cents
  }

  isProfitable(studentCount: number): boolean {
    const oneOnOne = this.calculate1on1Earnings();
    const group = this.calculateGroupEarnings(studentCount);
    return group >= oneOnOne;
  }

  getEarningsPercentage(studentCount: number): number {
    const oneOnOneNet = this.calculate1on1EarningsNet();
    const groupNet = this.calculateGroupEarningsNet(studentCount);
    if (oneOnOneNet === 0) return 0;
    const percentage = ((groupNet - oneOnOneNet) / oneOnOneNet) * 100;
    return Math.round(percentage);
  }

  getRecommendedMinimum(): number {
    if (!this.form.value.duration) return 2; // Default to 2 for group classes

    const oneOnOneNet = this.calculate1on1EarningsNet();
    const pricePerStudent = this.getFinalPrice();
    const maxStudents = this.form.value.maxStudents || 2;

    if (pricePerStudent === 0) return 2; // Default to 2 for group classes

    // Find the smallest group size where net earnings meet or exceed 1:1 net
    for (let count = 2; count <= maxStudents; count++) {
      const groupNet = this.calculateGroupEarningsNet(count);
      if (groupNet >= oneOnOneNet) {
        return count;
      }
    }

    // If none meet/exceed, recommend the max available
    return maxStudents;
  }

  getStudentCountRange(): number[] {
    const max = this.form.value.maxStudents || 10;
    // Show up to 5 options, or maxStudents if less
    const count = Math.min(5, max);
    return Array.from({ length: count }, (_, i) => i + 2); // Start from 2 students
  }
}


