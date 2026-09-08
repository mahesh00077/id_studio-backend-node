const express = require('express');
const router = express.Router();
const { authMiddleware, requireSchoolAdmin } = require('../middleware/auth');
const { enforceSchoolIsolation } = require('../middleware/school-isolation');
const schoolController = require('../controllers/schoolController');
const idCardController = require('../controllers/idCardController');

console.log('✅ School Admin Routes loaded');

// All routes require authentication and SCHOOL_ADMIN role
router.use(authMiddleware, requireSchoolAdmin);
router.use(enforceSchoolIsolation);

// ===== DASHBOARD =====
router.get('/dashboard', schoolController.getSchoolDashboard);

// ===== SCHOOL INFO =====
router.get('/school', (req, res) => {
    res.json(req.school);
});

// ===== CREDITS =====
router.get('/credits/balance', schoolController.getSchoolCreditBalance);
router.get('/credits/history', schoolController.getSchoolCreditHistory);

// ===== ID CARDS =====
router.post('/id-cards/generate', idCardController.generateIDCard);
router.post('/id-cards/preview', idCardController.previewIDCard);
router.get('/id-cards/history', idCardController.getIDCardHistory);
router.get('/id-cards/:id/download', idCardController.downloadIDCard);

// ===== DESIGNS =====
router.get('/designs', idCardController.getAvailableDesigns);

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

// ===== STUDENTS =====
const studentController = require('../controllers/studentController');

router.get('/students', studentController.getStudents);
router.get('/students/:id', studentController.getStudentDetails);
router.post('/students', studentController.createStudent);
router.put('/students/:id', studentController.updateStudent);
router.patch('/students/:id/status', studentController.updateStudentStatus);

module.exports = router;