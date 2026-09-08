const School = require('../models/School');
const { query } = require('../config/database');

const enforceSchoolIsolation = async (req, res, next) => {
    try {
        // Owner bypasses school isolation
        if (req.user.role === 'OWNER') {
            return next();
        }

        // Get school ID from user
        const schoolId = req.user.school_id;
        
        if (!schoolId) {
            return res.status(403).json({ error: 'No school associated with user' });
        }

        // Verify school exists and is active
        const school = await School.findById(schoolId);
        if (!school || school.status !== 'ACTIVE') {
            return res.status(403).json({ error: 'School not found or inactive' });
        }

        // Attach school ID to request
        req.schoolId = schoolId;
        req.school = school;

        // Check if operation is for a specific school
        const requestedSchoolId = req.params.schoolId || req.body.schoolId || req.query.schoolId;
        
        if (requestedSchoolId && requestedSchoolId !== schoolId) {
            return res.status(403).json({ error: 'Access denied to requested school' });
        }

        // Check if operation is for a specific student
        const studentId = req.params.studentId || req.body.studentId;
        if (studentId) {
            const result = await query(
                'SELECT school_id FROM students WHERE id = ?',
                [studentId]
            );
            if (result.rows.length > 0 && result.rows[0].school_id !== schoolId) {
                return res.status(403).json({ error: 'Student does not belong to your school' });
            }
        }

        // Check if operation is for a specific user
        const userId = req.params.userId || req.body.userId;
        if (userId) {
            const result = await query(
                'SELECT school_id FROM school_users WHERE user_id = ?',
                [userId]
            );
            if (result.rows.length > 0 && result.rows[0].school_id !== schoolId) {
                return res.status(403).json({ error: 'User does not belong to your school' });
            }
        }

        next();
    } catch (error) {
        console.error('School isolation error:', error);
        return res.status(500).json({ error: 'School isolation check failed' });
    }
};

const getSchoolId = (req) => {
    return req.schoolId || req.user?.school_id;
};

module.exports = {
    enforceSchoolIsolation,
    getSchoolId
};