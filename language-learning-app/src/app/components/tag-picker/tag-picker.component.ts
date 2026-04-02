import { Component, Input, Output, EventEmitter, OnInit, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { FormsModule } from '@angular/forms';
import { TaxonomyService, ContentTag } from '../../services/taxonomy.service';

@Component({
  selector: 'app-tag-picker',
  templateUrl: './tag-picker.component.html',
  styleUrls: ['./tag-picker.component.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class TagPickerComponent implements OnInit {
  @Input() selectedTagIds: string[] = [];
  @Input() locale: string = 'en';
  @Input() maxTags: number = 10;
  @Output() selectedTagIdsChange = new EventEmitter<string[]>();

  allTags: ContentTag[] = [];
  categories: string[] = [];
  tagsByCategory: Record<string, ContentTag[]> = {};
  subcategoriesByParent: Record<string, ContentTag[]> = {};
  leavesByParent: Record<string, ContentTag[]> = {};

  expandedCategory: string | null = null;
  expandedSubcategory: string | null = null;
  searchQuery = '';
  searchResults: ContentTag[] = [];
  isLoading = true;

  constructor(
    private taxonomyService: TaxonomyService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit() {
    this.taxonomyService.getFlat().subscribe({
      next: (tags) => {
        this.allTags = tags;
        this.buildStructure();
        this.isLoading = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.isLoading = false;
        this.cdr.markForCheck();
      }
    });
  }

  private buildStructure() {
    this.tagsByCategory = {};
    this.subcategoriesByParent = {};
    this.leavesByParent = {};

    for (const tag of this.allTags) {
      if (tag.depth === 'category') {
        if (!this.tagsByCategory[tag.category]) this.tagsByCategory[tag.category] = [];
        this.tagsByCategory[tag.category].push(tag);
      } else if (tag.depth === 'subcategory' && tag.parent) {
        if (!this.subcategoriesByParent[tag.parent]) this.subcategoriesByParent[tag.parent] = [];
        this.subcategoriesByParent[tag.parent].push(tag);
      } else if (tag.depth === 'leaf' && tag.parent) {
        if (!this.leavesByParent[tag.parent]) this.leavesByParent[tag.parent] = [];
        this.leavesByParent[tag.parent].push(tag);
      }
    }

    this.categories = Object.keys(this.tagsByCategory);
  }

  getLabel(tag: ContentTag): string {
    return tag.labels[this.locale] || tag.labels['en'] || tag.tagId;
  }

  getSubcategories(categoryTagId: string): ContentTag[] {
    return this.subcategoriesByParent[categoryTagId] || [];
  }

  getLeaves(subcategoryTagId: string): ContentTag[] {
    return this.leavesByParent[subcategoryTagId] || [];
  }

  toggleCategory(categoryTagId: string) {
    this.expandedCategory = this.expandedCategory === categoryTagId ? null : categoryTagId;
    this.expandedSubcategory = null;
  }

  toggleSubcategory(subcategoryTagId: string) {
    this.expandedSubcategory = this.expandedSubcategory === subcategoryTagId ? null : subcategoryTagId;
  }

  isSelected(tagId: string): boolean {
    return this.selectedTagIds.includes(tagId);
  }

  toggleTag(tagId: string) {
    const idx = this.selectedTagIds.indexOf(tagId);
    if (idx >= 0) {
      this.selectedTagIds = this.selectedTagIds.filter(t => t !== tagId);
    } else if (this.selectedTagIds.length < this.maxTags) {
      this.selectedTagIds = [...this.selectedTagIds, tagId];
    }
    this.selectedTagIdsChange.emit(this.selectedTagIds);
    this.cdr.markForCheck();
  }

  removeTag(tagId: string) {
    this.selectedTagIds = this.selectedTagIds.filter(t => t !== tagId);
    this.selectedTagIdsChange.emit(this.selectedTagIds);
    this.cdr.markForCheck();
  }

  getTagByIdFromAll(tagId: string): ContentTag | undefined {
    return this.allTags.find(t => t.tagId === tagId);
  }

  onSearch() {
    const q = this.searchQuery.toLowerCase().trim();
    if (!q) {
      this.searchResults = [];
      this.cdr.markForCheck();
      return;
    }
    this.searchResults = this.allTags.filter(t =>
      t.depth === 'leaf' &&
      Object.values(t.labels).some(label => label.toLowerCase().includes(q))
    ).slice(0, 15);
    this.cdr.markForCheck();
  }

  clearSearch() {
    this.searchQuery = '';
    this.searchResults = [];
    this.cdr.markForCheck();
  }

  trackByTagId(_: number, tag: ContentTag): string {
    return tag.tagId;
  }

  trackByCategory(_: number, category: string): string {
    return category;
  }
}
