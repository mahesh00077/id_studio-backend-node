// E2E smoke test against the real DB + running server (INT auto-increment schema)
const BASE = 'http://localhost:5000/api';
const fs = require('fs');
const path = require('path');

async function main() {
    // 1) login as owner
    let r = await fetch(BASE + '/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'owner@schoolidstudio.com', password: 'admin123' })
    });
    const login = await r.json();
    console.log('login:', r.status, login.token ? 'token-ok role=' + (login.user?.role || login.role) : JSON.stringify(login));
    const token = login.token;
    if (!token) throw new Error('no token');
    const H = { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' };

    // 2) current schools (owner scope)
    r = await fetch(BASE + '/owner/schools', { headers: H });
    const schools = await r.json();
    console.log('schools:', r.status, Array.isArray(schools) ? schools.map(s => ({ id: s.id, code: s.school_code, credits: s.credit_balance })) : schools);
    const school = schools[0];
    if (!school) throw new Error('no school');

    // 3) create a design (owner scope)
    r = await fetch(BASE + '/owner/designs', {
        method: 'POST', headers: H,
        body: JSON.stringify({
            name: 'Smoke Design INT',
            frontTemplate: { width: 340, height: 214, background: '#ffffff', fields: [] },
            backTemplate: { width: 340, height: 214, background: '#f5f5f5', fields: [] },
            isGlobal: true
        })
    });
    const design = await r.json();
    console.log('create design:', r.status, design.id ?? design);

    // 4) create a student (with a tiny valid JPEG photo data URL)
    const tinyJpegB64 = fs.readFileSync(path.join(__dirname, '_tiny.b64'), 'utf8').trim();
    r = await fetch(BASE + '/school-admin/students', {
        method: 'POST', headers: H,
        body: JSON.stringify({
            schoolId: school.id, name: 'Smoke Student INT', class: '10', section: 'A',
            admissionNumber: 'SMK-INT-1', photo: 'data:image/jpeg;base64,' + tinyJpegB64
        })
    });
    const student = await r.json();
    console.log('create student:', r.status, student.id ?? student, student.photo_url ?? '');

    // 5) generate the ID card via the SAME endpoint the frontend uses
    const frontDataUrl = 'data:image/jpeg;base64,' + tinyJpegB64;
    r = await fetch(BASE + '/school-admin/id-cards/generate', {
        method: 'POST', headers: H,
        body: JSON.stringify({
            studentId: student.id, designId: design.id,
            frontImage: frontDataUrl, backImage: frontDataUrl,
            photo: frontDataUrl
        })
    });
    const card = await r.json();
    console.log('generate card:', r.status, JSON.stringify({
        id: card.card?.id ?? card.id,
        card_number: card.card?.card_number ?? card.cardNumber,
        front_image_url: card.card?.front_image_url ?? card.frontImageUrl,
        back_image_url: card.card?.back_image_url ?? card.backImageUrl,
        downloadUrls: card.downloadUrls
    }));

    if (card.card) {
        const fu = path.join(__dirname, '..', 'uploads', card.card.front_image_url.replace('/uploads/', ''));
        const bu = path.join(__dirname, '..', 'uploads', card.card.back_image_url.replace('/uploads/', ''));
        console.log('front file exists:', fs.existsSync(fu), fs.existsSync(fu) && fs.statSync(fu).size);
        console.log('back  file exists:', fs.existsSync(bu), fs.existsSync(bu) && fs.statSync(bu).size);
        const b64 = v => v.startsWith('data:image');
        console.log('urls are NOT base64:', !b64(card.card.front_image_url) && !b64(card.card.back_image_url));
        console.log('ids are ints:', Number.isInteger(+String(student.id)) , Number.isInteger(+String(card.card.id)));
    }
}
main().catch(e => { console.error('E2E FAIL:', e.message); process.exit(1); });
