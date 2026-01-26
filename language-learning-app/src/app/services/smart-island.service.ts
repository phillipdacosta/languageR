import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';
import { UserService } from './user.service';
import { WebSocketService } from './websocket.service';

export interface DynamicCard {
  type: 'tutors_online' | 'achievement' | 'streak' | 'pending_rating' | 'weekly_summary' | 
        'tip' | 'goal_reminder' | 'new_feature' | 'tutor_recommendation' | 'next_badge' | 'level_progress' | 'tutor_availability';
  priority: 'urgent' | 'high' | 'medium' | 'low';
  icon: string;
  iconColor?: string;
  title: string;
  subtitle: string;
  ctaText: string;
  ctaAction: string;
  data?: any;
  avatars?: string[]; // For tutors online (stacked avatars)
  avatarUrl?: string; // For single tutor/person
}

@Injectable({
  providedIn: 'root'
})
export class SmartIslandService {
  private currentCardSubject = new BehaviorSubject<DynamicCard | null>(null);
  public currentCard$ = this.currentCardSubject.asObservable();
  
  private availableCards: DynamicCard[] = [];
  private rotationInterval: any;
  private readonly ROTATION_INTERVAL = 10000; // 10 seconds
  
  // Storage key for dismissed tutor availability notifications
  private readonly DISMISSED_AVAILABILITY_KEY = 'dismissed_tutor_availability';
  private readonly DISMISSED_EXPIRY_HOURS = 24; // Clear dismissed entries after 24 hours

  constructor(
    private http: HttpClient,
    private userService: UserService,
    private websocketService: WebSocketService
  ) {
    this.initializeCardRotation();
    this.cleanupOldDismissedEntries();
  }

  /**
   * Initialize card rotation and listen to real-time updates
   */
  private initializeCardRotation() {
    // Note: Tutors online feature can be added later when WebSocket support is available
    // For now, we focus on gamification and student-specific cards
    
    // Start rotation
    this.startRotation();
  }

  /**
   * Start auto-rotating through available cards
   */
  private startRotation() {
    console.log('🔄 [SmartIsland] startRotation called');
    
    if (this.rotationInterval) {
      console.log('🔄 [SmartIsland] Clearing existing interval');
      clearInterval(this.rotationInterval);
    }

    this.rotationInterval = setInterval(() => {
      console.log('⏰ [SmartIsland] Rotation timer fired');
      this.rotateToNextCard();
    }, this.ROTATION_INTERVAL);
    
    console.log('🔄 [SmartIsland] Interval set for', this.ROTATION_INTERVAL, 'ms');

    // Show first card immediately
    this.rotateToNextCard();
  }

  /**
   * Rotate to the next highest priority card
   */
  private rotateToNextCard() {
    console.log('🔄 [SmartIsland] rotateToNextCard called, availableCards:', this.availableCards.length);
    
    if (this.availableCards.length === 0) {
      console.log('⚠️ [SmartIsland] No cards available');
      this.currentCardSubject.next(null);
      return;
    }

    // Sort by priority (urgent > high > medium > low)
    const priorityOrder = { urgent: 0, high: 1, medium: 2, low: 3 };
    const sortedCards = [...this.availableCards].sort((a, b) => 
      priorityOrder[a.priority] - priorityOrder[b.priority]
    );
    
    console.log('🔄 [SmartIsland] Sorted cards:', sortedCards.map(c => ({ type: c.type, priority: c.priority })));

    // Get current card index
    const currentCard = this.currentCardSubject.value;
    const currentIndex = currentCard 
      ? sortedCards.findIndex(c => c.type === currentCard.type)
      : -1;
    
    console.log('🔄 [SmartIsland] Current card type:', currentCard?.type, 'index:', currentIndex);

    // Rotate to next card in priority order
    const nextIndex = (currentIndex + 1) % sortedCards.length;
    console.log('🔄 [SmartIsland] Next index:', nextIndex, 'Next card type:', sortedCards[nextIndex].type);
    
    this.currentCardSubject.next(sortedCards[nextIndex]);
  }

  /**
   * Update or add a card to the available cards
   */
  private updateOrAddCard(card: DynamicCard) {
    const existingIndex = this.availableCards.findIndex(c => c.type === card.type);
    
    if (existingIndex >= 0) {
      console.log('📝 [SmartIsland] Updating existing card:', card.type);
      this.availableCards[existingIndex] = card;
    } else {
      console.log('➕ [SmartIsland] Adding new card:', card.type, 'priority:', card.priority);
      this.availableCards.push(card);
    }
    
    console.log('📊 [SmartIsland] Total cards now:', this.availableCards.length, 
      'Types:', this.availableCards.map(c => c.type));

    // If this is an urgent card, show it immediately
    if (card.priority === 'urgent') {
      console.log('🚨 [SmartIsland] Urgent card, showing immediately:', card.type);
      this.currentCardSubject.next(card);
    }
  }

  /**
   * Remove a card from available cards
   */
  private removeCard(type: string) {
    this.availableCards = this.availableCards.filter(c => c.type !== type);
    
    // If current card was removed, rotate
    const currentCard = this.currentCardSubject.value;
    if (currentCard && currentCard.type === type) {
      this.rotateToNextCard();
    }
  }

  /**
   * Remove a specific tutor from the availability card
   * If no tutors remain, remove the card entirely
   */
  public removeTutorFromAvailabilityCard(bookedTutorId: string) {
    const card = this.availableCards.find(c => c.type === 'tutor_availability');
    
    if (!card || !card.data?.tutors) {
      console.log('🔍 [SmartIsland] No tutor availability card found');
      return;
    }
    
    // Filter out the booked tutor
    const remainingTutors = card.data.tutors.filter((t: any) => {
      const tutorId = t.id || t._id;
      return tutorId !== bookedTutorId;
    });
    
    console.log('🔍 [SmartIsland] Remaining tutors after booking:', {
      original: card.data.tutors.length,
      remaining: remainingTutors.length,
      bookedTutorId
    });
    
    if (remainingTutors.length === 0) {
      // No more tutors - remove the card
      console.log('🗑️ [SmartIsland] All tutors booked, removing card');
      this.removeCard('tutor_availability');
    } else {
      // Update card with remaining tutors
      console.log('🔄 [SmartIsland] Updating card with remaining tutors');
      this.addTutorAvailabilityCard(remainingTutors);
    }
  }

  /**
   * Remove tutor availability card completely
   */
  public removeTutorAvailabilityCard() {
    console.log('🗑️ [SmartIsland] removeTutorAvailabilityCard called');
    console.log('🗑️ [SmartIsland] Before removal - availableCards:', this.availableCards.map(c => c.type));
    console.log('🗑️ [SmartIsland] Before removal - currentCard:', this.currentCardSubject.value?.type);
    
    // Remove from available cards
    const hadCard = this.availableCards.some(c => c.type === 'tutor_availability');
    this.availableCards = this.availableCards.filter(c => c.type !== 'tutor_availability');
    
    // If the current card was the tutor availability card, force an update
    const currentCard = this.currentCardSubject.value;
    if (currentCard && currentCard.type === 'tutor_availability') {
      console.log('🗑️ [SmartIsland] Current card WAS tutor_availability, forcing rotation');
      // Force emit null first to ensure UI updates, then rotate to next
      this.currentCardSubject.next(null);
      
      // Small delay then show next card if available
      setTimeout(() => {
        if (this.availableCards.length > 0) {
          this.rotateToNextCard();
        }
      }, 100);
    }
    
    console.log('🗑️ [SmartIsland] After removal - availableCards:', this.availableCards.map(c => c.type));
    console.log('🗑️ [SmartIsland] After removal - currentCard:', this.currentCardSubject.value?.type);
    console.log('🗑️ [SmartIsland] Had card:', hadCard, '| Removed successfully');
  }

  /**
   * Add a gamification card (next badge or level progress)
   */
  public addGamificationCard(type: 'next_badge' | 'level_progress', data: any) {
    if (type === 'next_badge' && data) {
      this.updateOrAddCard({
        type: 'next_badge',
        priority: 'high',
        icon: data.icon || 'trophy',
        iconColor: data.color || '#fbbf24',
        title: `Next: ${data.name}`,
        subtitle: `${data.description} (${data.current}/${data.target})`,
        ctaText: 'View Progress',
        ctaAction: '/tabs/progress',
        data
      });
    } else if (type === 'level_progress' && data) {
      this.updateOrAddCard({
        type: 'level_progress',
        priority: 'high',
        icon: 'bar-chart',
        iconColor: '#8b5cf6',
        title: `${data.currentLevel} → ${data.nextLevel}`,
        subtitle: `Keep practicing to reach ${data.nextLevel}`,
        ctaText: 'View Progress',
        ctaAction: '/tabs/progress',
        data
      });
    }
  }

  /**
   * Add a streak card (for active or at-risk streaks)
   */
  public addStreakCard(streakDays: number, isAtRisk: boolean) {
    if (isAtRisk) {
      this.updateOrAddCard({
        type: 'streak',
        priority: 'urgent',
        icon: 'flame',
        iconColor: '#ef4444',
        title: `${streakDays}-Day Streak!`,
        subtitle: 'Book today to keep going',
        ctaText: 'Book Lesson',
        ctaAction: '/tabs/tutor-search',
        data: { streakDays, isAtRisk }
      });
    } else if (streakDays >= 3) {
      this.updateOrAddCard({
        type: 'streak',
        priority: 'high',
        icon: 'flame',
        iconColor: '#f59e0b',
        title: `${streakDays}-Day Streak! 🔥`,
        subtitle: 'You\'re on fire!',
        ctaText: 'Keep It Up',
        ctaAction: '/tabs/progress',
        data: { streakDays, isAtRisk }
      });
    } else {
      this.removeCard('streak');
    }
  }

  /**
   * Add a pending rating card
   */
  public addPendingRatingCard(lessonId: string, tutorName: string, tutorPicture?: string) {
    this.updateOrAddCard({
      type: 'pending_rating',
      priority: 'urgent',
      icon: 'star',
      iconColor: '#fbbf24',
      title: 'Rate Your Lesson',
      subtitle: `How was your lesson with ${tutorName}?`,
      ctaText: 'Rate Now',
      ctaAction: `/lesson-summary/${lessonId}`,
      data: { lessonId, tutorName, tutorPicture }
    });
  }

  /**
   * Add a weekly summary card
   */
  public addWeeklySummaryCard(lessonsCount: number, speakingMinutes: number, wordsLearned: number) {
    this.updateOrAddCard({
      type: 'weekly_summary',
      priority: 'medium',
      icon: 'bar-chart-outline',
      iconColor: '#8b5cf6',
      title: 'This Week\'s Progress',
      subtitle: `${lessonsCount} lessons • ${speakingMinutes}min speaking • ${wordsLearned} new words`,
      ctaText: 'View Details',
      ctaAction: '/tabs/progress',
      data: { lessonsCount, speakingMinutes, wordsLearned }
    });
  }

  /**
   * Add a goal reminder card
   */
  public addGoalReminderCard(goalType: string, current: number, target: number) {
    const remaining = target - current;
    this.updateOrAddCard({
      type: 'goal_reminder',
      priority: 'high',
      icon: 'flag',
      iconColor: '#22c55e',
      title: 'Almost There!',
      subtitle: `Goal: ${goalType} • ${remaining} more to go!`,
      ctaText: 'Book Now',
      ctaAction: '/tabs/tutor-search',
      data: { goalType, current, target, remaining }
    });
  }

  /**
   * Add a personalized tip card
   */
  public addTipCard(tip: string, ctaText: string, ctaAction: string) {
    this.updateOrAddCard({
      type: 'tip',
      priority: 'low',
      icon: 'bulb',
      iconColor: '#fbbf24',
      title: 'Pro Tip',
      subtitle: tip,
      ctaText,
      ctaAction,
      data: null
    });
  }

  /**
   * Add an achievement unlock card
   */
  public addAchievementCard(achievementName: string, description: string) {
    this.updateOrAddCard({
      type: 'achievement',
      priority: 'urgent',
      icon: 'trophy',
      iconColor: '#fbbf24',
      title: `🎉 ${achievementName}!`,
      subtitle: description,
      ctaText: 'View Progress',
      ctaAction: '/tabs/progress',
      data: { achievementName, description }
    });
  }

  /**
   * Add a tutors online card (shows stacked avatars)
   */
  public addTutorsOnlineCard(tutorCount: number, tutorAvatars: string[]) {
    if (tutorCount < 2) {
      this.removeCard('tutors_online');
      return;
    }
    
    this.updateOrAddCard({
      type: 'tutors_online',
      priority: 'high',
      icon: 'people',
      iconColor: '#3b82f6',
      title: 'Tutors Online Now',
      subtitle: `${tutorCount} tutors are online now`,
      ctaText: 'Find Tutors',
      ctaAction: '/tabs/tutor-search',
      avatars: tutorAvatars.slice(0, 5), // Max 5 avatars
      data: { tutorCount }
    });
  }

  /**
   * Add a tutor recommendation card
   */
  public addTutorRecommendationCard(
    tutorId: string, 
    tutorName: string, 
    tutorPicture: string, 
    rating: number, 
    subject: string
  ) {
    this.updateOrAddCard({
      type: 'tutor_recommendation',
      priority: 'medium',
      icon: 'person',
      iconColor: '#8b5cf6',
      title: `Meet ${tutorName}`,
      subtitle: `${subject} tutor • ${rating}% rating`,
      ctaText: 'View Profile',
      ctaAction: `/tutor-profile/${tutorId}`,
      avatarUrl: tutorPicture,
      data: { tutorId, tutorName, tutorPicture, rating, subject }
    });
  }

  /**
   * Add a new feature card
   */
  public addNewFeatureCard(featureName: string, description: string, ctaAction: string) {
    this.updateOrAddCard({
      type: 'new_feature',
      priority: 'medium',
      icon: 'sparkles',
      iconColor: '#f59e0b',
      title: `New: ${featureName}`,
      subtitle: description,
      ctaText: 'Try Now',
      ctaAction,
      data: { featureName, description }
    });
  }

  /**
   * Add a tutor availability card (when tutors student has worked with add new slots)
   */
  public addTutorAvailabilityCard(
    tutors: any[], // Array of full tutor objects with id, firstName, lastName, picture
    ctaAction: string = '/tabs/tutor-search'
  ) {
    const tutorCount = tutors.length;
    const isSingleTutor = tutorCount === 1;
    const tutorNames = tutors.map((t: any) => t.firstName || t.name);
    const tutorAvatars = tutors.map((t: any) => t.picture || 'assets/avatar-placeholder.png');
    const tutorName = isSingleTutor ? tutorNames[0] : '';
    
    this.updateOrAddCard({
      type: 'tutor_availability',
      priority: 'high', // High priority to encourage booking
      icon: 'calendar',
      iconColor: '#10b981', // Green for new availability
      title: isSingleTutor ? `${tutorName} Added New Times!` : `${tutorCount} Tutors Added New Times!`,
      subtitle: isSingleTutor ? 'Book a lesson now' : 'Your tutors added new availability',
      ctaText: 'Book Now',
      ctaAction,
      avatars: isSingleTutor ? undefined : tutorAvatars.slice(0, 5), // Stacked avatars for multiple tutors
      avatarUrl: isSingleTutor ? tutorAvatars[0] : undefined, // Single avatar for one tutor
      data: { tutorCount, tutorNames, tutorAvatars, tutors } // Include full tutor objects
    });
  }

  /**
   * Clear all cards (useful when logging out)
   */
  public clearAllCards() {
    this.availableCards = [];
    this.currentCardSubject.next(null);
    if (this.rotationInterval) {
      clearInterval(this.rotationInterval);
    }
    // Also clear dismissed tutor availability when logging out
    this.clearDismissedTutorAvailability();
  }

  /**
   * Get current card without subscribing
   */
  public getCurrentCard(): DynamicCard | null {
    return this.currentCardSubject.value;
  }

  /**
   * Manually trigger next card rotation
   */
  public rotateManually() {
    this.rotateToNextCard();
  }
  
  /**
   * Restart rotation (useful after adding multiple cards)
   */
  public restartRotation() {
    console.log('🔄 [SmartIsland] Restarting rotation');
    this.startRotation();
  }

  // ============================================
  // Dismissed Tutor Availability Tracking
  // ============================================

  /**
   * Mark tutors as "seen" - student has interacted with the availability card
   * This prevents the card from reappearing for these tutors until they add NEW availability
   */
  public dismissTutorAvailability(tutorIds: string[], tutorTimestamps?: { [tutorId: string]: string }) {
    const dismissed = this.getDismissedTutorAvailability();
    const now = Date.now();
    
    tutorIds.forEach(tutorId => {
      // Store the lastAvailabilityUpdate timestamp if provided, so we only dismiss THIS update
      // If tutor adds new availability later, it will have a newer timestamp
      const timestamp = tutorTimestamps?.[tutorId] || new Date().toISOString();
      dismissed[tutorId] = {
        dismissedAt: now,
        lastAvailabilityUpdate: timestamp
      };
    });
    
    localStorage.setItem(this.DISMISSED_AVAILABILITY_KEY, JSON.stringify(dismissed));
    console.log('🔕 [SmartIsland] Dismissed tutor availability for:', tutorIds);
    
    // Remove the card since student interacted
    this.removeCard('tutor_availability');
  }

  /**
   * Get the list of dismissed tutor availability entries
   */
  private getDismissedTutorAvailability(): { [tutorId: string]: { dismissedAt: number; lastAvailabilityUpdate: string } } {
    try {
      const stored = localStorage.getItem(this.DISMISSED_AVAILABILITY_KEY);
      return stored ? JSON.parse(stored) : {};
    } catch {
      return {};
    }
  }

  /**
   * Check if a tutor's availability has been dismissed
   * Returns true if dismissed AND the tutor hasn't added newer availability since
   */
  public isTutorAvailabilityDismissed(tutorId: string, lastAvailabilityUpdate?: string): boolean {
    const dismissed = this.getDismissedTutorAvailability();
    const entry = dismissed[tutorId];
    
    if (!entry) return false;
    
    // If tutor has updated availability AFTER we dismissed, show it again
    if (lastAvailabilityUpdate && entry.lastAvailabilityUpdate) {
      const dismissedTimestamp = new Date(entry.lastAvailabilityUpdate).getTime();
      const currentTimestamp = new Date(lastAvailabilityUpdate).getTime();
      
      if (currentTimestamp > dismissedTimestamp) {
        console.log(`📅 [SmartIsland] Tutor ${tutorId} has newer availability, showing card`);
        return false; // Not dismissed - they have new availability
      }
    }
    
    return true; // Still dismissed
  }

  /**
   * Filter out tutors whose availability has already been dismissed
   */
  public filterDismissedTutors(tutors: any[]): any[] {
    return tutors.filter(tutor => {
      const tutorId = tutor.id || tutor._id;
      const lastUpdate = tutor.lastAvailabilityUpdate;
      return !this.isTutorAvailabilityDismissed(tutorId, lastUpdate);
    });
  }

  /**
   * Clean up old dismissed entries (older than DISMISSED_EXPIRY_HOURS)
   */
  private cleanupOldDismissedEntries() {
    const dismissed = this.getDismissedTutorAvailability();
    const now = Date.now();
    const expiryMs = this.DISMISSED_EXPIRY_HOURS * 60 * 60 * 1000;
    let cleaned = false;
    
    Object.keys(dismissed).forEach(tutorId => {
      if (now - dismissed[tutorId].dismissedAt > expiryMs) {
        delete dismissed[tutorId];
        cleaned = true;
      }
    });
    
    if (cleaned) {
      localStorage.setItem(this.DISMISSED_AVAILABILITY_KEY, JSON.stringify(dismissed));
      console.log('🧹 [SmartIsland] Cleaned up old dismissed availability entries');
    }
  }

  /**
   * Clear all dismissed entries (useful for testing or when logging out)
   */
  public clearDismissedTutorAvailability() {
    localStorage.removeItem(this.DISMISSED_AVAILABILITY_KEY);
    console.log('🗑️ [SmartIsland] Cleared all dismissed tutor availability');
  }
}

