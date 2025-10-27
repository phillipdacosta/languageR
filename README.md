# Language Learning App

A comprehensive language learning application similar to Preply, built with Ionic Angular frontend and Node.js/Express/MongoDB backend.

## Features

- **User Authentication**: Register, login, and profile management
- **Lesson Management**: Browse, filter, and take language lessons
- **Progress Tracking**: Track learning progress, streaks, and achievements
- **Multi-language Support**: Support for multiple languages and skill levels
- **Responsive Design**: Works on mobile, tablet, and desktop

## Tech Stack

### Frontend
- **Ionic Angular**: Cross-platform mobile app framework
- **Angular**: TypeScript-based web framework
- **Ionic Components**: UI components for mobile-first design

### Backend
- **Node.js**: JavaScript runtime
- **Express.js**: Web application framework
- **MongoDB**: NoSQL database
- **Mongoose**: MongoDB object modeling
- **JWT**: Authentication tokens
- **bcryptjs**: Password hashing

## Project Structure

```
language-app/
├── language-learning-app/     # Ionic Angular frontend
│   ├── src/
│   │   ├── app/
│   │   │   ├── services/      # API services
│   │   │   ├── tab1/          # Home tab
│   │   │   ├── tab2/          # Lessons tab
│   │   │   ├── tab3/          # Progress tab
│   │   │   ├── profile/       # Profile tab
│   │   │   └── tabs/          # Tab navigation
│   │   └── ...
│   └── ...
└── backend/                   # Node.js backend
    ├── models/                # Database models
    ├── routes/                # API routes
    ├── middleware/            # Custom middleware
    └── server.js              # Main server file
```

## Setup Instructions

### Prerequisites

- Node.js (v14 or higher)
- MongoDB (local installation or MongoDB Atlas)
- Ionic CLI
- Angular CLI

### Backend Setup

1. Navigate to the backend directory:
   ```bash
   cd backend
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Create a `.env` file in the backend directory with the following variables:
   ```env
   PORT=3000
   MONGODB_URI=mongodb://localhost:27017/language-learning-app
   JWT_SECRET=your-super-secret-jwt-key-change-this-in-production
   FRONTEND_URL=http://localhost:8100
   NODE_ENV=development
   ```

4. Start MongoDB (if running locally):
   ```bash
   mongod
   ```

5. Start the backend server:
   ```bash
   npm run dev
   ```

The backend API will be available at `http://localhost:3000`

### Frontend Setup

1. Navigate to the frontend directory:
   ```bash
   cd language-learning-app
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the development server:
   ```bash
   ionic serve
   ```

The frontend will be available at `http://localhost:8100`

## API Endpoints

### Authentication
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - User login
- `GET /api/auth/me` - Get current user
- `PUT /api/auth/profile` - Update profile
- `PUT /api/auth/change-password` - Change password

### Lessons
- `GET /api/lessons` - Get all lessons (with filtering)
- `GET /api/lessons/:id` - Get specific lesson
- `POST /api/lessons` - Create new lesson
- `PUT /api/lessons/:id` - Update lesson
- `DELETE /api/lessons/:id` - Delete lesson
- `POST /api/lessons/:id/start` - Start lesson
- `POST /api/lessons/:id/submit` - Submit lesson answers

### Progress
- `GET /api/progress` - Get user progress
- `GET /api/progress/stats` - Get progress statistics
- `GET /api/progress/streak` - Get streak information
- `DELETE /api/progress/lesson/:id` - Reset lesson progress

### Users
- `GET /api/users/profile` - Get user profile
- `POST /api/users/learning-languages` - Add learning language
- `PUT /api/users/learning-languages/:id` - Update learning language
- `DELETE /api/users/learning-languages/:id` - Remove learning language
- `GET /api/users/stats` - Get user statistics

## Database Models

### User
- Basic user information
- Learning languages and levels
- Progress tracking (streak, XP)
- Authentication data

### Lesson
- Lesson content and metadata
- Exercises and questions
- Difficulty and categorization
- Prerequisites and tags

### Progress
- User lesson progress
- Scores and completion status
- Exercise results
- XP and time tracking

## Development

### Adding New Features

1. **Backend**: Add new routes in the `routes/` directory
2. **Frontend**: Create new services in `services/` directory
3. **UI**: Add new pages or components as needed

### Testing

- Backend: Use tools like Postman or curl to test API endpoints
- Frontend: Use browser developer tools and Ionic DevApp

### Deployment

- **Backend**: Deploy to services like Heroku, DigitalOcean, or AWS
- **Frontend**: Build for production and deploy to web hosting or app stores

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

This project is licensed under the MIT License.

## Support

For support and questions, please open an issue in the repository.

