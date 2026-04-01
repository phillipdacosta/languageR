import { Component, OnInit, ChangeDetectorRef, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule, Location } from '@angular/common';
import { IonicModule, ToastController, AlertController } from '@ionic/angular';
import { RouterModule, ActivatedRoute, Router } from '@angular/router';
import { BundleService, ContentBundle } from '../services/bundle.service';
import { UserService } from '../services/user.service';
import { SharedModule } from '../shared/shared.module';
import { environment } from '../../environments/environment';

@Component({
  selector: 'app-bundle-detail',
  templateUrl: './bundle-detail.page.html',
  styleUrls: ['./bundle-detail.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, RouterModule, SharedModule],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class BundleDetailPage implements OnInit {
  bundle: ContentBundle | null = null;
  isLoading = true;
  isPurchasing = false;
  hasPurchased = false;
  isOwner = false;
  currentUserId = '';

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private location: Location,
    private bundleService: BundleService,
    private userService: UserService,
    private toastCtrl: ToastController,
    private alertCtrl: AlertController,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit() {
    this.userService.currentUser$.subscribe((u: any) => {
      this.currentUserId = u?._id || '';
    });

    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.loadBundle(id);
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
      },
      error: () => {
        this.isLoading = false;
        this.cdr.markForCheck();
      }
    });
  }

  goBack() {
    this.location.back();
  }

  get tutorName(): string {
    const tutor = this.bundle?.tutorId as any;
    if (!tutor) return 'Tutor';
    if (tutor.firstName && tutor.lastName) {
      return `${tutor.firstName} ${tutor.lastName.charAt(0)}.`;
    }
    return tutor.name || 'Tutor';
  }

  get tutorPicture(): string {
    return (this.bundle?.tutorId as any)?.picture || '';
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
      case 'video_quiz': return 'Video';
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
    this.router.navigate(['/material', materialId]);
  }

  async purchaseBundle() {
    if (!this.bundle || this.isPurchasing) return;

    const alert = await this.alertCtrl.create({
      header: 'Purchase Bundle',
      message: `Get "${this.bundle.title}" for $${this.bundle.price}?`,
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
          message: 'Bundle purchased! All materials are now unlocked.',
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
