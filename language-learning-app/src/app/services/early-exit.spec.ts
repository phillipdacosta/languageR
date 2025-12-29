import { TestBed } from '@angular/core/testing';

import { EarlyExit } from './early-exit';

describe('EarlyExit', () => {
  let service: EarlyExit;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(EarlyExit);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
