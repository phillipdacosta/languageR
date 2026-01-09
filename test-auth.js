// Quick test: Open browser console and run this to check auth status

// 1. Check if you have an auth token
console.log('Auth token:', localStorage.getItem('access_token') ? '✅ Found' : '❌ Not found');

// 2. Check user info
console.log('User info:', localStorage.getItem('user_info'));

// 3. Test wallet API manually
const token = localStorage.getItem('access_token');
if (token) {
  fetch('http://localhost:3000/api/wallet/balance', {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  })
  .then(r => r.json())
  .then(data => console.log('Wallet API response:', data))
  .catch(err => console.error('Wallet API error:', err));
} else {
  console.log('❌ No auth token found - you need to log in first!');
}


