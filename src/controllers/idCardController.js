const { query } = require('../config/database');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const Design = require('../models/Design');
const School = require('../models/School');
const Student = require('../models/Student');
const IDCard = require('../models/IDCard');
const idCardFiles = require('../utils/idCardFiles');

console.log('✅ ID Card Controller loaded');

// Resolve a student field from the submitted data map, tolerating all the
// key aliases the Owner-configured design fields can carry (e.g. the same
// concept may be keyed `className` vs `class`, `admissionNo` vs
// `admissionNumber`, `mobile` vs `phone`, ...). Falls back to `fallback`
// when every candidate is blank/missing.
function pickStudentValue(studentData, keys, fallback = '') {
    for (const k of keys) {
        const v = studentData && studentData[k];
        if (v !== undefined && v !== null && String(v).trim() !== '') {
            return v;
        }
    }
    return fallback;
}

// ===== AVAILABLE DESIGNS FOR SCHOOL =====
exports.getAvailableDesigns = async (req, res) => {
    try {
        const schoolId = req.schoolId;
        console.log('Fetching designs for school:', schoolId);
        
        if (!schoolId) {
            return res.json([]);
        }
        
        const designs = await Design.findAvailableForSchool(schoolId);
        return res.json(designs || []);
    } catch (error) {
        console.error('Get available designs error:', error);
        return res.json([]);
    }
};

// ===== PREVIEW ID CARD =====
exports.previewIDCard = async (req, res) => {
    try {
        const schoolId = req.schoolId;
        const { studentData, photo, designId, imagePosition, imageSize } = req.body;
        
        if (!designId) {
            return res.status(400).json({ error: 'Design ID is required' });
        }
        
        if (!studentData) {
            return res.status(400).json({ error: 'Student data is required' });
        }
        
        if (!photo) {
            return res.status(400).json({ error: 'Student photo is required' });
        }
        
        const designs = await Design.findAvailableForSchool(schoolId);
        const design = designs.find(d => d.id === designId);
        if (!design) {
            return res.status(404).json({ error: 'Design not available for this school' });
        }
        
        const cardNumber = 'PREVIEW-' + Date.now().toString().slice(-8);
        
        return res.json({
            success: true,
            preview: {
                front: photo,
                back: null,
                cardNumber: cardNumber
            },
            message: 'Preview generated successfully. No credits consumed.'
        });
        
    } catch (error) {
        console.error('Preview ID card error:', error);
        return res.status(500).json({ 
            error: error.message || 'Failed to preview ID card' 
        });
    }
};

// ===== GENERATE ID CARD =====
exports.generateIDCard = async (req, res) => {
    try {
        const schoolId = req.schoolId;
        const { studentData, photo, designId, imagePosition, imageSize, frontImage, backImage, fieldData } = req.body;
        
        if (!designId) {
            return res.status(400).json({ error: 'Design ID is required' });
        }
        
        if (!studentData) {
            return res.status(400).json({ error: 'Student data is required' });
        }
        
        if (!photo) {
            return res.status(400).json({ error: 'Student photo is required' });
        }
        
        const designs = await Design.findAvailableForSchool(schoolId);
        const design = designs.find(d => d.id === designId);
        if (!design) {
            return res.status(404).json({ error: 'Design not available for this school' });
        }
        
        const creditBalance = await School.getCredits(schoolId);
        if (creditBalance <= 0) {
            return res.status(400).json({ error: 'Insufficient credits. Please contact school admin.' });
        }
        
        // ---- Resolve the student record from the submitted data map ----
        // The frontend now posts the FULL set of entered field values, keyed by
        // the design field keys. Resolve each students-table column flexibly so
        // the data persists regardless of the field key naming a design uses.
        const sd = studentData || {};
        const name = pickStudentValue(sd, ['name', 'studentName', 'student_name']);
        if (!name) {
            return res.status(400).json({ error: 'Student name is required' });
        }

        const fatherName = pickStudentValue(sd, ['fatherName', 'father_name', 'fathersName']);
        const className = pickStudentValue(sd, ['class', 'className', 'grade', 'class_name']);
        const section = pickStudentValue(sd, ['section', 'sec']);
        const phone = pickStudentValue(sd, ['phone', 'mobile', 'mobileNo', 'mobile_number']);
        const address = pickStudentValue(sd, ['address', 'addressLine', 'street']);
        const admissionNumber = pickStudentValue(sd, ['admissionNumber', 'admissionNo', 'admission_number', 'rollNo', 'rollNumber']);

        // 1) Add / UPDATE the STUDENTS row first (so the student table always
        //    reflects the fields the admin just entered — and never silently
        //    inserts a duplicate for the same student on repeated generation).
        //    Prefer matching by admission number; when no admission number was
        //    provided, fall back to matching the existing student by name (and
        //    class/section, then name alone) so the SAME student row is updated
        //    and its id reused instead of inserting a duplicate.
        let student = null;
        if (admissionNumber) {
            student = await Student.findByAdmissionNumber(admissionNumber, schoolId);
        }
        if (!student && name) {
            student = await Student.findByName(name, className, section, schoolId);
        }
        if (!student && name) {
            student = await Student.findByName(name, null, null, schoolId);
        }

        // ---- School code (from the authenticated school, never the client) ----
        // Normally `req.school` is attached by enforceSchoolIsolation. Fall back
        // to a DB lookup (e.g. for the OWNER role which bypasses that check) so
        // the code is ALWAYS derived server-side from the authed school.
        let schoolRow = req.school;
        if (!schoolRow) {
            schoolRow = await School.findById(schoolId);
        }
        const schoolCode = schoolRow?.school_code
            ? idCardFiles.sanitizeSegment(schoolRow.school_code, 'school')
            : null;
        if (!schoolCode) {
            return res.status(500).json({ error: 'School code is not configured.' });
        }

        const cardId = uuidv4();

        // Save the student photo to disk FIRST (before the student row) so we
        // can store a real URL in students.photo_url instead of a base64 blob.
        let studentPhotoUrl = null;
        const writtenFilePaths = [];
        try {
            studentPhotoUrl = await idCardFiles.saveStudentPhoto(schoolCode, cardId, photo);
            if (studentPhotoUrl) {
                writtenFilePaths.push(path.join(idCardFiles.ID_CARDS_ROOT, schoolCode, `${cardId}_student_photo.jpg`));
            }
        } catch (photoErr) {
            return res.status(500).json({
                error: `Failed to save student photo: ${photoErr.message}`
            });
        }

        try {
            if (!student) {
                student = await Student.create({
                    schoolId: schoolId,
                    name,
                    fatherName,
                    phone,
                    address,
                    class: className,
                    section,
                    admissionNumber,
                    photoUrl: studentPhotoUrl || photo
                });
            } else {
                // Sync the latest entered details so the table list always
                // reflects the name/class/section the admin just typed, while
                // KEEPING the original student id.
                await Student.update(student.id, {
                    name,
                    fatherName,
                    phone,
                    address,
                    class: className,
                    section,
                    admissionNumber,
                    photoUrl: studentPhotoUrl || photo
                });
                student = await Student.findById(student.id, schoolId);
            }
        } catch (createError) {
            // Guard against a unique-key race: if creating a new student fails
            // because the admission number is already in use, locate that
            // existing student and update it instead.
            if (
                admissionNumber &&
                createError.code === 'ER_DUP_ENTRY'
            ) {
                const existing = await Student.findByAdmissionNumber(admissionNumber, schoolId);
                if (existing) {
                    await Student.update(existing.id, {
                        name,
                        fatherName,
                        phone,
                        address,
                        class: className,
                        section,
                        admissionNumber,
                        photoUrl: studentPhotoUrl || photo
                    });
                    student = await Student.findById(existing.id, schoolId);
                } else {
                    throw createError;
                }
            } else {
                throw createError;
            }
        }

        const cardNumber = IDCard.generateCardNumber(schoolId, student.id);

        // ---- Persist the rendered card sides to DISK; store only URL paths ----
        let frontImageUrl = null;
        let backImageUrl = null;

        try {
            // Front is always required; the clean rendered card takes priority.
            if (frontImage) {
                frontImageUrl = await idCardFiles.saveIdCardImage(schoolCode, cardId, 'front', frontImage);
            } else if (photo) {
                frontImageUrl = await idCardFiles.saveIdCardImage(schoolCode, cardId, 'front', photo);
            }
            if (frontImageUrl) {
                writtenFilePaths.push(path.join(idCardFiles.ID_CARDS_ROOT, schoolCode, `${cardId}_front.jpg`));
            }

            // Back is written whenever the design/template or payload has one.
            const wantBack = backImage || design.back_template;
            if (wantBack) {
                if (!backImage) {
                    throw new Error('Back image data is required for this design');
                }
                backImageUrl = await idCardFiles.saveIdCardImage(schoolCode, cardId, 'back', backImage);
                if (backImageUrl) {
                    writtenFilePaths.push(path.join(idCardFiles.ID_CARDS_ROOT, schoolCode, `${cardId}_back.jpg`));
                }
            }

            // Verify both sides actually exist when the design has both.
            if (design.front_template && !frontImageUrl) {
                throw new Error('Failed to generate the front ID card image');
            }
            if (wantBack && !backImageUrl) {
                throw new Error('Failed to generate the back ID card image');
            }
        } catch (fileErr) {
            // Clean up any files written before the failure; no credit consumed.
            writtenFilePaths.forEach(p => {
                try { if (require('fs').existsSync(p)) require('fs').unlinkSync(p); } catch (_) {}
            });
            return res.status(500).json({
                error: `Failed to save generated images: ${fileErr.message}`
            });
        }

        if (!frontImageUrl) {
            return res.status(500).json({ error: 'Failed to generate the front ID card image' });
        }

        const idCard = await IDCard.generate({
            schoolId,
            studentId: student.id,
            designId,
            // ONLY file URL paths — never base64.
            frontImageUrl,
            backImageUrl,
            cardNumber,
            userId: req.user.id,
            cardId,
            fieldData
        });

        await query(
            'INSERT INTO audit_logs (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
            [req.user.id, 'ID_CARD_GENERATED', JSON.stringify({ card_id: idCard.id, student_id: student.id, school_code: schoolCode }), req.ip]
        );

        return res.status(201).json({
            success: true,
            card: idCard,
            downloadUrls: {
                front: idCard.front_image_url,
                back: idCard.back_image_url
            },
            message: 'ID card generated successfully. 1 credit consumed.'
        });
        
    } catch (error) {
        console.error('Generate ID card error:', error);
        return res.status(500).json({ 
            error: error.message || 'Failed to generate ID card' 
        });
    }
};

// ===== DEMO GENERATE ID CARD (OWNER) =====
// The Owner's demo flow (Designs page → "Demo Generate") behaves exactly like a
// real school-admin generate — student row created/updated, both card images
// persisted to disk, an id_cards record inserted and downloadable — but it must
// NEVER deduct a credit from any school. The Owner role has no school_id, so the
// card is attached to the seeded "Demo School" so it persists somewhere tangible.
exports.generateDemoIDCard = async (req, res) => {
    try {
        const { studentData, photo, designId, frontImage, backImage, fieldData } = req.body;

        if (!designId) return res.status(400).json({ error: 'Design ID is required' });
        if (!studentData) return res.status(400).json({ error: 'Student data is required' });
        if (!photo) return res.status(400).json({ error: 'Student photo is required' });

        // ---- Demo school: prefer the seeded "Demo School", else any ACTIVE one ----
        const demoResult = await query(
            "SELECT * FROM schools WHERE name = 'Demo School' AND status = 'ACTIVE' ORDER BY id ASC LIMIT 1"
        );
        let schoolRow = demoResult.rows[0] || null;
        if (!schoolRow) {
            const schools = await School.findAll({ limit: 1, offset: 0 });
            schoolRow = schools[0] || null;
        }
        const schoolId = schoolRow?.id;
        if (!schoolId) {
            return res.status(500).json({ error: 'No school available for demo generation. Please create a school first.' });
        }

        // Owner can access any design directly (not restricted to assignment).
        const design = await Design.findById(designId);
        if (!design) return res.status(404).json({ error: 'Design not found' });

        // ---- Resolve student fields from the submitted data map ----
        const sd = studentData || {};
        const name = pickStudentValue(sd, ['name', 'studentName', 'student_name']);
        if (!name) return res.status(400).json({ error: 'Student name is required' });

        const fatherName = pickStudentValue(sd, ['fatherName', 'father_name', 'fathersName']);
        const className = pickStudentValue(sd, ['class', 'className', 'grade', 'class_name']);
        const section = pickStudentValue(sd, ['section', 'sec']);
        const phone = pickStudentValue(sd, ['phone', 'mobile', 'mobileNo', 'mobile_number']);
        const address = pickStudentValue(sd, ['address', 'addressLine', 'street']);
        const admissionNumber = pickStudentValue(sd, ['admissionNumber', 'admissionNo', 'admission_number', 'rollNo', 'rollNumber']);

        let student = null;
        if (admissionNumber) student = await Student.findByAdmissionNumber(admissionNumber, schoolId);
        if (!student && name) student = await Student.findByName(name, className, section, schoolId);
        if (!student && name) student = await Student.findByName(name, null, null, schoolId);

        const schoolCode = schoolRow.school_code
            ? idCardFiles.sanitizeSegment(schoolRow.school_code, 'school')
            : null;
        if (!schoolCode) return res.status(500).json({ error: 'School code is not configured.' });

        const cardId = uuidv4();
        let studentPhotoUrl = null;
        const writtenFilePaths = [];
        try {
            studentPhotoUrl = await idCardFiles.saveStudentPhoto(schoolCode, cardId, photo);
            if (studentPhotoUrl) writtenFilePaths.push(path.join(idCardFiles.ID_CARDS_ROOT, schoolCode, `${cardId}_student_photo.jpg`));
        } catch (photoErr) {
            return res.status(500).json({ error: `Failed to save student photo: ${photoErr.message}` });
        }
        try {
            if (!student) {
                student = await Student.create({
                    schoolId,
                    name,
                    fatherName,
                    phone,
                    address,
                    class: className,
                    section,
                    admissionNumber,
                    photoUrl: studentPhotoUrl || photo
                });
            } else {
                await Student.update(student.id, {
                    name,
                    fatherName,
                    phone,
                    address,
                    class: className,
                    section,
                    admissionNumber,
                    photoUrl: studentPhotoUrl || photo
                });
                student = await Student.findById(student.id, schoolId);
            }
        } catch (createError) {
            if (admissionNumber && createError.code === 'ER_DUP_ENTRY') {
                const existing = await Student.findByAdmissionNumber(admissionNumber, schoolId);
                if (existing) {
                    await Student.update(existing.id, {
                        name,
                        fatherName,
                        phone,
                        address,
                        class: className,
                        section,
                        admissionNumber,
                        photoUrl: studentPhotoUrl || photo
                    });
                    student = await Student.findById(existing.id, schoolId);
                } else {
                    throw createError;
                }
            } else {
                throw createError;
            }
        }

        const cardNumber = IDCard.generateCardNumber(schoolId, student.id);

        // ---- Persist rendered card sides to disk ----
        let frontImageUrl = null;
        let backImageUrl = null;
        try {
            if (frontImage) {
                frontImageUrl = await idCardFiles.saveIdCardImage(schoolCode, cardId, 'front', frontImage);
            } else if (photo) {
                frontImageUrl = await idCardFiles.saveIdCardImage(schoolCode, cardId, 'front', photo);
            }
            if (frontImageUrl) {
                writtenFilePaths.push(path.join(idCardFiles.ID_CARDS_ROOT, schoolCode, `${cardId}_front.jpg`));
            }

            const wantBack = backImage || design.back_template;
            if (wantBack) {
                if (!backImage) throw new Error('Back image data is required for this design');
                backImageUrl = await idCardFiles.saveIdCardImage(schoolCode, cardId, 'back', backImage);
                if (backImageUrl) {
                    writtenFilePaths.push(path.join(idCardFiles.ID_CARDS_ROOT, schoolCode, `${cardId}_back.jpg`));
                }
            }

            if (design.front_template && !frontImageUrl) throw new Error('Failed to generate the front ID card image');
            if (wantBack && !backImageUrl) throw new Error('Failed to generate the back ID card image');
        } catch (fileErr) {
            writtenFilePaths.forEach(p => {
                try { if (require('fs').existsSync(p)) require('fs').unlinkSync(p); } catch (_) {}
            });
            return res.status(500).json({ error: `Failed to save generated images: ${fileErr.message}` });
        }

        if (!frontImageUrl) return res.status(500).json({ error: 'Failed to generate the front ID card image' });

        // skipCredit ensures the DEMO school's balance is never touched.
        const idCard = await IDCard.generate({
            schoolId,
            studentId: student.id,
            designId,
            frontImageUrl,
            backImageUrl,
            cardNumber,
            userId: req.user.id,
            cardId,
            skipCredit: true,
            fieldData
        });

        await query(
            'INSERT INTO audit_logs (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
            [req.user.id, 'ID_CARD_DEMO_GENERATED', JSON.stringify({ card_id: idCard.id, student_id: student.id, school_code: schoolCode }), req.ip]
        );

        return res.status(201).json({
            success: true,
            card: idCard,
            downloadUrls: {
                front: idCard.front_image_url,
                back: idCard.back_image_url
            },
            message: 'Demo ID card generated successfully. No credit consumed.'
        });
    } catch (error) {
        console.error('Generate demo ID card error:', error);
        return res.status(500).json({ error: error.message || 'Failed to generate demo ID card' });
    }
};

// ===== GET ID CARD HISTORY =====
exports.getIDCardHistory = async (req, res) => {
    try {
        const schoolId = req.schoolId;
        const { limit = 50, offset = 0, studentId = null } = req.query;
        
        const cards = await IDCard.findBySchool(schoolId, { limit, offset, studentId });
        return res.json(cards || []);
    } catch (error) {
        console.error('Get ID card history error:', error);
        return res.json([]);
    }
};

// ===== DOWNLOAD ID CARD =====
exports.downloadIDCard = async (req, res) => {
    try {
        const schoolId = req.schoolId;
        const { id } = req.params;
        
        const card = await IDCard.findById(id, schoolId);
        if (!card) {
            return res.status(404).json({ error: 'ID card not found' });
        }
        
        await IDCard.updateDownloadStatus(id);
        
        await query(
            'INSERT INTO audit_logs (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
            [req.user.id, 'ID_CARD_DOWNLOADED', JSON.stringify({ card_id: id }), req.ip]
        );
        
        // If no generated Back image was saved for this card, fall back to the
        // assigned design's back template so admins still get a usable Back side.
        let fallbackBackUrl = null;
        if ((!card.back_image_url || String(card.back_image_url).trim() === '') && card.design_id) {
            const result = await query(
                "SELECT back_template FROM id_designs WHERE id = ? AND back_template IS NOT NULL AND back_template <> ''",
                [card.design_id]
            );
            fallbackBackUrl = result.rows[0]?.back_template || null;
        }
        
        return res.json({
            success: true,
            card: card,
            downloadUrls: {
                front: card.front_image_url,
                back: card.back_image_url || fallbackBackUrl
            },
            // true => the Back URL above is the template design, not a saved generated back side.
            backIsTemplate: !card.back_image_url && !!fallbackBackUrl
        });
        
    } catch (error) {
        console.error('Download ID card error:', error);
        return res.status(500).json({ error: 'Failed to download ID card' });
    }
};

// ===== OWNER DOWNLOAD ID CARD =====
// Same contract as downloadIDCard but scoped for the OWNER role: the card is
// looked up WITHOUT the school isolation filter (the owner can access cards
// of every school) and req.schoolId is undefined on owner routes.
exports.getOwnerIDCardDownload = async (req, res) => {
    try {
        const { id } = req.params;

        const card = await IDCard.findById(id);
        if (!card) {
            return res.status(404).json({ error: 'ID card not found' });
        }

        await IDCard.updateDownloadStatus(id);

        await query(
            'INSERT INTO audit_logs (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
            [req.user.id, 'ID_CARD_DOWNLOADED', JSON.stringify({ card_id: id, by_owner: true }), req.ip]
        );

        // If no generated Back image was saved for this card, fall back to the
        // assigned design's back template so the owner still gets a usable
        // Back side.
        let fallbackBackUrl = null;
        if ((!card.back_image_url || String(card.back_image_url).trim() === '') && card.design_id) {
            const result = await query(
                "SELECT back_template FROM id_designs WHERE id = ? AND back_template IS NOT NULL AND back_template <> ''",
                [card.design_id]
            );
            fallbackBackUrl = result.rows[0]?.back_template || null;
        }

        return res.json({
            success: true,
            card: card,
            downloadUrls: {
                front: card.front_image_url,
                back: card.back_image_url || fallbackBackUrl
            },
            // true => the Back URL above is the template design, not a saved generated back side.
            backIsTemplate: !card.back_image_url && !!fallbackBackUrl
        });

    } catch (error) {
        console.error('Owner download ID card error:', error);
        return res.status(500).json({ error: 'Failed to download ID card' });
    }
};

// ===== DESIGN MANAGEMENT =====
// ===== DESIGN MANAGEMENT =====

// Upload design images
exports.uploadDesignImages = async (req, res) => {
    try {
        const files = req.files;
        
        if (!files || (!files.frontImage && !files.backImage)) {
            return res.status(400).json({ error: 'At least one image is required' });
        }
        
        const uploadedFiles = {};
        
        if (files.frontImage) {
            const frontFile = files.frontImage[0];
            uploadedFiles.frontImageUrl = `/uploads/designs/${frontFile.filename}`;
        }
        
        if (files.backImage) {
            const backFile = files.backImage[0];
            uploadedFiles.backImageUrl = `/uploads/designs/${backFile.filename}`;
        }
        
        return res.json({
            success: true,
            files: uploadedFiles,
            message: 'Design images uploaded successfully'
        });
    } catch (error) {
        console.error('Upload design images error:', error);
        return res.status(500).json({ error: 'Failed to upload design images' });
    }
};

// Create design
exports.createDesign = async (req, res) => {
    try {
        const { name, frontImageUrl, backImageUrl, isGlobal } = req.body;
        
        if (!name || name.trim() === '') {
            return res.status(400).json({ error: 'Design name is required' });
        }
        
        if (!frontImageUrl || frontImageUrl.trim() === '') {
            return res.status(400).json({ error: 'Front image URL is required' });
        }
        
        const designData = {
            name: name.trim(),
            frontTemplate: frontImageUrl.trim(),
            backTemplate: backImageUrl && backImageUrl.trim() ? backImageUrl.trim() : null,
            isGlobal: isGlobal === 'true' || isGlobal === true || isGlobal === 1,
            userId: req.user.id
        };
        
        const design = await Design.create(designData);
        
        if (!design) {
            return res.status(500).json({ error: 'Failed to create design' });
        }
        
        await query(
            'INSERT INTO audit_logs (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
            [req.user.id, 'DESIGN_CREATED', JSON.stringify({ design_id: design.id, name }), req.ip]
        );
        
        return res.status(201).json({
            success: true,
            design: design,
            message: 'Design created successfully'
        });
    } catch (error) {
        console.error('Create design error:', error);
        return res.status(500).json({ 
            error: 'Failed to create design', 
            details: error.message 
        });
    }
};

// Get all designs
exports.getDesigns = async (req, res) => {
    try {
        const { limit = 50, offset = 0, isGlobal = null } = req.query;
        const designs = await Design.findAll({ limit, offset, isGlobal });
        return res.json(designs || []);
    } catch (error) {
        console.error('Get designs error:', error);
        return res.json([]);
    }
};

// Get design details
exports.getDesignDetails = async (req, res) => {
    try {
        const { id } = req.params;
        const design = await Design.findById(id);
        
        if (!design) {
            return res.status(404).json({ error: 'Design not found' });
        }
        
        const schools = await Design.getAssignedSchools(id);
        
        return res.json({
            ...design,
            assigned_schools: schools || [],
            assigned_count: schools?.length || 0
        });
    } catch (error) {
        console.error('Get design details error:', error);
        return res.status(500).json({ error: 'Failed to fetch design details' });
    }
};

// Update design
exports.updateDesign = async (req, res) => {
    try {
        const { id } = req.params;
        const { name, frontImageUrl, backImageUrl } = req.body;
        
        if (!name || name.trim() === '') {
            return res.status(400).json({ error: 'Design name is required' });
        }
        
        const design = await Design.update(id, { 
            name: name.trim(), 
            frontTemplate: frontImageUrl, 
            backTemplate: backImageUrl || null
        });
        
        if (!design) {
            return res.status(404).json({ error: 'Design not found' });
        }
        
        await query(
            'INSERT INTO audit_logs (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
            [req.user.id, 'DESIGN_UPDATED', JSON.stringify({ design_id: id }), req.ip]
        );
        
        return res.json({
            success: true,
            design,
            message: 'Design updated successfully'
        });
    } catch (error) {
        console.error('Update design error:', error);
        return res.status(500).json({ error: 'Failed to update design' });
    }
};

// Update design status
exports.updateDesignStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;
        
        if (!['ACTIVE', 'INACTIVE'].includes(status)) {
            return res.status(400).json({ error: 'Invalid status' });
        }
        
        const design = await Design.updateStatus(id, status);
        
        if (!design) {
            return res.status(404).json({ error: 'Design not found' });
        }
        
        await query(
            'INSERT INTO audit_logs (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
            [req.user.id, 'DESIGN_STATUS_CHANGED', JSON.stringify({ design_id: id, status }), req.ip]
        );
        
        return res.json({
            success: true,
            design,
            message: `Design status updated to ${status}`
        });
    } catch (error) {
        console.error('Update design status error:', error);
        return res.status(500).json({ error: 'Failed to update design status' });
    }
};

// Delete design
exports.deleteDesign = async (req, res) => {
    try {
        const { id } = req.params;
        
        const design = await Design.findById(id);
        if (!design) {
            return res.status(404).json({ error: 'Design not found' });
        }
        
        const used = await Design.isDesignUsed(id);
        if (used) {
            const schools = await Design.getUsingSchools(id);
            return res.status(400).json({ 
                error: 'Cannot delete design: It is currently assigned to one or more schools',
                schools: schools,
                message: `This design is used by ${schools.length} school(s). Please unassign it first.`
            });
        }
        
        const deleted = await Design.hardDelete(id);
        
        if (!deleted) {
            return res.status(500).json({ error: 'Failed to delete design' });
        }
        
        await query(
            'INSERT INTO audit_logs (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
            [req.user.id, 'DESIGN_DELETED', JSON.stringify({ design_id: id, name: design.name }), req.ip]
        );
        
        return res.json({ 
            success: true, 
            message: 'Design deleted successfully' 
        });
    } catch (error) {
        console.error('Delete design error:', error);
        return res.status(500).json({ 
            error: 'Failed to delete design', 
            details: error.message 
        });
    }
};

// Assign design to multiple schools
exports.assignDesignToMultipleSchools = async (req, res) => {
    try {
        const { designId } = req.params;
        const { schoolIds } = req.body;
        
        if (!schoolIds || !Array.isArray(schoolIds) || schoolIds.length === 0) {
            return res.status(400).json({ error: 'Please provide an array of school IDs' });
        }
        
        const design = await Design.findById(designId);
        if (!design) {
            return res.status(404).json({ error: 'Design not found' });
        }
        
        await Design.assignToSchools(designId, schoolIds);
        
        await query(
            'INSERT INTO audit_logs (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
            [req.user.id, 'DESIGN_ASSIGNED_MULTIPLE', JSON.stringify({ design_id: designId, school_ids: schoolIds }), req.ip]
        );
        
        return res.json({ 
            success: true, 
            message: `Design assigned to ${schoolIds.length} school(s) successfully` 
        });
    } catch (error) {
        console.error('Assign design to multiple schools error:', error);
        return res.status(500).json({ error: 'Failed to assign design to schools' });
    }
};

// Assign design to single school
exports.assignDesignToSchool = async (req, res) => {
    try {
        const { designId, schoolId } = req.params;
        
        const design = await Design.findById(designId);
        if (!design) {
            return res.status(404).json({ error: 'Design not found' });
        }
        
        const school = await School.findById(schoolId);
        if (!school) {
            return res.status(404).json({ error: 'School not found' });
        }
        
        await Design.assignToSchool(designId, schoolId);
        
        await query(
            'INSERT INTO audit_logs (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
            [req.user.id, 'DESIGN_ASSIGNED', JSON.stringify({ design_id: designId, school_id: schoolId }), req.ip]
        );
        
        return res.json({ 
            success: true, 
            message: 'Design assigned to school successfully' 
        });
    } catch (error) {
        console.error('Assign design error:', error);
        return res.status(500).json({ error: 'Failed to assign design' });
    }
};

// Remove design from school
exports.removeDesignFromSchool = async (req, res) => {
    try {
        const { designId, schoolId } = req.params;
        
        await Design.removeFromSchool(designId, schoolId);
        
        await query(
            'INSERT INTO audit_logs (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
            [req.user.id, 'DESIGN_UNASSIGNED', JSON.stringify({ design_id: designId, school_id: schoolId }), req.ip]
        );
        
        return res.json({ 
            success: true, 
            message: 'Design removed from school successfully' 
        });
    } catch (error) {
        console.error('Remove design error:', error);
        return res.status(500).json({ error: 'Failed to remove design' });
    }
};

// Get designs for a school
exports.getSchoolDesigns = async (req, res) => {
    try {
        const { schoolId } = req.params;
        
        const designs = await Design.getSchoolDesigns(schoolId);
        return res.json(designs || []);
    } catch (error) {
        console.error('Get school designs error:', error);
        return res.json([]);
    }
};

// ===== ID CARD MANAGEMENT (Owner) =====

// Get all ID cards
exports.getAllIDCards = async (req, res) => {
    try {
        const { limit = 50, offset = 0, schoolId = null, status = null, search = null } = req.query;

        let queryText = `
            SELECT 
                ic.id,
                ic.school_id,
                ic.student_id,
                ic.design_id,
                ic.card_number,
                ic.status,
                ic.generated_by,
                ic.generated_at,
                ic.downloaded_at,
                CASE WHEN ic.front_image_url IS NOT NULL AND ic.front_image_url <> '' THEN 1 ELSE 0 END AS has_front_image,
                CASE WHEN ic.back_image_url  IS NOT NULL AND ic.back_image_url  <> '' THEN 1 ELSE 0 END AS has_back_image,
                s.name as school_name,
                st.name as student_name,
                st.admission_number,
                d.name as design_name,
                u.email as generated_by_email
            FROM id_cards ic
            JOIN schools s ON ic.school_id = s.id
            JOIN students st ON ic.student_id = st.id
            LEFT JOIN id_designs d ON ic.design_id = d.id
            LEFT JOIN users u ON ic.generated_by = u.id
            WHERE 1=1
        `;
        
        const params = [];
        
        if (schoolId) {
            queryText += ' AND ic.school_id = ?';
            params.push(schoolId);
        }
        
        if (status) {
            queryText += ' AND ic.status = ?';
            params.push(status);
        }
        
        if (search) {
            queryText += ' AND (st.name LIKE ? OR st.admission_number LIKE ?)';
            params.push(`%${search}%`, `%${search}%`);
        }
        
        queryText += ' ORDER BY ic.generated_at DESC LIMIT ? OFFSET ?';
        params.push(parseInt(limit), parseInt(offset));
        
        const result = await query(queryText, params);
        
        return res.json({
            data: result.rows || [],
            pagination: {
                limit: parseInt(limit),
                offset: parseInt(offset),
                total: result.rows?.length || 0
            }
        });
    } catch (error) {
        console.error('Get all ID cards error:', error);
        return res.json({ data: [], pagination: { limit: 50, offset: 0, total: 0 } });
    }
};

// Get ID card details
exports.getIDCardDetails = async (req, res) => {
    try {
        const { id } = req.params;
        
        const result = await query(
            `SELECT 
                ic.*,
                s.name as school_name,
                st.name as student_name,
                st.father_name,
                st.class,
                st.section,
                st.admission_number,
                st.phone,
                st.address,
                d.name as design_name,
                u.email as generated_by_email
            FROM id_cards ic
            JOIN schools s ON ic.school_id = s.id
            JOIN students st ON ic.student_id = st.id
            LEFT JOIN id_designs d ON ic.design_id = d.id
            LEFT JOIN users u ON ic.generated_by = u.id
            WHERE ic.id = ?`,
            [id]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'ID card not found' });
        }
        
        return res.json(result.rows[0]);
    } catch (error) {
        console.error('Get ID card details error:', error);
        return res.status(500).json({ error: 'Failed to fetch ID card details' });
    }
};

// Get ID cards by school
exports.getIDCardsBySchool = async (req, res) => {
    try {
        const { schoolId } = req.params;
        const { limit = 50, offset = 0 } = req.query;
        
        const school = await School.findById(schoolId);
        if (!school) {
            return res.status(404).json({ error: 'School not found' });
        }
        
        const result = await query(
            `SELECT ic.*, st.name as student_name, st.admission_number, d.name as design_name
             FROM id_cards ic
             JOIN students st ON ic.student_id = st.id
             LEFT JOIN id_designs d ON ic.design_id = d.id
             WHERE ic.school_id = ?
             ORDER BY ic.generated_at DESC
             LIMIT ? OFFSET ?`,
            [schoolId, parseInt(limit), parseInt(offset)]
        );
        
        return res.json({
            school: school,
            data: result.rows || [],
            pagination: {
                limit: parseInt(limit),
                offset: parseInt(offset),
                total: result.rows?.length || 0
            }
        });
    } catch (error) {
        console.error('Get ID cards by school error:', error);
        return res.status(500).json({ error: 'Failed to fetch school ID cards' });
    }
};

// Update ID card status
exports.updateIDCardStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;
        
        if (!['ACTIVE', 'INACTIVE', 'REVOKED'].includes(status)) {
            return res.status(400).json({ error: 'Invalid status' });
        }
        
        const result = await query(
            'UPDATE id_cards SET status = ? WHERE id = ?',
            [status, id]
        );
        
        if (result.rows.affectedRows === 0) {
            return res.status(404).json({ error: 'ID card not found' });
        }
        
        await query(
            'INSERT INTO audit_logs (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
            [req.user.id, 'ID_CARD_STATUS_UPDATED', JSON.stringify({ card_id: id, status }), req.ip]
        );
        
        return res.json({ 
            success: true, 
            message: `ID card status updated to ${status}` 
        });
    } catch (error) {
        console.error('Update ID card status error:', error);
        return res.status(500).json({ error: 'Failed to update ID card status' });
    }
};

// Delete ID card
exports.deleteIDCard = async (req, res) => {
    try {
        const { id } = req.params;
        
        await query(
            'UPDATE id_cards SET status = ? WHERE id = ?',
            ['INACTIVE', id]
        );
        
        await query(
            'INSERT INTO audit_logs (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
            [req.user.id, 'ID_CARD_DELETED', JSON.stringify({ card_id: id }), req.ip]
        );
        
        return res.json({ 
            success: true, 
            message: 'ID card deleted successfully' 
        });
    } catch (error) {
        console.error('Delete ID card error:', error);
        return res.status(500).json({ error: 'Failed to delete ID card' });
    }
};

// Get ID card statistics
exports.getIDCardStats = async (req, res) => {
    try {
        const { schoolId = null } = req.query;
        
        let queryText = `
            SELECT 
                COUNT(*) as total_cards,
                COUNT(DISTINCT student_id) as unique_students,
                COUNT(DISTINCT school_id) as total_schools
            FROM id_cards
            WHERE 1=1
        `;
        
        const params = [];
        
        if (schoolId) {
            queryText += ' AND school_id = ?';
            params.push(schoolId);
        }
        
        const result = await query(queryText, params);
        
        return res.json({
            summary: result.rows[0] || {
                total_cards: 0,
                unique_students: 0,
                total_schools: 0
            }
        });
    } catch (error) {
        console.error('Get ID card stats error:', error);
        return res.json({ summary: { total_cards: 0, unique_students: 0, total_schools: 0 } });
    }
};
