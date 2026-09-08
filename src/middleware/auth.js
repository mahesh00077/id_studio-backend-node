const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { query } = require('../config/database');

const authMiddleware = async (req, res, next) => {
    try {
        const token = req.cookies.session_token || req.headers.authorization?.split(' ')[1];
        
        if (!token) {
            return res.status(401).json({ error: 'Authentication required' });
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
        const user = await User.findById(decoded.id);
        
        if (!user) {
            return res.status(401).json({ error: 'User not found' });
        }
        
        if (user.status !== 'ACTIVE') {
            return res.status(403).json({ error: 'Account is inactive' });
        }

        // Get user's school if not owner
        if (user.role !== 'OWNER') {
            const result = await query(
                'SELECT s.id, s.name, s.credit_balance FROM schools s JOIN school_users su ON s.id = su.school_id WHERE su.user_id = ?',
                [user.id]
            );
            if (result.rows.length > 0) {
                user.school_id = result.rows[0].id;
                user.school = result.rows[0];
            }
        }

        req.user = user;
        req.userId = user.id;
        req.schoolId = user.school_id;
        next();
    } catch (error) {
        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({ error: 'Invalid token' });
        }
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ error: 'Token expired' });
        }
        console.error('Auth error:', error);
        return res.status(500).json({ error: 'Authentication error' });
    }
};

const requireRole = (roles) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ error: 'Authentication required' });
        }
        
        if (!roles.includes(req.user.role)) {
            return res.status(403).json({ error: 'Insufficient permissions' });
        }
        
        next();
    };
};

const requireOwner = requireRole(['OWNER']);
const requireSchoolAdmin = requireRole(['OWNER', 'SCHOOL_ADMIN']);
const requireSchoolStaff = requireRole(['OWNER', 'SCHOOL_ADMIN', 'SCHOOL_STAFF']);

module.exports = {
    authMiddleware,
    requireRole,
    requireOwner,
    requireSchoolAdmin,
    requireSchoolStaff
};