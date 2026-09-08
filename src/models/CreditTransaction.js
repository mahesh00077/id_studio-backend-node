const { query } = require('../config/database');

class CreditTransaction {
    static async create({ schoolId, amount, type, reason, userId }) {
        const result = await query(
            `INSERT INTO credit_transactions (school_id, amount, type, reason, created_by)
             VALUES (?, ?, ?, ?, ?)`,
            [schoolId, amount, type, reason, userId]
        );
        return result.rows;
    }

    static async findBySchool(schoolId, { limit = 50, offset = 0 }) {
        const result = await query(
            `SELECT ct.*, u.email as created_by_email
             FROM credit_transactions ct
             LEFT JOIN users u ON ct.created_by = u.id
             WHERE ct.school_id = ?
             ORDER BY ct.created_at DESC
             LIMIT ? OFFSET ?`,
            [schoolId, parseInt(limit), parseInt(offset)]
        );
        return result.rows;
    }

    static async findAll({ limit = 100, offset = 0, schoolId = null }) {
        let queryText = `SELECT ct.*, s.name as school_name, u.email as created_by_email
                        FROM credit_transactions ct
                        JOIN schools s ON ct.school_id = s.id
                        LEFT JOIN users u ON ct.created_by = u.id
                        WHERE 1=1`;
        const params = [];
        
        if (schoolId) {
            queryText += ' AND ct.school_id = ?';
            params.push(schoolId);
        }
        
        queryText += ' ORDER BY ct.created_at DESC LIMIT ? OFFSET ?';
        params.push(parseInt(limit), parseInt(offset));
        
        const result = await query(queryText, params);
        return result.rows;
    }

    static async getTotalCredits(schoolId) {
        const result = await query(
            "SELECT SUM(CASE WHEN type = 'CREDIT' THEN amount ELSE -amount END) as total FROM credit_transactions WHERE school_id = ?",
            [schoolId]
        );
        return parseInt(result.rows[0]?.total || 0);
    }
}

module.exports = CreditTransaction;