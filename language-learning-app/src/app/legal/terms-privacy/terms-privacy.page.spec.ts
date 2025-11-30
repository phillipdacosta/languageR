import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TermsPrivacyPage } from './terms-privacy.page';

describe('TermsPrivacyPage', () => {
  let component: TermsPrivacyPage;
  let fixture: ComponentFixture<TermsPrivacyPage>;

  beforeEach(() => {
    fixture = TestBed.createComponent(TermsPrivacyPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
