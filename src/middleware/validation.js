const { body, param, query, validationResult } = require('express-validator');

const validate = (validations) => {
    return async (req, res, next) => {
        await Promise.all(validations.map(validation => validation.run(req)));

        const errors = validationResult(req);
        if (errors.isEmpty()) {
            return next();
        }

        return res.status(400).json({
            errors: errors.array().map(err => ({
                field: err.param,
                message: err.msg
            }))
        });
    };
};

// Validation rules
const userValidation = {
    register: [
        body('email').isEmail().normalizeEmail(),
        body('password').isLength({ min: 8 }),
        body('role').isIn(['SCHOOL_ADMIN', 'SCHOOL_STAFF'])
    ],
    login: [
        body('email').isEmail().normalizeEmail(),
        body('password').notEmpty()
    ]
};

const schoolValidation = {
    create: [
        body('name').notEmpty().trim().isLength({ min: 2 }),
        body('address').optional().trim(),
        body('phone').optional().trim().isMobilePhone(),
        body('email').optional().isEmail().normalizeEmail()
    ],
    update: [
        param('id').isInt({ min: 1 }),
        body('name').optional().trim().isLength({ min: 2 }),
        body('address').optional().trim(),
        body('phone').optional().trim().isMobilePhone(),
        body('email').optional().isEmail().normalizeEmail()
    ]
};

const studentValidation = {
    create: [
        body('name').notEmpty().trim().isLength({ min: 2 }),
        body('fatherName').optional().trim(),
        body('phone').optional().trim().isMobilePhone(),
        body('address').optional().trim(),
        body('class').optional().trim(),
        body('section').optional().trim(),
        body('admissionNumber').optional().trim()
    ],
    update: [
        param('id').isInt({ min: 1 }),
        body('name').optional().trim().isLength({ min: 2 }),
        body('fatherName').optional().trim(),
        body('phone').optional().trim().isMobilePhone(),
        body('address').optional().trim(),
        body('class').optional().trim(),
        body('section').optional().trim(),
        body('admissionNumber').optional().trim()
    ]
};

const designValidation = {
    create: [
        body('name').notEmpty().trim(),
        body('frontTemplate').notEmpty(),
        body('backTemplate').optional(),
        body('isGlobal').optional().isBoolean()
    ]
};

module.exports = {
    validate,
    userValidation,
    schoolValidation,
    studentValidation,
    designValidation
};