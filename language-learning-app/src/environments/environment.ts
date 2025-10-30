export const environment = {
  production: false,
  backendUrl: 'http://localhost:3000',
  agora: {
    appId: '134e5b056b944b66b14fc9e275726131', // Replace with your actual Agora App ID
    token: '007eJxTYBD+/FDjz5O5jcZTuuN+tAQ9e+dkf+dbravQlC8TTKJsN15SYDA0Nkk1TTIwNUuyNDFJMjNLMjRJS7ZMNTI3NTcyMzQ2jOX+m9EQyMgQEubLysgAgSC+EENOYl56aWJ6qm5yTmJxsa6BgSEDAwDVlST1', // Replace with the token from token-generator.html
    channel: 'language-class-001',
    uid: null // Let Agora assign a random UID
  },
  auth0: {
    domain: 'dev-h6q8nxbfbq8psb4k.us.auth0.com',
    clientId: 'veJihab93y2EdvOK10ve1TvwSffMTflj',
    redirectUri: 'http://localhost:8100/callback',
    audience: 'https://dev-h6q8nxbfbq8psb4k.us.auth0.com/api/v2/' // Auth0 Management API
  }
};