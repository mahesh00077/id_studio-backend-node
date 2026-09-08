const Design = require('../models/Design');
const DesignField = require('../models/DesignField');

const ALLOWED_SIDES = ['FRONT', 'BACK'];
const ALLOWED_TYPES = ['TEXT', 'PHOTO'];
const ALLOWED_ALIGNMENTS = ['left', 'center', 'right'];

async function ensureDesignExists(designId) {
    return Design.findById(designId);
}

function validateNumber(value, name, min = 0, max = 1) {
    if (value === undefined || value === null || value === '') return null;

    const number = Number(value);

    if (!Number.isFinite(number) || number < min || number > max) {
        return `${name} must be between ${min} and ${max}`;
    }

    return null;
}

function validateFieldPayload(field, requireKey = true) {
    const errors = [];

    if (requireKey && !field.field_key) {
        errors.push('field_key is required');
    }

    if (field.side && !ALLOWED_SIDES.includes(String(field.side).toUpperCase())) {
        errors.push('side must be FRONT or BACK');
    }

    if (field.field_type && !ALLOWED_TYPES.includes(String(field.field_type).toUpperCase())) {
        errors.push('field_type must be TEXT or PHOTO');
    }

    for (const [value, name] of [
        [field.x, 'x'],
        [field.y, 'y'],
        [field.width, 'width'],
        [field.height, 'height']
    ]) {
        const error = validateNumber(value, name);
        if (error) errors.push(error);
    }

    if (
        field.text_align &&
        !ALLOWED_ALIGNMENTS.includes(String(field.text_align).toLowerCase())
    ) {
        errors.push('text_align must be left, center, or right');
    }

    return errors;
}

exports.getDesignFields = async (req, res) => {
    try {
        const { designId } = req.params;
        const side = req.query.side
            ? String(req.query.side).toUpperCase()
            : null;

        if (side && !ALLOWED_SIDES.includes(side)) {
            return res.status(400).json({ error: 'side must be FRONT or BACK' });
        }

        const design = await ensureDesignExists(designId);

        if (!design) {
            return res.status(404).json({ error: 'Design not found' });
        }

        const fields = await DesignField.findByDesign(designId, side);

        return res.json({
            success: true,
            designId,
            side,
            fields
        });
    } catch (error) {
        console.error('Get design fields error:', error);
        return res.status(500).json({
            error: 'Failed to fetch design fields'
        });
    }
};

exports.createDesignField = async (req, res) => {
    try {
        const { designId } = req.params;
        const design = await ensureDesignExists(designId);

        if (!design) {
            return res.status(404).json({ error: 'Design not found' });
        }

        const payload = {
            ...req.body,
            design_id: designId,
            side: String(req.body.side || 'FRONT').toUpperCase(),
            field_type: String(req.body.field_type || 'TEXT').toUpperCase()
        };

        const errors = validateFieldPayload(payload);

        if (errors.length) {
            return res.status(400).json({ error: errors.join(', ') });
        }

        const field = await DesignField.create(payload);

        return res.status(201).json({
            success: true,
            field
        });
    } catch (error) {
        console.error('Create design field error:', error);

        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({
                error: 'This field already exists for this design side'
            });
        }

        return res.status(500).json({
            error: 'Failed to create design field'
        });
    }
};

exports.updateDesignField = async (req, res) => {
    try {
        const { designId, fieldId } = req.params;
        const design = await ensureDesignExists(designId);

        if (!design) {
            return res.status(404).json({ error: 'Design not found' });
        }

        const existing = await DesignField.findById(fieldId);

        if (!existing || existing.design_id !== designId) {
            return res.status(404).json({
                error: 'Design field not found'
            });
        }

        const errors = validateFieldPayload(req.body, false);

        if (errors.length) {
            return res.status(400).json({ error: errors.join(', ') });
        }

        const field = await DesignField.update(fieldId, req.body);

        return res.json({
            success: true,
            field
        });
    } catch (error) {
        console.error('Update design field error:', error);

        return res.status(500).json({
            error: 'Failed to update design field'
        });
    }
};

exports.deleteDesignField = async (req, res) => {
    try {
        const { designId, fieldId } = req.params;
        const design = await ensureDesignExists(designId);

        if (!design) {
            return res.status(404).json({ error: 'Design not found' });
        }

        const existing = await DesignField.findById(fieldId);

        if (!existing || existing.design_id !== designId) {
            return res.status(404).json({
                error: 'Design field not found'
            });
        }

        await DesignField.delete(fieldId);

        return res.json({
            success: true,
            message: 'Design field deleted successfully'
        });
    } catch (error) {
        console.error('Delete design field error:', error);

        return res.status(500).json({
            error: 'Failed to delete design field'
        });
    }
};

exports.saveDesignFields = async (req, res) => {
    try {
        const { designId } = req.params;
        const side = String(req.body.side || 'FRONT').toUpperCase();
        const fields = Array.isArray(req.body.fields) ? req.body.fields : [];

        const design = await ensureDesignExists(designId);

        if (!design) {
            return res.status(404).json({ error: 'Design not found' });
        }

        if (!ALLOWED_SIDES.includes(side)) {
            return res.status(400).json({
                error: 'side must be FRONT or BACK'
            });
        }

        if (!fields.length) {
            return res.status(400).json({
                error: 'fields must contain at least one field'
            });
        }

        for (const field of fields) {
            const payload = {
                ...field,
                design_id: designId,
                side,
                field_type: String(field.field_type || 'TEXT').toUpperCase()
            };

            const errors = validateFieldPayload(payload);

            if (errors.length) {
                return res.status(400).json({
                    error: `Invalid field "${field.field_key || 'unknown'}": ${errors.join(', ')}`
                });
            }
        }

        const savedFields = [];

        for (const field of fields) {
            const payload = {
                ...field,
                design_id: designId,
                side,
                field_type: String(field.field_type || 'TEXT').toUpperCase()
            };
            // Explicit existence check by the natural key (design + side +
            // field_key): if a record already exists we UPDATE it (reusing its
            // id), otherwise we INSERT a new one. This avoids relying on any
            // DB unique constraint for the upsert.
            const existing = await DesignField.findByDesignKey(
                designId,
                side,
                field.field_key
            );

            let saved;
            if (existing) {
                saved = await DesignField.update(existing.id, payload);
            } else {
                saved = await DesignField.create(payload);
            }

            savedFields.push(saved);
        }

        return res.json({
            success: true,
            message: 'Design fields saved successfully',
            designId,
            side,
            fields: savedFields
        });
    } catch (error) {
        console.error('Save design fields error:', error);

        return res.status(500).json({
            error: 'Failed to save design fields'
        });
    }
};

exports.deleteDesignFieldsForSide = async (req, res) => {
    try {
        const { designId } = req.params;
        const side = String(
            req.body.side || req.query.side || 'FRONT'
        ).toUpperCase();

        const design = await ensureDesignExists(designId);

        if (!design) {
            return res.status(404).json({ error: 'Design not found' });
        }

        if (!ALLOWED_SIDES.includes(side)) {
            return res.status(400).json({
                error: 'side must be FRONT or BACK'
            });
        }

        const deletedCount =
            await DesignField.deleteByDesignAndSide(designId, side);

        return res.json({
            success: true,
            message: `All ${side} design fields deleted`,
            deleted_count: deletedCount
        });
    } catch (error) {
        console.error('Delete design fields error:', error);

        return res.status(500).json({
            error: 'Failed to delete design fields'
        });
    }
};
