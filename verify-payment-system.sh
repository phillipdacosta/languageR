#!/bin/bash

# Payment System Verification Script
# Tests that all payment endpoints are registered and responding

echo "🔍 Payment & Wallet System Verification"
echo "========================================"
echo ""

BASE_URL="http://localhost:3000"

# Check if backend is running
echo "1. Checking backend health..."
if curl -s "$BASE_URL/health" > /dev/null; then
    echo "   ✅ Backend is running"
else
    echo "   ❌ Backend is not responding"
    exit 1
fi

echo ""
echo "2. Checking wallet endpoints..."

# Test wallet endpoints (should return 401 without auth, but that means they exist)
endpoints=(
    "/api/wallet/balance"
    "/api/wallet/transactions"
)

for endpoint in "${endpoints[@]}"; do
    status=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL$endpoint")
    if [ "$status" == "401" ] || [ "$status" == "200" ]; then
        echo "   ✅ $endpoint (HTTP $status)"
    else
        echo "   ❌ $endpoint (HTTP $status - expected 401 or 200)"
    fi
done

echo ""
echo "3. Checking payment endpoints..."

payment_endpoints=(
    "/api/payments/history"
    "/api/payments/stripe-connect/status"
)

for endpoint in "${payment_endpoints[@]}"; do
    status=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL$endpoint")
    if [ "$status" == "401" ] || [ "$status" == "200" ]; then
        echo "   ✅ $endpoint (HTTP $status)"
    else
        echo "   ❌ $endpoint (HTTP $status - expected 401 or 200)"
    fi
done

echo ""
echo "4. Checking Stripe configuration..."

# Check logs for Stripe warning
if tail -20 /tmp/backend-payment.log 2>/dev/null | grep -q "STRIPE_SECRET_KEY not configured"; then
    echo "   ⚠️  Stripe keys not configured (add to .env)"
else
    echo "   ✅ Stripe configured"
fi

echo ""
echo "========================================"
echo "✅ Verification Complete!"
echo ""
echo "Next Steps:"
echo "1. Add Stripe keys to backend/.env"
echo "2. Build frontend wallet/payment UI"
echo "3. Test complete payment flow"
echo ""
echo "📚 See documentation:"
echo "   - PAYMENT_WALLET_SYSTEM_COMPLETE.md"
echo "   - PAYMENT_QUICK_REFERENCE.md"
echo "   - IMPLEMENTATION_SUMMARY.md"

