#!/bin/bash

# Language Learning App Startup Script

echo "🚀 Starting Language Learning App..."

# Check if MongoDB is running
if ! pgrep -x "mongod" > /dev/null; then
    echo "⚠️  MongoDB is not running. Please start MongoDB first:"
    echo "   brew services start mongodb-community"
    echo "   or"
    echo "   mongod"
    echo ""
fi

# Start backend
echo "📡 Starting backend server..."
cd backend
npm run dev &
BACKEND_PID=$!

# Wait a moment for backend to start
sleep 3

# Start frontend
echo "📱 Starting frontend app..."
cd ../language-learning-app
ionic serve &
FRONTEND_PID=$!

echo ""
echo "✅ Both servers are starting up!"
echo "📡 Backend: http://localhost:3000"
echo "📱 Frontend: http://localhost:8100"
echo ""
echo "Press Ctrl+C to stop both servers"

# Wait for user to stop
wait

# Cleanup
echo "🛑 Stopping servers..."
kill $BACKEND_PID 2>/dev/null
kill $FRONTEND_PID 2>/dev/null
echo "✅ Servers stopped"

