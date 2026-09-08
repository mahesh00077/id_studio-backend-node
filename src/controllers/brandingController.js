const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { query } = require('../config/database');

const UPLOADS_ROOT = path.join(__dirname, '..', '..', 'uploads');
const BRANDING_DIR = path.join(UPLOADS_ROOT, 'branding');

// Strip HTML/control chars from user text so branding can never be used to
// smuggle markup into the rendered UI (defense in depth; the UI also escapes).
function cleanText(value, maxLen) {
  if (value == null) return null;
  return String(value).replace(/<[^>]*>/g, '').slice(0, maxLen).trim();
}

// Ensure the stored value is a safe web URL (http/https only) or null.
function sanitizeUrl(value) {
  if (!value) return null;
  const s = String(value).trim();
  if (!/^https?:\/\//i.test(s)) return null;
  return s.slice(0, 500);
}

// Turn a stored DB reference into a public, browser-safe URL. Only ever
// exposes the /uploads/... path relative to the app origin - never an absolute
// server filesystem path.
function toPublicUrl(reference) {
  if (!reference) return null;
  let clean = String(reference).replace(/\\/g, '/');
  if (!clean.startsWith('/')) clean = '/' + clean;
  if (!clean.startsWith('/uploads/')) return null;
  return clean;
}

// Attach derived/public fields to a branding row and normalize the stored
// theme_colors JSON string into an object. Callers simply return this object.
function formatBrandingRow(row) {
  const out = { ...row };
  out.logo_url = toPublicUrl(row.logo_path);
  out.favicon_url = toPublicUrl(row.favicon_path);

  let theme = null;
  if (row.theme_colors) {
    try {
      theme = JSON.parse(row.theme_colors);
    } catch (e) {
      theme = null;
    }
  }
  out.theme_colors = theme;

  // Normalize logo size to numbers (defensive - DB columns are nullable ints).
  out.logo_width = row.logo_width == null ? null : Number(row.logo_width);
  out.logo_height = row.logo_height == null ? null : Number(row.logo_height);
  return out;
}

// Remove an uploaded file (best-effort, path-safe: only within branding dir).
function removeBrandingFile(reference) {
  if (!reference) return;
  const safe = path.basename(String(reference).replace(/\\/g, '/'));
  const abs = path.join(BRANDING_DIR, safe);
  try {
    if (fs.existsSync(abs)) fs.unlinkSync(abs);
  } catch (e) {
    console.warn('brandingController: failed to remove file', abs, e.message);
  }
}

exports.getBranding = async (req, res) => {
  try {
    const r = await query('SELECT * FROM company_branding WHERE id = 1');
    const row = r.rows[0];
    if (!row) return res.status(404).json({ error: 'Branding not configured' });

    return res.json({ branding: formatBrandingRow(row) });
  } catch (error) {
    console.error('Get branding error:', error);
    return res.status(500).json({ error: 'Failed to get branding' });
  }
};
exports.updateBranding = async (req, res) => {
  try {
    const b = req.body || {};
    // const companyName = cleanText(b.companyName, 150) || 'School ID Studio';
    const companyName = b.companyName;
    const showLogoWithName = b.showLogoWithName == null ? 1 : (b.showLogoWithName ? 1 : 0);

    const year = Number(b.footer_start_year) || 2023;
    const safeYear = Math.max(2000, Math.min(2100, year));

    // Logo size - optional positive dimensions (px). Null keeps the default
    // responsive behavior in the UI.
    const logoWidth = b.logo_width == null || !Number(b.logo_width)
      ? null : Math.max(1, Math.min(600, Math.round(Number(b.logo_width))));
    const logoHeight = b.logo_height == null || !Number(b.logo_height)
      ? null : Math.max(1, Math.min(300, Math.round(Number(b.logo_height))));

    // Theme colors - a bounded JSON object. Only known scalar fields are kept
    // (defense in depth; rejects any nested/oversized payload).
    let themeColors = null;
    if (b.theme_colors && typeof b.theme_colors === 'object') {
      const keys = ['navbar_bg', 'navbar_text', 'navbar_hover_bg', 'navbar_hover_text',
                    'navbar_active_bg', 'navbar_active_text', 'primary'];
      const clean = {};
      for (const k of keys) {
        const v = b.theme_colors[k];
        if (typeof v === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(v.trim())) {
          clean[k] = v.trim();
        }
      }
      if (Object.keys(clean).length > 0) themeColors = JSON.stringify(clean);
    }

    await query(
      `UPDATE company_branding
       SET company_name = ?, show_logo_with_name = ?, website_url = ?,
           support_email = ?, support_phone = ?, footer_start_year = ?,
           footer_text = ?, logo_width = ?, logo_height = ?, theme_colors = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = 1`,
      [
        companyName,
        showLogoWithName,
        sanitizeUrl(b.website_url),
        cleanText(b.support_email, 254),
        cleanText(b.support_phone, 40),
        safeYear,
        cleanText(b.footer_text, 200),
        logoWidth,
        logoHeight,
        themeColors
      ]
    );

    const r = await query('SELECT * FROM company_branding WHERE id = 1');
    const row = r.rows[0];
    return res.json({ branding: formatBrandingRow(row), success: true });
  } catch (error) {
    console.error('Update branding error:', error);
    return res.status(500).json({ error: 'Failed to update branding' });
  }
};

exports.uploadLogo = async (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'No logo image uploaded' });

    const absPath = path.join(BRANDING_DIR, file.filename);

    // Validate the bytes are a real image using sharp (catches disguised
    // executables / polyglot files that pass the mimetype allowlist).
    try {
      const meta = await sharp(absPath).metadata();
      if (!meta || !meta.width || !meta.height) throw new Error('not an image');
    } catch (e) {
      try { fs.unlinkSync(absPath); } catch (_) {}
      return res.status(400).json({ error: 'Uploaded file is not a valid image' });
    }

    const old = (await query('SELECT logo_path, favicon_path, company_name FROM company_branding WHERE id = 1')).rows[0];

    // Name the stored logo file after the company name (e.g. "bsr-school-id-studio.png")
    // so the branding asset is self-describing instead of a random upload hash.
    const slug = (old?.company_name || 'company')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'company';
    const ext = (path.extname(file.filename) || '.png').toLowerCase();
    const logoName = `${slug}${ext}`;
    let finalName = logoName;
    let n = 1;
    while (fs.existsSync(path.join(BRANDING_DIR, finalName)) && finalName !== file.filename) {
      finalName = `${slug}-${n}${ext}`;
      n += 1;
    }
    if (finalName !== file.filename) fs.renameSync(absPath, path.join(BRANDING_DIR, finalName));

    const reference = '/uploads/branding/' + finalName;

    // The company logo doubles as the favicon: generate a 64x64 PNG version
    // from the uploaded logo and store it as favicon_path.
    const faviconName = `${slug}-favicon.png`;
    await sharp(path.join(BRANDING_DIR, finalName))
      .resize(64, 64, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toFile(path.join(BRANDING_DIR, faviconName));
    const faviconReference = '/uploads/branding/' + faviconName;

    await query(
      'UPDATE company_branding SET logo_path = ?, favicon_path = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1',
      [reference, faviconReference]
    );

    // Only remove the previous logo/favicon after the new record is committed.
    if (old && old.logo_path && old.logo_path !== reference) {
      removeBrandingFile(old.logo_path);
    }
    if (old && old.favicon_path && old.favicon_path !== faviconReference) {
      removeBrandingFile(old.favicon_path);
    }

    const row = (await query('SELECT * FROM company_branding WHERE id = 1')).rows[0];
    return res.json({ success: true, branding: formatBrandingRow(row) });
  } catch (error) {
    console.error('Upload logo error:', error);
    return res.status(500).json({ error: 'Failed to upload logo' });
  }
};
exports.uploadFavicon = async (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'No favicon image uploaded' });

    const absPath = path.join(BRANDING_DIR, file.filename);
    try {
      const meta = await sharp(absPath).metadata();
      if (!meta || !meta.width || !meta.height) throw new Error('not an image');
    } catch (e) {
      try { fs.unlinkSync(absPath); } catch (_) {}
      return res.status(400).json({ error: 'Uploaded file is not a valid image' });
    }

    const old = (await query('SELECT favicon_path FROM company_branding WHERE id = 1')).rows[0];
    const reference = '/uploads/branding/' + file.filename;

    await query(
      'UPDATE company_branding SET favicon_path = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1',
      [reference]
    );
    if (old && old.favicon_path && old.favicon_path !== reference) {
      removeBrandingFile(old.favicon_path);
    }

    const row = (await query('SELECT * FROM company_branding WHERE id = 1')).rows[0];
    return res.json({ success: true, branding: formatBrandingRow(row) });
  } catch (error) {
    console.error('Upload favicon error:', error);
    return res.status(500).json({ error: 'Failed to upload favicon' });
  }
};

exports.deleteLogo = async (req, res) => {
  try {
    const old = (await query('SELECT logo_path, favicon_path FROM company_branding WHERE id = 1')).rows[0];
    await query(
      'UPDATE company_branding SET logo_path = NULL, favicon_path = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = 1'
    );
    if (old && old.logo_path) removeBrandingFile(old.logo_path);
    // The favicon was auto-generated from the logo, so remove it with it.
    if (old && old.favicon_path) removeBrandingFile(old.favicon_path);

    const row = (await query('SELECT * FROM company_branding WHERE id = 1')).rows[0];
    return res.json({ success: true, branding: formatBrandingRow(row) });
  } catch (error) {
    console.error('Delete logo error:', error);
    return res.status(500).json({ error: 'Failed to delete logo' });
  }
};

exports.deleteFavicon = async (req, res) => {
  try {
    const old = (await query('SELECT favicon_path FROM company_branding WHERE id = 1')).rows[0];
    await query(
      'UPDATE company_branding SET favicon_path = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = 1'
    );
    if (old && old.favicon_path) removeBrandingFile(old.favicon_path);

    const row = (await query('SELECT * FROM company_branding WHERE id = 1')).rows[0];
    return res.json({ success: true, branding: formatBrandingRow(row) });
  } catch (error) {
    console.error('Delete favicon error:', error);
    return res.status(500).json({ error: 'Failed to delete favicon' });
  }
};