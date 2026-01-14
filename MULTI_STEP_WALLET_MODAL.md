# Multi-Step Wallet Top-Up Modal

## Summary

Converted wallet top-up modal from single-step to multi-step flow where new card entry happens **inside the modal** instead of navigating away.

---

## Implementation

### Step Flow

**Step 1: Selection**
- Choose amount
- View fee breakdown
- Select saved card OR "Add new card"
- Click "Continue"

**Step 2: Card Entry** (only for new cards)
- Shows amount summary
- Stripe card element for entering card details
- "Back" button to return to selection
- "Pay $XX.XX" button to process

---

## Code Changes

### TypeScript

**File:** `wallet-topup-modal.component.ts`

```typescript
export class WalletTopupModalComponent {
  // Multi-step flow
  currentStep: 'selection' | 'card-entry' = 'selection';
  processingPayment: boolean = false;
  
  // Stripe Elements
  stripe: any;
  cardElement: any;
  stripeElements: any;
  clientSecret: string | null = null;
  paymentIntentId: string | null = null;

  async goToCardEntry() {
    this.loading = true;
    
    // Create PaymentIntent on backend
    const response = await firstValueFrom(
      this.http.post<any>(`${environment.apiUrl}/wallet/top-up`, {
        walletCredit: this.amount,
        totalCharge: this.totalCharge,
        stripeFee: this.stripeFee
      }, {
        headers: this.userService.getAuthHeadersSync()
      })
    );

    if (response.success) {
      this.clientSecret = response.clientSecret;
      this.paymentIntentId = response.paymentIntentId;
      this.currentStep = 'card-entry';
      
      // Mount Stripe card element
      setTimeout(() => {
        this.mountCardElement();
      }, 300);
    }
    
    this.loading = false;
  }

  mountCardElement() {
    this.stripeElements = this.stripe.elements({
      clientSecret: this.clientSecret
    });

    this.cardElement = this.stripeElements.create('card', {
      style: {
        base: {
          fontSize: '16px',
          color: '#1c1c1e',
          '::placeholder': { color: '#8e8e93' }
        },
        invalid: { color: '#ff3b30' }
      }
    });

    this.cardElement.mount('#card-element-wallet');
  }

  goBack() {
    if (this.currentStep === 'card-entry') {
      this.currentStep = 'selection';
      if (this.cardElement) {
        this.cardElement.unmount();
      }
    } else {
      this.cancel();
    }
  }

  async submitNewCard() {
    this.processingPayment = true;

    const { error, paymentIntent } = await this.stripe.confirmCardPayment(
      this.clientSecret,
      { payment_method: { card: this.cardElement } }
    );

    if (error) {
      alert(error.message);
      this.processingPayment = false;
    } else if (paymentIntent.status === 'succeeded') {
      // Confirm on backend
      const response = await firstValueFrom(
        this.http.post<any>(`${environment.apiUrl}/wallet/confirm-top-up`, {
          paymentIntentId: this.paymentIntentId
        }, {
          headers: this.userService.getAuthHeadersSync()
        })
      );

      if (response.success) {
        this.modalController.dismiss({ 
          success: true,
          amount: this.amount
        }, 'success');
      }
    }
  }

  continue() {
    // If using saved card, dismiss immediately
    if (selectedCard) {
      this.modalController.dismiss({ 
        amount: this.amount,
        totalCharge: this.totalCharge,
        stripeFee: this.stripeFee,
        selectedCard: selectedCard
      }, 'confirm');
    } 
    // If using new card, go to card entry step
    else if (this.showNewCardForm) {
      this.goToCardEntry();
    }
  }
}
```

### HTML Template

**File:** `wallet-topup-modal.component.html`

```html
<div class="modal-wrapper">
  <div class="modal-header">
    <!-- Back button (only on card entry step) -->
    <ion-button 
      *ngIf="currentStep === 'card-entry'" 
      fill="clear" 
      (click)="goBack()"
      class="back-button">
      <ion-icon name="arrow-back" slot="icon-only"></ion-icon>
    </ion-button>
    
    <!-- Dynamic title -->
    <h2>{{ currentStep === 'selection' ? 'Top Up Wallet' : 'Enter Card Details' }}</h2>
  </div>

  <div class="modal-content">
    <!-- Step 1: Selection -->
    <ng-container *ngIf="currentStep === 'selection'">
      <!-- Amount input, fee breakdown, card selection -->
    </ng-container>

    <!-- Step 2: Card Entry -->
    <ng-container *ngIf="currentStep === 'card-entry'">
      <div class="card-entry-step">
        <div class="amount-summary">
          <div class="summary-row">
            <span>Wallet credit:</span>
            <span>${{ amount.toFixed(2) }}</span>
          </div>
          <div class="summary-row">
            <span>Processing fee:</span>
            <span>${{ stripeFee.toFixed(2) }}</span>
          </div>
          <div class="summary-row total">
            <span>Total charge:</span>
            <span>${{ totalCharge.toFixed(2) }}</span>
          </div>
        </div>

        <p class="card-label">Card Information</p>
        <div id="card-element-wallet" class="card-element-container"></div>
        <p class="card-helper-text">
          <ion-icon name="lock-closed"></ion-icon>
          Your payment information is secure
        </p>
      </div>
    </ng-container>
  </div>

  <div class="modal-footer">
    <!-- Dynamic button text -->
    <button class="btn-cancel" (click)="goBack()">
      {{ currentStep === 'card-entry' ? 'Back' : 'Cancel' }}
    </button>
    
    <!-- Continue button (selection step) -->
    <button 
      *ngIf="currentStep === 'selection'"
      class="btn-continue" 
      (click)="continue()">
      Continue
    </button>
    
    <!-- Pay button (card entry step) -->
    <button 
      *ngIf="currentStep === 'card-entry'"
      class="btn-continue" 
      (click)="submitNewCard()"
      [disabled]="processingPayment">
      <ion-spinner *ngIf="processingPayment"></ion-spinner>
      <span *ngIf="!processingPayment">Pay ${{ totalCharge.toFixed(2) }}</span>
      <span *ngIf="processingPayment">Processing...</span>
    </button>
  </div>
</div>
```

### CSS Styles

**File:** `wallet-topup-modal.component.scss`

```scss
.modal-header {
  display: flex;
  align-items: center;
  gap: 12px;

  .back-button {
    --color: #007aff;
    width: 40px;
    height: 40px;

    ion-icon {
      font-size: 24px;
    }
  }

  h2 {
    flex: 1;
    text-align: center;
  }
}

.card-entry-step {
  .amount-summary {
    background: #f9f9f9;
    border: 1px solid #e5e5ea;
    border-radius: 12px;
    padding: 16px;

    .summary-row {
      display: flex;
      justify-content: space-between;
      padding: 8px 0;

      &.total {
        span:last-child {
          font-size: 18px;
          color: #007aff;
        }
      }
    }
  }

  .card-element-container {
    padding: 14px;
    background: #f9f9f9;
    border: 1px solid #e5e5ea;
    border-radius: 10px;

    &:focus-within {
      border-color: #007aff;
      background: #ffffff;
      box-shadow: 0 0 0 4px rgba(0, 122, 255, 0.1);
    }
  }

  .card-helper-text {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: #8e8e93;

    ion-icon {
      color: #34c759;
    }
  }
}
```

---

## User Flow

### Adding New Card

1. **Step 1: Selection**
   ```
   Top Up Wallet
   
   How much? $50
   
   Wallet credit:    $50.00
   Processing fee:   $2.50
   Total charge:     $52.50
   
   ○ Visa ••••1234
   ● Add new card
   
   [Cancel] [Continue]
   ```

2. **Click Continue** → Stays in modal, goes to step 2

3. **Step 2: Card Entry**
   ```
   [←] Enter Card Details
   
   Wallet credit:    $50.00
   Processing fee:   $2.50
   Total charge:     $52.50
   
   Card Information
   [Stripe card input field]
   🔒 Your payment information is secure
   
   [Back] [Pay $52.50]
   ```

4. **Click Pay** → Processes payment in modal

5. **Success** → Modal dismisses, wallet updated

### Using Saved Card

1. **Step 1: Selection**
   - Select saved card
   - Click "Continue"
   - **Immediately processes** (no step 2 needed)

---

## Benefits

✅ **Better UX** - No navigation away from modal  
✅ **Clearer flow** - Step-by-step progression  
✅ **Easy to go back** - Back button returns to selection  
✅ **Consistent** - Matches expected mobile app patterns  
✅ **Secure** - Stripe elements properly mounted  

---

## Testing

### Test New Card Flow

1. Open wallet top-up modal
2. Select "Add new card"
3. Click "Continue"
4. Should stay in modal, show card entry step
5. Should see:
   - Back arrow in header
   - "Enter Card Details" title
   - Amount summary
   - Stripe card input
   - "Pay $XX.XX" button
6. Click back arrow → Returns to step 1
7. Enter test card: `4242 4242 4242 4242`
8. Click "Pay $52.50"
9. Should process and dismiss modal on success

### Test Saved Card Flow

1. Open wallet top-up modal
2. Select saved card
3. Click "Continue"
4. Should immediately process (no step 2)

---

## Summary

**Before:**
- Click "Continue" → Nothing happened (bug)
- New card flow was broken

**After:**
- Click "Continue" → Goes to card entry step
- Back button to return
- Complete flow inside modal
- Clean, intuitive UX

