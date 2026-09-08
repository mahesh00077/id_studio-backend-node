const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { authMiddleware, requireOwner } = require('../middleware/auth');
const schoolController = require('../controllers/schoolController');
const { validate, schoolValidation } = require('../middleware/validation');
const { query } = require('../config/database');

// Import idCardController with try-catch
let idCardController;
try {
    idCardController = require('../controllers/idCardController');
    console.log('✅ Owner routes: idCardController loaded');
} catch (error) {
    console.error('❌ Owner routes: Failed to load idCardController', error.message);
    // Create dummy functions
    idCardController = {
        getAllIDCards: (req, res) => res.json([]),
        getIDCardDetails: (req, res) => res.json({}),
        getIDCardsBySchool: (req, res) => res.json([]),
        updateIDCardStatus: (req, res) => res.json({ success: true }),
        deleteIDCard: (req, res) => res.json({ success: true }),
        getIDCardStats: (req, res) => res.json({ summary: {}, daily_stats: [] }),
        uploadDesignImages: (req, res) => res.json({ success: true, files: {} }),
        createDesign: (req, res) => res.json({ success: true }),
        getDesigns: (req, res) => res.json([]),
        getDesignDetails: (req, res) => res.json({}),
        updateDesign: (req, res) => res.json({ success: true }),
        updateDesignStatus: (req, res) => res.json({ success: true }),
        deleteDesign: (req, res) => res.json({ success: true }),
        assignDesignToSchool: (req, res) => res.json({ success: true }),
        assignDesignToMultipleSchools: (req, res) => res.json({ success: true }),
        removeDesignFromSchool: (req, res) => res.json({ success: true }),
        getSchoolDesigns: (req, res) => res.json([]),
        getAvailableDesigns: (req, res) => res.json([]),
        previewIDCard: (req, res) => res.json({ success: true }),
        generateIDCard: (req, res) => res.json({ success: true }),
        generateDemoIDCard: (req, res) => res.json({ success: true }),
        getIDCardHistory: (req, res) => res.json([]),
        downloadIDCard: (req, res) => res.json({ success: true })
    };
}

// Ensure uploads directory exists
const uploadDir = path.join(__dirname, '../../uploads/designs');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// Multer configuration
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'design-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const fileFilter = (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/jpg', 'image/webp'];
    if (allowedTypes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error('Invalid file type. Only JPEG, PNG, WebP are allowed.'), false);
    }
};

const upload = multer({
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: fileFilter
});

// All routes require authentication and OWNER role
router.use(authMiddleware, requireOwner);

// ===== SCHOOL MANAGEMENT =====
router.post('/schools', validate(schoolValidation.create), schoolController.createSchool);
router.get('/schools', schoolController.getSchools);
router.get('/schools/:id', schoolController.getSchoolDetails);
router.put('/schools/:id', validate(schoolValidation.update), schoolController.updateSchool);
router.patch('/schools/:id/status', schoolController.updateSchoolStatus);

// List all students for a given school (used by owner reports). Returns the
// full ACTIVE student roster so the report page can render + export it.
router.get('/schools/:schoolId/students', async (req, res) => {
    try {
        const { search = '' } = req.query;
        const Student = require('../models/Student');
        const students = await Student.findBySchool(req.params.schoolId, {
            limit: 10000,
            offset: 0,
            search,
            status: 'ACTIVE'
        });
        return res.json(students);
    } catch (error) {
        console.error('Get school students error:', error);
        return res.status(500).json({ error: 'Failed to fetch school students' });
    }
});

// ===== CREDIT MANAGEMENT =====
router.post('/schools/:id/credits', schoolController.addSchoolCredits);
router.get('/schools/:id/credits/history', schoolController.getSchoolCreditHistory);

// ===== ID CARD MANAGEMENT =====
router.get('/id-cards', idCardController.getAllIDCards);
// Demo (credit-free) generation for the Owner's /designs page. Registered BEFORE
// the /id-cards/:id parameterized routes so the literal "demo-generate" segment
// is not captured as an :id.
router.post('/id-cards/demo-generate', idCardController.generateDemoIDCard);
// IMPORTANT: "/id-cards/stats" MUST be registered before "/id-cards/:id",
// otherwise the literal segment "stats" is captured as the :id param and the
// stats call would hit getIDCardDetails instead (returning a wrong 404).
router.get('/id-cards/stats', idCardController.getIDCardStats);
router.get('/id-cards/:id/download', idCardController.getOwnerIDCardDownload);
router.get('/id-cards/:id', idCardController.getIDCardDetails);
router.get('/id-cards/school/:schoolId', idCardController.getIDCardsBySchool);
router.patch('/id-cards/:id/status', idCardController.updateIDCardStatus);
router.delete('/id-cards/:id', idCardController.deleteIDCard);

// ===== DESIGN MANAGEMENT =====
router.post('/designs/upload', upload.fields([
    { name: 'frontImage', maxCount: 1 },
    { name: 'backImage', maxCount: 1 }
]), idCardController.uploadDesignImages);

router.post('/designs', idCardController.createDesign);
router.get('/designs', idCardController.getDesigns);
router.get('/designs/:id', idCardController.getDesignDetails);
router.put('/designs/:id', idCardController.updateDesign);
router.patch('/designs/:id/status', idCardController.updateDesignStatus);
router.delete('/designs/:id', idCardController.deleteDesign);

// ===== DESIGN ASSIGNMENT =====
router.post('/designs/:designId/assign/:schoolId', idCardController.assignDesignToSchool);
router.post('/designs/:designId/assign-multiple', idCardController.assignDesignToMultipleSchools);
router.delete('/designs/:designId/unassign/:schoolId', idCardController.removeDesignFromSchool);
router.get('/designs/school/:schoolId', idCardController.getSchoolDesigns);

// ===== USER MANAGEMENT =====
// Server-side credential validation for owner-created users (the previous
// versions trusted the client completely — any malformed email or a 2-char
// password was accepted straight into the database).
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function validateNewUserCredentials(req, res) {
    const { email, password, schoolId } = req.body;

    if (!email || !password || !schoolId) {
        res.status(400).json({ error: 'Email, password, and schoolId are required' });
        return null;
    }

    if (typeof email !== 'string' || !EMAIL_RE.test(email.trim()) || email.length > 254) {
        res.status(400).json({ error: 'Please provide a valid email address' });
        return null;
    }

    if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
        res.status(400).json({ error: 'Password must be between 8 and 128 characters' });
        return null;
    }

    return { email: String(email).trim().toLowerCase(), password, schoolId };
}

router.post('/users/admin', async (req, res) => {
    try {
        const creds = validateNewUserCredentials(req, res);
        if (!creds) return;

        const { email, password, schoolId } = creds;
        
        const User = require('../models/User');
        const existingUser = await User.findByEmail(email);
        if (existingUser) {
            return res.status(400).json({ error: 'User with this email already exists' });
        }
        
        const user = await User.create({ email, password, role: 'SCHOOL_ADMIN' });
        await User.assignToSchool(user.id, schoolId);
        
        await query(
            'INSERT INTO audit_logs (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
            [req.user.id, 'SCHOOL_ADMIN_CREATED', JSON.stringify({ user_id: user.id, school_id: schoolId }), req.ip]
        );
        
        return res.status(201).json({
            success: true,
            user,
            schoolId,
            message: 'School Admin created successfully'
        });
    } catch (error) {
        console.error('Create school admin error:', error);
        return res.status(500).json({ error: 'Failed to create school admin' });
    }
});

router.post('/users/staff', async (req, res) => {
    try {
        const creds = validateNewUserCredentials(req, res);
        if (!creds) return;

        const { email, password, schoolId } = creds;
        const { permissions = {} } = req.body;
        
        const User = require('../models/User');
        const existingUser = await User.findByEmail(email);
        if (existingUser) {
            return res.status(400).json({ error: 'User with this email already exists' });
        }
        
        const user = await User.create({ email, password, role: 'SCHOOL_STAFF' });
        await User.assignToSchool(user.id, schoolId, permissions);
        
        await query(
            'INSERT INTO audit_logs (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
            [req.user.id, 'SCHOOL_STAFF_CREATED', JSON.stringify({ user_id: user.id, school_id: schoolId }), req.ip]
        );
        
        return res.status(201).json({
            success: true,
            user,
            schoolId,
            permissions,
            message: 'School Staff created successfully'
        });
    } catch (error) {
        console.error('Create school staff error:', error);
        return res.status(500).json({ error: 'Failed to create school staff' });
    }
});

router.get('/users', async (req, res) => {
    try {
        const { role, schoolId } = req.query;
        const User = require('../models/User');
        
        let users;
        if (schoolId) {
            users = await User.getSchoolUsers(schoolId);
        } else if (role) {
            users = await User.getUsersByRole(role);
        } else {
            return res.status(400).json({ error: 'Please specify role or schoolId' });
        }
        
        return res.json(users);
    } catch (error) {
        console.error('Get users error:', error);
        return res.status(500).json({ error: 'Failed to fetch users' });
    }
});

router.patch('/users/:userId/status', async (req, res) => {
    try {
        const { userId } = req.params;
        const { status } = req.body;
        const User = require('../models/User');
        
        if (!['ACTIVE', 'INACTIVE'].includes(status)) {
            return res.status(400).json({ error: 'Invalid status' });
        }
        
        const user = await User.updateStatus(userId, status);
        
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        await query(
            'INSERT INTO audit_logs (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
            [req.user.id, 'USER_STATUS_CHANGED', JSON.stringify({ user_id: userId, status }), req.ip]
        );
        
        return res.json({ success: true, user });
    } catch (error) {
        console.error('Update user status error:', error);
        return res.status(500).json({ error: 'Failed to update user status' });
    }
});

// ===== USER EDIT =====
// Update an existing user's email, role, and school assignment, and
// optionally reset their password. Only the OWNER can perform this.
router.put('/users/:userId', async (req, res) => {
    try {
        const User = require('../models/User');
        const { userId } = req.params;
        const b = req.body || {};

        const current = await User.findById(userId);
        if (!current) {
            return res.status(404).json({ error: 'User not found' });
        }

        // OWNER role cannot be edited by this endpoint (protect the platform admin).
        if (current.role === 'OWNER') {
            return res.status(400).json({ error: 'Owner accounts cannot be edited here' });
        }

        const email = b.email == null ? current.email : String(b.email).trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 254) {
            return res.status(400).json({ error: 'Please provide a valid email address' });
        }

        const role = b.role == null ? current.role : b.role;
        if (!['SCHOOL_ADMIN', 'SCHOOL_STAFF'].includes(role)) {
            return res.status(400).json({ error: 'Invalid role. Allowed: SCHOOL_ADMIN, SCHOOL_STAFF' });
        }

        let password;
        if (b.password) {
            if (typeof b.password !== 'string' || b.password.length < 8 || b.password.length > 128) {
                return res.status(400).json({ error: 'Password must be between 8 and 128 characters' });
            }
            password = b.password;
        }

        // Prevent email collisions (ignoring the user being updated).
        const existing = await User.findByEmail(email);
        if (existing && String(existing.id) !== String(userId)) {
            return res.status(400).json({ error: 'Another user already uses this email' });
        }

        const updated = await User.updateProfile(userId, { email, role, password });

        // Update school assignment.
        const schoolId = b.schoolId ? String(b.schoolId) : null;
        const currentSchool = (await query(
            'SELECT school_id FROM school_users WHERE user_id = ?',
            [userId]
        )).rows[0];

        if (schoolId) {
            if (currentSchool && String(currentSchool.school_id) !== schoolId) {
                await User.removeFromSchool(userId, currentSchool.school_id);
            }
            await User.assignToSchool(userId, schoolId);
        } else if (currentSchool) {
            await User.removeFromSchool(userId, currentSchool.school_id);
        }

        await query(
            'INSERT INTO audit_logs (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
            [req.user.id, 'USER_UPDATED',
             JSON.stringify({ user_id: userId, email, role, password_changed: !!password, school_id: schoolId }),
             req.ip]
        );

        return res.json({ success: true, user: updated });
    } catch (error) {
        console.error('Update user error:', error);
        return res.status(500).json({ error: 'Failed to update user' });
    }
});

// ===== PLATFORM MANAGEMENT =====
router.get('/platform/stats', async (req, res) => {
    try {
        const stats = await query(
            `SELECT 
                (SELECT COUNT(*) FROM schools) as total_schools,
                (SELECT COUNT(*) FROM users WHERE role != 'OWNER') as total_users,
                (SELECT COUNT(*) FROM students) as total_students,
                (SELECT COUNT(*) FROM id_cards) as total_cards,
                (SELECT SUM(credit_balance) FROM schools) as total_credits`
        );
        res.json(stats.rows[0] || {
            total_schools: 0,
            total_users: 0,
            total_students: 0,
            total_cards: 0,
            total_credits: 0
        });
    } catch (error) {
        console.error('Platform stats error:', error);
        res.status(500).json({ 
            total_schools: 0,
            total_users: 0,
            total_students: 0,
            total_cards: 0,
            total_credits: 0,
            error: 'Failed to fetch platform stats' 
        });
    }
});

router.get('/platform/audit-logs', async (req, res) => {
    try {
        const { limit = 100, offset = 0 } = req.query;
        const result = await query(
            `SELECT al.*, u.email as user_email
             FROM audit_logs al
             LEFT JOIN users u ON al.user_id = u.id
             ORDER BY al.created_at DESC
             LIMIT ? OFFSET ?`,
            [parseInt(limit), parseInt(offset)]
        );
        res.json(result.rows);
    } catch (error) {
        console.error('Audit logs error:', error);
        res.status(500).json({ error: 'Failed to fetch audit logs' });
    }
});


const designFieldController = require('../controllers/designFieldController');

router.get('/designs/:designId/fields', designFieldController.getDesignFields);
router.post('/designs/:designId/fields', designFieldController.createDesignField);
router.put('/designs/:designId/fields', designFieldController.saveDesignFields);
router.put('/designs/:designId/fields/:fieldId', designFieldController.updateDesignField);
router.delete('/designs/:designId/fields/:fieldId', designFieldController.deleteDesignField);
router.delete('/designs/:designId/fields', designFieldController.deleteDesignFieldsForSide);


module.exports = router;