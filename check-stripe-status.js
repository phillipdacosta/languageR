// Run this in MongoDB Compass or mongosh to check and update the tutor's Stripe status

// 1. Check current status
db.users.findOne(
  { email: "travelbuggler2@gmail.com" },
  { 
    email: 1, 
    stripeConnectAccountId: 1, 
    stripeConnectOnboarded: 1,
    stripeConnectOnboardedAt: 1
  }
)

// 2. If they have an accountId but onboarded is false, update it:
db.users.updateOne(
  { 
    email: "travelbuggler2@gmail.com",
    stripeConnectAccountId: { $exists: true, $ne: null }
  },
  { 
    $set: { 
      stripeConnectOnboarded: true,
      stripeConnectOnboardedAt: new Date()
    } 
  }
)

// 3. Verify the update
db.users.findOne(
  { email: "travelbuggler2@gmail.com" },
  { 
    email: 1, 
    stripeConnectAccountId: 1, 
    stripeConnectOnboarded: 1 
  }
)

// Expected result:
// {
//   email: "travelbuggler2@gmail.com",
//   stripeConnectAccountId: "acct_xxxxx",
//   stripeConnectOnboarded: true  ← Should be true now
// }

