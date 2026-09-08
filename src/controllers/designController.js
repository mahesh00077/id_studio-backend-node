const Design = require('../models/Design');
const School = require('../models/School');
const { query } = require('../config/database');

exports.createDesign = async (req, res) => {
    try {
        const { name, frontTemplate, backTemplate, isGlobal = false } = req.body;
        
        if (!name || !frontTemplate) {
            return res.status(400).json({ error: 'Name and front template are required' });
        }
        
        const design = await Design.create({
            name,
            frontTemplate,
            backTemplate,
            isGlobal,
            userId: req.user.id
        });
        
        // Log action
        await query(
            'INSERT INTO audit_logs (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
            [req.user.id, 'DESIGN_CREATED', JSON.stringify({ design_id: design.id, name }), req.ip]
        );
        
        return res.status(201).json(design);
    } catch (error) {
        console.error('Create design error:', error);
        return res.status(500).json({ error: 'Failed to create design' });
    }
};

exports.getDesigns = async (req, res) => {
    try {
        const { limit = 50, offset = 0, isGlobal = null } = req.query;
        const designs = await Design.findAll({ limit, offset, isGlobal });
        return res.json(designs);
    } catch (error) {
        console.error('Get designs error:', error);
        return res.status(500).json({ error: 'Failed to fetch designs' });
    }
};

exports.getDesignDetails = async (req, res) => {
    try {
        const { id } = req.params;
        const design = await Design.findById(id);
        
        if (!design) {
            return res.status(404).json({ error: 'Design not found' });
        }
        
        return res.json(design);
    } catch (error) {
        console.error('Get design details error:', error);
        return res.status(500).json({ error: 'Failed to fetch design details' });
    }
};

exports.updateDesign = async (req, res) => {
    try {
        const { id } = req.params;
        const { name, frontTemplate, backTemplate } = req.body;
        
        const design = await Design.update(id, { name, frontTemplate, backTemplate });
        
        if (!design) {
            return res.status(404).json({ error: 'Design not found' });
        }
        
        // Log action
        await query(
            'INSERT INTO audit_logs (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
            [req.user.id, 'DESIGN_UPDATED', JSON.stringify({ design_id: id }), req.ip]
        );
        
        return res.json(design);
    } catch (error) {
        console.error('Update design error:', error);
        return res.status(500).json({ error: 'Failed to update design' });
    }
};

exports.updateDesignStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;
        
        if (!['ACTIVE', 'INACTIVE'].includes(status)) {
            return res.status(400).json({ error: 'Invalid status' });
        }
        
        const design = await Design.updateStatus(id, status);
        
        if (!design) {
            return res.status(404).json({ error: 'Design not found' });
        }
        
        // Log action
        await query(
            'INSERT INTO audit_logs (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
            [req.user.id, 'DESIGN_STATUS_CHANGED', JSON.stringify({ design_id: id, status }), req.ip]
        );
        
        return res.json(design);
    } catch (error) {
        console.error('Update design status error:', error);
        return res.status(500).json({ error: 'Failed to update design status' });
    }
};

exports.assignDesignToSchool = async (req, res) => {
    try {
        const { schoolId, designId } = req.params;
        
        // Verify school exists
        const school = await School.findById(schoolId);
        if (!school) {
            return res.status(404).json({ error: 'School not found' });
        }
        
        // Verify design exists
        const design = await Design.findById(designId);
        if (!design) {
            return res.status(404).json({ error: 'Design not found' });
        }
        
        const result = await Design.assignToSchool(designId, schoolId);
        
        // Log action
        await query(
            'INSERT INTO audit_logs (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
            [req.user.id, 'DESIGN_ASSIGNED_TO_SCHOOL', JSON.stringify({ school_id: schoolId, design_id: designId }), req.ip]
        );
        
        return res.json({ success: true, message: 'Design assigned to school successfully' });
    } catch (error) {
        console.error('Assign design error:', error);
        return res.status(500).json({ error: 'Failed to assign design to school' });
    }
};

exports.removeDesignFromSchool = async (req, res) => {
    try {
        const { schoolId, designId } = req.params;
        
        await Design.removeFromSchool(designId, schoolId);
        
        // Log action
        await query(
            'INSERT INTO audit_logs (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
            [req.user.id, 'DESIGN_REMOVED_FROM_SCHOOL', JSON.stringify({ school_id: schoolId, design_id: designId }), req.ip]
        );
        
        return res.json({ success: true, message: 'Design removed from school successfully' });
    } catch (error) {
        console.error('Remove design error:', error);
        return res.status(500).json({ error: 'Failed to remove design from school' });
    }
};

exports.getSchoolDesigns = async (req, res) => {
    try {
        const { schoolId } = req.params;
        const designs = await School.getAssignedDesigns(schoolId);
        return res.json(designs);
    } catch (error) {
        console.error('Get school designs error:', error);
        return res.status(500).json({ error: 'Failed to fetch school designs' });
    }
};

exports.getAvailableDesigns = async (req, res) => {
    try {
        const schoolId = req.schoolId || req.params.schoolId;
        const designs = await Design.findAvailableForSchool(schoolId);
        return res.json(designs);
    } catch (error) {
        console.error('Get available designs error:', error);
        return res.status(500).json({ error: 'Failed to fetch available designs' });
    }
};