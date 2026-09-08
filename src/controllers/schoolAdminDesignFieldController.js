const { query } = require('../config/database');

exports.getDesignFieldsForSchool = async (req, res) => {
  try {
    const { designId } = req.params;
    const side = String(req.query.side || 'FRONT').toUpperCase();
    const schoolId = req.schoolId || req.user?.school_id || req.user?.schoolId;

    if (!designId) return res.status(400).json({error:'designId is required'});
    if (!['FRONT','BACK'].includes(side)) return res.status(400).json({error:'Invalid side'});
    if (!schoolId) return res.status(403).json({error:'School context not found'});

    const assigned = await query(
      `SELECT 1 FROM school_designs WHERE school_id=? AND design_id=? LIMIT 1`,
      [schoolId, designId]
    );
    if (!assigned.rows?.length) return res.status(403).json({error:'Design is not assigned to this school'});

    const result = await query(
      `SELECT * FROM id_design_fields
       WHERE design_id=? AND side=?
       ORDER BY sort_order ASC, created_at ASC`,
      [designId, side]
    );

    return res.json({success:true, side, fields:result.rows || []});
  } catch (error) {
    console.error('Get school design fields error:', error);
    return res.status(500).json({error:'Failed to fetch design fields'});
  }
};
