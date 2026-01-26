# Card Management & Fee Display Fix

## Issues Fixed

### 1. Delete Card Functionality
**Problem:** No way to remove saved cards from wallet modal

**Solution:** Added delete button with trash icon

### 2. Fee Display for Existing Cards
**Problem:** Cards saved before country field migration showed fee range instead of exact fee

**Solution:** Created and ran migration script to fetch card countries from Stripe

---

## Implementation

### 1. Delete Card Feature

**Frontend: Wallet Top-Up Modal**

**File:** `wallet-topup-modal.component.ts`

```typescript
async deleteCard(card: SavedCard, event: Event) {
  event.stopPropagation(); // Prevent selecting card
  
  if (!confirm(`Remove ${card.brand} ••••${card.last4}?`)) {
    return;
  }

  try {
    const response = await firstValueFrom(
      this.http.delete<any>(
        `${environment.apiUrl}/payments/payment-method/${card.stripePaymentMethodId}`,
        { headers: this.userService.getAuthHeadersSync() }
      )
    );

    if (response.success) {
      // Remove from local array
      this.savedCards = this.savedCards.filter(c => c.id !== card.id);
      
      // If deleted card was selected, select another
      if (this.selectedCardId === card.id) {
        if (this.savedCards.length > 0) {
          this.selectedCardId = this.savedCards[0].id;
        } else {
          this.selectedCardId = null;
          this.showNewCardForm = true;
        }
      }
    }
  } catch (error: any) {
    alert(error.error?.message || 'Failed to remove card');
  }
}
```

**HTML:**
```html
<ion-button 
  fill="clear" 
  size="small"
  class="delete-card-btn"
  (click)="deleteCard(card, $event)">
  <ion-icon slot="icon-only" name="trash-outline"></ion-icon>
</ion-button>
```

**CSS:**
```scss
.delete-card-btn {
  --color: #ff3b30;
  --padding-start: 8px;
  --padding-end: 8px;
  height: 32px;
  width: 32px;
  margin-left: 8px;
  
  ion-icon {
    font-size: 20px;
  }

  &:hover {
    --color: #ff1a0e;
  }
}
```

### 2. Migration Script

**File:** `backend/migrate-card-countries.js`

```javascript
/**
 * Fetches card country from Stripe for all saved payment methods
 * that don't have a country field yet.
 */

async function updateCardCountries() {
  const users = await User.find({ 'savedPaymentMethods.0': { $exists: true } });
  
  for (const user of users) {
    for (let i = 0; i < user.savedPaymentMethods.length; i++) {
      const card = user.savedPaymentMethods[i];
      
      // Skip if already has country
      if (card.country) continue;

      // Fetch from Stripe
      const paymentMethod = await stripe.paymentMethods.retrieve(
        card.stripePaymentMethodId
      );
      
      if (paymentMethod.card && paymentMethod.card.country) {
        user.savedPaymentMethods[i].country = paymentMethod.card.country;
      }
    }
    
    await user.save();
  }
}
```

**Results:**
```
✅ Updated: visa ****0077 → US
✅ Updated: visa ****0278 → IE (Ireland)
```

### 3. Enhanced Logging

Added detailed console logging to debug fee display:

```typescript
console.log('💳 Mapped saved cards with countries:', this.savedCards.map(c => ({
  last4: c.last4,
  country: c.country,
  hasCountry: !!c.country
})));
```

---

## How It Works

### Delete Card Flow

1. User clicks trash icon on card
2. Confirmation prompt: "Remove Visa ••••1234?"
3. If confirmed:
   - DELETE request to `/api/payments/payment-method/:id`
   - Backend removes from user record
   - Backend detaches from Stripe
   - Frontend removes from list
4. If deleted card was selected:
   - Auto-select first remaining card
   - Or show "Add new card" if no cards left

### Fee Display Logic

**For saved cards with country:**
```typescript
const card = this.selectedCard;
if (card?.country) {
  const isInternational = card.country !== 'US';
  const feeRate = isInternational ? 0.044 : 0.029;
  const fee = (amount * feeRate) + 0.30;
  
  // Display exact fee
  return isInternational 
    ? '4.4% + $0.30 (international card)'
    : '2.9% + $0.30';
}
```

**For cards without country (fallback):**
```typescript
// Show range until country is known
return '2.9% – 4.4% + $0.30 (depends on card type)';
```

---

## User Experience

### Delete Card

**Before:**
```
[Radio] Visa •••• 1234  [Default]
[Radio] Visa •••• 5678
[Radio] Add new card
```

**After:**
```
[Radio] Visa •••• 1234  [Default]  [🗑️]
[Radio] Visa •••• 5678             [🗑️]
[Radio] Add new card
```

**On Delete:**
```
⚠️ Remove Visa ••••1234?
[Cancel] [OK]
```

### Fee Display

**US Card (after migration):**
```
Wallet credit:        $50.00
Processing fee:       $1.75  (2.9% + $0.30)
───────────────────────────────────
Total charge:         $51.75
```

**International Card (after migration):**
```
Wallet credit:        $50.00
Processing fee:       $2.50  (4.4% + $0.30, international card)
───────────────────────────────────
Total charge:         $52.50
```

---

## Testing

### Test Delete Card

1. Open wallet top-up modal
2. Should see trash icon on each saved card
3. Click trash on a card
4. Confirm deletion
5. Card should disappear
6. If it was selected, another card should auto-select

### Test Fee Display

1. Refresh page (clear old cached data)
2. Open wallet top-up modal
3. Check console for:
   ```
   💳 Mapped saved cards with countries: [
     { last4: "0077", country: "US", hasCountry: true },
     { last4: "0278", country: "IE", hasCountry: true }
   ]
   ```
4. Select US card → Should show $1.75 fee
5. Select international card → Should show $2.50 fee
6. Both should show exact fee (no range)

---

## Backend API

### Delete Card Endpoint

**Endpoint:** `DELETE /api/payments/payment-method/:paymentMethodId`

**Auth:** Required (Bearer token)

**Response:**
```json
{
  "success": true,
  "message": "Payment method removed",
  "paymentMethods": [/* remaining cards */]
}
```

**Actions:**
1. Removes card from user.savedPaymentMethods
2. If deleted card was default, sets first remaining as default
3. Detaches payment method from Stripe
4. Returns updated payment methods list

---

## Migration Notes

### Running the Migration

```bash
cd backend
node migrate-card-countries.js
```

**Output:**
```
✅ Connected to MongoDB
📊 Found 2 users with saved payment methods
👤 Processing user: user@example.com
  🔄 Fetching country for visa ****1234...
  ✅ Updated: visa ****1234 → US
📊 Migration Summary:
  - Cards updated: 2
  - Errors: 0
✅ Migration completed!
```

### When to Run

- **Once:** After deploying card country feature
- **Automatic:** New cards automatically include country going forward
- **No downtime:** Safe to run on production database

### Idempotent

Script is safe to run multiple times:
- Skips cards that already have country
- Only fetches missing data from Stripe
- No data overwritten

---

## Troubleshooting

### Issue: Still seeing fee range

**Possible causes:**
1. Frontend cache not cleared
2. Migration not run
3. Country field missing in API response

**Debug:**
```typescript
// Check console for:
console.log('💳 Mapped saved cards with countries:', this.savedCards);
// Should show: { country: "US" } or { country: "IE" }
```

**Fix:**
1. Hard refresh page (Cmd+Shift+R)
2. Run migration script
3. Check API response includes country field

### Issue: Delete not working

**Possible causes:**
1. Network error
2. Auth token expired
3. Card doesn't exist

**Debug:**
Check console for error message

**Fix:**
- Refresh page to get new auth token
- Verify card exists in database

---

## Summary

**Added:**
- ✅ Delete card button with trash icon
- ✅ Confirmation before deletion
- ✅ Migration script for existing cards
- ✅ Enhanced logging for debugging

**Fixed:**
- ✅ Fee range showing for existing cards
- ✅ Missing card country data
- ✅ No way to remove cards

**Result:**
- ✅ Users can manage their saved cards
- ✅ Exact fees shown for all saved cards
- ✅ Clean, intuitive UI

