const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

// Ensure upload directories exist
const UPLOAD_ROOT = path.join(process.cwd(), 'uploads');
['', '/branding', '/ads'].forEach((sub) => {
    const dir = path.join(UPLOAD_ROOT, sub);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

// Generic image mimetype allowlist (raster images only - SVG is excluded
// because inline SVG can carry embedded scripts).
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/jpg', 'image/webp'];

function imageFileFilter(label) {
    return (req, file, cb) => {
        if (IMAGE_TYPES.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type. Only JPEG, PNG, and WebP are allowed for ' + label + '.'), false);
        }
    };
}

// Builds a multer instance with uuid filenames inside a fixed subfolder.
// The original user filename is NEVER used as a filesystem path, which
// removes any path-traversal / overwrite risk by construction.
function makeUploader(subfolder, maxMb) {
    const dest = path.join(UPLOAD_ROOT, subfolder);
    const storage = multer.diskStorage({
        destination: (req, file, cb) => cb(null, dest),
        filename: (req, file, cb) => {
            // Extension is derived and sanitized; name is always a uuid.
            let ext = path.extname(file.originalname || '').toLowerCase();
            if (!['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) ext = '.png';
            cb(null, uuidv4() + ext);
        }
    });
    return multer({
        storage: storage,
        limits: { fileSize: maxMb * 1024 * 1024 },
        fileFilter: imageFileFilter(subfolder)
    });
}

// Company logo / favicon (Owner branding) - small images.
const brandingUpload = makeUploader('branding', 2);
// Advertisement banners.
const adUpload = makeUploader('ads', 5);

// Legacy default uploader (kept for existing callers) - root uploads/ dir.
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/');
    },
    filename: function (req, file, cb) {
        const ext = path.extname(file.originalname);
        cb(null, uuidv4() + ext);
    }
});

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB limit
    },
    fileFilter: imageFileFilter('upload')
});

module.exports = upload;
module.exports.upload = upload;
module.exports.brandingUpload = brandingUpload;
module.exports.adUpload = adUpload;
