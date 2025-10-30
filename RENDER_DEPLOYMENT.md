# Render Deployment Guide

This guide will help you deploy your Language Learning App to Render.

## Prerequisites

1. **GitHub Repository**: Your code should be pushed to a GitHub repository
2. **Render Account**: Sign up at [render.com](https://render.com)
3. **MongoDB Atlas**: Set up a MongoDB Atlas cluster for production database
4. **Agora Account**: Have your Agora App ID and Certificate ready

## Deployment Steps

### 1. Connect Repository to Render

1. Go to [Render Dashboard](https://dashboard.render.com)
2. Click "New" → "Blueprint"
3. Connect your GitHub repository
4. Render will automatically detect the `render.yaml` file and show two services:
   - `languager-backend` (Web Service)
   - `languager-frontend` (Static Site)
5. Click "Apply" to create both services

### 2. Configure Backend Environment Variables

After deployment, go to your backend service settings and add these environment variables:

#### Required Variables:
- `MONGODB_URI`: Your MongoDB Atlas connection string
  - Example: `mongodb+srv://username:password@cluster.mongodb.net/language-learning-app`
- `CORS_ORIGIN`: Your frontend URL
  - Example: `https://languager-frontend.onrender.com`

#### Auth0 Variables:
- `AUTH0_DOMAIN`: Your Auth0 domain
- `AUTH0_AUDIENCE`: Your Auth0 API audience

#### Agora Variables:
- `AGORA_APP_ID`: Your Agora App ID
- `AGORA_APP_CERT`: Your Agora App Certificate
- `AGORA_TEMP_TOKEN`: (Optional) Temporary token for testing

#### Google Cloud Storage (Optional):
- `GCS_BUCKET_NAME`: Your GCS bucket name
- `GCS_PROJECT_ID`: Your GCP project ID
- `GCS_KEY_FILE`: Path to your service account key file

### 3. Update Frontend URLs

After your services are deployed, you'll get URLs like:
- Backend: `https://languager-backend.onrender.com`
- Frontend: `https://languager-frontend.onrender.com`

Update the following files with your actual URLs:

#### `language-learning-app/src/environments/environment.prod.ts`:
```typescript
export const environment = {
  production: true,
  backendUrl: 'https://YOUR-BACKEND-URL.onrender.com', // Replace with actual URL
  auth0: {
    domain: 'your-auth0-domain.auth0.com',
    clientId: 'your-auth0-client-id',
    redirectUri: 'https://YOUR-FRONTEND-URL.onrender.com/callback' // Replace with actual URL
  }
};
```

### 4. Update Auth0 Configuration

In your Auth0 dashboard:
1. Go to Applications → Your App → Settings
2. Update **Allowed Callback URLs**: `https://YOUR-FRONTEND-URL.onrender.com/callback`
3. Update **Allowed Web Origins**: `https://YOUR-FRONTEND-URL.onrender.com`
4. Update **Allowed Logout URLs**: `https://YOUR-FRONTEND-URL.onrender.com`

### 5. Deploy Updates

After updating the URLs:
1. Commit and push your changes to GitHub
2. Render will automatically redeploy both services
3. Wait for both deployments to complete

## Testing Your Deployment

1. Open your frontend URL in a browser
2. Test user authentication (login/logout)
3. Test lesson booking and joining
4. Test video calls and real-time messaging

## Troubleshooting

### Common Issues:

1. **CORS Errors**: Make sure `CORS_ORIGIN` in backend matches your frontend URL exactly
2. **Database Connection**: Verify your `MONGODB_URI` is correct and the database is accessible
3. **Auth0 Errors**: Check that all Auth0 URLs are updated in both Auth0 dashboard and environment files
4. **Agora Errors**: Verify your Agora credentials are correct

### Logs:
- Backend logs: Go to your backend service → Logs tab
- Frontend build logs: Go to your frontend service → Logs tab

## Free Tier Limitations

Render's free tier has some limitations:
- Services may sleep after 15 minutes of inactivity
- Limited build minutes per month
- Slower cold starts

For production use, consider upgrading to a paid plan.

## Environment Variables Summary

Copy this checklist when setting up your backend environment variables:

```
□ NODE_ENV=production
□ PORT=3000
□ MONGODB_URI=mongodb+srv://...
□ CORS_ORIGIN=https://your-frontend.onrender.com
□ AUTH0_DOMAIN=your-domain.auth0.com
□ AUTH0_AUDIENCE=your-api-audience
□ AGORA_APP_ID=your-app-id
□ AGORA_APP_CERT=your-app-certificate
□ AGORA_TEMP_TOKEN=your-temp-token (optional)
□ GCS_BUCKET_NAME=your-bucket (optional)
□ GCS_PROJECT_ID=your-project (optional)
□ GCS_KEY_FILE=path-to-key (optional)
```
