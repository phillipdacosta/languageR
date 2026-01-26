import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PaymentReviewPage } from './payment-review.page';

describe('PaymentReviewPage', () => {
  let component: PaymentReviewPage;
  let fixture: ComponentFixture<PaymentReviewPage>;

  beforeEach(() => {
    fixture = TestBed.createComponent(PaymentReviewPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
