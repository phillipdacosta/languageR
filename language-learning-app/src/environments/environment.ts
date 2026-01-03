export const environment = {
  production: false,
  apiUrl: 'http://localhost:3000/api', // Backend API URL
  backendUrl: 'http://localhost:3000',
  stripePublishableKey: 'pk_test_51SkSi9BKUCCLlfbERkY1hkCVT1cdSlKyTyRN6VkxAwcaT81mV8eXlllJc2vvuRJf8vGRKwaqtGnNbP5LgycSZZ6L00f2UHYKbP',
  agora: {
    appId: '134e5b056b944b66b14fc9e275726131', // Replace with your actual Agora App ID
    token: '007eJxTYBD+/FDjz5O5jcZTuuN+tAQ9e+dkf+tbravQlC8TTKJsN15SYDA0Nkk1TTIwNUuyNDFJMjNLMjRJS7ZMNTI3NTcyMzQ2jOX+m9EQyMgQEubLysgAgSC+EENOYl56aWJ6qm5yTmJxsa6BgSEDAwDVlST1', // Replace with the token from token-generator.html
    channel: 'language-class-001',
    uid: null // Let Agora assign a random UID
  },
  agoraWhiteboard: {
    appId: 'LlbHYLHIEfCEJZXtHZ664A/hz-fQn1QNhGOwQ', // From Agora Console Whiteboard
    region: 'us-sv' // us-sv, ap-sg, eu, or cn-hz
  },
  auth0: {
    domain: 'dev-h6q8nxbfbq8psb4k.us.auth0.com',
    clientId: 'veJihab93y2EdvOK10ve1TvwSffMTflj',
    redirectUri: 'http://localhost:8100/callback',
    audience: 'https://dev-h6q8nxbfbq8psb4k.us.auth0.com/api/v2/' // Auth0 Management API
  }
};
