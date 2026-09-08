require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');

const authRoutes = require('./src/routes/authRoutes');
const ownerRoutes = require('./src/routes/ownerRoutes');
const schoolAdminRoutes = require('./src/routes/schoolAdminRoutes');
const schoolStaffRoutes = require('./src/routes/schoolStaffRoutes');
const brandingRoutes = require('./src/routes/brandingRoutes');
const advertisementRoutes = require('./src/routes/advertisementRoutes');

const app = express();
const PORT = process.env.PORT || 5000;

// ===== SECURITY: fail fast on a missing/weak JWT secret =====
// Without this check the app would happily sign tokens with `undefined`
// (or an easily guessable value), letting anyone forge sessions.
if (!process.env.JWT_SECRET || String(process.env.JWT_SECRET).length < 32) {
    console.error('FATAL: JWT_SECRET is missing or too weak (min 32 chars). Set it in backend-node/.env before starting.');
    process.exit(1);
}

// CORS Configuration — ONLY explicitly allow-listed origins are accepted.
// (The previous NODE_ENV === 'development' bypass allowed ANY origin,
// which defeats the purpose of CORS entirely.)
const allowedOrigins = [
    'http://localhost:3000',
    'http://localhost:5173',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:5173',
    process.env.FRONTEND_URL
].filter(Boolean);

app.use(cors({
    origin: function (origin, callback) {
        if (!origin) return callback(null, true); // same-origin / curl / mobile apps
        if (allowedOrigins.indexOf(origin) !== -1) {
            callback(null, true);
        } else {
            console.log('Blocked origin:', origin);
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Cookie', 'X-Requested-With'],
    exposedHeaders: ['Set-Cookie']
}));

app.options('*', cors());

// Security middleware
app.use(helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" }
}));

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: { error: 'Too many requests, please try again later.' }
});
app.use('/api', limiter);

// Body parsing — 10mb is plenty for base64 photos + rendered card images
// (the old 50mb limit was an easy DoS / memory-exhaustion vector).
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// Static files
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
console.log('📁 Serving uploads from:', path.join(__dirname, 'uploads'));

// Request logging
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} from ${req.headers.origin || 'unknown'}`);
    next();
});

// ===== ROUTES =====
app.use('/api/auth', authRoutes);
app.use('/api/owner', ownerRoutes);
app.use('/api/school-admin', schoolAdminRoutes);  // Make sure this is registered
app.use('/api/school-staff', schoolStaffRoutes);
app.use('/api/branding', brandingRoutes);
app.use('/api/ads', advertisementRoutes);

// Health check
app.get('/api/health', (req, res) => {
    res.json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Route not found' });
});

// Error handler
app.use((err, req, res, next) => {
    console.error('Error:', err);
    // Never leak internal error details or stack traces to clients outside
    // of local development.
    const isDev = process.env.NODE_ENV === 'development';
    res.status(err.status || 500).json({
        error: (isDev && err.message) || 'Internal server error',
        ...(isDev && { stack: err.stack })
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📖 Environment: ${process.env.NODE_ENV}`);
    console.log(`🔗 API URL: http://localhost:${PORT}/api`);
    console.log(`📁 Uploads URL: http://localhost:${PORT}/uploads`);
    console.log(`✅ Allowed CORS origins:`, allowedOrigins);
});

// Add this to your server.js
app.use('/api/python', (req, res) => {
    // This will proxy requests to Python backend
    const pythonUrl = `http://localhost:8000${req.url}`;
    // Use axios or fetch to forward request
});

module.exports = app;