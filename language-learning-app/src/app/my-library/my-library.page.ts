import { Component, OnInit, ChangeDetectorRef, ChangeDetectionStrategy, Input, Output, EventEmitter, HostBinding } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { RouterModule, Router } from '@angular/router';
import { BundleService, ContentBundle } from '../services/bundle.service';
import { MaterialService, TutorMaterial } from '../services/material.service';
import { UserService } from '../services/user.service';
import { SharedModule } from '../shared/shared.module';

@Component({
  selector: 'app-my-library',
  templateUrl: './my-library.page.html',
  styleUrls: ['./my-library.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, RouterModule, SharedModule],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class MyLibraryPage implements OnInit {
  @Input() inline = false;
  @Output() goBackEvent = new EventEmitter<void>();

  @HostBinding('class.ml-host-inline')
  get hostInlineClass(): boolean { return this.inline; }

  activeTab: 'bundles' | 'materials' = 'bundles';
  purchasedBundles: ContentBundle[] = [];
  purchasedMaterials: TutorMaterial[] = [];
  isLoadingBundles = true;
  isLoadingMaterials = true;

  constructor(
    private bundleService: BundleService,
    private materialService: MaterialService,
    private userService: UserService,
    private router: Router,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit() {
    this.loadPurchasedBundles();
    this.loadPurchasedMaterials();
  }

  goBack() {
    this.goBackEvent.emit();
  }

  switchTab(tab: 'bundles' | 'materials') {
    this.activeTab = tab;
  }

  private loadPurchasedBundles() {
    this.isLoadingBundles = true;
    this.bundleService.getMyPurchases().subscribe({
      next: (purchases) => {
        this.purchasedBundles = purchases.map((p: any) => p.bundleId).filter(Boolean);
        this.isLoadingBundles = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.isLoadingBundles = false;
        this.cdr.markForCheck();
      }
    });
  }

  private loadPurchasedMaterials() {
    this.isLoadingMaterials = true;
    this.materialService.getMyPurchases().subscribe({
      next: (res: any) => {
        this.purchasedMaterials = res?.materials || [];
        this.isLoadingMaterials = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.isLoadingMaterials = false;
        this.cdr.markForCheck();
      }
    });
  }

  viewBundle(bundleId: string) {
    this.router.navigate(['/bundle', bundleId]);
  }

  viewMaterial(materialId: string) {
    this.router.navigate(['/material', materialId]);
  }

  getBundleItemCount(bundle: ContentBundle): number {
    return bundle.items?.length || 0;
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

  get isLoading(): boolean {
    return this.isLoadingBundles || this.isLoadingMaterials;
  }

  get isEmpty(): boolean {
    return this.purchasedBundles.length === 0 && this.purchasedMaterials.length === 0;
  }
}
