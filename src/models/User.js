const { query } = require('../config/database');
const bcrypt = require('bcrypt');

class User {
    static async create({ email, password, role }) {
        const password_hash = await bcrypt.hash(password, 10);
        const result = await query(
            `INSERT INTO users (email, password_hash, role, status)
             VALUES (?, ?, ?, 'ACTIVE')`,
            [email, password_hash, role]
        );

        if (result.rows.insertId > 0) {
            return await this.findById(result.rows.insertId);
        }
        return null;
    }

    static async findByEmail(email) {
        const result = await query(
            'SELECT * FROM users WHERE email = ?',
            [email]
        );
        return result.rows[0] || null;
    }

    static async findById(id) {
        const result = await query(
            'SELECT id, email, role, status, last_login, created_at FROM users WHERE id = ?',
            [id]
        );
        return result.rows[0] || null;
    }

    static async findWithPassword(id) {
        const result = await query(
            'SELECT * FROM users WHERE id = ?',
            [id]
        );
        return result.rows[0] || null;
    }

    static async updateStatus(id, status) {
        const result = await query(
            'UPDATE users SET status = ? WHERE id = ?',
            [status, id]
        );
        if (result.rows.affectedRows > 0) {
            return await this.findById(id);
        }
        return null;
    }

    // Update a user's mutable fields. Password is re-hashed only when provided.
    // Returns the updated user (without the password hash).
    static async updateProfile(id, { email, role, password }) {
        const nextEmail = email == null ? null : String(email).trim().toLowerCase();

        if (password) {
            const password_hash = await bcrypt.hash(password, 10);
            if (nextEmail && role) {
                await query(
                    'UPDATE users SET email = ?, role = ?, password_hash = ? WHERE id = ?',
                    [nextEmail, role, password_hash, id]
                );
            } else if (nextEmail) {
                await query(
                    'UPDATE users SET email = ?, password_hash = ? WHERE id = ?',
                    [nextEmail, password_hash, id]
                );
            } else if (role) {
                await query(
                    'UPDATE users SET role = ?, password_hash = ? WHERE id = ?',
                    [role, password_hash, id]
                );
            } else {
                await query(
                    'UPDATE users SET password_hash = ? WHERE id = ?',
                    [password_hash, id]
                );
            }
        } else if (nextEmail && role) {
            await query(
                'UPDATE users SET email = ?, role = ? WHERE id = ?',
                [nextEmail, role, id]
            );
        } else if (nextEmail) {
            await query(
                'UPDATE users SET email = ? WHERE id = ?',
                [nextEmail, id]
            );
        } else if (role) {
            await query(
                'UPDATE users SET role = ? WHERE id = ?',
                [role, id]
            );
        }

        return await this.findById(id);
    }

    static async updatePassword(id, newPassword) {
        const password_hash = await bcrypt.hash(newPassword, 10);
        const result = await query(
            'UPDATE users SET password_hash = ? WHERE id = ?',
            [password_hash, id]
        );
        if (result.rows.affectedRows > 0) {
            return await this.findById(id);
        }
        return null;
    }

    static async updateLastLogin(id) {
        await query(
            'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?',
            [id]
        );
    }

    static async getSchoolUsers(schoolId) {
        const result = await query(
            `SELECT u.id, u.email, u.role, u.status, su.permissions, su.created_at as assigned_at
             FROM users u
             JOIN school_users su ON u.id = su.user_id
             WHERE su.school_id = ?`,
            [schoolId]
        );
        return result.rows;
    }

    static async assignToSchool(userId, schoolId, permissions = {}) {
        const result = await query(
            `INSERT INTO school_users (user_id, school_id, permissions)
             VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE permissions = ?`,
            [userId, schoolId, JSON.stringify(permissions), JSON.stringify(permissions)]
        );
        return result.rows;
    }

    static async removeFromSchool(userId, schoolId) {
        await query(
            'DELETE FROM school_users WHERE user_id = ? AND school_id = ?',
            [userId, schoolId]
        );
    }

    static async getUsersByRole(role) {
        const result = await query(
            'SELECT id, email, role, status, created_at FROM users WHERE role = ?',
            [role]
        );
        return result.rows;
    }

    static async comparePassword(plainPassword, hashedPassword) {
        return await bcrypt.compare(plainPassword, hashedPassword);
    }
}

module.exports = User;