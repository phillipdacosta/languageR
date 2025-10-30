export const environment = {
  production: false, // This is for development/staging on Render
  backendUrl: 'https://languager-backend.onrender.com', // Update this with your actual Render backend URL
  agora: {
    appId: '134e5b056b944b66b14fc9e275726131', // Replace with your actual Agora App ID
    token: '007eJxTYBD+/FDjz5O5jcZTuuN+tAQ9e+dkf+dbravQlC8TTKJsN15SYDA0Nkk1TTIwNUuyNDFJMjNLMjRJS7ZMNTI3NTcyMzQ2jOX+m9EQyMgQEubLysgAgSC+EENOYl56aWJ6qm5yTmJxsa6BgSEDAwDVlST1', // Will be generated dynamically
    channel: 'language-class-001',
    uid: null // Let Agora assign a random UID
  },
  auth0: {
    domain: 'dev-h6q8nxbfbq8psb4k.us.auth0.com', // e.g., 'your-tenant.auth0.com'
    clientId: 'veJihab93y2EdvOK10ve1TvwSffMTflj', // Your Auth0 application client ID
    redirectUri: 'https://languager-frontend.onrender.com/callback' // Update this with your actual Render frontend URL
  }
};
