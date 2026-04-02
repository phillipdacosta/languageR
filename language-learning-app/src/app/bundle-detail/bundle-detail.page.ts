import {
  Component, OnInit, OnDestroy, AfterViewInit,
  ChangeDetectorRef, ChangeDetectionStrategy,
  ElementRef, NgZone
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ToastController, AlertController, NavController } from '@ionic/angular';
import { RouterModule, ActivatedRoute, Router } from '@angular/router';
import { BundleService, ContentBundle } from '../services/bundle.service';
import { MaterialService, TutorMaterial } from '../services/material.service';
import { UserService } from '../services/user.service';
import { SharedModule } from '../shared/shared.module';
import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';

@Component({
  selector: 'app-bundle-detail',
  templateUrl: './bundle-detail.page.html',
  styleUrls: ['./bundle-detail.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, RouterModule, SharedModule],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class BundleDetailPage implements OnInit, AfterViewInit, OnDestroy {
  bundle: ContentBundle | null = null;
  isLoading = true;
  isPurchasing = false;
  hasPurchased = false;
  isOwner = false;
  currentUserId = '';

  imageBlur = 0;
  imageOpacity = 1;
  imageScale = 1;
  showAllItems = false;
  visibleItemLimit = 5;

  moreBundles: ContentBundle[] = [];
  moreMaterials: TutorMaterial[] = [];

  private scrollEl: HTMLElement | null = null;
  private scrollHandler: (() => void) | null = null;
  private rafId = 0;

  private referrerUrl = '/tabs/home';

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private navCtrl: NavController,
    private bundleService: BundleService,
    private materialService: MaterialService,
    private userService: UserService,
    private toastCtrl: ToastController,
    private alertCtrl: AlertController,
    private cdr: ChangeDetectorRef,
    private elRef: ElementRef,
    private zone: NgZone
  ) {
    this.referrerUrl = sessionStorage.getItem('bundleReferrer') || '/tabs/home';
  }

  ngOnInit() {
    this.userService.currentUser$.subscribe((u: any) => {
      this.currentUserId = u?._id || '';
    });

    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.loadBundle(id);
    }
  }

  ngAfterViewInit() {
    this.zone.runOutsideAngular(() => {
      setTimeout(() => this.attachScrollListener(), 200);
    });
  }

  ngOnDestroy() {
    this.detachScrollListener();
  }

  private attachScrollListener() {
    const host = this.elRef.nativeElement as HTMLElement;
    const ionContent = host.querySelector('ion-content');

    if (ionContent) {
      (ionContent as any).getScrollElement().then((el: HTMLElement) => {
        this.scrollEl = el;
        this.scrollHandler = () => {
          if (this.rafId) return;
          this.rafId = requestAnimationFrame(() => {
            this.onScroll();
            this.rafId = 0;
          });
        };
        this.scrollEl.addEventListener('scroll', this.scrollHandler, { passive: true });
      });
    }
  }

  private detachScrollListener() {
    if (this.scrollEl && this.scrollHandler) {
      this.scrollEl.removeEventListener('scroll', this.scrollHandler);
    }
    if (this.rafId) cancelAnimationFrame(this.rafId);
  }

  private onScroll() {
    if (!this.scrollEl) return;
    const scrollY = this.scrollEl.scrollTop || 0;
    const heroH = 320;
    const progress = Math.min(scrollY / heroH, 1);

    const imgEl = this.elRef.nativeElement.querySelector('.bd-hero-img, .bd-hero-placeholder') as HTMLElement;
    if (imgEl) {
      const blur = progress * 12;
      const opacity = 1 - progress * 0.6;
      const scale = 1 + progress * 0.08;
      imgEl.style.filter = `blur(${blur}px)`;
      imgEl.style.opacity = `${opacity}`;
      imgEl.style.transform = `scale(${scale})`;
    }
  }

  private loadBundle(id: string) {
    this.isLoading = true;
    this.bundleService.getBundle(id).subscribe({
      next: (res: any) => {
        this.bundle = res.bundle || res;
        this.hasPurchased = !!res.hasPurchased;
        this.isOwner = this.bundle?.tutorId?._id === this.currentUserId ||
                       (this.bundle?.tutorId as any) === this.currentUserId;
        this.isLoading = false;
        this.cdr.markForCheck();
        this.loadMoreFromTutor();
      },
      error: () => {
        this.isLoading = false;
        this.cdr.markForCheck();
      }
    });
  }

  private loadMoreFromTutor() {
    const tutorId = (this.bundle?.tutorId as any)?._id || this.bundle?.tutorId;
    if (!tutorId || typeof tutorId !== 'string') return;

    const bundleItemIds = new Set(
      (this.bundle?.items || []).map((item: any) => {
        const mid = (item.materialId as any)?._id || item.materialId;
        return typeof mid === 'string' ? mid : String(mid);
      })
    );

    this.bundleService.getTutorBundles(tutorId).subscribe({
      next: (bundles) => {
        this.moreBundles = (bundles || [])
          .filter(b => b._id !== this.bundle?._id)
          .slice(0, 4);
        this.cdr.markForCheck();
      },
      error: () => {}
    });

    this.materialService.getTutorMaterials(tutorId).subscribe({
      next: (res: any) => {
        const all: TutorMaterial[] = res?.materials || (Array.isArray(res) ? res : []);
        const extras = all.filter(m => !bundleItemIds.has(String(m._id)));
        this.moreMaterials = extras.slice(0, 6);
        this.cdr.markForCheck();
      },
      error: () => {}
    });
  }

  goBack() {
    const isTabRoute = this.referrerUrl.startsWith('/tabs/');
    this.navCtrl.navigateBack(this.referrerUrl, { animated: !isTabRoute });
  }

  editBundle() {
    if (this.bundle) {
      this.router.navigate(['/tabs/tab1'], { queryParams: { editBundle: this.bundle._id } });
    }
  }

  toggleShowAll() {
    this.showAllItems = !this.showAllItems;
    this.cdr.markForCheck();
  }

  get displayItems(): any[] {
    if (!this.bundle?.items) return [];
    if (this.showAllItems) return this.bundle.items;
    return this.bundle.items.slice(0, this.visibleItemLimit);
  }

  get hasMoreItems(): boolean {
    return (this.bundle?.items?.length || 0) > this.visibleItemLimit;
  }

  get tutorName(): string {
    const tutor = this.bundle?.tutorId as any;
    if (!tutor) return 'Tutor';
    if (tutor.firstName && tutor.lastName) {
      return `${tutor.firstName} ${tutor.lastName.charAt(0)}.`;
    }
    return tutor.name || 'Tutor';
  }

  get tutorFullName(): string {
    const tutor = this.bundle?.tutorId as any;
    if (!tutor) return 'Tutor';
    if (tutor.firstName && tutor.lastName) {
      return `${tutor.firstName} ${tutor.lastName}`;
    }
    return tutor.name || 'Tutor';
  }

  get tutorPicture(): string {
    return (this.bundle?.tutorId as any)?.picture || '';
  }

  get tutorBio(): string {
    const tutor = this.bundle?.tutorId as any;
    return tutor?.onboardingData?.bio || tutor?.bio || '';
  }

  get tutorSummary(): string {
    return (this.bundle?.tutorId as any)?.onboardingData?.summary || '';
  }

  get tutorExperience(): string {
    return (this.bundle?.tutorId as any)?.onboardingData?.experience || '';
  }

  get tutorOriginCountry(): string {
    return (this.bundle?.tutorId as any)?.country || '';
  }

  get tutorLivesIn(): string {
    const tutor = this.bundle?.tutorId as any;
    const residence = tutor?.residenceCountry || '';
    if (residence && residence !== tutor?.country) return residence;
    return '';
  }

  get tutorLanguages(): string[] {
    return (this.bundle?.tutorId as any)?.onboardingData?.languages || [];
  }

  get tutorTotalLessons(): number {
    return (this.bundle?.tutorId as any)?.stats?.totalLessons || 0;
  }

  get tutorHasCertifications(): boolean {
    const certs = (this.bundle?.tutorId as any)?.verification?.teachingCertifications;
    return Array.isArray(certs) && certs.some((c: any) => c.status === 'approved');
  }

  get tutorId(): string {
    return (this.bundle?.tutorId as any)?._id || '';
  }

  async viewTutorProfile() {
    const id = this.tutorId;
    if (!id) return;

    if (Capacitor.isNativePlatform()) {
      const url = `${window.location.origin}/tutor/${id}`;
      await Browser.open({ url });
    } else {
      window.open(`/tutor/${id}`, '_blank');
    }
  }

  get itemCount(): number {
    return this.bundle?.items?.length || 0;
  }

  get levelLabel(): string {
    if (!this.bundle?.level || this.bundle.level === 'any') return 'All Levels';
    return this.bundle.level.charAt(0).toUpperCase() + this.bundle.level.slice(1);
  }

  get isFree(): boolean {
    return this.bundle?.pricingType !== 'paid';
  }

  get canAccess(): boolean {
    return this.isFree || this.hasPurchased || this.isOwner;
  }

  getMaterialTypeLabel(type: string): string {
    switch (type) {
      case 'video_quiz': return 'Video Quiz';
      case 'reading': return 'Reading';
      case 'listening': return 'Listening';
      default: return type;
    }
  }

  getMaterialTypeIcon(type: string): string {
    switch (type) {
      case 'video_quiz': return 'videocam';
      case 'reading': return 'book';
      case 'listening': return 'headset';
      default: return 'document';
    }
  }

  viewMaterial(materialId: string) {
    if (materialId) {
      sessionStorage.setItem('materialReferrer', `/bundle/${this.bundle?._id}`);
      this.router.navigate(['/material', materialId]);
    }
  }

  viewBundle(bundleId: string) {
    if (bundleId) {
      sessionStorage.setItem('bundleReferrer', `/bundle/${this.bundle?._id}`);
      this.router.navigate(['/bundle', bundleId]);
    }
  }

  get hasMoreContent(): boolean {
    return this.moreBundles.length > 0 || this.moreMaterials.length > 0;
  }

  async purchaseBundle() {
    if (!this.bundle || this.isPurchasing) return;

    if (this.isFree) {
      this.executePurchase();
      return;
    }

    const alert = await this.alertCtrl.create({
      header: 'Get this Bundle',
      message: `Unlock all ${this.itemCount} items in "${this.bundle.title}" for $${this.bundle.price}?`,
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Purchase',
          handler: () => this.executePurchase()
        }
      ]
    });
    await alert.present();
  }

  private executePurchase() {
    if (!this.bundle) return;
    this.isPurchasing = true;
    this.cdr.markForCheck();

    this.bundleService.purchaseBundle(this.bundle._id, 'default').subscribe({
      next: async () => {
        this.isPurchasing = false;
        this.hasPurchased = true;
        this.cdr.markForCheck();
        const toast = await this.toastCtrl.create({
          message: 'Bundle unlocked! All materials are now available.',
          duration: 3000,
          position: 'bottom',
          color: 'success'
        });
        await toast.present();
      },
      error: async () => {
        this.isPurchasing = false;
        this.cdr.markForCheck();
        const toast = await this.toastCtrl.create({
          message: 'Purchase failed. Please try again.',
          duration: 2000,
          position: 'bottom',
          color: 'danger'
        });
        await toast.present();
      }
    });
  }
}
