const { query, getConnection } = require('../config/database');

// Build a short, readable, filename-safe school code from the school name
// (e.g. "LPS" -> "LPS", "demo school" -> "DEMO"), made unique with a numeric
// suffix so two schools never collide. Source is the school record itself,
// never anything supplied by a request body.
function buildSchoolCode(name) {
    const base = String(name || 'SCH')
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '')
        .slice(0, 4) || 'SCH';
    return base;
}

class School {
    // Produce a unique, filename-safe school_code from the school name,
    // appending an incrementing numeric suffix whenever the base code is
    // already taken (collision-free without needing a UUID).
    static async nextSchoolCode(name) {
        const base = buildSchoolCode(name);
        for (let i = 0; i < 100; i++) {
            const candidate = i === 0 ? base : `${base}${i}`;
            const result = await query(
                'SELECT school_code FROM schools WHERE school_code = ?',
                [candidate]
            );
            if (result.rows.length === 0) return candidate;
        }
        return `${base}${Date.now().toString(36).toUpperCase().slice(-4)}`;
    }

    static async create({ name, address, phone, email }) {
        const school_code = await this.nextSchoolCode(name);
        const result = await query(
            `INSERT INTO schools (school_code, name, address, phone, email, status, credit_balance)
             VALUES (?, ?, ?, ?, ?, 'ACTIVE', 0)`,
            [school_code, name, address, phone, email]
        );

        if (result.rows.insertId > 0) {
            return await this.findById(result.rows.insertId);
        }
        return null;
    }

    static async findById(id) {
        const result = await query(
            'SELECT * FROM schools WHERE id = ?',
            [id]
        );
        return result.rows[0] || null;
    }

    static async findAll({ limit = 50, offset = 0, search = '' }) {
        let queryText = 'SELECT * FROM schools';
        const params = [];
        
        if (search) {
            queryText += ' WHERE name LIKE ? OR email LIKE ?';
            params.push(`%${search}%`, `%${search}%`);
        }
        
        queryText += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
        params.push(parseInt(limit), parseInt(offset));
        
        const result = await query(queryText, params);
        return result.rows;
    }

    static async update(id, { name, address, phone, email }) {
        const result = await query(
            `UPDATE schools 
             SET name = COALESCE(?, name),
                 address = COALESCE(?, address),
                 phone = COALESCE(?, phone),
                 email = COALESCE(?, email)
             WHERE id = ?`,
            [name, address, phone, email, id]
        );
        
        if (result.rows.affectedRows > 0) {
            return await this.findById(id);
        }
        return null;
    }

    static async updateStatus(id, status) {
        const result = await query(
            'UPDATE schools SET status = ? WHERE id = ?',
            [status, id]
        );
        
        if (result.rows.affectedRows > 0) {
            return await this.findById(id);
        }
        return null;
    }

    static async getCredits(id) {
        const result = await query(
            'SELECT credit_balance FROM schools WHERE id = ?',
            [id]
        );
        return result.rows[0]?.credit_balance || 0;
    }

    static async updateCredits(id, amount, reason, userId) {
        const connection = await getConnection();
        try {
            await connection.beginTransaction();

            const [schoolResult] = await connection.execute(
                'SELECT credit_balance FROM schools WHERE id = ? FOR UPDATE',
                [id]
            );
            
            const currentBalance = schoolResult[0].credit_balance;
            const newBalance = currentBalance + amount;
            
            if (newBalance < 0) {
                throw new Error('Insufficient credits');
            }
            
            await connection.execute(
                'UPDATE schools SET credit_balance = ? WHERE id = ?',
                [newBalance, id]
            );
            
            await connection.execute(
                `INSERT INTO credit_transactions (school_id, amount, type, reason, created_by)
                 VALUES (?, ?, ?, ?, ?)`,
                [id, Math.abs(amount), amount > 0 ? 'CREDIT' : 'DEBIT', reason, userId]
            );
            
            await connection.commit();
            
            const [updated] = await connection.execute(
                'SELECT * FROM schools WHERE id = ?',
                [id]
            );
            
            return updated[0];
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }

    static async getStatistics(id) {
        try {
            const result = await query(
                `SELECT 
                    (SELECT COUNT(*) FROM students WHERE school_id = ? AND status = 'ACTIVE') as total_students,
                    (SELECT COUNT(*) FROM id_cards WHERE school_id = ?) as total_id_cards,
                    (SELECT credit_balance FROM schools WHERE id = ?) as available_credits,
                    (SELECT COUNT(*) FROM users u JOIN school_users su ON u.id = su.user_id WHERE su.school_id = ? AND u.status = 'ACTIVE') as total_staff`,
                [id, id, id, id]
            );
            return result.rows[0] || {
                total_students: 0,
                total_id_cards: 0,
                available_credits: 0,
                total_staff: 0
            };
        } catch (error) {
            console.error('School.getStatistics error:', error);
            return {
                total_students: 0,
                total_id_cards: 0,
                available_credits: 0,
                total_staff: 0
            };
        }
    }

    static async getCreditHistory(id, { limit = 50, offset = 0 }) {
        try {
            const result = await query(
                `SELECT ct.*, u.email as created_by_email
                 FROM credit_transactions ct
                 LEFT JOIN users u ON ct.created_by = u.id
                 WHERE ct.school_id = ?
                 ORDER BY ct.created_at DESC
                 LIMIT ? OFFSET ?`,
                [id, parseInt(limit), parseInt(offset)]
            );
            return result.rows || [];
        } catch (error) {
            console.error('School.getCreditHistory error:', error);
            return [];
        }
    }

    static async getAssignedDesigns(id) {
        const result = await query(
            `SELECT d.*, sd.is_active as assigned_active, sd.assigned_at
             FROM id_designs d
             JOIN school_designs sd ON d.id = sd.design_id
             WHERE sd.school_id = ? AND d.status = 'ACTIVE'
             ORDER BY sd.assigned_at DESC`,
            [id]
        );
        return result.rows;
    }

    static async assignDesign(schoolId, designId) {
        const result = await query(
            `INSERT INTO school_designs (school_id, design_id)
             VALUES (?, ?)
             ON DUPLICATE KEY UPDATE is_active = TRUE`,
            [schoolId, designId]
        );
        return result.rows;
    }

    static async removeDesign(schoolId, designId) {
        await query(
            'DELETE FROM school_designs WHERE school_id = ? AND design_id = ?',
            [schoolId, designId]
        );
    }
}

module.exports = School;