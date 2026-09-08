const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

// Root folder that `server.js` serves statically at `/uploads`.
// Files written here are immediately available at their `/uploads/...` URL.
const UPLOADS_ROOT = path.join(__dirname, '..', '..', 'uploads');
const ID_CARDS_ROOT = path.join(UPLOADS_ROOT, 'id-cards');

// Allow only filename-safe characters so a school code / card id can never
// be used for path traversal (e.g. `../`, absolute paths, OS separators).
function sanitizeSegment(value, fallback = 'school') {
    const s = String(value || '').replace(/[^A-Za-z0-9_-]/g, '').trim();
    if (!s || s === '.' || s === '..') return fallback;
    return s;
}

// Decode a `data:[mime];base64,....` URL and re-encode it as a clean JPEG
// buffer using sharp, which also validates the input is a real image.
async function dataUrlToJpegBuffer(dataUrl) {
    if (!dataUrl || typeof dataUrl !== 'string') return null;
    const m = /^data:image\/(jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(
        dataUrl.trim()
    );
    if (!m) return null;
    const buffer = Buffer.from(m[2], 'base64');
    if (!buffer.length) return null;
    try {
        return await sharp(buffer)
            .rotate() // respect EXIF orientation from the canvas upload
            .jpeg({ quality: 95 })
            .toBuffer();
    } catch (e) {
        console.error('idCardFiles: sharp re-encode failed:', e.message);
        return null;
    }
}

/**
 * Save one ID-card side as a JPEG file on disk and return its public URL path.
 * - Folder  : uploads/id-cards/{school_code}
 * - Filename: {uniqueId}_{side}.jpg  (uniqueId is a fresh UUID => never overwrites)
 * - Returns : /uploads/id-cards/{school_code}/{uniqueId}_{side}.jpg
 *
 * Throws if the image could not be written or verified — the caller is then
 * responsible for not persisting the card / deducting no credit.
 */
async function saveIdCardImage(schoolCode, uniqueId, side, dataUrl) {
    const buffer = await dataUrlToJpegBuffer(dataUrl);
    if (!buffer) {
        throw new Error(`No valid ${side} image data received`);
    }

    const code = sanitizeSegment(schoolCode, 'school');
    const dir = path.join(ID_CARDS_ROOT, code);
    fs.mkdirSync(dir, { recursive: true });

    const fileName = `${uniqueId}_${side}.jpg`;
    const absPath = path.join(dir, fileName);
    fs.writeFileSync(absPath, buffer);

    // Verify the bytes were actually written before trusting the URL.
    const stat = fs.statSync(absPath);
    if (!stat || stat.size <= 0) {
        throw new Error(`Failed to save ${side} image file`);
    }

    return `/uploads/id-cards/${code}/${fileName}`;
}

/**
 * Save the uploaded student photo as a file and return its public URL path.
 * Used for the `students.photo_url` column so we never persist base64 there.
 */
async function saveStudentPhoto(schoolCode, uniqueId, dataUrl) {
    const buffer = await dataUrlToJpegBuffer(dataUrl);
    if (!buffer) return null;

    const code = sanitizeSegment(schoolCode, 'school');
    const dir = path.join(ID_CARDS_ROOT, code);
    fs.mkdirSync(dir, { recursive: true });

    const fileName = `${uniqueId}_student_photo.jpg`;
    const absPath = path.join(dir, fileName);
    fs.writeFileSync(absPath, buffer);

    const stat = fs.statSync(absPath);
    if (!stat || stat.size <= 0) {
        throw new Error('Failed to save student photo file');
    }

    return `/uploads/id-cards/${code}/${fileName}`;
}

// Best-effort removal of files we just wrote, used on rollback so a failed
// generation does not litter the uploads folder.
function removeIfExists(absPath) {
    try {
        if (absPath && fs.existsSync(absPath)) fs.unlinkSync(absPath);
    } catch (e) {
        console.warn('idCardFiles: failed to clean up file', absPath, e.message);
    }
}

module.exports = {
    sanitizeSegment,
    dataUrlToJpegBuffer,
    saveIdCardImage,
    saveStudentPhoto,
    removeIfExists,
    ID_CARDS_ROOT
};