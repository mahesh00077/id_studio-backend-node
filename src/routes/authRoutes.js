const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const authController = require('../controllers/authController');
const { authMiddleware } = require('../middleware/auth');
const { validate, userValidation } = require('../middleware/validation');

// Strict per-IP limiter for credential endpoints to slow down brute-force
// and credential-stuffing attempts (on top of the global /api limiter).
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many authentication attempts. Please try again later.' }
});

router.post('/login', authLimiter, validate(userValidation.login), authController.login);
router.post('/logout', authMiddleware, authController.logout);
router.get('/me', authMiddleware, authController.getMe);
router.post('/change-password', authLimiter, authMiddleware, authController.changePassword);
router.post('/reset-password/:userId', authLimiter, authMiddleware, authController.resetPassword);

module.exports = router;