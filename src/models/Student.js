const { query } = require('../config/database');

class Student {
    static async create({ schoolId, name, fatherName, phone, address, class: className, section, admissionNumber, photoUrl }) {
        // Normalize blank admission numbers to NULL. `admission_number` is a
        // UNIQUE column, and MySQL would otherwise reject a second '' value
        // with a duplicate-key error when generating for multiple students
        // without admission numbers.
        const normalizedAdmission = admissionNumber && String(admissionNumber).trim() ? admissionNumber : null;
        const result = await query(
            `INSERT INTO students (school_id, name, father_name, phone, address, class, section, admission_number, photo_url, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE')`,
            [schoolId, name, fatherName, phone, address, className, section, normalizedAdmission, photoUrl]
        );

        if (result.rows.insertId > 0) {
            return await this.findById(result.rows.insertId);
        }
        return null;
    }

    static async findById(id, schoolId = null) {
        let queryText = 'SELECT * FROM students WHERE id = ?';
        const params = [id];
        
        if (schoolId) {
            queryText += ' AND school_id = ?';
            params.push(schoolId);
        }
        
        const result = await query(queryText, params);
        return result.rows[0] || null;
    }

    static async findByAdmissionNumber(admissionNumber, schoolId = null) {
        let queryText = 'SELECT * FROM students WHERE admission_number = ?';
        const params = [admissionNumber];

        if (schoolId) {
            queryText += ' AND school_id = ?';
            params.push(schoolId);
        }

        const result = await query(queryText, params);
        return result.rows[0] || null;
    }

    // Find the most recently updated student that matches the given identity
    // (name, and class/section when provided). Used by the ID-card generator to
    // UPDATE an existing student instead of always inserting a new record.
    static async findByName(name, className = null, section = null, schoolId = null) {
        let queryText = 'SELECT * FROM students WHERE name = ?';
        const params = [name];

        if (className) {
            queryText += ' AND class = ?';
            params.push(String(className));
        }
        if (section) {
            queryText += ' AND section = ?';
            params.push(String(section));
        }
        if (schoolId) {
            queryText += ' AND school_id = ?';
            params.push(schoolId);
        }

        queryText += ' ORDER BY updated_at DESC, created_at DESC LIMIT 1';

        const result = await query(queryText, params);
        return result.rows[0] || null;
    }

    static async findBySchool(schoolId, { limit = 100, offset = 0, search = '', status = 'ACTIVE' }) {
        let queryText = 'SELECT * FROM students WHERE school_id = ?';
        const params = [schoolId];
        
        if (status) {
            queryText += ' AND status = ?';
            params.push(status);
        }
        
        if (search) {
            queryText += ' AND (name LIKE ? OR admission_number LIKE ? OR phone LIKE ?)';
            params.push(`%${search}%`, `%${search}%`, `%${search}%`);
        }
        
        queryText += ' ORDER BY name ASC LIMIT ? OFFSET ?';
        params.push(parseInt(limit), parseInt(offset));
        
        const result = await query(queryText, params);
        return result.rows;
    }

    static async update(id, { name, fatherName, phone, address, class: className, section, admissionNumber, photoUrl }) {
        // Normalize a blank admission number to NULL before the UPDATE. The
        // column is UNIQUE and COALESCE would happily write '' (which collides
        // with any other student that has an empty admission number).
        admissionNumber = admissionNumber && String(admissionNumber).trim() ? admissionNumber : null;
        const result = await query(
            `UPDATE students 
             SET name = COALESCE(?, name),
                 father_name = COALESCE(?, father_name),
                 phone = COALESCE(?, phone),
                 address = COALESCE(?, address),
                 class = COALESCE(?, class),
                 section = COALESCE(?, section),
                 admission_number = COALESCE(?, admission_number),
                 photo_url = COALESCE(?, photo_url)
             WHERE id = ?`,
            [name, fatherName, phone, address, className, section, admissionNumber, photoUrl, id]
        );
        
        if (result.rows.affectedRows > 0) {
            return await this.findById(id);
        }
        return null;
    }

    static async updateStatus(id, status) {
        const result = await query(
            'UPDATE students SET status = ? WHERE id = ?',
            [status, id]
        );
        
        if (result.rows.affectedRows > 0) {
            return await this.findById(id);
        }
        return null;
    }

    static async updatePhoto(id, photoUrl) {
        const result = await query(
            'UPDATE students SET photo_url = ? WHERE id = ?',
            [photoUrl, id]
        );
        
        if (result.rows.affectedRows > 0) {
            return await this.findById(id);
        }
        return null;
    }

    static async getCount(schoolId) {
        const result = await query(
            'SELECT COUNT(*) as total FROM students WHERE school_id = ? AND status = ?',
            [schoolId, 'ACTIVE']
        );
        return parseInt(result.rows[0]?.total || 0);
    }

    static async getIDCards(id, schoolId = null) {
        let queryText = `SELECT ic.*, d.name as design_name 
                        FROM id_cards ic 
                        JOIN students s ON ic.student_id = s.id 
                        LEFT JOIN id_designs d ON ic.design_id = d.id 
                        WHERE ic.student_id = ?`;
        const params = [id];
        
        if (schoolId) {
            queryText += ' AND ic.school_id = ?';
            params.push(schoolId);
        }
        
        queryText += ' ORDER BY ic.generated_at DESC';
        
        const result = await query(queryText, params);
        return result.rows;
    }
}

module.exports = Student;