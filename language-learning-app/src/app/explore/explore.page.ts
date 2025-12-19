import { Component, OnInit, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, ToastController, ModalController } from '@ionic/angular';
import { Router, RouterModule } from '@angular/router';
import { ClassService } from '../services/class.service';
import { UserService } from '../services/user.service';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { SharedModule } from '../shared/shared.module';
import { ClassInvitationModalComponent } from '../components/class-invitation-modal/class-invitation-modal.component';

@Component({
  selector: 'app-explore',
  templateUrl: './explore.page.html',
  styleUrls: ['./explore.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, RouterModule, FormsModule, SharedModule]
})
export class ExplorePage implements OnInit {
  publicClasses: any[] = [];
  filteredClasses: any[] = [];
  isLoading = false;
  currentUser: any = null;
  showFiltersView = false;
  showLanguageDropdown = false;
  showSecondaryFilters = false;
  
  filters = {
    language: 'any',
    priceMin: 0,
    priceMax: 200,
    dateFrom: '',
    dateTo: '',
    sortBy: 'date_asc', // 'date_asc', 'date_desc', 'price_asc', 'price_desc', 'name_asc'
    searchQuery: ''
  };
  
  priceRange = {
    lower: 0,
    upper: 200
  };
  
  availableLanguages = [
    { value: 'any', label: 'Any language' },
    { value: 'Spanish', label: 'Spanish' },
    { value: 'French', label: 'French' },
    { value: 'German', label: 'German' },
    { value: 'Italian', label: 'Italian' },
    { value: 'Portuguese', label: 'Portuguese' },
    { value: 'Russian', label: 'Russian' },
    { value: 'Chinese', label: 'Chinese' },
    { value: 'Japanese', label: 'Japanese' },
    { value: 'Korean', label: 'Korean' },
    { value: 'Arabic', label: 'Arabic' },
    { value: 'Hindi', label: 'Hindi' },
    { value: 'Dutch', label: 'Dutch' },
    { value: 'Swedish', label: 'Swedish' },
    { value: 'Norwegian', label: 'Norwegian' },
    { value: 'Danish', label: 'Danish' },
    { value: 'Finnish', label: 'Finnish' },
    { value: 'Polish', label: 'Polish' },
    { value: 'Czech', label: 'Czech' },
    { value: 'Hungarian', label: 'Hungarian' },
    { value: 'Turkish', label: 'Turkish' },
    { value: 'Greek', label: 'Greek' },
    { value: 'Hebrew', label: 'Hebrew' },
    { value: 'Thai', label: 'Thai' },
    { value: 'Vietnamese', label: 'Vietnamese' },
    { value: 'Indonesian', label: 'Indonesian' },
    { value: 'Malay', label: 'Malay' },
    { value: 'Tagalog', label: 'Tagalog' },
    { value: 'Swahili', label: 'Swahili' },
    { value: 'English', label: 'English' }
  ];

  constructor(
    private classService: ClassService,
    private userService: UserService,
    private router: Router,
    private toast: ToastController,
    private sanitizer: DomSanitizer,
    private modalCtrl: ModalController
  ) {}

  ngOnInit() {
    this.userService.currentUser$.subscribe(user => {
      this.currentUser = user;
    });
    this.loadPublicClasses();
  }

  loadPublicClasses() {
    this.isLoading = true;
    this.classService.getPublicClasses().subscribe({
      next: (response) => {
        console.log('📚 Public classes loaded:', response);
        console.log('📚 Number of classes:', response.classes?.length || 0);
        if (response.classes && response.classes.length > 0) {
          console.log('📚 First class details:', {
            name: response.classes[0].name,
            startTime: response.classes[0].startTime,
            endTime: response.classes[0].endTime,
            isPublic: response.classes[0].isPublic,
            duration: response.classes[0].duration,
            level: response.classes[0].level
          });
        }
        if (response.success) {
          // Show ALL classes including cancelled ones with status
          this.publicClasses = response.classes.map((cls: any) => ({
            ...cls,
            sanitizedDescription: cls.description ? this.sanitizer.bypassSecurityTrustHtml(cls.description) : '',
            plainTextDescription: this.getPlainTextDescription(cls.description),
            tutorName: this.formatDisplayName(cls.name)
          }));
          this.filteredClasses = [...this.publicClasses]; // Initialize with all classes
          console.log('📚 After filtering, showing', this.filteredClasses.length, 'classes (including cancelled)');
          this.applyFilters();
        } else {
          this.publicClasses = [];
          this.filteredClasses = [];
        }
        this.isLoading = false;
      },
      error: (error) => {
        console.error('Error loading public classes:', error);
        this.isLoading = false;
        this.toast.create({
          message: 'Failed to load classes',
          duration: 2000,
          color: 'danger'
        }).then(t => t.present());
      }
    });
  }

  
  
  applyFilters() {
    let filtered = [...this.publicClasses];
    
    // Language filter (extract from class name or description)
    if (this.filters.language && this.filters.language !== 'any') {
      filtered = filtered.filter(cls => {
        const name = (cls.name || '').toLowerCase();
        const desc = (cls.description || '').toLowerCase();
        const lang = this.filters.language.toLowerCase();
        return name.includes(lang) || desc.includes(lang);
      });
    }
    
    // Price filter
    filtered = filtered.filter(cls => {
      const price = cls.price || 0;
      return price >= this.filters.priceMin && price <= this.filters.priceMax;
    });
    
    // Date range filter
    if (this.filters.dateFrom) {
      const fromDate = new Date(this.filters.dateFrom);
      filtered = filtered.filter(cls => {
        const classDate = new Date(cls.startTime);
        return classDate >= fromDate;
      });
    }
    
    if (this.filters.dateTo) {
      const toDate = new Date(this.filters.dateTo);
      toDate.setHours(23, 59, 59); // Include entire day
      filtered = filtered.filter(cls => {
        const classDate = new Date(cls.startTime);
        return classDate <= toDate;
      });
    }
    
    // Search query filter
    if (this.filters.searchQuery) {
      const query = this.filters.searchQuery.toLowerCase();
      filtered = filtered.filter(cls => {
        const name = (cls.name || '').toLowerCase();
        const desc = (cls.description || '').toLowerCase();
        const tutorName = (cls.tutorId?.name || '').toLowerCase();
        return name.includes(query) || desc.includes(query) || tutorName.includes(query);
      });
    }
    
    // Sort
    filtered.sort((a, b) => {
      switch (this.filters.sortBy) {
        case 'date_asc':
          return new Date(a.startTime).getTime() - new Date(b.startTime).getTime();
        case 'date_desc':
          return new Date(b.startTime).getTime() - new Date(a.startTime).getTime();
        case 'price_asc':
          return (a.price || 0) - (b.price || 0);
        case 'price_desc':
          return (b.price || 0) - (a.price || 0);
        case 'name_asc':
          return (a.name || '').localeCompare(b.name || '');
        default:
          return 0;
      }
    });
    
    this.filteredClasses = filtered;
  }
  
  toggleLanguageDropdown() {
    this.showLanguageDropdown = !this.showLanguageDropdown;
  }
  
  selectLanguage(language: string) {
    this.filters.language = language;
    this.showLanguageDropdown = false;
    this.applyFilters();
  }
  
  getCurrentLanguageLabel(): string {
    const currentLang = this.availableLanguages.find(lang => lang.value === this.filters.language);
    return currentLang ? currentLang.label : 'Any language';
  }
  
  onPriceRangeChange(event: any) {
    const value = event.detail.value;
    this.priceRange = {
      lower: value.lower,
      upper: value.upper
    };
    this.filters.priceMin = value.lower;
    this.filters.priceMax = value.upper;
    this.applyFilters();
  }
  
  toggleSecondaryFilters() {
    this.showSecondaryFilters = !this.showSecondaryFilters;
  }
  
  openFiltersView() {
    this.showFiltersView = true;
  }
  
  closeFilters() {
    this.showFiltersView = false;
  }
  
  clearFilters() {
    this.filters = {
      language: 'any',
      priceMin: 0,
      priceMax: 200,
      dateFrom: '',
      dateTo: '',
      sortBy: 'date_asc',
      searchQuery: ''
    };
    this.priceRange = {
      lower: 0,
      upper: 200
    };
    this.applyFilters();
  }
  
  getActiveFilterCount(): number {
    let count = 0;
    if (this.filters.language && this.filters.language !== 'any') count++;
    if (this.filters.priceMin !== 0 || this.filters.priceMax !== 200) count++;
    if (this.filters.dateFrom) count++;
    if (this.filters.dateTo) count++;
    if (this.filters.searchQuery) count++;
    if (this.filters.sortBy !== 'date_asc') count++;
    return count;
  }
  
  @HostListener('document:click', ['$event'])
  onDocumentClick(event: Event) {
    if (this.showLanguageDropdown) {
      this.showLanguageDropdown = false;
    }
  }

  formatDate(dateString: string): string {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { 
      weekday: 'short', 
      month: 'short', 
      day: 'numeric' 
    });
  }

// Format user name as "FirstName L." (e.g., "Phillip D.")
     formatDisplayName(user: any) {
    if (!user) return 'User';
    
    const firstName = user.firstName;
    const lastName = user.lastName;
    const fullName = user.name;
    
    if (firstName && lastName) {
      const lastInitial = lastName.charAt(0).toUpperCase();
      return `${firstName} ${lastInitial}.`;
    }
    
    if (fullName) {
      const parts = fullName.trim().split(' ').filter((p: string) => p.length > 0);
      if (parts.length >= 2) {
        const first = parts[0];
        const lastInitial = parts[parts.length - 1].charAt(0).toUpperCase();
        return `${first} ${lastInitial}.`;
      }
      return fullName;
    }
    
    return 'User';
  }

  formatTime(dateString: string): string {
    const date = new Date(dateString);
    return date.toLocaleTimeString('en-US', { 
      hour: 'numeric', 
      minute: '2-digit', 
      hour12: true 
    });
  }

  getLevelLabel(level: string): string {
    const levelMap: { [key: string]: string } = {
      'any': 'Any Level',
      'beginner': 'Beginner',
      'intermediate': 'Intermediate',
      'advanced': 'Advanced'
    };
    return levelMap[level] || 'Any Level';
  }

  formatTutorName(tutorData: any): string {
    if (!tutorData) return 'Tutor';
    
    // Check if we have firstName and lastName fields
    if (tutorData.firstName && tutorData.lastName) {
      const lastInitial = tutorData.lastName.charAt(0).toUpperCase();
      return `${tutorData.firstName} ${lastInitial}.`;
    }
    
    // Fallback to name field if firstName/lastName not available
    const fullName = tutorData.name || tutorData;
    if (typeof fullName !== 'string') return 'Tutor';
    
    const names = fullName.trim().split(' ');
    if (names.length === 0) return 'Tutor';
    if (names.length === 1) return names[0];
    
    const firstName = names[0];
    const lastName = names[names.length - 1];
    const lastInitial = lastName.charAt(0).toUpperCase();
    
    return `${firstName} ${lastInitial}.`;
  }

  getPlainTextDescription(htmlDescription: string | undefined): string {
    if (!htmlDescription) return '';
    
    // Create a temporary div to parse HTML
    const temp = document.createElement('div');
    temp.innerHTML = htmlDescription;
    
    // Get text content (strips all HTML tags)
    return temp.textContent || temp.innerText || '';
  }

  async enrollInClass(classItem: any) {
    // If already enrolled
    if (classItem.isEnrolled) {
      this.toast.create({
        message: 'You are already enrolled in this class',
        duration: 2000,
        color: 'primary'
      }).then(t => t.present());
      return;
    }

    // If they have a pending invitation, direct them to invitations
    if (classItem.hasInvitation && classItem.invitationStatus === 'pending') {
      this.toast.create({
        message: 'You have been invited to this class. Check your class invitations on the home page.',
        duration: 3000,
        color: 'warning'
      }).then(t => t.present());
      return;
    }

    // If they already declined the invitation
    if (classItem.hasInvitation && classItem.invitationStatus === 'declined') {
      this.toast.create({
        message: 'You previously declined this class invitation',
        duration: 2000,
        color: 'medium'
      }).then(t => t.present());
      return;
    }

    // If class is full
    if (classItem.isFull) {
      this.toast.create({
        message: 'This class is full',
        duration: 2000,
        color: 'warning'
      }).then(t => t.present());
      return;
    }

    // For now, show message that enrollment needs to be implemented
    // Later you can add logic to create a "join request" or auto-enroll if space available
    this.toast.create({
      message: 'Direct enrollment for public classes will be implemented soon. For now, ask the tutor for an invitation.',
      duration: 3000,
      color: 'primary'
    }).then(t => t.present());
  }

  viewClassDetails(classItem: any) {
    if (classItem._id) {
      this.router.navigate(['/tabs/home/explore', classItem._id]);
    }
  }

  async openClassInvitation(classId: string) {
    const modal = await this.modalCtrl.create({
      component: ClassInvitationModalComponent,
      componentProps: {
        classId
      },
      cssClass: 'class-invitation-modal'
    });

    await modal.present();

    const { data } = await modal.onWillDismiss();
    if (data?.accepted || data?.declined) {
      // Reload classes to reflect the change
      this.loadPublicClasses();
    }
  }

  handleClassAction(classItem: any, event: Event) {
    event.stopPropagation();
    
    // If they have a pending invitation, open the invitation modal
    if (classItem.hasInvitation && classItem.invitationStatus === 'pending') {
      this.openClassInvitation(classItem._id);
    } else {
      // Otherwise, proceed with normal enrollment
      this.enrollInClass(classItem);
    }
  }

}

