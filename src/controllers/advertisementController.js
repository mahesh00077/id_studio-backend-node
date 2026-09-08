const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { query } = require('../config/database');

// Root folder that server.js serves statically at /uploads.
const UPLOADS_ROOT = path.join(__dirname, '..', '..', 'uploads');
const ADS_DIR = path.join(UPLOADS_ROOT, 'ads');

const AUDIENCES = ['SCHOOL_ADMIN', 'SCHOOL_STAFF', 'BOTH'];
const POSITIONS = ['DASHBOARD', 'SIDEBAR', 'ID_CARD_GENERATOR'];

// Plain text, HTML stripped (XSS prevention). The UI also renders as text.
function cleanText(value, maxLen) {
  if (value == null) return '';
  return String(value).replace(/<[^>]*>/g, '').slice(0, maxLen).trim();
}

// Only http/https URLs are allowed - blocks javascript:, data:, vbscript:,
// and any other unsafe scheme.
function sanitizeUrl(value) {
  if (!value) return null;
  const s = String(value).trim();
  if (!/^https?:\/\//i.test(s)) return null;
  return s.slice(0, 500);
}

function toPublicUrl(reference) {
  if (!reference) return null;
  let clean = String(reference).replace(/\\/g, '/');
  if (!clean.startsWith('/')) clean = '/' + clean;
  if (!clean.startsWith('/uploads/')) return null;
  return clean;
}

function removeAdFile(reference) {
  if (!reference) return;
  const safe = path.basename(String(reference).replace(/\\/g, '/'));
  const abs = path.join(ADS_DIR, safe);
  try {
    if (fs.existsSync(abs)) fs.unlinkSync(abs);
  } catch (e) {
    console.warn('advertisementController: failed to remove file', abs, e.message);
  }
}

// Convert a row's datetime string to an ISO string that the frontend can use.
function fmtDate(v) {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

// Serialize a row for the API, stripping absolute filesystem info.
function serializeAd(row) {
  if (!row) return row;
  return {
    ...row,
    image_url: toPublicUrl(row.image_path),
    start_at: fmtDate(row.start_at),
    end_at: fmtDate(row.end_at)
  };
}

// Parse + validate enum values, falling back to defaults on invalid input.
function pickAudience(v) { return AUDIENCES.includes(v) ? v : 'BOTH'; }
function pickPosition(v) { return POSITIONS.includes(v) ? v : 'DASHBOARD'; }

// Owner management: list all (optionally filtered), including inactive/expired.
exports.listAdvertisements = async (req, res) => {
  try {
    const r = await query(
      `SELECT * FROM advertisements ORDER BY is_active DESC, priority DESC, created_at DESC`
    );
    return res.json({ advertisements: r.rows.map(serializeAd) });
  } catch (error) {
    console.error('List advertisements error:', error);
    return res.status(500).json({ error: 'Failed to list advertisements' });
  }
};

exports.createAdvertisement = async (req, res) => {
  try {
    const b = req.body || {};
    const title = cleanText(b.title, 255);
    if (!title) return res.status(400).json({ error: 'Title is required' });

    let image_path = null;
    if (req.file) image_path = '/uploads/ads/' + req.file.filename;

    const r = await query(
      `INSERT INTO advertisements
       (title, description, image_path, link_url, target_audience, position,
        start_at, end_at, priority, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        title,
        cleanText(b.description, 4000) || null,
        image_path,
        sanitizeUrl(b.link_url),
        pickAudience(b.target_audience),
        pickPosition(b.position),
        b.start_at || null,
        b.end_at || null,
        b.priority == null ? 0 : Number(b.priority) || 0,
        b.is_active == null ? 1 : (b.is_active ? 1 : 0)
      ]
    );
    const id = r.rows.insertId;
    const row = (await query('SELECT * FROM advertisements WHERE id = ?', [id])).rows[0];
    return res.status(201).json({ advertisement: serializeAd(row) });
  } catch (error) {
    console.error('Create advertisement error:', error);
    return res.status(500).json({ error: 'Failed to create advertisement' });
  }
};
exports.updateAdvertisement = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid id' });

    const existing = (await query('SELECT * FROM advertisements WHERE id = ?', [id])).rows[0];
    if (!existing) return res.status(404).json({ error: 'Advertisement not found' });

    const b = req.body || {};
    const title = cleanText(b.title, 255);
    if (!title) return res.status(400).json({ error: 'Title is required' });

    // If a new banner image was uploaded, replace and clean up the old one.
    let image_path = existing.image_path;
    if (req.file) {
      image_path = '/uploads/ads/' + req.file.filename;
      if (existing.image_path && existing.image_path !== image_path) {
        removeAdFile(existing.image_path);
      }
    } else if (b.remove_image) {
      if (existing.image_path) removeAdFile(existing.image_path);
      image_path = null;
    }

    await query(
      `UPDATE advertisements
       SET title = ?, description = ?, image_path = ?, link_url = ?,
           target_audience = ?, position = ?, start_at = ?, end_at = ?,
           priority = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
        title,
        b.description === undefined ? existing.description : (cleanText(b.description, 4000) || null),
        image_path,
        b.link_url === undefined ? existing.link_url : sanitizeUrl(b.link_url),
        b.target_audience ? pickAudience(b.target_audience) : existing.target_audience,
        b.position ? pickPosition(b.position) : existing.position,
        b.start_at === undefined ? existing.start_at : (b.start_at || null),
        b.end_at === undefined ? existing.end_at : (b.end_at || null),
        b.priority === undefined ? existing.priority : (Number(b.priority) || 0),
        b.is_active === undefined ? existing.is_active : (b.is_active ? 1 : 0),
        id
      ]
    );

    const row = (await query('SELECT * FROM advertisements WHERE id = ?', [id])).rows[0];
    return res.json({ advertisement: serializeAd(row) });
  } catch (error) {
    console.error('Update advertisement error:', error);
    return res.status(500).json({ error: 'Failed to update advertisement' });
  }
};

exports.updateAdvertisementStatus = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid id' });
    const isActive = req.body?.is_active ? 1 : 0;
    await query(
      'UPDATE advertisements SET is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [isActive, id]
    );
    const row = (await query('SELECT * FROM advertisements WHERE id = ?', [id])).rows[0];
    if (!row) return res.status(404).json({ error: 'Advertisement not found' });
    return res.json({ advertisement: serializeAd(row) });
  } catch (error) {
    console.error('Update advertisement status error:', error);
    return res.status(500).json({ error: 'Failed to update advertisement status' });
  }
};

// ===== SCHOOL-FACING views (authenticated school_admin / school_staff) =====
// Filtering rules are enforced on the BACKEND from the session role/userId,
// never from the frontend:
//  - is_active = 1
//  - start_at <= NOW() (or null)
//  - end_at >= NOW()   (or null)
//  - target_audience matches the session role (BOTH or exact)
//  - optional position filter from query string
//  - ads this user dismissed are excluded via LEFT JOIN
exports.getActiveAdvertisements = async (req, res) => {
  try {
    const role = req.user.role; // from the session, NEVER the client
    if (role !== 'SCHOOL_ADMIN' && role !== 'SCHOOL_STAFF') {
      return res.status(200).json({ advertisements: [] });
    }

    const position = req.query.position;
    const positionOk = POSITIONS.includes(position);

    const sql = [
      'SELECT a.* FROM advertisements a',
      'LEFT JOIN advertisement_dismissals d',
      '  ON d.advertisement_id = a.id AND d.user_id = ?',
      'WHERE a.is_active = 1',
      '  AND d.id IS NULL',
      '  AND (a.start_at IS NULL OR a.start_at <= NOW())',
      '  AND (a.end_at IS NULL OR a.end_at >= NOW())',
      "  AND (a.target_audience = 'BOTH' OR a.target_audience = ?)",
      positionOk ? '  AND a.position = ?' : null,
      'ORDER BY a.priority DESC, a.created_at DESC'
    ].filter(Boolean).join('\n');

    const params = [req.userId, role];
    if (positionOk) params.push(position);

    const r = await query(sql, params);
    return res.json({ advertisements: r.rows.map(serializeAd) });
  } catch (error) {
    console.error('Get active advertisements error:', error);
    return res.status(500).json({ error: 'Failed to get advertisements' });
  }
};

exports.dismissAdvertisement = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid id' });

    const exists = (await query('SELECT id FROM advertisements WHERE id = ?', [id])).rows[0];
    if (!exists) return res.status(404).json({ error: 'Advertisement not found' });

    await query(
      'INSERT IGNORE INTO advertisement_dismissals (advertisement_id, user_id) VALUES (?, ?)',
      [id, req.userId]
    );
    return res.json({ success: true, message: 'Advertisement dismissed' });
  } catch (error) {
    console.error('Dismiss advertisement error:', error);
    return res.status(500).json({ error: 'Failed to dismiss advertisement' });
  }
};

exports.deleteAdvertisement = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const existing = (await query('SELECT * FROM advertisements WHERE id = ?', [id])).rows[0];
    if (!existing) return res.status(404).json({ error: 'Advertisement not found' });
    await query('DELETE FROM advertisements WHERE id = ?', [id]);
    if (existing.image_path) removeAdFile(existing.image_path);
    return res.json({ success: true, message: 'Advertisement deleted' });
  } catch (error) {
    console.error('Delete advertisement error:', error);
    return res.status(500).json({ error: 'Failed to delete advertisement' });
  }
};