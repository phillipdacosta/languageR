import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TutorSearchContentPage } from './tutor-search-content.page';

describe('TutorSearchContentPage', () => {
  let component: TutorSearchContentPage;
  let fixture: ComponentFixture<TutorSearchContentPage>;

  beforeEach(() => {
    fixture = TestBed.createComponent(TutorSearchContentPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
