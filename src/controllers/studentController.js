const Student = require('../models/Student');
const { query } = require('../config/database');

exports.createStudent = async (req, res) => {
    try {
        const schoolId = req.schoolId;
        const { name, fatherName, phone, address, class: className, section, admissionNumber, photoUrl } = req.body;
        
        // Check if admission number already exists
        if (admissionNumber) {
            const existing = await query(
                'SELECT id FROM students WHERE admission_number = ?',
                [admissionNumber]
            );
            if (existing.rows.length > 0) {
                return res.status(400).json({ error: 'Admission number already exists' });
            }
        }
        
        const student = await Student.create({
            schoolId,
            name,
            fatherName,
            phone,
            address,
            class: className,
            section,
            admissionNumber,
            photoUrl
        });
        
        // Log action
        await query(
            'INSERT INTO audit_logs (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
            [req.user.id, 'STUDENT_CREATED', JSON.stringify({ student_id: student.id, name }), req.ip]
        );
        
        return res.status(201).json(student);
    } catch (error) {
        console.error('Create student error:', error);
        return res.status(500).json({ error: 'Failed to create student' });
    }
};

exports.getStudents = async (req, res) => {
    try {
        const schoolId = req.schoolId;
        const { limit = 100, offset = 0, search = '', status = 'ACTIVE' } = req.query;
        
        const students = await Student.findBySchool(schoolId, { limit, offset, search, status });
        return res.json(students);
    } catch (error) {
        console.error('Get students error:', error);
        return res.status(500).json({ error: 'Failed to fetch students' });
    }
};

exports.getStudentDetails = async (req, res) => {
    try {
        const schoolId = req.schoolId;
        const { id } = req.params;
        
        const student = await Student.findById(id, schoolId);
        if (!student) {
            return res.status(404).json({ error: 'Student not found' });
        }
        
        // Get student's ID cards
        const idCards = await Student.getIDCards(id, schoolId);
        
        return res.json({
            ...student,
            idCards
        });
    } catch (error) {
        console.error('Get student details error:', error);
        return res.status(500).json({ error: 'Failed to fetch student details' });
    }
};

exports.updateStudent = async (req, res) => {
    try {
        const schoolId = req.schoolId;
        const { id } = req.params;
        const { name, fatherName, phone, address, class: className, section, admissionNumber, photoUrl } = req.body;
        
        // Verify student belongs to school
        const existing = await Student.findById(id, schoolId);
        if (!existing) {
            return res.status(404).json({ error: 'Student not found' });
        }
        
        // Check admission number uniqueness
        if (admissionNumber && admissionNumber !== existing.admission_number) {
            const duplicate = await query(
                'SELECT id FROM students WHERE admission_number = ? AND id != ?',
                [admissionNumber, id]
            );
            if (duplicate.rows.length > 0) {
                return res.status(400).json({ error: 'Admission number already exists' });
            }
        }
        
        const student = await Student.update(id, {
            name,
            fatherName,
            phone,
            address,
            class: className,
            section,
            admissionNumber,
            photoUrl
        });
        
        // Log action
        await query(
            'INSERT INTO audit_logs (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
            [req.user.id, 'STUDENT_UPDATED', JSON.stringify({ student_id: id }), req.ip]
        );
        
        return res.json(student);
    } catch (error) {
        console.error('Update student error:', error);
        return res.status(500).json({ error: 'Failed to update student' });
    }
};

exports.updateStudentStatus = async (req, res) => {
    try {
        const schoolId = req.schoolId;
        const { id } = req.params;
        const { status } = req.body;
        
        if (!['ACTIVE', 'INACTIVE'].includes(status)) {
            return res.status(400).json({ error: 'Invalid status' });
        }
        
        // Verify student belongs to school
        const existing = await Student.findById(id, schoolId);
        if (!existing) {
            return res.status(404).json({ error: 'Student not found' });
        }
        
        const student = await Student.updateStatus(id, status);
        
        // Log action
        await query(
            'INSERT INTO audit_logs (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
            [req.user.id, 'STUDENT_STATUS_CHANGED', JSON.stringify({ student_id: id, status }), req.ip]
        );
        
        return res.json(student);
    } catch (error) {
        console.error('Update student status error:', error);
        return res.status(500).json({ error: 'Failed to update student status' });
    }
};

exports.updateStudentPhoto = async (req, res) => {
    try {
        const schoolId = req.schoolId;
        const { id } = req.params;
        const { photoUrl } = req.body;
        
        if (!photoUrl) {
            return res.status(400).json({ error: 'Photo URL is required' });
        }
        
        // Verify student belongs to school
        const existing = await Student.findById(id, schoolId);
        if (!existing) {
            return res.status(404).json({ error: 'Student not found' });
        }
        
        const student = await Student.updatePhoto(id, photoUrl);
        
        // Log action
        await query(
            'INSERT INTO audit_logs (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
            [req.user.id, 'STUDENT_PHOTO_UPDATED', JSON.stringify({ student_id: id }), req.ip]
        );
        
        return res.json(student);
    } catch (error) {
        console.error('Update student photo error:', error);
        return res.status(500).json({ error: 'Failed to update student photo' });
    }
};