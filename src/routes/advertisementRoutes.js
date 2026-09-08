const express = require('express');
const router = express.Router();
const { authMiddleware, requireOwner, requireRole } = require('../middleware/auth');
const { adUpload } = require('../config/upload');
const adController = require('../controllers/advertisementController');

// ===== OWNER MANAGEMENT (OWNER role only, enforced server-side) =====
// Owner CRUD plus banner upload flows.
router.use('/manage', authMiddleware, requireOwner);
router.get('/manage', adController.listAdvertisements);
router.post('/manage', authMiddleware, requireOwner, adUpload.single('image'), adController.createAdvertisement);
router.put('/manage/:id', authMiddleware, requireOwner, adUpload.single('image'), adController.updateAdvertisement);
router.patch('/manage/:id/status', authMiddleware, requireOwner, adController.updateAdvertisementStatus);
router.delete('/manage/:id', authMiddleware, requireOwner, adController.deleteAdvertisement);

// ===== SCHOOL-FACING (authenticated school_admin / school_staff only) =====
// Strict guard - OWNER is NOT allowed to see/view these as a "school" role.
// Role is read from the authenticated session, never from the client.
const schoolOnly = requireRole(['SCHOOL_ADMIN', 'SCHOOL_STAFF']);
router.get('/', authMiddleware, schoolOnly, adController.getActiveAdvertisements);
router.post('/:id/dismiss', authMiddleware, schoolOnly, adController.dismissAdvertisement);

module.exports = router;