import { Component, OnInit } from '@angular/core';

@Component({
  selector: 'app-tab2',
  templateUrl: 'tab2.page.html',
  styleUrls: ['tab2.page.scss'],
  standalone: false,
})
export class Tab2Page implements OnInit {

  selectedFilter = 'all';
  selectedCategory = '';
  categories = ['vocabulary', 'grammar', 'pronunciation', 'conversation', 'reading', 'listening'];
  
  lessons = [
    {
      id: 1,
      title: 'Spanish Food Vocabulary',
      description: 'Learn essential food-related words in Spanish',
      language: 'Spanish',
      level: 'beginner',
      category: 'vocabulary',
      estimatedTime: 15,
      difficulty: 2,
      progress: { status: 'completed', score: 95 }
    },
    {
      id: 2,
      title: 'French Past Tense',
      description: 'Master the passé composé in French',
      language: 'French',
      level: 'intermediate',
      category: 'grammar',
      estimatedTime: 25,
      difficulty: 4,
      progress: { status: 'in-progress', score: 0 }
    },
    {
      id: 3,
      title: 'German Pronunciation',
      description: 'Perfect your German pronunciation',
      language: 'German',
      level: 'beginner',
      category: 'pronunciation',
      estimatedTime: 20,
      difficulty: 3,
      progress: null
    },
    {
      id: 4,
      title: 'Italian Conversation',
      description: 'Practice everyday Italian conversations',
      language: 'Italian',
      level: 'intermediate',
      category: 'conversation',
      estimatedTime: 30,
      difficulty: 3,
      progress: null
    },
    {
      id: 5,
      title: 'Portuguese Reading',
      description: 'Read and understand Portuguese texts',
      language: 'Portuguese',
      level: 'advanced',
      category: 'reading',
      estimatedTime: 35,
      difficulty: 5,
      progress: null
    }
  ];

  filteredLessons = [...this.lessons];

  constructor() {}

  ngOnInit() {
    this.loadLessons();
  }

  loadLessons() {
    // TODO: Implement API call to load lessons
    console.log('Loading lessons...');
  }

  filterLessons() {
    this.filteredLessons = this.lessons.filter(lesson => {
      const levelMatch = this.selectedFilter === 'all' || lesson.level === this.selectedFilter;
      const categoryMatch = !this.selectedCategory || lesson.category === this.selectedCategory;
      return levelMatch && categoryMatch;
    });
  }

  selectCategory(category: string) {
    this.selectedCategory = this.selectedCategory === category ? '' : category;
    this.filterLessons();
  }

  getCategoryIcon(category: string): string {
    const icons: { [key: string]: string } = {
      vocabulary: 'book',
      grammar: 'library',
      pronunciation: 'mic',
      conversation: 'chatbubbles',
      reading: 'document-text',
      listening: 'headset'
    };
    return icons[category] || 'book';
  }

  getLevelColor(level: string): string {
    const colors: { [key: string]: string } = {
      beginner: 'success',
      intermediate: 'warning',
      advanced: 'danger'
    };
    return colors[level] || 'medium';
  }

  openLesson(lesson: any) {
    // TODO: Navigate to lesson detail page
    console.log('Opening lesson:', lesson.title);
  }

}
