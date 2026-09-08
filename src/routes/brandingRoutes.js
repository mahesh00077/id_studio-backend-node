const express = require('express');
const router = express.Router();
const { authMiddleware, requireOwner } = require('../middleware/auth');
const { brandingUpload } = require('../config/upload');
const brandingController = require('../controllers/brandingController');

// Public - the login page needs company branding before the user is signed in.
// Only exposes company name/logo/footer config - no user data.
router.get('/', brandingController.getBranding);

// Everything below requires the OWNER role (enforced server-side).
router.put('/', authMiddleware, requireOwner, brandingController.updateBranding);
router.post('/logo', authMiddleware, requireOwner, brandingUpload.single('logo'), brandingController.uploadLogo);
router.post('/favicon', authMiddleware, requireOwner, brandingUpload.single('favicon'), brandingController.uploadFavicon);
router.delete('/logo', authMiddleware, requireOwner, brandingController.deleteLogo);
router.delete('/favicon', authMiddleware, requireOwner, brandingController.deleteFavicon);

module.exports = router;