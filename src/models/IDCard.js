const { query, getConnection } = require('../config/database');

class IDCard {
    static async generate({ schoolId, studentId, designId, frontImageUrl, backImageUrl, cardNumber, userId, skipCredit = false, fieldData = null }) {
        const connection = await getConnection();
        try {
            await connection.beginTransaction();

            // Check if school has credits (skipped for the Owner demo flow,
            // which must never consume a credit from any school).
            const [schoolResult] = await connection.execute(
                'SELECT credit_balance FROM schools WHERE id = ? FOR UPDATE',
                [schoolId]
            );
            
            if (!schoolResult[0]) {
                throw new Error('School not found');
            }
            
            if (!skipCredit && schoolResult[0].credit_balance <= 0) {
                throw new Error('Insufficient credits to generate ID card');
            }
            
            // Insert ID card (id is INT AUTO_INCREMENT; use insertId afterwards)
            const [insertResult] = await connection.execute(
                `INSERT INTO id_cards (school_id, student_id, design_id, front_image_url, back_image_url, field_data, card_number, generated_by, status)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE')`,
                [schoolId, studentId, designId, frontImageUrl, backImageUrl,
                 fieldData ? JSON.stringify(fieldData) : null,
                 cardNumber, userId]
            );
            const finalCardId = insertResult.insertId;
            
            // Deduct credit (demo flow skips this entirely)
            if (!skipCredit) {
                const newBalance = schoolResult[0].credit_balance - 1;
                await connection.execute(
                    'UPDATE schools SET credit_balance = ? WHERE id = ?',
                    [newBalance, schoolId]
                );
                
                // Log transaction
                await connection.execute(
                    `INSERT INTO credit_transactions (school_id, amount, type, reason, created_by)
                     VALUES (?, 1, 'DEBIT', ?, ?)`,
                    [schoolId, `ID Card generated for student ${studentId}`, userId]
                );
            }
            
            await connection.commit();
            
            // Get the created card
            const [cardResult] = await connection.execute(
                `SELECT ic.*, s.name as student_name, d.name as design_name 
                 FROM id_cards ic 
                 JOIN students s ON ic.student_id = s.id 
                 LEFT JOIN id_designs d ON ic.design_id = d.id 
                 WHERE ic.id = ?`,
                [finalCardId]
            );
            
            return IDCard.parseRow(cardResult[0]);
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }

    static parseRow(row) {
        if (!row) return row;
        if (row.field_data != null && typeof row.field_data === 'string') {
            try { row.field_data = JSON.parse(row.field_data); } catch (_) { /* keep raw */ }
        }
        return row;
    }

    static async findById(id, schoolId = null) {
        // Join ALL student columns so the details/download response carries
        // every configured student field (name, father, phone, address,
        // class, section, admission number) — not just the name.
        let queryText = `SELECT ic.*, 
                        s.name as student_name, 
                        s.father_name, 
                        s.phone, 
                        s.address, 
                        s.class, 
                        s.section, 
                        s.admission_number,
                        d.name as design_name 
                        FROM id_cards ic 
                        JOIN students s ON ic.student_id = s.id 
                        LEFT JOIN id_designs d ON ic.design_id = d.id 
                        WHERE ic.id = ?`;
        const params = [id];
        
        if (schoolId) {
            queryText += ' AND ic.school_id = ?';
            params.push(schoolId);
        }
        
        const result = await query(queryText, params);
        return IDCard.parseRow(result.rows[0] || null);
    }

    static async findBySchool(schoolId, { limit = 50, offset = 0, studentId = null }) {
        // Include every student column the ID Cards page displays so field
        // values never fall back to "-" while data exists in the DB.
        let queryText = `SELECT ic.*, 
                        s.name as student_name, 
                        s.father_name, 
                        s.phone, 
                        s.address, 
                        s.class, 
                        s.section, 
                        s.admission_number, 
                        d.name as design_name 
                        FROM id_cards ic 
                        JOIN students s ON ic.student_id = s.id 
                        LEFT JOIN id_designs d ON ic.design_id = d.id 
                        WHERE ic.school_id = ?`;
        const params = [schoolId];
        
        if (studentId) {
            queryText += ' AND ic.student_id = ?';
            params.push(studentId);
        }
        
        queryText += ' ORDER BY ic.generated_at DESC LIMIT ? OFFSET ?';
        params.push(parseInt(limit), parseInt(offset));
        
        const result = await query(queryText, params);
        return result.rows.map(IDCard.parseRow);
    }

    static async updateDownloadStatus(id) {
        await query(
            'UPDATE id_cards SET downloaded_at = CURRENT_TIMESTAMP WHERE id = ?',
            [id]
        );
        return await this.findById(id);
    }

    static async getStats(schoolId) {
        const result = await query(
            `SELECT 
                COUNT(*) as total,
                COUNT(DISTINCT student_id) as unique_students,
                DATE(generated_at) as date
             FROM id_cards 
             WHERE school_id = ? 
             GROUP BY DATE(generated_at)
             ORDER BY date DESC
             LIMIT 30`,
            [schoolId]
        );
        return result.rows;
    }

    static async getGeneratedCount(schoolId) {
        const result = await query(
            'SELECT COUNT(*) as total FROM id_cards WHERE school_id = ?',
            [schoolId]
        );
        return parseInt(result.rows[0]?.total || 0);
    }

    static generateCardNumber(schoolId, studentId) {
        const timestamp = Date.now().toString(36).toUpperCase();
        const randomPart = Math.random().toString(36).slice(2, 6).toUpperCase();
        return `ID-${timestamp}-${randomPart}-${studentId}`;
    }
}

module.exports = IDCard;
