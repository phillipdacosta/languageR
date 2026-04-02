const API_BASE = 'https://languager-backend.onrender.com';

export const env = {
  apiUrl: `${API_BASE}/api`,
  backendUrl: API_BASE,
  auth0: {
    domain: 'dev-h6q8nxbfbq8psb4k.us.auth0.com',
    clientId: 'veJihab93y2EdvOK10ve1TvwSffMTflj',
    audience: 'https://dev-h6q8nxbfbq8psb4k.us.auth0.com/api/v2/',
  },
} as const;
