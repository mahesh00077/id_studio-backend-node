const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { query } = require('../config/database');

exports.login = async (req, res) => {
    try {
        const { email, password } = req.body;
        
        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required' });
        }

        const user = await User.findByEmail(email);
        if (!user) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        if (user.status !== 'ACTIVE') {
            return res.status(403).json({ error: 'Account is inactive' });
        }

        const isValidPassword = await User.comparePassword(password, user.password_hash);
        if (!isValidPassword) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Update last login
        await User.updateLastLogin(user.id);

        // Get user's school if not owner
        let schoolInfo = null;
        if (user.role !== 'OWNER') {
            const result = await query(
                'SELECT s.* FROM schools s JOIN school_users su ON s.id = su.school_id WHERE su.user_id = ?',
                [user.id]
            );
            if (result.rows.length > 0) {
                schoolInfo = result.rows[0];
                user.school_id = schoolInfo.id;
            }
        }

        // Generate JWT token
        const token = jwt.sign(
            { id: user.id, email: user.email, role: user.role },
            process.env.JWT_SECRET,
            { expiresIn: '24h' }
        );

        // Set cookie. NOTE: no maxAge on purpose -> this is a *session cookie*.
        // The browser deletes it automatically when the browser closes, so the
        // session ends with the browser session. The JWT inside still
        // hard-expires server-side after 24h regardless.
        res.cookie('session_token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
        });

        return res.json({
            success: true,
            user: {
                id: user.id,
                email: user.email,
                role: user.role,
                status: user.status
            },
            school: schoolInfo
            // SECURITY: the JWT is intentionally NOT returned in the body.
            // Authentication relies solely on the httpOnly session cookie,
            // which JavaScript cannot read, preventing XSS token theft.
        });

    } catch (error) {
        console.error('Login error:', error);
        return res.status(500).json({ error: 'Login failed' });
    }
};

exports.logout = (req, res) => {
    res.clearCookie('session_token', { path: '/' });
    return res.json({ success: true, message: 'Logged out successfully' });
};

exports.getMe = async (req, res) => {
    try {
        if (!req.user) {
            return res.status(401).json({ error: 'Not authenticated' });
        }

        const user = await User.findById(req.user.id);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        let schoolInfo = null;
        if (user.role !== 'OWNER') {
            const result = await query(
                'SELECT s.* FROM schools s JOIN school_users su ON s.id = su.school_id WHERE su.user_id = ?',
                [user.id]
            );
            if (result.rows.length > 0) {
                schoolInfo = result.rows[0];
                user.school_id = schoolInfo.id;
            }
        }

        return res.json({
            user,
            school: schoolInfo
        });

    } catch (error) {
        console.error('Get me error:', error);
        return res.status(500).json({ error: 'Failed to get user info' });
    }
};

exports.changePassword = async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;
        
        if (!currentPassword || !newPassword) {
            return res.status(400).json({ error: 'Current password and new password are required' });
        }

        if (newPassword.length < 8) {
            return res.status(400).json({ error: 'New password must be at least 8 characters' });
        }

        const user = await User.findWithPassword(req.user.id);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const isValidPassword = await User.comparePassword(currentPassword, user.password_hash);
        if (!isValidPassword) {
            return res.status(401).json({ error: 'Current password is incorrect' });
        }

        await User.updatePassword(user.id, newPassword);

        return res.json({ success: true, message: 'Password changed successfully' });

    } catch (error) {
        console.error('Change password error:', error);
        return res.status(500).json({ error: 'Failed to change password' });
    }
};

exports.resetPassword = async (req, res) => {
    try {
        const { userId } = req.params;
        const { newPassword } = req.body;

        if (!newPassword || newPassword.length < 8) {
            return res.status(400).json({ error: 'New password must be at least 8 characters' });
        }

        // Only Owner can reset passwords
        if (req.user.role !== 'OWNER') {
            return res.status(403).json({ error: 'Only Owner can reset passwords' });
        }

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        await User.updatePassword(userId, newPassword);

        // Log the action
        const { query } = require('../config/database');
        await query(
            'INSERT INTO audit_logs (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
            [req.user.id, 'PASSWORD_RESET', JSON.stringify({ target_user: userId }), req.ip]
        );

        return res.json({ success: true, message: 'Password reset successfully' });

    } catch (error) {
        console.error('Reset password error:', error);
        return res.status(500).json({ error: 'Failed to reset password' });
    }
};