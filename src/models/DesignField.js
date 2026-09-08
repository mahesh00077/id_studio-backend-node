const { query } = require('../config/database');

class DesignField {
    static normalizeField(row) {
        if (!row) return null;

        return {
            ...row,
            x: Number(row.x),
            y: Number(row.y),
            width: Number(row.width),
            height: Number(row.height),
            font_size: row.font_size !== null ? Number(row.font_size) : null,
            line_height: row.line_height !== null ? Number(row.line_height) : null,
            max_lines: row.max_lines !== null ? Number(row.max_lines) : null,
            is_required: Boolean(row.is_required),
            sort_order: Number(row.sort_order || 0)
        };
    }

    static async findById(id) {
        const result = await query(
            `SELECT * FROM id_design_fields WHERE id = ?`,
            [id]
        );
        return this.normalizeField(result.rows[0] || null);
    }

    // Look up an existing design field record by its design/side/field_key
    // combination (the natural business key). Returns null when it does not
    // exist. Used by the save flow to decide UPDATE vs INSERT.
    static async findByDesignKey(designId, side, fieldKey) {
        const result = await query(
            `SELECT * FROM id_design_fields
             WHERE design_id = ? AND side = ? AND field_key = ?`,
            [designId, side, fieldKey]
        );
        return this.normalizeField(result.rows[0] || null);
    }

    static async findByDesign(designId, side = null) {
        let sql = `
            SELECT *
            FROM id_design_fields
            WHERE design_id = ?
        `;
        const params = [designId];

        if (side) {
            sql += ` AND side = ?`;
            params.push(side);
        }

        sql += ` ORDER BY side ASC, sort_order ASC, created_at ASC`;

        const result = await query(sql, params);
        return result.rows.map(row => this.normalizeField(row));
    }

    static async create(data) {
        const result = await query(
            `INSERT INTO id_design_fields (
                design_id, side, field_key, field_type,
                x, y, width, height,
                font_family, font_size, font_weight, font_style,
                text_align, color, line_height, max_lines, fit_mode,
                is_required, source, sort_order
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                data.design_id, data.side || 'FRONT',
                data.field_key, data.field_type || 'TEXT',
                data.x ?? 0, data.y ?? 0, data.width ?? 0, data.height ?? 0,
                data.font_family || 'Arial', data.font_size ?? 24,
                data.font_weight || 'normal', data.font_style || 'normal',
                data.text_align || 'left', data.color || '#000000',
                data.line_height ?? 1.2, data.max_lines ?? 1,
                data.fit_mode || 'cover',
                data.is_required ? 1 : 0,
                data.source || 'MANUAL', data.sort_order ?? 0
            ]
        );

        return this.findById(result.rows.insertId);
    }

    static async upsert(data) {
        await query(
            `INSERT INTO id_design_fields (
                design_id, side, field_key, field_type,
                x, y, width, height,
                font_family, font_size, font_weight, font_style,
                text_align, color, line_height, max_lines, fit_mode,
                is_required, source, sort_order
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
                field_type = VALUES(field_type),
                x = VALUES(x), y = VALUES(y),
                width = VALUES(width), height = VALUES(height),
                font_family = VALUES(font_family),
                font_size = VALUES(font_size),
                font_weight = VALUES(font_weight),
                font_style = VALUES(font_style),
                text_align = VALUES(text_align),
                color = VALUES(color),
                line_height = VALUES(line_height),
                max_lines = VALUES(max_lines),
                fit_mode = VALUES(fit_mode),
                is_required = VALUES(is_required),
                source = VALUES(source),
                sort_order = VALUES(sort_order)`,
            [
                data.design_id, data.side || 'FRONT',
                data.field_key, data.field_type || 'TEXT',
                data.x ?? 0, data.y ?? 0, data.width ?? 0, data.height ?? 0,
                data.font_family || 'Arial', data.font_size ?? 24,
                data.font_weight || 'normal', data.font_style || 'normal',
                data.text_align || 'left', data.color || '#000000',
                data.line_height ?? 1.2, data.max_lines ?? 1,
                data.fit_mode || 'cover',
                data.is_required ? 1 : 0,
                data.source || 'MANUAL', data.sort_order ?? 0
            ]
        );

        const result = await query(
            `SELECT *
             FROM id_design_fields
             WHERE design_id = ? AND side = ? AND field_key = ?`,
            [data.design_id, data.side || 'FRONT', data.field_key]
        );

        return this.normalizeField(result.rows[0] || null);
    }

    static async update(id, data) {
        await query(
            `UPDATE id_design_fields SET
                field_type = COALESCE(?, field_type),
                x = COALESCE(?, x),
                y = COALESCE(?, y),
                width = COALESCE(?, width),
                height = COALESCE(?, height),
                font_family = COALESCE(?, font_family),
                font_size = COALESCE(?, font_size),
                font_weight = COALESCE(?, font_weight),
                font_style = COALESCE(?, font_style),
                text_align = COALESCE(?, text_align),
                color = COALESCE(?, color),
                line_height = COALESCE(?, line_height),
                max_lines = COALESCE(?, max_lines),
                fit_mode = COALESCE(?, fit_mode),
                is_required = COALESCE(?, is_required),
                source = COALESCE(?, source),
                sort_order = COALESCE(?, sort_order)
             WHERE id = ?`,
            [
                data.field_type ?? null, data.x ?? null, data.y ?? null,
                data.width ?? null, data.height ?? null,
                data.font_family ?? null, data.font_size ?? null,
                data.font_weight ?? null, data.font_style ?? null,
                data.text_align ?? null, data.color ?? null,
                data.line_height ?? null, data.max_lines ?? null,
                data.fit_mode ?? null,
                data.is_required === undefined ? null : (data.is_required ? 1 : 0),
                data.source ?? null, data.sort_order ?? null, id
            ]
        );

        return this.findById(id);
    }

    static async delete(id) {
        const result = await query(
            `DELETE FROM id_design_fields WHERE id = ?`,
            [id]
        );
        return result.rows.affectedRows > 0;
    }

    static async deleteByDesignAndSide(designId, side) {
        const result = await query(
            `DELETE FROM id_design_fields WHERE design_id = ? AND side = ?`,
            [designId, side]
        );
        return result.rows.affectedRows;
    }
}

module.exports = DesignField;
