export const environment = {
  production: true, // This enables production build optimizations
  apiUrl: 'https://languager-backend.onrender.com/api', // Backend API URL
  backendUrl: 'https://languager-backend.onrender.com',
  stripePublishableKey: 'pk_test_51SsQr8APHD8TltVxFOXQ8CzoUcwH8DTA4M9qfuKahOj6v6T6257HsLJzPjsPdMmJ5E2jzrF8UNwnOP2xx0wfLLTj004HuD4ZMo',
  agora: {
    appId: '134e5b056b944b66b14fc9e275726131', // Replace with your actual Agora App ID
    token: '007eJxTYBD+/FDjz5O5jcZTuuN+tAQ9e+dkf+dbravQlC8TTKJsN15SYDA0Nkk1TTIwNUuyNDFJMjNLMjRJS7ZMNTI3NTcyMzQ2jOX+m9EQyMgQEubLysgAgSC+EENOYl56aWJ6qm5yTmJxsa6BgSEDAwDVlST1', // Will be generated dynamically
    channel: 'language-class-001',
    uid: null // Let Agora assign a random UID
  },
  agoraWhiteboard: {
    appId: 'LlbHYLHIEfCEJZXtHZ664A/hz-fQn1QNhGOwQ', // From Agora Console Whiteboard
    region: 'us-sv' // us-sv, ap-sg, eu, or cn-hz
  },
  auth0: {
    domain: 'dev-h6q8nxbfbq8psb4k.us.auth0.com',
    clientId: 'GOoBQhd850NcpUZxqZRgVQU4pEams1QI',
    redirectUri: 'https://languager-frontend.onrender.com/callback',
    audience: 'https://api.barnabi.com' // Custom Auth0 API identifier (must match the API audience in the Auth0 dashboard)
  }
};
