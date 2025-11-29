import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';

import { BlockTimeComponent } from './block-time.component';

describe('BlockTimeComponent', () => {
  let component: BlockTimeComponent;
  let fixture: ComponentFixture<BlockTimeComponent>;

  beforeEach(waitForAsync(() => {
    TestBed.configureTestingModule({
      imports: [BlockTimeComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(BlockTimeComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }));

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
