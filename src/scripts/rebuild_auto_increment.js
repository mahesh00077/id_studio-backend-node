// ============================================================================
// Migration: convert all primary keys to INT AUTO_INCREMENT
// ----------------------------------------------------------------------------
// Steps per the requirement:
//   1) Drop ALL foreign-key constraints.
//   2) Drop all non-PRIMARY keys/indexes.
//   3) Rebuild every table's `id` (first column) as INT AUTO_INCREMENT PRIMARY KEY.
//   4) Truncate (wipe) all tables.
//   5) Recreate the unique/business indexes and foreign-key constraints
//      (the "add again constraints" part), so referential integrity is
//      preserved going forward.
//
// DANGER: TRUNCATE wipes all existing rows. This is intentional per the
// requirement ("truncate all table").
// Run once:  node src/scripts/rebuild_auto_increment.js
// ============================================================================
const mysql = require('mysql2/promise');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const DB = process.env.DB_NAME;

(async () => {
    const conn = await mysql.createConnection({
        host: process.env.DB_HOST,
        port: parseInt(process.env.DB_PORT) || 4306,
        database: DB,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        multipleStatements: true
    });

    console.log('== 1) Dropping foreign keys ==');
    const [fks] = await conn.query(
        "SELECT TABLE_NAME, CONSTRAINT_NAME FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = ?",
        [DB]
    );
    for (const fk of fks) {
        await conn.query('ALTER TABLE `' + fk.TABLE_NAME + '` DROP FOREIGN KEY `' + fk.CONSTRAINT_NAME + '`');
        console.log('  dropped FK', fk.TABLE_NAME + '.' + fk.CONSTRAINT_NAME);
    }

    console.log('== 2) Dropping non-primary keys/indexes ==');
    const [idx] = await conn.query(
        'SELECT TABLE_NAME, INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? AND INDEX_NAME <> "PRIMARY" GROUP BY TABLE_NAME, INDEX_NAME',
        [DB]
    );
    for (const i of idx) {
        await conn.query('ALTER TABLE `' + i.TABLE_NAME + '` DROP INDEX `' + i.INDEX_NAME + '`');
        console.log('  dropped index', i.TABLE_NAME + '.' + i.INDEX_NAME);
    }
console.log('== 3) Truncating all tables (wipe UUID data before converting PKs) ==');
    await conn.query('SET FOREIGN_KEY_CHECKS = 0');
    const tables = [
        'users', 'schools', 'students', 'id_designs', 'id_design_fields',
        'school_designs', 'school_users', 'credit_transactions', 'audit_logs', 'id_cards'
    ];
    for (const t of tables) {
        await conn.query('TRUNCATE TABLE `' + t + '`');
        console.log('  truncated', t);
    }

    console.log('== 4) Rebuilding PKs and FK columns as INT ==');
    // Which tables currently have a single-column PRIMARY KEY on `id`?
    const pkOf = {};
    {
        const [pks] = await conn.query(
            "SELECT TABLE_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_SCHEMA=? AND CONSTRAINT_NAME='PRIMARY' AND COLUMN_NAME='id' AND ORDINAL_POSITION=1",
            [DB]
        );
        pks.forEach(r => { pkOf[r.TABLE_NAME] = true; });
    }
    for (const t of tables) {
        // a) Detach existing PK so column types can change freely (students.id has none right now)
        if (pkOf[t]) {
            await conn.query('ALTER TABLE `' + t + '` DROP PRIMARY KEY');
            console.log('  dropped old PK', t);
        }
        // b) Force `id` to INT UNSIGNED NOT NULL
        await conn.query('ALTER TABLE `' + t + '` MODIFY `id` INT UNSIGNED NOT NULL');
        console.log('  converted id -> INT UNSIGNED', t);
        // c) Convert remaining CHAR(36) FK columns (must become INT to match re-added constraints)
        const [uuidCols] = await conn.query(
            "SELECT COLUMN_NAME, IS_NULLABLE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND COLUMN_TYPE='char(36)' AND ORDINAL_POSITION > 1",
            [DB, t]
        );
        for (const col of uuidCols) {
            const nn = col.IS_NULLABLE === 'NO' ? 'NOT NULL' : 'NULL';
            await conn.query('ALTER TABLE `' + t + '` MODIFY `' + col.COLUMN_NAME + '` INT UNSIGNED ' + nn);
            console.log('  converted', t + '.' + col.COLUMN_NAME, '-> INT UNSIGNED', nn);
        }
        // d) Add PRIMARY KEY, then enable AUTO_INCREMENT
        await conn.query('ALTER TABLE `' + t + '` ADD PRIMARY KEY (`id`)');
        await conn.query('ALTER TABLE `' + t + '` MODIFY `id` INT UNSIGNED NOT NULL AUTO_INCREMENT');
        console.log('  rebuilt PK (INT AUTO_INCREMENT) for', t);
    }
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');

    console.log('== 5) Re-adding unique indexes ==');
    await conn.query('ALTER TABLE `users` ADD UNIQUE INDEX `uq_users_email` (`email`)');
    await conn.query('ALTER TABLE `students` ADD UNIQUE INDEX `uq_students_admission_number` (`admission_number`)');
    await conn.query('ALTER TABLE `id_cards` ADD UNIQUE INDEX `uq_id_cards_card_number` (`card_number`)');

    console.log('== 6) Re-adding foreign keys ==');
    await conn.query('ALTER TABLE `students` ADD CONSTRAINT `fk_students_school` FOREIGN KEY (`school_id`) REFERENCES `schools`(`id`)');
    await conn.query('ALTER TABLE `school_users` ADD CONSTRAINT `fk_school_users_user` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`)');
    await conn.query('ALTER TABLE `school_users` ADD CONSTRAINT `fk_school_users_school` FOREIGN KEY (`school_id`) REFERENCES `schools`(`id`)');
    await conn.query('ALTER TABLE `credit_transactions` ADD CONSTRAINT `fk_ct_school` FOREIGN KEY (`school_id`) REFERENCES `schools`(`id`)');
    await conn.query('ALTER TABLE `credit_transactions` ADD CONSTRAINT `fk_ct_created_by` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`)');
    await conn.query('ALTER TABLE `id_designs` ADD CONSTRAINT `fk_designs_created_by` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`)');
    await conn.query('ALTER TABLE `id_design_fields` ADD CONSTRAINT `fk_design_fields_design` FOREIGN KEY (`design_id`) REFERENCES `id_designs`(`id`)');
    await conn.query('ALTER TABLE `school_designs` ADD CONSTRAINT `fk_school_designs_school` FOREIGN KEY (`school_id`) REFERENCES `schools`(`id`)');
    await conn.query('ALTER TABLE `school_designs` ADD CONSTRAINT `fk_school_designs_design` FOREIGN KEY (`design_id`) REFERENCES `id_designs`(`id`)');
    await conn.query('ALTER TABLE `id_cards` ADD CONSTRAINT `fk_id_cards_school` FOREIGN KEY (`school_id`) REFERENCES `schools`(`id`)');
    await conn.query('ALTER TABLE `id_cards` ADD CONSTRAINT `fk_id_cards_student` FOREIGN KEY (`student_id`) REFERENCES `students`(`id`)');
    await conn.query('ALTER TABLE `id_cards` ADD CONSTRAINT `fk_id_cards_design` FOREIGN KEY (`design_id`) REFERENCES `id_designs`(`id`)');
    await conn.query('ALTER TABLE `id_cards` ADD CONSTRAINT `fk_id_cards_generated_by` FOREIGN KEY (`generated_by`) REFERENCES `users`(`id`)');
    await conn.query('ALTER TABLE `audit_logs` ADD CONSTRAINT `fk_audit_logs_user` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`)');
    console.log('  re-added 14 foreign keys');

    await conn.end();
    console.log('✅ Migration complete: all PKs are INT AUTO_INCREMENT, tables truncated, constraints restored.');
})().catch(e => {
    console.error('❌ Migration failed:', e.message);
    process.exit(1);
});