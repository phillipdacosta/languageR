import { Component, OnInit, OnDestroy, Input, Output, EventEmitter, ChangeDetectorRef, HostBinding } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, ToastController, ModalController } from '@ionic/angular';
import { Router, RouterModule } from '@angular/router';
import { ClassService } from '../services/class.service';
import { MaterialService, TutorMaterial } from '../services/material.service';
import { UserService } from '../services/user.service';
import { DomSanitizer } from '@angular/platform-browser';
import { SharedModule } from '../shared/shared.module';
import { formatTimeInTz, formatDateInTz } from '../shared/timezone.utils';
import { ClassInvitationModalComponent } from '../components/class-invitation-modal/class-invitation-modal.component';
import { ExploreFiltersModalComponent, ExploreFilters } from '../components/explore-filters-modal/explore-filters-modal.component';
import { ScheduleClassPage } from '../tutor-calendar/schedule-class/schedule-class.page';
import { TranslateService } from '@ngx-translate/core';
import { Subscription } from 'rxjs';
import { HomeInlineToolbarService } from '../services/home-inline-toolbar.service';
@Component({
  selector: 'app-explore',
  templateUrl: './explore.page.html',
  styleUrls: ['./explore.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, RouterModule, FormsModule, SharedModule, ScheduleClassPage]
})
export class ExplorePage implements OnInit, OnDestroy {
  @Input() inline = false;
  @Output() goBackEvent = new EventEmitter<void>();

  @HostBinding('class.explore-host-inline')
  get exploreHostInlineClass(): boolean {
    return this.inline;
  }

  publicClasses: any[] = [];
  filteredClasses: any[] = [];
  isLoading = false;
  currentUser: any = null;
  isTutorUser = false;
  showScheduleForm = false;
  activeFilterCount = 0;

  recommendedMaterials: any[] = [];
  recommendedStruggles: string[] = [];
  isLoadingRecommended = false;
  studentLanguage = '';

  filters: ExploreFilters = {
    language: 'any',
    priceMin: 0,
    priceMax: 200,
    dateFrom: '',
    dateTo: '',
    sortBy: 'date_asc',
    searchQuery: ''
  };

  private levelLabels: { [key: string]: string } = {};
  private tutorFallback = '';
  private durationSuffix = '';
  private animScheduleLabel = '';
  private animGoBackLabel = '';

  private langSub?: Subscription;
  private userSub?: Subscription;
  private toolbarExploreSub?: Subscription;

  private get userTz(): string | undefined {
    return this.currentUser?.profile?.timezone || undefined;
  }

  private get isDarkMode(): boolean {
    return document.documentElement.classList.contains('ion-palette-dark');
  }

  returningFromSchedule = false;

  constructor(
    private classService: ClassService,
    private materialService: MaterialService,
    private userService: UserService,
    private router: Router,
    private toast: ToastController,
    private sanitizer: DomSanitizer,
    private modalCtrl: ModalController,
    private cdr: ChangeDetectorRef,
    private translate: TranslateService,
    private homeInlineToolbar: HomeInlineToolbarService
  ) {}

  ngOnInit() {
    this.buildTranslatedLabels();

    this.langSub = this.translate.onLangChange.subscribe(() => {
      this.buildTranslatedLabels();
      this.syncExploreToolbarBackLabel();
      if (this.publicClasses.length > 0) {
        this.publicClasses = this.publicClasses.map(cls => this.enrichClassItem(cls));
        this.applyFilters();
      }
    });

    this.userSub = this.userService.currentUser$.subscribe(user => {
      this.currentUser = user;
      this.isTutorUser = user?.userType === 'tutor';
      if (!this.isTutorUser && user?.onboardingData?.languages?.length) {
        this.studentLanguage = user.onboardingData.languages[0];
        this.loadRecommendedMaterials();
      }
    });
    this.loadPublicClasses();

    if (this.inline) {
      this.toolbarExploreSub = this.homeInlineToolbar.onCloseExploreRequest$.subscribe(() => {
        this.handleExploreToolbarBack();
      });
      this.syncExploreToolbarBackLabel();
    }
  }

  ngOnDestroy() {
    this.langSub?.unsubscribe();
    this.userSub?.unsubscribe();
    this.toolbarExploreSub?.unsubscribe();
    if (this.inline) {
      this.homeInlineToolbar.setExploreToolbarBackLabel('');
    }
  }

  /** Mobile global toolbar back: schedule form → classes list; list → close inline explore */
  private handleExploreToolbarBack(): void {
    if (this.showScheduleForm) {
      this.onScheduleGoBack();
    } else {
      this.goBack();
    }
  }

  private syncExploreToolbarBackLabel(): void {
    if (!this.inline) return;
    if (this.showScheduleForm) {
      this.homeInlineToolbar.setExploreToolbarBackLabel(this.translate.instant('EXPLORE_CLASSES.PAGE_TITLE'));
    } else {
      this.homeInlineToolbar.setExploreToolbarBackLabel(this.translate.instant('EXPLORE_CLASSES.ANIM_GO_BACK'));
    }
  }

  private buildTranslatedLabels() {
    this.levelLabels = {
      'any': this.translate.instant('EXPLORE_CLASSES.LEVEL_ANY'),
      'beginner': this.translate.instant('EXPLORE_CLASSES.LEVEL_BEGINNER'),
      'intermediate': this.translate.instant('EXPLORE_CLASSES.LEVEL_INTERMEDIATE'),
      'advanced': this.translate.instant('EXPLORE_CLASSES.LEVEL_ADVANCED')
    };
    this.tutorFallback = this.translate.instant('EXPLORE_CLASSES.TUTOR_FALLBACK');
    this.durationSuffix = this.translate.instant('EXPLORE_CLASSES.DURATION_MIN');
    this.animScheduleLabel = this.translate.instant('EXPLORE_CLASSES.ANIM_SCHEDULE_CLASS');
    this.animGoBackLabel = this.translate.instant('EXPLORE_CLASSES.ANIM_GO_BACK');
  }

  scheduleClass() {
    const srcBtn = document.querySelector('.schedule-class-btn') as HTMLElement;
    const srcRect = srcBtn?.getBoundingClientRect();

    const scheduleBtnLabel = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 512 512" fill="none" stroke="currentColor" stroke-width="32" stroke-linecap="round"><line x1="256" y1="112" x2="256" y2="400"/><line x1="112" y1="256" x2="400" y2="256"/></svg><span>${this.animScheduleLabel}</span>`;

    const dark = this.isDarkMode;
    const btnBg = dark ? '#4298d2' : '#222222';
    const btnFg = '#ffffff';
    const linkColor = dark ? '#4298d2' : '#222222';

    let clone: HTMLElement | null = null;
    if (srcRect && srcBtn) {
      clone = document.createElement('div');
      clone.innerHTML = scheduleBtnLabel;
      Object.assign(clone.style, {
        position: 'fixed',
        left: `${srcRect.left}px`,
        top: `${srcRect.top}px`,
        width: `${srcRect.width}px`,
        height: `${srcRect.height}px`,
        zIndex: '10000',
        pointerEvents: 'none',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '8px',
        boxSizing: 'border-box',
        fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif',
        fontSize: '14px',
        fontWeight: '600',
        whiteSpace: 'nowrap',
        color: btnFg,
        backgroundColor: btnBg,
        border: 'none',
        borderRadius: '12px',
        transition: 'left 0.46s cubic-bezier(0.32, 0.72, 0, 1), top 0.46s cubic-bezier(0.32, 0.72, 0, 1), width 0.46s cubic-bezier(0.32, 0.72, 0, 1), height 0.46s cubic-bezier(0.32, 0.72, 0, 1), border-radius 0.46s cubic-bezier(0.32, 0.72, 0, 1), font-size 0.36s ease 0.1s, background-color 0.36s ease 0.1s, color 0.36s ease 0.1s',
      });
      document.body.appendChild(clone);
    }

    this.showScheduleForm = true;
    this.cdr.detectChanges();
    this.syncExploreToolbarBackLabel();

    if (clone && srcRect) {
      requestAnimationFrame(() => {
        if (!clone) return;
        clone.style.top = `${srcRect.top - 10}px`;
      });

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const dest = document.querySelector('.schedule-class-inline .go-back-link') as HTMLElement;

          if (dest && clone) {
            dest.style.transition = 'none';
            dest.style.opacity = '0';
            const destRect = dest.getBoundingClientRect();

            clone.style.transition = 'left 0.36s cubic-bezier(0.32, 0.72, 0, 1), top 0.36s cubic-bezier(0.32, 0.72, 0, 1), width 0.36s cubic-bezier(0.32, 0.72, 0, 1), height 0.36s cubic-bezier(0.32, 0.72, 0, 1), border-radius 0.36s cubic-bezier(0.32, 0.72, 0, 1), font-size 0.36s cubic-bezier(0.32, 0.72, 0, 1), background-color 0.36s ease, color 0.36s ease';
            clone.textContent = this.animGoBackLabel;
            clone.style.left = `${destRect.left}px`;
            clone.style.top = `${destRect.top}px`;
            clone.style.width = `${destRect.width}px`;
            clone.style.height = `${destRect.height}px`;
            clone.style.backgroundColor = 'transparent';
            clone.style.color = linkColor;
            clone.style.borderRadius = '0';
            clone.style.textDecoration = 'underline';

            setTimeout(() => {
              dest.style.opacity = '1';
              requestAnimationFrame(() => {
                if (clone?.parentNode) clone.remove();
              });
              setTimeout(() => { dest.style.transition = ''; dest.style.opacity = ''; }, 50);
            }, 420);
          } else if (clone) {
            clone.style.opacity = '0';
            setTimeout(() => { if (clone?.parentNode) clone.remove(); }, 350);
          }
        });
      });
    }
  }

  onScheduleGoBack() {
    const srcLink = document.querySelector('.schedule-class-inline .go-back-link') as HTMLElement;
    const srcRect = srcLink?.getBoundingClientRect();

    const dark = this.isDarkMode;
    const btnBg = dark ? '#4298d2' : '#222222';
    const btnFg = '#ffffff';
    const linkColor = dark ? '#4298d2' : '#222222';

    let clone: HTMLElement | null = null;
    if (srcRect) {
      clone = document.createElement('div');
      clone.textContent = this.animGoBackLabel;
      Object.assign(clone.style, {
        position: 'fixed',
        left: `${srcRect.left}px`,
        top: `${srcRect.top}px`,
        width: `${srcRect.width}px`,
        height: `${srcRect.height}px`,
        zIndex: '10000',
        pointerEvents: 'none',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxSizing: 'border-box',
        fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif',
        fontSize: '14px',
        fontWeight: '600',
        whiteSpace: 'nowrap',
        color: linkColor,
        backgroundColor: 'transparent',
        textDecoration: 'underline',
        border: 'none',
        transition: 'left 0.46s cubic-bezier(0.32, 0.72, 0, 1), top 0.46s cubic-bezier(0.32, 0.72, 0, 1), width 0.46s cubic-bezier(0.32, 0.72, 0, 1), height 0.46s cubic-bezier(0.32, 0.72, 0, 1), border-radius 0.46s cubic-bezier(0.32, 0.72, 0, 1), font-size 0.36s ease 0.1s, background-color 0.36s ease 0.1s, color 0.36s ease 0.1s',
      });
      document.body.appendChild(clone);
    }

    this.returningFromSchedule = true;
    this.showScheduleForm = false;
    this.cdr.detectChanges();
    this.syncExploreToolbarBackLabel();

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const destBtn = document.querySelector('.schedule-class-btn') as HTMLElement;

        if (clone && destBtn) {
          const destRect = destBtn.getBoundingClientRect();
          destBtn.style.transition = 'none';
          destBtn.style.opacity = '0';

          clone.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 512 512" fill="none" stroke="currentColor" stroke-width="32" stroke-linecap="round"><line x1="256" y1="112" x2="256" y2="400"/><line x1="112" y1="256" x2="400" y2="256"/></svg><span>${this.animScheduleLabel}</span>`;
          clone.style.textDecoration = 'none';
          clone.style.gap = '8px';
          clone.style.left = `${destRect.left}px`;
          clone.style.top = `${destRect.top}px`;
          clone.style.width = `${destRect.width}px`;
          clone.style.height = `${destRect.height}px`;
          clone.style.backgroundColor = btnBg;
          clone.style.color = btnFg;
          clone.style.borderRadius = '12px';

          setTimeout(() => {
            destBtn.style.opacity = '1';
            requestAnimationFrame(() => {
              if (clone?.parentNode) clone.remove();
            });
            setTimeout(() => {
              destBtn.style.transition = '';
              destBtn.style.opacity = '';
              this.returningFromSchedule = false;
              this.cdr.detectChanges();
            }, 50);
          }, 480);
        } else {
          if (clone) clone.remove();
          this.returningFromSchedule = false;
          this.cdr.detectChanges();
        }
      });
    });
  }

  onClassCreated() {
    this.showScheduleForm = false;
    this.syncExploreToolbarBackLabel();
    this.loadPublicClasses();
  }

  goBack() {
    if (this.inline) {
      this.goBackEvent.emit();
    } else {
      this.router.navigate(['/tabs/home']);
    }
  }

  loadPublicClasses() {
    this.isLoading = true;
    this.classService.getPublicClasses().subscribe({
      next: (response) => {
        if (response.success) {
          this.publicClasses = response.classes.map((cls: any) => this.enrichClassItem(cls));
          this.applyFilters();
        } else {
          this.publicClasses = [];
          this.filteredClasses = [];
        }
        this.isLoading = false;
        this.cdr.markForCheck();
      },
      error: (error) => {
        console.error('Error loading public classes:', error);
        this.isLoading = false;
        this.cdr.markForCheck();
        this.toast.create({
          message: this.translate.instant('EXPLORE_CLASSES.TOAST_LOAD_FAILED'),
          duration: 2000,
          color: 'danger'
        }).then(t => t.present());
      }
    });
  }

  private enrichClassItem(cls: any): any {
    const tz = this.userTz;
    const start = new Date(cls.startTime);
    const end = new Date(cls.endTime);
    const startStr = formatTimeInTz(start, tz);
    const endStr = formatTimeInTz(end, tz);

    return {
      ...cls,
      plainTextDescription: this.getPlainTextDescription(cls.description),
      displayDate: formatDateInTz(start, tz, { weekday: 'short', month: 'short', day: 'numeric', year: undefined }),
      displayTimeRange: `${startStr} – ${endStr}`,
      displayDuration: `${cls.duration || Math.round((end.getTime() - start.getTime()) / 60000)}${this.durationSuffix}`,
      displayTutorName: this.formatTutorName(cls.tutorId),
      displayLevel: this.getLevelLabel(cls.level),
      displayPrice: (cls.price || 0).toFixed(2),
      displayStudentCount: `${cls.confirmedStudents?.length || 0}/${cls.capacity}`,
    };
  }

  applyFilters() {
    let filtered = [...this.publicClasses];

    if (this.filters.language && this.filters.language !== 'any') {
      filtered = filtered.filter(cls => {
        const name = (cls.name || '').toLowerCase();
        const desc = (cls.description || '').toLowerCase();
        const lang = this.filters.language.toLowerCase();
        return name.includes(lang) || desc.includes(lang);
      });
    }

    filtered = filtered.filter(cls => {
      const price = cls.price || 0;
      return price >= this.filters.priceMin && price <= this.filters.priceMax;
    });

    if (this.filters.dateFrom) {
      const fromDate = new Date(this.filters.dateFrom);
      filtered = filtered.filter(cls => new Date(cls.startTime) >= fromDate);
    }

    if (this.filters.dateTo) {
      const toDate = new Date(this.filters.dateTo);
      toDate.setHours(23, 59, 59);
      filtered = filtered.filter(cls => new Date(cls.startTime) <= toDate);
    }

    if (this.filters.searchQuery) {
      const query = this.filters.searchQuery.toLowerCase();
      filtered = filtered.filter(cls => {
        const name = (cls.name || '').toLowerCase();
        const desc = (cls.description || '').toLowerCase();
        const tutorName = (cls.tutorId?.name || '').toLowerCase();
        return name.includes(query) || desc.includes(query) || tutorName.includes(query);
      });
    }

    filtered.sort((a, b) => {
      switch (this.filters.sortBy) {
        case 'date_asc': return new Date(a.startTime).getTime() - new Date(b.startTime).getTime();
        case 'date_desc': return new Date(b.startTime).getTime() - new Date(a.startTime).getTime();
        case 'price_asc': return (a.price || 0) - (b.price || 0);
        case 'price_desc': return (b.price || 0) - (a.price || 0);
        case 'name_asc': return (a.name || '').localeCompare(b.name || '');
        default: return 0;
      }
    });

    this.filteredClasses = filtered;
    this.computeActiveFilterCount();
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
    this.applyFilters();
  }

  private computeActiveFilterCount() {
    let count = 0;
    if (this.filters.language && this.filters.language !== 'any') count++;
    if (this.filters.priceMin !== 0 || this.filters.priceMax !== 200) count++;
    if (this.filters.dateFrom) count++;
    if (this.filters.dateTo) count++;
    if (this.filters.searchQuery) count++;
    if (this.filters.sortBy !== 'date_asc') count++;
    this.activeFilterCount = count;
  }

  async openFiltersModal() {
    const modal = await this.modalCtrl.create({
      component: ExploreFiltersModalComponent,
      componentProps: {
        initialFilters: { ...this.filters },
        totalClassCount: this.publicClasses.length
      },
      cssClass: 'explore-filters-modal-sheet'
    });

    await modal.present();

    const { data, role } = await modal.onWillDismiss();
    if (role === 'apply' && data) {
      this.filters = data;
      this.applyFilters();
    }
  }

  formatDate(dateString: string): string {
    const date = new Date(dateString);
    return formatDateInTz(date, this.userTz, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: undefined
    });
  }

  formatTime(dateString: string): string {
    const date = new Date(dateString);
    return formatTimeInTz(date, this.userTz);
  }

  getLevelLabel(level: string): string {
    return this.levelLabels[level] || this.levelLabels['any'] || level;
  }

  formatTutorName(tutorData: any): string {
    if (!tutorData) return this.tutorFallback;
    if (tutorData.firstName && tutorData.lastName) {
      return `${tutorData.firstName} ${tutorData.lastName.charAt(0).toUpperCase()}.`;
    }
    const fullName = tutorData.name || tutorData;
    if (typeof fullName !== 'string') return this.tutorFallback;
    const names = fullName.trim().split(' ');
    if (names.length <= 1) return names[0] || this.tutorFallback;
    return `${names[0]} ${names[names.length - 1].charAt(0).toUpperCase()}.`;
  }

  getPlainTextDescription(htmlDescription: string | undefined): string {
    if (!htmlDescription) return '';
    const temp = document.createElement('div');
    temp.innerHTML = htmlDescription;
    return temp.textContent || temp.innerText || '';
  }

  loadRecommendedMaterials() {
    if (!this.studentLanguage) return;
    this.isLoadingRecommended = true;
    this.materialService.getRecommendedMaterials(this.studentLanguage).subscribe({
      next: (res) => {
        this.isLoadingRecommended = false;
        if (res.success) {
          this.recommendedMaterials = res.materials || [];
          this.recommendedStruggles = res.struggles || [];
        }
        this.cdr.markForCheck();
      },
      error: () => {
        this.isLoadingRecommended = false;
        this.cdr.markForCheck();
      }
    });
  }

  viewMaterial(materialId: string) {
    this.router.navigate(['/material', materialId]);
  }

  formatMaterialTutorName(mat: any): string {
    const tutor = mat.tutorId;
    if (!tutor) return 'Tutor';
    if (tutor.firstName && tutor.lastName) {
      return `${tutor.firstName} ${tutor.lastName.charAt(0)}.`;
    }
    return tutor.name || 'Tutor';
  }

  viewClassDetails(classItem: any) {
    if (classItem._id) {
      this.router.navigate(['/tabs/lessons', classItem._id]);
    }
  }

  async handleClassAction(classItem: any, event: Event) {
    event.stopPropagation();
    if (classItem.hasInvitation && classItem.invitationStatus === 'pending') {
      const modal = await this.modalCtrl.create({
        component: ClassInvitationModalComponent,
        componentProps: { classId: classItem._id },
        cssClass: 'class-invitation-modal'
      });
      await modal.present();
      const { data } = await modal.onWillDismiss();
      if (data?.accepted || data?.declined) {
        this.loadPublicClasses();
      }
    } else {
      this.enrollInClass(classItem);
    }
  }

  async enrollInClass(classItem: any) {
    if (classItem.isEnrolled) {
      (await this.toast.create({ message: this.translate.instant('EXPLORE_CLASSES.TOAST_ALREADY_ENROLLED'), duration: 2000, color: 'primary' })).present();
      return;
    }
    if (classItem.isFull) {
      (await this.toast.create({ message: this.translate.instant('EXPLORE_CLASSES.TOAST_CLASS_FULL'), duration: 2000, color: 'warning' })).present();
      return;
    }
    (await this.toast.create({ message: this.translate.instant('EXPLORE_CLASSES.TOAST_ENROLL_SOON'), duration: 3000, color: 'primary' })).present();
  }
}
