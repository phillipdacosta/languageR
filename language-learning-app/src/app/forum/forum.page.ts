import {
  Component,
  OnInit,
  OnDestroy,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Input,
  Output,
  EventEmitter,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { UserService } from '../services/user.service';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

export interface ForumThreadRow {
  id: string;
  authorName: string;
  authorAvatar: string | null;
  isTutorVerified: boolean;
  title: string;
  excerpt: string;
  tags: string[];
  timeLabel: string;
  upvotes: number;
  bookmarked: boolean;
  authorId: string;
  userHasAnswered: boolean;
}

@Component({
  selector: 'app-forum',
  templateUrl: './forum.page.html',
  styleUrls: ['./forum.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule, TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ForumPage implements OnInit, OnDestroy {
  /** Embedded in tab1 home overlay (mobile card or desktop cm-modal). */
  @Input() inline = false;
  /** When true with `inline`, parent provides chrome (desktop modal top bar). */
  @Input() hideToolbar = false;

  @Output() goBackEvent = new EventEmitter<void>();

  forumMainTab: 'community' | 'profile' | 'answers' = 'community';

  selectedTopic = 'all';
  readonly topicOptions: { value: string; labelKey: string }[] = [
    { value: 'all', labelKey: 'FORUM.TOPIC_ALL' },
    { value: 'general', labelKey: 'FORUM.TOPIC_GENERAL' },
    { value: 'learning', labelKey: 'FORUM.TOPIC_LEARNING' },
    { value: 'jobs', labelKey: 'FORUM.TOPIC_JOBS' }
  ];

  sortKey: 'latest' | 'popular' = 'latest';
  bookmarksOnly = false;
  searchQuery = '';
  searchOpen = false;

  /** Replace with API data; empty = empty state */
  allThreads: ForumThreadRow[] = [];

  displayThreads: ForumThreadRow[] = [];

  topUsers: { name: string; avatar: string | null; votesLabel: string; verified: boolean }[] = [];

  activeTopics: { tag: string; threadCount: number }[] = [];

  currentUserId: string | null = null;

  /** Only students may create threads; tutors browse only. */
  canStartThread = false;

  private readonly destroy$ = new Subject<void>();

  constructor(
    private router: Router,
    private userService: UserService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.refreshDisplayThreads();
    this.userService.currentUser$
      .pipe(takeUntil(this.destroy$))
      .subscribe(user => {
        this.currentUserId = user?.id || null;
        this.canStartThread = user?.userType === 'student';
        this.refreshDisplayThreads();
        this.cdr.markForCheck();
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  goBack(): void {
    if (this.inline) {
      this.goBackEvent.emit();
      return;
    }
    this.router.navigate(['/tabs/home']);
  }

  onTabCommunity(): void {
    this.forumMainTab = 'community';
    this.refreshDisplayThreads();
    this.cdr.markForCheck();
  }

  onTabProfile(): void {
    this.forumMainTab = 'profile';
    this.refreshDisplayThreads();
    this.cdr.markForCheck();
  }

  onTabAnswers(): void {
    this.forumMainTab = 'answers';
    this.refreshDisplayThreads();
    this.cdr.markForCheck();
  }

  onTopicIonChange(ev: CustomEvent<{ value: string }>): void {
    const v = ev.detail?.value;
    if (v !== undefined && v !== null) {
      this.selectedTopic = v;
      this.refreshDisplayThreads();
      this.cdr.markForCheck();
    }
  }

  readonly trackByThreadId = (_index: number, row: ForumThreadRow) => row.id;

  onSortLatest(): void {
    this.sortKey = 'latest';
    this.refreshDisplayThreads();
    this.cdr.markForCheck();
  }

  onSortPopular(): void {
    this.sortKey = 'popular';
    this.refreshDisplayThreads();
    this.cdr.markForCheck();
  }

  toggleBookmarks(): void {
    this.bookmarksOnly = !this.bookmarksOnly;
    this.refreshDisplayThreads();
    this.cdr.markForCheck();
  }

  toggleSearch(): void {
    this.searchOpen = !this.searchOpen;
    if (!this.searchOpen) {
      this.searchQuery = '';
      this.refreshDisplayThreads();
    }
    this.cdr.markForCheck();
  }

  onSearchInput(value: string): void {
    this.searchQuery = value;
    this.refreshDisplayThreads();
    this.cdr.markForCheck();
  }

  startNewThread(): void {
    if (!this.canStartThread) {
      return;
    }
    // Wire when compose / thread API exists
  }

  toggleBookmarkRow(row: ForumThreadRow, ev: Event): void {
    ev.stopPropagation();
    row.bookmarked = !row.bookmarked;
    this.refreshDisplayThreads();
    this.cdr.markForCheck();
  }

  openThread(row: ForumThreadRow): void {
    // Wire to thread detail route when available
  }

  private refreshDisplayThreads(): void {
    let list = [...this.allThreads];

    if (this.forumMainTab === 'profile' && this.currentUserId) {
      list = list.filter(t => t.authorId === this.currentUserId);
    } else if (this.forumMainTab === 'profile') {
      list = [];
    }

    if (this.forumMainTab === 'answers') {
      list = list.filter(t => t.userHasAnswered);
    }

    if (this.bookmarksOnly) {
      list = list.filter(t => t.bookmarked);
    }

    if (this.selectedTopic !== 'all') {
      const key = this.selectedTopic.toLowerCase();
      list = list.filter(t =>
        t.tags.some(tag => tag.replace(/^#/, '').toLowerCase() === key)
      );
    }

    const q = this.searchQuery.trim().toLowerCase();
    if (q) {
      list = list.filter(
        t =>
          t.title.toLowerCase().includes(q) ||
          t.excerpt.toLowerCase().includes(q) ||
          t.authorName.toLowerCase().includes(q)
      );
    }

    if (this.sortKey === 'popular') {
      list.sort((a, b) => b.upvotes - a.upvotes);
    } else {
      list.sort((a, b) => b.id.localeCompare(a.id));
    }

    this.displayThreads = list;
  }
}
