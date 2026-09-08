// ============================================================================
// Migration: add `school_code` to schools (used for per-school id-cards folder)
// Run once:  node src/scripts/add_school_code.js
// ============================================================================
const mysql = require('mysql2/promise');
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

function buildCode(name, id) {
    const base = String(name || 'SCH').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4) || 'SCH';
    const suffix = parseInt((id || '').replace(/[^0-9]/g, '').slice(0, 3), 10) || 1;
    return `${base}${(suffix % 90) + 10}`;
}

(async () => {
    const conn = await mysql.createConnection({
        host: process.env.DB_HOST,
        port: process.env.DB_PORT || 3306,
        database: process.env.DB_NAME,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD
    });

    // Ensure the column exists
    const [cols] = await conn.query("SHOW COLUMNS FROM schools LIKE 'school_code'");
    if (cols.length === 0) {
        await conn.query("ALTER TABLE schools ADD COLUMN school_code VARCHAR(50) NULL AFTER id");
        console.log('✅ Added school_code column');
    } else {
        console.log('ℹ️  school_code column already exists');
    }

    // Backfill rows that lack a code, guaranteeing uniqueness.
    const [rows] = await conn.query("SELECT id, name, school_code FROM schools");
    const used = new Set(rows.filter(r => r.school_code).map(r => String(r.school_code)));
    for (const r of rows) {
        if (r.school_code) continue;
        let candidate = buildCode(r.name, r.id);
        let i = 1;
        while (used.has(candidate)) {
            candidate = buildCode(r.name, r.id) + (i++).toString().padStart(2, '0');
        }
        used.add(candidate);
        await conn.query("UPDATE schools SET school_code = ? WHERE id = ?", [candidate, r.id]);
        console.log(`   ${r.name} -> ${candidate}`);
    }

    await conn.end();
    console.log('✅ School code migration complete');
})().catch(e => { console.error('❌ Migration failed:', e.message); process.exit(1); });