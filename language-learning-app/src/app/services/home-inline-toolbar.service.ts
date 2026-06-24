import { Injectable } from '@angular/core';
import { BehaviorSubject, Subject } from 'rxjs';

/**
 * Syncs home tab inline panels (My Materials, Explore Classes) with the global mobile toolbar.
 * Tab1 toggles views; TabsPage shows back + label instead of Barnabi when open.
 */
@Injectable({ providedIn: 'root' })
export class HomeInlineToolbarService {
  private readonly materialsViewOpen = new BehaviorSubject(false);
  readonly materialsViewOpen$ = this.materialsViewOpen.asObservable();

  private readonly materialsToolbarBackLabel = new BehaviorSubject<string>('');
  readonly materialsToolbarBackLabel$ = this.materialsToolbarBackLabel.asObservable();

  private readonly closeMaterialsRequest = new Subject<void>();
  readonly onCloseMaterialsRequest$ = this.closeMaterialsRequest.asObservable();

  private readonly exploreViewOpen = new BehaviorSubject(false);
  readonly exploreViewOpen$ = this.exploreViewOpen.asObservable();

  private readonly exploreToolbarBackLabel = new BehaviorSubject<string>('');
  readonly exploreToolbarBackLabel$ = this.exploreToolbarBackLabel.asObservable();

  private readonly closeExploreRequest = new Subject<void>();
  readonly onCloseExploreRequest$ = this.closeExploreRequest.asObservable();

  setMaterialsViewOpen(open: boolean): void {
    this.materialsViewOpen.next(open);
    if (!open) {
      this.materialsToolbarBackLabel.next('');
    }
  }

  /** Shown next to the mobile toolbar back control while My Materials (inline) is open */
  setMaterialsToolbarBackLabel(label: string): void {
    this.materialsToolbarBackLabel.next(label?.trim() ?? '');
  }

  /** Toolbar back tapped while My Materials is showing */
  requestCloseMaterialsView(): void {
    this.closeMaterialsRequest.next();
  }

  setExploreViewOpen(open: boolean): void {
    this.exploreViewOpen.next(open);
    if (!open) {
      this.exploreToolbarBackLabel.next('');
    }
  }

  setExploreToolbarBackLabel(label: string): void {
    this.exploreToolbarBackLabel.next(label?.trim() ?? '');
  }

  requestCloseExploreView(): void {
    this.closeExploreRequest.next();
  }

  private readonly openEarningsRequest = new Subject<void>();
  readonly onOpenEarningsRequest$ = this.openEarningsRequest.asObservable();

  /** Flag checked by Tab1 in ionViewWillEnter (for cross-tab navigation) */
  pendingOpenEarnings = false;

  requestOpenEarnings(): void {
    this.openEarningsRequest.next();
  }

  consumePendingOpenEarnings(): boolean {
    if (this.pendingOpenEarnings) {
      this.pendingOpenEarnings = false;
      return true;
    }
    return false;
  }

  /** Approval wizard step to open when home loads (notification deep link). */
  pendingOpenTutorApprovalStep: string | null = null;

  consumePendingOpenTutorApproval(): string | null {
    const step = this.pendingOpenTutorApprovalStep;
    this.pendingOpenTutorApprovalStep = null;
    return step;
  }
}
