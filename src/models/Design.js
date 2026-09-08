const { query, transaction } = require('../config/database');

class Design {
    static async create({ name, frontTemplate, backTemplate, isGlobal = false, userId }) {
        try {
            const result = await query(
                `INSERT INTO id_designs (name, front_template, back_template, is_global, status, created_by)
                 VALUES (?, ?, ?, ?, 'ACTIVE', ?)`,
                [name, frontTemplate, backTemplate || null, isGlobal ? 1 : 0, userId]
            );
            
            if (result.rows.insertId > 0) {
                return await this.findById(result.rows.insertId);
            }
            return null;
        } catch (error) {
            console.error('Design.create error:', error);
            throw error;
        }
    }

    static async findById(id) {
        try {
            const result = await query(
                `SELECT d.*, u.email as created_by_email
                 FROM id_designs d
                 LEFT JOIN users u ON d.created_by = u.id
                 WHERE d.id = ?`,
                [id]
            );
            return result.rows[0] || null;
        } catch (error) {
            console.error('Design.findById error:', error);
            throw error;
        }
    }

    static async findAll({ limit = 50, offset = 0, isGlobal = null, status = 'ACTIVE' }) {
        try {
            let queryText = `SELECT d.*, u.email as created_by_email
                            FROM id_designs d
                            LEFT JOIN users u ON d.created_by = u.id
                            WHERE 1=1`;
            const params = [];
            
            if (status) {
                queryText += ' AND d.status = ?';
                params.push(status);
            }
            
            if (isGlobal !== null) {
                queryText += ' AND d.is_global = ?';
                params.push(isGlobal ? 1 : 0);
            }
            
            queryText += ' ORDER BY d.created_at DESC LIMIT ? OFFSET ?';
            params.push(parseInt(limit), parseInt(offset));
            
            const result = await query(queryText, params);
            
            // Get assigned schools for each design
            for (let design of result.rows) {
                const schools = await this.getAssignedSchools(design.id);
                design.assigned_schools = schools;
                design.assigned_count = schools.length;
            }
            
            return result.rows;
        } catch (error) {
            console.error('Design.findAll error:', error);
            throw error;
        }
    }

    // Check if design is used by any school
    static async isDesignUsed(designId) {
        try {
            const result = await query(
                'SELECT COUNT(*) as count FROM school_designs WHERE design_id = ?',
                [designId]
            );
            return (result.rows[0]?.count || 0) > 0;
        } catch (error) {
            console.error('Design.isDesignUsed error:', error);
            throw error;
        }
    }

    // Get schools using this design
    static async getUsingSchools(designId) {
        try {
            const result = await query(
                `SELECT s.id, s.name, s.phone, s.email, sd.assigned_at
                 FROM schools s
                 JOIN school_designs sd ON s.id = sd.school_id
                 WHERE sd.design_id = ?`,
                [designId]
            );
            return result.rows;
        } catch (error) {
            console.error('Design.getUsingSchools error:', error);
            throw error;
        }
    }

   

    static async update(id, { name, frontTemplate, backTemplate }) {
        try {
            const result = await query(
                `UPDATE id_designs 
                 SET name = COALESCE(?, name),
                     front_template = COALESCE(?, front_template),
                     back_template = COALESCE(?, back_template)
                 WHERE id = ?`,
                [name, frontTemplate, backTemplate, id]
            );
            
            if (result.rows.affectedRows > 0) {
                return await this.findById(id);
            }
            return null;
        } catch (error) {
            console.error('Design.update error:', error);
            throw error;
        }
    }

    static async updateStatus(id, status) {
        try {
            const result = await query(
                'UPDATE id_designs SET status = ? WHERE id = ?',
                [status, id]
            );
            
            if (result.rows.affectedRows > 0) {
                return await this.findById(id);
            }
            return null;
        } catch (error) {
            console.error('Design.updateStatus error:', error);
            throw error;
        }
    }

    // Soft delete
    static async softDelete(id) {
        try {
            const result = await query(
                'UPDATE id_designs SET status = ? WHERE id = ?',
                ['INACTIVE', id]
            );
            
            if (result.rows.affectedRows > 0) {
                return await this.findById(id);
            }
            return null;
        } catch (error) {
            console.error('Design.softDelete error:', error);
            throw error;
        }
    }

    // Hard delete - only if not used
    static async hardDelete(id) {
        try {
            // Block deletion while the design is still assigned to any school
            // (this surfaces a friendly message to the user instead of a raw FK error).
            const used = await this.isDesignUsed(id);
            if (used) {
                throw new Error('Cannot delete design: It is currently assigned to one or more schools');
            }

            // Delete the design AND every child row that references it, inside a
            // single transaction. Without this the FK constraints on
            // id_design_fields (fk_design_fields_design) and id_cards
            // (fk_id_cards_design) make the DELETE fail once a design has saved
            // fields or generated/demo cards.
            const deletedCount = await transaction(async (conn) => {
                await conn.execute('DELETE FROM id_design_fields WHERE design_id = ?', [id]);
                await conn.execute('DELETE FROM id_cards WHERE design_id = ?', [id]);
                const [result] = await conn.execute('DELETE FROM id_designs WHERE id = ?', [id]);
                return result.affectedRows;
            });

            return deletedCount > 0;
        } catch (error) {
            console.error('Design.hardDelete error:', error);
            throw error;
        }
    }

    // Assign design to multiple schools
    static async assignToSchools(designId, schoolIds) {
        try {
            const results = [];
            for (const schoolId of schoolIds) {
                const result = await query(
                    `INSERT INTO school_designs (school_id, design_id, is_active)
                     VALUES (?, ?, 1)
                     ON DUPLICATE KEY UPDATE is_active = 1`,
                    [schoolId, designId]
                );
                results.push(result);
            }
            return results;
        } catch (error) {
            console.error('Design.assignToSchools error:', error);
            throw error;
        }
    }

    // Assign design to single school
    static async assignToSchool(designId, schoolId) {
        try {
            const result = await query(
                `INSERT INTO school_designs (school_id, design_id, is_active)
                 VALUES (?, ?, 1)
                 ON DUPLICATE KEY UPDATE is_active = 1`,
                [schoolId, designId]
            );
            return result.rows;
        } catch (error) {
            console.error('Design.assignToSchool error:', error);
            throw error;
        }
    }

    static async removeFromSchool(designId, schoolId) {
        try {
            await query(
                'DELETE FROM school_designs WHERE school_id = ? AND design_id = ?',
                [schoolId, designId]
            );
        } catch (error) {
            console.error('Design.removeFromSchool error:', error);
            throw error;
        }
    }

    static async getAssignedSchools(designId) {
        try {
            const result = await query(
                `SELECT s.*, sd.is_active, sd.assigned_at
                 FROM schools s
                 JOIN school_designs sd ON s.id = sd.school_id
                 WHERE sd.design_id = ?`,
                [designId]
            );
            return result.rows;
        } catch (error) {
            console.error('Design.getAssignedSchools error:', error);
            throw error;
        }
    }

    static async getSchoolDesigns(schoolId) {
        try {
            const result = await query(
                `SELECT d.*, sd.is_active as assigned_active, sd.assigned_at
                 FROM id_designs d
                 JOIN school_designs sd ON d.id = sd.design_id
                 WHERE sd.school_id = ? AND d.status = 'ACTIVE'
                 ORDER BY sd.assigned_at DESC`,
                [schoolId]
            );
            return result.rows;
        } catch (error) {
            console.error('Design.getSchoolDesigns error:', error);
            throw error;
        }
    }

    static async findAvailableForSchool(schoolId) {
        try {
            const result = await query(
                `SELECT d.*, sd.is_active as assigned_active
                 FROM id_designs d
                 LEFT JOIN school_designs sd ON d.id = sd.design_id AND sd.school_id = ?
                 WHERE d.status = 'ACTIVE' 
                 AND (d.is_global = 1 OR sd.id IS NOT NULL)
                 ORDER BY d.is_global DESC, d.created_at DESC`,
                [schoolId]
            );
            return result.rows || [];
        } catch (error) {
            console.error('Design.findAvailableForSchool error:', error);
            return [];
        }
    }

}

module.exports = Design;