export const environment = {
  production: true, // This enables production build optimizations
  apiUrl: 'https://api.barnabi.ai/api', // Backend API URL (custom domain → Render service)
  backendUrl: 'https://api.barnabi.ai',
  stripePublishableKey: 'pk_test_51SsQr8APHD8TltVxFOXQ8CzoUcwH8DTA4M9qfuKahOj6v6T6257HsLJzPjsPdMmJ5E2jzrF8UNwnOP2xx0wfLLTj004HuD4ZMo',
  agora: {
    appId: '134e5b056b944b66b14fc9e275726131',
    // No baked-in token in prod. Tokens are always minted by the backend
    // using AGORA_APP_CERT (see backend/routes/lessons.js + routes/classes.js).
    token: '',
    channel: 'language-class-001',
    uid: null
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
