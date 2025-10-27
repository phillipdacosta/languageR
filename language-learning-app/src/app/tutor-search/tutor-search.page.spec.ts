import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TutorSearchPage } from './tutor-search.page';

describe('TutorSearchPage', () => {
  let component: TutorSearchPage;
  let fixture: ComponentFixture<TutorSearchPage>;

  beforeEach(() => {
    fixture = TestBed.createComponent(TutorSearchPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
