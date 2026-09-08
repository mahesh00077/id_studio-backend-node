const express = require('express');
const router = express.Router();
const { authMiddleware, requireSchoolStaff } = require('../middleware/auth');
const { enforceSchoolIsolation } = require('../middleware/school-isolation');
const schoolController = require('../controllers/schoolController');
const idCardController = require('../controllers/idCardController');

// All routes require authentication and SCHOOL_STAFF role
router.use(authMiddleware, requireSchoolStaff);
router.use(enforceSchoolIsolation);

// ===== DASHBOARD =====
router.get('/dashboard', (req, res) => {
    res.json({
        stats: {
            available_credits: req.school?.credit_balance || 0
        }
    });
});

// ===== CREDITS (View only) =====
router.get('/credits/balance', schoolController.getSchoolCreditBalance);

// ===== ID CARDS =====
router.post('/id-cards/generate', idCardController.generateIDCard);
router.post('/id-cards/preview', idCardController.previewIDCard);
router.get('/id-cards/history', idCardController.getIDCardHistory);
router.get('/id-cards/:id/download', idCardController.downloadIDCard);

// ===== DESIGNS (View only) =====
router.get('/designs', idCardController.getAvailableDesigns);

// Owner-configured fields for a school-assigned design (same source of
// truth as School Admin uses for the ID-card generator).
const schoolAdminDesignFieldController =
  require('../controllers/schoolAdminDesignFieldController');

router.get(
  '/designs/:designId/fields',
  schoolAdminDesignFieldController.getDesignFieldsForSchool
);

// Persist field position/attribute edits made in the ID-card generator
// (same bulk upsert the owner scope uses, keyed by design+side+field_key).
router.put(
  '/designs/:designId/fields',
  require('../controllers/designFieldController').saveDesignFields
);

module.exports = router;