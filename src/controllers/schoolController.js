const School = require('../models/School');
const User = require('../models/User');
const { query } = require('../config/database');

console.log('✅ School Controller loaded');

// ===== OWNER CONTROLLERS =====
exports.createSchool = async (req, res) => {
    try {
        const { name, address, phone, email } = req.body;
        
        const school = await School.create({ name, address, phone, email });
        
        await query(
            'INSERT INTO audit_logs (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
            [req.user.id, 'SCHOOL_CREATED', JSON.stringify({ school_id: school.id, name }), req.ip]
        );
        
        return res.status(201).json(school);
    } catch (error) {
        console.error('Create school error:', error);
        return res.status(500).json({ error: 'Failed to create school' });
    }
};

exports.getSchools = async (req, res) => {
    try {
        const { limit = 50, offset = 0, search = '' } = req.query;
        const schools = await School.findAll({ limit, offset, search });
        return res.json(schools);
    } catch (error) {
        console.error('Get schools error:', error);
        return res.status(500).json({ error: 'Failed to fetch schools' });
    }
};

exports.getSchoolDetails = async (req, res) => {
    try {
        const { id } = req.params;
        const school = await School.findById(id);
        
        if (!school) {
            return res.status(404).json({ error: 'School not found' });
        }
        
        return res.json(school);
    } catch (error) {
        console.error('Get school details error:', error);
        return res.status(500).json({ error: 'Failed to fetch school details' });
    }
};

exports.updateSchool = async (req, res) => {
    try {
        const { id } = req.params;
        const { name, address, phone, email } = req.body;
        
        const school = await School.update(id, { name, address, phone, email });
        
        if (!school) {
            return res.status(404).json({ error: 'School not found' });
        }
        
        await query(
            'INSERT INTO audit_logs (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
            [req.user.id, 'SCHOOL_UPDATED', JSON.stringify({ school_id: id }), req.ip]
        );
        
        return res.json(school);
    } catch (error) {
        console.error('Update school error:', error);
        return res.status(500).json({ error: 'Failed to update school' });
    }
};

exports.updateSchoolStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;
        
        if (!['ACTIVE', 'INACTIVE'].includes(status)) {
            return res.status(400).json({ error: 'Invalid status' });
        }
        
        const school = await School.updateStatus(id, status);
        
        if (!school) {
            return res.status(404).json({ error: 'School not found' });
        }
        
        await query(
            'INSERT INTO audit_logs (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
            [req.user.id, 'SCHOOL_STATUS_CHANGED', JSON.stringify({ school_id: id, status }), req.ip]
        );
        
        return res.json(school);
    } catch (error) {
        console.error('Update school status error:', error);
        return res.status(500).json({ error: 'Failed to update school status' });
    }
};

// ===== SCHOOL ADMIN CONTROLLERS =====
exports.getSchoolDashboard = async (req, res) => {
    try {
        const schoolId = req.schoolId;
        console.log('Fetching dashboard for school:', schoolId);
        
        if (!schoolId) {
            console.log('No school ID found');
            return res.json({
                stats: {
                    total_students: 0,
                    total_id_cards: 0,
                    available_credits: 0,
                    total_staff: 0
                },
                recentCards: []
            });
        }
        
        const stats = await School.getStatistics(schoolId);
        console.log('Stats:', stats);
        
        const recentCards = await query(
            `SELECT ic.*, s.name as student_name 
             FROM id_cards ic 
             JOIN students s ON ic.student_id = s.id 
             WHERE ic.school_id = ? 
             ORDER BY ic.generated_at DESC 
             LIMIT 10`,
            [schoolId]
        );
        
        return res.json({
            stats: {
                total_students: stats?.total_students || 0,
                total_id_cards: stats?.total_id_cards || 0,
                available_credits: stats?.available_credits || 0,
                total_staff: stats?.total_staff || 0
            },
            recentCards: recentCards.rows || []
        });
    } catch (error) {
        console.error('Get dashboard error:', error);
        return res.json({
            stats: {
                total_students: 0,
                total_id_cards: 0,
                available_credits: 0,
                total_staff: 0
            },
            recentCards: []
        });
    }
};

exports.getSchoolCreditBalance = async (req, res) => {
    try {
        const schoolId = req.schoolId || req.params.id;
        console.log('Fetching credit balance for school:', schoolId);
        
        if (!schoolId) {
            return res.json({ balance: 0 });
        }
        
        const balance = await School.getCredits(schoolId);
        return res.json({ balance });
    } catch (error) {
        console.error('Get credit balance error:', error);
        return res.json({ balance: 0 });
    }
};

exports.getSchoolCreditHistory = async (req, res) => {
    try {
        const schoolId = req.params.id || req.schoolId;
        const { limit = 50, offset = 0 } = req.query;
        
        console.log('Fetching credit history for school:', schoolId);
        
        if (!schoolId) {
            return res.json([]);
        }
        
        const history = await School.getCreditHistory(schoolId, { limit, offset });
        return res.json(history || []);
    } catch (error) {
        console.error('Get credit history error:', error);
        return res.json([]);
    }
};

exports.addSchoolCredits = async (req, res) => {
    try {
        const { id } = req.params;
        const { amount, reason } = req.body;
        
        if (!amount || amount <= 0) {
            return res.status(400).json({ error: 'Valid amount is required' });
        }
        
        const school = await School.updateCredits(id, amount, reason || 'Added by Owner', req.user.id);
        
        if (!school) {
            return res.status(404).json({ error: 'School not found' });
        }
        
        await query(
            'INSERT INTO audit_logs (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
            [req.user.id, 'CREDITS_ADDED', JSON.stringify({ school_id: id, amount, reason }), req.ip]
        );
        
        return res.json({ 
            success: true, 
            newBalance: school.credit_balance,
            message: `Added ${amount} credits to school`
        });
    } catch (error) {
        console.error('Add credits error:', error);
        return res.status(500).json({ error: error.message || 'Failed to add credits' });
    }
};