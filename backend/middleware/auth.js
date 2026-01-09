const jwt = require('jsonwebtoken');
const User = require('../models/User');

const auth = async (req, res, next) => {
  try {
    // Check for token in multiple places:
    // 1. Authorization header (existing behavior)
    // 2. Cookie (new for cross-tab support in incognito)
    let token = req.header('Authorization')?.replace('Bearer ', '');
    
    // If no Authorization header, check for cookie
    if (!token && req.cookies && req.cookies.auth_token) {
      token = req.cookies.auth_token;
      console.log('🍪 Using token from cookie');
    }
    
    if (!token) {
      return res.status(401).json({ message: 'No token, authorization denied' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback-secret');
    const user = await User.findById(decoded.userId).select('-password');
    
    if (!user) {
      return res.status(401).json({ message: 'Token is not valid' });
    }

    if (!user.isActive) {
      return res.status(401).json({ message: 'User account is deactivated' });
    }

    req.user = user;
    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    res.status(401).json({ message: 'Token is not valid' });
  }
};

const optionalAuth = async (req, res, next) => {
  try {
    // Check for token in Authorization header or cookie
    let token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token && req.cookies && req.cookies.auth_token) {
      token = req.cookies.auth_token;
    }
    
    if (token) {
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback-secret');
      const user = await User.findById(decoded.userId).select('-password');
      
      if (user && user.isActive) {
        req.user = user;
      }
    }
    
    next();
  } catch (error) {
    // Continue without authentication for optional auth
    next();
  }
};

module.exports = { auth, optionalAuth, requireAuth: auth, requireAdmin };

// Admin middleware - check if user is admin
function requireAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ message: 'Authentication required' });
  }
  
  // Check if user is admin (you can adjust this logic based on your User model)
  if (req.user.userType !== 'admin' && req.user.email !== process.env.ADMIN_EMAIL) {
    return res.status(403).json({ message: 'Admin access required' });
  }
  
  next();
}
