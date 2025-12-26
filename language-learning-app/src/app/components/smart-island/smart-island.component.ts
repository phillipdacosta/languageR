import { Component, OnInit, OnDestroy, ChangeDetectorRef, NgZone } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { trigger, state, style, animate, transition } from '@angular/animations';

/**
 * Smart Island Component - Inspired by Apple's Dynamic Island
 * 
 * A magical, animated notification bar that appears at the top of the screen
 * to show contextual, actionable information without disrupting the user.
 * 
 * Features:
 * - Priority-based queue system (shows urgent items first)
 * - Smooth animations with spring physics
 * - Support for avatars, icons, and emoji
 * - Tappable actions
 * - Auto-rotation through multiple moments
 * - Glowing effect for urgent notifications
 * - Multiple avatar support (stacked)
 * 
 * Usage:
 * 1. Add to your template: <app-smart-island #smartIsland></app-smart-island>
 * 2. Get reference in component: @ViewChild('smartIsland') smartIsland!: SmartIslandComponent;
 * 3. Add moments:
 *    this.smartIsland.addMoment({
 *      type: 'invitation',
 *      priority: IslandPriority.HIGH,
 *      avatarUrl: 'https://...',
 *      title: 'New invitation',
 *      subtitle: 'from John Doe',
 *      action: () => this.openInvitation(),
 *      glow: true,
 *      duration: 5000
 *    });
 * 
 * Priority Levels:
 * - URGENT (1): Lesson starting in <5 min, requires immediate attention
 * - HIGH (2): New invitation, someone waiting, important updates
 * - MEDIUM (3): Tutor came online, achievement unlocked
 * - LOW (4): General stats, motivational messages
 * - AMBIENT (5): Background activity, passive updates
 */

export enum IslandPriority {
  URGENT = 1,      // Lesson starting in <5 min
  HIGH = 2,        // New invitation, tutor waiting
  MEDIUM = 3,      // Tutor came online, achievement
  LOW = 4,         // General stats, motivational
  AMBIENT = 5      // Background activity
}

export interface IslandMoment {
  type: 'invitation' | 'lesson-soon' | 'tutor-online' | 'achievement' | 'live-activity' | 
        'milestone' | 'rating' | 'tutor-shared' | 'idle-nudge' | 'recommendation' | 'custom';
  priority: IslandPriority;
  
  // Visual content
  avatarUrl?: string;
  avatars?: string[];  // For multiple tutors
  icon?: string;
  color?: string;
  gradient?: string;
  
  // Text content
  title: string;
  subtitle?: string;
  emoji?: string;
  
  // Behavior
  action?: () => void;
  duration?: number;  // How long to show (ms)
  animated?: boolean;
  glow?: boolean;
  
  // NEW: Persistence and expiry
  persistent?: boolean;   // If true, stays until acted upon (for invitations, ratings, etc.)
  expiresAt?: number;     // Timestamp when moment expires
  id?: string;            // Unique ID for tracking and removal
  viewCount?: number;     // How many times this moment has been shown
  maxViews?: number;      // Max times to show before removing (default: 3 for persistent)
  
  // New: Inline interaction support (for future enhancements)
  showRating?: boolean;  // Show star rating inline
  showQuickActions?: boolean;  // Show action buttons
  quickActions?: Array<{label: string; handler: () => void}>;
}

@Component({
  selector: 'app-smart-island',
  templateUrl: './smart-island.component.html',
  styleUrls: ['./smart-island.component.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule],
  animations: [
    trigger('slideDown', [
      transition(':enter', [
        style({ transform: 'translateY(-100px)', opacity: 0 }),
        animate('600ms cubic-bezier(0.34, 1.56, 0.64, 1)', 
                style({ transform: 'translateY(0)', opacity: 1 }))
      ]),
      transition(':leave', [
        animate('400ms ease-out', 
                style({ transform: 'translateY(-100px)', opacity: 0 }))
      ])
    ]),
    trigger('contentFade', [
      transition(':enter', [
        style({ opacity: 0, transform: 'translateX(-10px) scale(0.95)' }),
        animate('350ms cubic-bezier(0.34, 1.56, 0.64, 1)', 
                style({ opacity: 1, transform: 'translateX(0) scale(1)' }))
      ]),
      transition(':leave', [
        animate('250ms ease-out', 
                style({ opacity: 0, transform: 'translateX(10px) scale(0.95)' }))
      ])
    ]),
    trigger('avatarPop', [
      transition(':enter', [
        style({ transform: 'scale(0)', opacity: 0 }),
        animate('400ms cubic-bezier(0.34, 1.56, 0.64, 1)', 
                style({ transform: 'scale(1)', opacity: 1 }))
      ]),
      transition(':leave', [
        animate('250ms ease-out', 
                style({ transform: 'scale(0.8)', opacity: 0 }))
      ])
    ]),
    trigger('slideIn', [
      transition(':enter', [
        style({ transform: 'translateX(-10px)', opacity: 0 }),
        animate('300ms ease-out', 
                style({ transform: 'translateX(0)', opacity: 1 }))
      ]),
      transition(':leave', [
        animate('200ms ease-out', 
                style({ transform: 'translateX(10px)', opacity: 0 }))
      ])
    ]),
    trigger('avatarStack', [
      transition(':enter', [
        style({ transform: 'scale(0) translateX(-50%)', opacity: 0 }),
        animate('{{ delay }}ms cubic-bezier(0.34, 1.56, 0.64, 1)', 
                style({ transform: 'scale(1) translateX(0)', opacity: 1 }))
      ], { params: { delay: 0 } }),
      transition(':leave', [
        animate('250ms ease-out', 
                style({ transform: 'scale(0.8)', opacity: 0 }))
      ])
    ])
  ]
})
export class SmartIslandComponent implements OnInit, OnDestroy {
  currentMoment: IslandMoment | null = null;
  queue: IslandMoment[] = [];
  currentIndex: number = 0; // NEW: Track current position in queue
  allMoments: IslandMoment[] = []; // NEW: Keep all moments for navigation
  defaultGradient = 'linear-gradient(135deg, rgba(255, 255, 255, 0.98), rgba(255, 255, 255, 0.98))'; // White background
  showingSleepingState = true; // Start with sleeping state
  isCollapsed = true; // START COLLAPSED as ball
  hasBeenViewedOnce = false; // Track if user has seen events
  animateCollapse = false; // Only animate when collapsing from expanded
  animateExpand = false; // Only animate when expanding from collapsed
  isTransitioning = false; // Flag to smoothly transition between moments
  isClosing = false; // Prevent double-clicks on close button
  
  private rotationInterval: any;
  private currentTimeout: any;
  private readonly STORAGE_KEY = 'smart_island_dismissed_moments';
  private readonly DISMISSAL_EXPIRY_DAYS = 7; // Moments can show again after 7 days
  
  constructor(
    private cdr: ChangeDetectorRef,
    private ngZone: NgZone
  ) {}
  
  ngOnInit() {
    console.log('🌟 [Smart Island] Initialized - starting in collapsed ball state');
    // Start collapsed as a ball - no initial sleeping state display
    this.isCollapsed = true;
  }
  
  // Show sleeping state
  private showSleepingState() {
    this.showingSleepingState = true;
    this.currentMoment = {
      type: 'custom',
      priority: IslandPriority.AMBIENT,
      icon: 'moon-outline',
      title: 'All quiet',
      subtitle: 'No new activity',
      gradient: 'linear-gradient(135deg, rgba(255, 255, 255, 0.98), rgba(250, 250, 250, 0.98))',
      duration: 0 // Stays forever until replaced
    };
    
    // Auto-collapse after 4 seconds of sleeping state
    console.log('🌟 [Smart Island] Showing sleeping state, will collapse in 4 seconds...');
    if (this.currentTimeout) {
      clearTimeout(this.currentTimeout);
    }
    this.currentTimeout = setTimeout(() => {
      console.log('🌟 [Smart Island] 4 seconds of sleep, collapsing to ball...');
      this.collapseIsland();
    }, 4000);
  }
  
  // Public API: Add a moment to the queue
  addMoment(moment: IslandMoment) {
    console.log('🌟 [Smart Island] Adding moment:', moment.type, moment.title, 'Priority:', moment.priority);
    
    // Generate stable ID for tracking dismissals
    const stableId = this.generateStableMomentId(moment);
    moment.id = stableId;
    
    // Check if this moment has been dismissed recently
    // EXCEPTION: Don't check dismissal for actionable items (invitations, ratings, etc)
    // These should always appear when triggered
    const skipDismissalCheck = ['invitation', 'rating', 'tutor-shared', 'lesson-soon'].includes(moment.type);
    
    if (!skipDismissalCheck && this.isMomentDismissed(stableId)) {
      console.log('🌟 [Smart Island] Moment was recently dismissed, skipping:', stableId);
      return;
    }
    
    // Set default expiry based on type and priority if not specified
    if (!moment.expiresAt) {
      if (moment.persistent) {
        // Persistent items: 2 hours
        moment.expiresAt = Date.now() + (2 * 60 * 60 * 1000);
        console.log('🌟 [Smart Island] Persistent moment, expires in 2 hours');
      } else if (moment.priority === IslandPriority.URGENT) {
        // Urgent items: 30 minutes
        moment.expiresAt = Date.now() + (30 * 60 * 1000);
        console.log('🌟 [Smart Island] Urgent moment, expires in 30 minutes');
      } else {
        // Everything else: 1 hour
        moment.expiresAt = Date.now() + (60 * 60 * 1000);
        console.log('🌟 [Smart Island] Standard moment, expires in 1 hour');
      }
    }
    
    // Set persistent flag based on type if not specified
    if (moment.persistent === undefined) {
      // Actionable items are persistent by default
      moment.persistent = ['invitation', 'rating', 'tutor-shared'].includes(moment.type);
      if (moment.persistent) {
        console.log('🌟 [Smart Island] Auto-marked as persistent (actionable type)');
      }
    }
    
    // Initialize view count and max views for persistent moments
    if (moment.persistent) {
      if (moment.viewCount === undefined) {
        moment.viewCount = 0;
      }
      if (moment.maxViews === undefined) {
        moment.maxViews = 3; // Show max 3 times before giving up
      }
      console.log('🌟 [Smart Island] Persistent moment - viewCount:', moment.viewCount, 'maxViews:', moment.maxViews);
    }
    
    // Check if this moment already exists in allMoments (by ID) to prevent duplicates
    const existingIndex = this.allMoments.findIndex(m => m.id === moment.id);
    if (existingIndex !== -1) {
      console.log('🌟 [Smart Island] Moment already in allMoments, updating instead of adding');
      this.allMoments[existingIndex] = moment;
      return;
    }
    
    // Insert based on priority into allMoments
    const insertIndex = this.allMoments.findIndex(m => m.priority > moment.priority);
    if (insertIndex === -1) {
      this.allMoments.push(moment);
      console.log('🌟 [Smart Island] Pushed to end, allMoments length now:', this.allMoments.length);
    } else {
      this.allMoments.splice(insertIndex, 0, moment);
      console.log('🌟 [Smart Island] Inserted at index', insertIndex, 'allMoments length now:', this.allMoments.length);
    }
    
    console.log('🌟 [Smart Island] Current allMoments:', this.allMoments.map(m => `${m.title} (P:${m.priority}, Persistent:${m.persistent})`));
    
    // Clean expired moments
    this.cleanExpiredMoments();
    
    // If sleeping or collapsed, wake up to show the new moment
    if (this.showingSleepingState || this.isCollapsed) {
      console.log('🌟 [Smart Island] Island is sleeping/collapsed, waking up for new moment...');
      this.wakeUp();
    } else if (!this.currentMoment) {
      // If island is expanded but showing nothing, start showing moments
      console.log('🌟 [Smart Island] Island expanded but showing nothing, starting carousel...');
      this.showNext();
    }
  }
  
  // Clean up expired moments
  private cleanExpiredMoments() {
    const now = Date.now();
    const beforeCount = this.allMoments.length;
    this.allMoments = this.allMoments.filter(m => !m.expiresAt || m.expiresAt > now);
    const afterCount = this.allMoments.length;
    
    if (beforeCount !== afterCount) {
      console.log('🌟 [Smart Island] Cleaned', beforeCount - afterCount, 'expired moments');
    }
    
    // If current moment expired, move to next
    if (this.currentMoment?.expiresAt && this.currentMoment.expiresAt <= now) {
      console.log('🌟 [Smart Island] Current moment expired, moving to next');
      this.showNext();
    }
  }
  
  // Public API: Remove a specific moment by ID (when user acts on it)
  removeMoment(momentId: string) {
    console.log('🌟 [Smart Island] Removing moment by ID:', momentId);
    
    // Remove from allMoments
    const beforeCount = this.allMoments.length;
    this.allMoments = this.allMoments.filter(m => m.id !== momentId);
    const afterCount = this.allMoments.length;
    
    if (beforeCount !== afterCount) {
      console.log('🌟 [Smart Island] Removed moment from allMoments');
    }
    
    // If it's the current moment, adjust index and show next
    if (this.currentMoment?.id === momentId) {
      console.log('🌟 [Smart Island] Removed current moment, adjusting...');
      if (this.currentTimeout) {
        clearTimeout(this.currentTimeout);
      }
      
      // Adjust index if needed
      if (this.currentIndex >= this.allMoments.length) {
        this.currentIndex = Math.max(0, this.allMoments.length - 1);
      }
      
      this.showNext();
    }
  }
  
  // Wake up from sleeping state
  private wakeUp() {
    console.log('🌟 [Smart Island] Waking up - expanding from ball...');
    this.showingSleepingState = false;
    
    // If collapsed, use expandIsland to trigger animation
    if (this.isCollapsed) {
      this.expandIsland();
    } else {
      // Already expanded, just show next
      if (this.currentTimeout) {
        clearTimeout(this.currentTimeout);
      }
      this.showNext();
    }
  }
  
  // Public API: Clear all moments
  clearAll() {
    this.allMoments = [];
    this.currentMoment = null;
    this.currentIndex = 0;
    if (this.currentTimeout) {
      clearTimeout(this.currentTimeout);
    }
    this.cdr.detectChanges();
  }
  
  // Show next moment in queue (now uses carousel system)
  private showNext() {
    // Clean expired moments first
    this.cleanExpiredMoments();
    
    console.log('🌟 [Smart Island] showNext - allMoments length:', this.allMoments.length, 'currentIndex:', this.currentIndex);
    
    if (this.allMoments.length === 0) {
      // If no moments, collapse or show sleeping state
      if (this.hasBeenViewedOnce && !this.showingSleepingState) {
        console.log('🌟 [Smart Island] All events viewed, collapsing in 1 second...');
        setTimeout(() => {
          this.collapseIsland();
        }, 1000);
        return;
      }
      
      console.log('🌟 [Smart Island] No moments, returning to sleep');
      this.showSleepingState();
      return;
    }
    
    // Start carousel from beginning
    this.currentIndex = 0;
    this.showMomentAtIndex(0);
  }
  
  // User taps the island
  // User taps the main content area (executes action and dismisses moment)
  onIslandContentTap() {
    console.log('🌟 [Smart Island] Content tapped, sleeping:', this.showingSleepingState);
    
    // If sleeping, do nothing
    if (this.showingSleepingState) {
      return;
    }
    
    // Mark as viewed
    this.hasBeenViewedOnce = true;
    
    // If has action, execute it first
    if (this.currentMoment?.action) {
      console.log('🌟 [Smart Island] Executing action for:', this.currentMoment.title);
      this.currentMoment.action();
    }
    
    // Mark this moment as dismissed (so it won't show again for 7 days)
    // EXCEPTION: Don't mark actionable items as dismissed - they're removed from backend
    const skipDismissal = ['invitation', 'rating', 'tutor-shared', 'lesson-soon'].includes(this.currentMoment?.type || '');
    
    if (this.currentMoment?.id && !skipDismissal) {
      console.log('🌟 [Smart Island] Marking moment as dismissed:', this.currentMoment.id);
      this.markMomentDismissed(this.currentMoment.id);
    } else if (skipDismissal) {
      console.log('🌟 [Smart Island] Skipping dismissal tracking for actionable moment:', this.currentMoment?.type);
    }
    
    // Always remove the moment after clicking (whether it has action or not)
    if (this.currentMoment?.id) {
      const momentId = this.currentMoment.id;
      this.allMoments = this.allMoments.filter(m => m.id !== momentId);
      
      console.log('🌟 [Smart Island] Moment removed, remaining:', this.allMoments.length);
      
      // Adjust index if needed
      if (this.currentIndex >= this.allMoments.length && this.allMoments.length > 0) {
        this.currentIndex = this.allMoments.length - 1;
      }
    }
    
    // Clear current timeout
    if (this.currentTimeout) {
      clearTimeout(this.currentTimeout);
    }
    
    // If there are more moments, show current index
    if (this.allMoments.length > 0) {
      if (this.currentIndex >= this.allMoments.length) {
        this.currentIndex = 0;
      }
      this.showMomentAtIndex(this.currentIndex);
    } else {
      // No more moments, collapse
      console.log('🌟 [Smart Island] All moments dismissed, collapsing...');
      this.collapseIsland();
    }
  }
  
  // NEW: Navigate to previous moment
  onNavigatePrevious(event: Event) {
    console.log('🌟 [Smart Island] Navigate Previous tapped');
    event.stopPropagation(); // Prevent triggering content tap
    
    if (this.showingSleepingState || this.currentIndex === 0) {
      return;
    }
    
    // Clear auto-advance timeout
    if (this.currentTimeout) {
      clearTimeout(this.currentTimeout);
    }
    
    // Go to previous moment
    this.currentIndex--;
    this.showMomentAtIndex(this.currentIndex);
  }
  
  // NEW: Navigate to next moment
  onNavigateNext(event: Event) {
    console.log('🌟 [Smart Island] Navigate Next tapped');
    event.stopPropagation(); // Prevent triggering content tap
    
    if (this.showingSleepingState || this.currentIndex >= this.allMoments.length - 1) {
      return;
    }
    
    // Clear auto-advance timeout
    if (this.currentTimeout) {
      clearTimeout(this.currentTimeout);
    }
    
    // Go to next moment
    this.currentIndex++;
    this.showMomentAtIndex(this.currentIndex);
  }
  
  // NEW: Show specific moment by index
  private showMomentAtIndex(index: number) {
    if (index < 0 || index >= this.allMoments.length) {
      return;
    }
    
    this.ngZone.run(() => {
      // If there's no current moment, show immediately (first load)
      if (!this.currentMoment) {
        this.showingSleepingState = false;
        this.currentMoment = this.allMoments[index];
        this.currentIndex = index;
        this.isTransitioning = false;
        
        console.log('🌟 [Smart Island] Showing first moment:', this.currentMoment.title);
        this.cdr.detectChanges();
        
        // Start auto-advance timer if there's a duration
        const duration = this.currentMoment.duration || 5000;
        if (duration > 0 && index < this.allMoments.length - 1) {
          this.currentTimeout = setTimeout(() => {
            console.log('🌟 [Smart Island] Auto-advancing to next...');
            this.currentIndex++;
            this.showMomentAtIndex(this.currentIndex);
          }, duration);
        } else if (index === this.allMoments.length - 1) {
          // On last moment, collapse after duration
          this.currentTimeout = setTimeout(() => {
            console.log('🌟 [Smart Island] Last moment viewed, collapsing...');
            this.collapseIsland();
          }, duration + 1000);
        }
        return;
      }
      
      // Otherwise, do fade transition
      // Fade out current content
      this.isTransitioning = true;
      this.cdr.detectChanges();
      
      // Wait for fade out animation (300ms), then switch content
      setTimeout(() => {
        this.showingSleepingState = false;
        this.currentMoment = this.allMoments[index];
        this.currentIndex = index;
        
        console.log('🌟 [Smart Island] Showing moment', index + 1, 'of', this.allMoments.length, ':', this.currentMoment.title);
        
        // Fade in new content
        this.isTransitioning = false;
        this.cdr.detectChanges();
        
        // Start auto-advance timer if there's a duration
        const duration = this.currentMoment.duration || 5000;
        if (duration > 0 && index < this.allMoments.length - 1) {
          this.currentTimeout = setTimeout(() => {
            console.log('🌟 [Smart Island] Auto-advancing to next...');
            this.currentIndex++;
            this.showMomentAtIndex(this.currentIndex);
          }, duration);
        } else if (index === this.allMoments.length - 1) {
          // On last moment, collapse after duration
          this.currentTimeout = setTimeout(() => {
            console.log('🌟 [Smart Island] Last moment viewed, collapsing...');
            this.collapseIsland();
          }, duration + 1000);
        }
      }, 300); // Match the leave animation duration
    });
  }
  
  
  
  // User clicks the close button (X)
  onCloseIsland(event: Event) {
    console.log('🌟 [Smart Island] Close button clicked');
    event.stopPropagation(); // Prevent triggering content tap
    event.preventDefault(); // Prevent default behavior
    
    // Prevent double-clicks
    if (this.isClosing || this.isCollapsed) {
      return; // Already closing or collapsed, ignore
    }
    
    this.isClosing = true; // Set flag to prevent double-clicks
    
    // Clear all moments and collapse
    this.allMoments = [];
    this.currentMoment = null;
    this.currentIndex = 0;
    
    if (this.currentTimeout) {
      clearTimeout(this.currentTimeout);
    }
    
    this.collapseIsland();
    
    // Reset flag after a short delay
    setTimeout(() => {
      this.isClosing = false;
    }, 300);
  }
  
  // Collapse island into ball (after viewing all events)
  collapseIsland() {
    console.log('🌟 [Smart Island] Collapsing into ball...');
    this.animateCollapse = true; // Trigger roll animation
    this.isCollapsed = true;
    this.cdr.detectChanges();
  }
  
  // Expand island back to normal
  expandIsland() {
    console.log('🌟 [Smart Island] Expanding from ball...');
    this.animateExpand = true; // Trigger expand animation
    this.animateCollapse = false; // Reset collapse animation flag
    this.isCollapsed = false;
    
    // Small delay to allow animation to start before showing content
    setTimeout(() => {
      // If there are moments, show them
      if (this.allMoments.length > 0) {
        this.showNext();
      } else {
        // Otherwise show sleeping state
        this.showSleepingState();
      }
    }, 100);
    
    // Reset animation flag after animation completes
    setTimeout(() => {
      this.animateExpand = false;
    }, 600);
    
    this.cdr.detectChanges();
  }
  
  hasAvatars(): boolean {
    return !!(this.currentMoment?.avatarUrl || this.currentMoment?.avatars);
  }
  
  getStackDelay(index: number): number {
    return 100 + (index * 100);
  }
  
  ngOnDestroy() {
    if (this.rotationInterval) {
      clearInterval(this.rotationInterval);
    }
    if (this.currentTimeout) {
      clearTimeout(this.currentTimeout);
    }
  }
  
  // ====================
  // Dismissal Tracking
  // ====================
  
  /**
   * Get list of dismissed moment IDs and their dismissal timestamps
   */
  private getDismissedMoments(): { [key: string]: number } {
    try {
      const stored = localStorage.getItem(this.STORAGE_KEY);
      if (!stored) return {};
      
      const dismissed = JSON.parse(stored);
      const now = Date.now();
      const expiryMs = this.DISMISSAL_EXPIRY_DAYS * 24 * 60 * 60 * 1000;
      
      // Clean up old dismissals (older than expiry period)
      const cleaned: { [key: string]: number } = {};
      for (const [id, timestamp] of Object.entries(dismissed)) {
        if (now - (timestamp as number) < expiryMs) {
          cleaned[id] = timestamp as number;
        }
      }
      
      // Save cleaned data back
      if (Object.keys(cleaned).length !== Object.keys(dismissed).length) {
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(cleaned));
      }
      
      return cleaned;
    } catch (error) {
      console.error('🌟 [Smart Island] Error reading dismissed moments:', error);
      return {};
    }
  }
  
  /**
   * Mark a moment as dismissed
   */
  private markMomentDismissed(momentId: string) {
    try {
      const dismissed = this.getDismissedMoments();
      dismissed[momentId] = Date.now();
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(dismissed));
      console.log('🌟 [Smart Island] Marked moment as dismissed:', momentId);
    } catch (error) {
      console.error('🌟 [Smart Island] Error saving dismissed moment:', error);
    }
  }
  
  /**
   * Check if a moment has been recently dismissed
   */
  private isMomentDismissed(momentId: string): boolean {
    const dismissed = this.getDismissedMoments();
    return dismissed.hasOwnProperty(momentId);
  }
  
  /**
   * Generate a stable ID for a moment based on its type and key attributes
   */
  private generateStableMomentId(moment: IslandMoment): string {
    // If moment already has an ID, use it
    if (moment.id) return moment.id;
    
    // Generate based on type and content
    switch (moment.type) {
      case 'achievement':
      case 'milestone':
        // For achievements/milestones, use type + title (e.g., "achievement:100 words learned")
        return `${moment.type}:${moment.title}`;
      
      case 'invitation':
        // For invitations, should have unique ID from backend
        return moment.id || `invitation:${Date.now()}`;
      
      case 'lesson-soon':
        // For upcoming lessons, use lesson ID if available
        return moment.id || `lesson-soon:${Date.now()}`;
      
      case 'tutor-online':
        // For tutor online, use tutor ID
        return moment.id || `tutor-online:${moment.title}`;
      
      case 'rating':
        // For ratings, use lesson ID
        return moment.id || `rating:${Date.now()}`;
      
      case 'idle-nudge':
      case 'recommendation':
        // For nudges, use type + title
        return `${moment.type}:${moment.title}`;
      
      default:
        // Fallback: type + timestamp
        return `${moment.type}:${Date.now()}`;
    }
  }
  
  /**
   * Public API: Clear all dismissal history (useful for testing or "reset notifications" feature)
   */
  clearDismissalHistory() {
    try {
      localStorage.removeItem(this.STORAGE_KEY);
      console.log('🌟 [Smart Island] Cleared all dismissal history');
    } catch (error) {
      console.error('🌟 [Smart Island] Error clearing dismissal history:', error);
    }
  }
}

