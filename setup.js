const bcrypt = require('bcrypt');
const mysql = require('mysql2/promise');
require('dotenv').config();

async function setup() {
    try {
        // Generate hash
        const password = 'admin123';
        const hash = await bcrypt.hash(password, 10);
        console.log('✅ Generated hash for admin123:', hash);

        // Connect to database
        const connection = await mysql.createConnection({
            host: process.env.DB_HOST || 'localhost',
            port: process.env.DB_PORT || 3306,
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD || '',
            database: process.env.DB_NAME || 'school_id_studio'
        });

        console.log('✅ Connected to database');

        // Check if owner exists
        const [existing] = await connection.execute(
            'SELECT id FROM users WHERE email = ?',
            ['owner@schoolidstudio.com']
        );

        let ownerId;
        if (existing.length > 0) {
            // Update existing user
            await connection.execute(
                'UPDATE users SET password_hash = ? WHERE email = ?',
                [hash, 'owner@schoolidstudio.com']
            );
            const [user] = await connection.execute(
                'SELECT id FROM users WHERE email = ?',
                ['owner@schoolidstudio.com']
            );
            ownerId = user[0].id;
            console.log('✅ Updated owner password');
        } else {
            // Insert new user
            const [insertRes] = await connection.execute(
                'INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)',
                ['owner@schoolidstudio.com', hash, 'OWNER']
            );
            ownerId = insertRes.insertId;
            console.log('✅ Created new owner user');
        }

        console.log('\n📋 Login Credentials:');
        console.log('   Email: owner@schoolidstudio.com');
        console.log('   Password: admin123');
        console.log(`   Hash: ${hash}`);

        // Optionally create a sample school
        const [schools] = await connection.execute(
            'SELECT id FROM schools LIMIT 1'
        );

        if (schools.length === 0) {
            await connection.execute(
                `INSERT INTO schools (name, address, phone, email, status, credit_balance)
                 VALUES ('Demo School', '123 Demo Street', '1234567890', 'demo@school.com', 'ACTIVE', 1000)`
            );
            console.log('✅ Created demo school with 1000 credits');
        }

        await connection.end();
        console.log('\n✅ Setup complete!');
        console.log('\n🔑 Test Login:');
        console.log('curl -X POST http://localhost:5000/api/auth/login \\');
        console.log('  -H "Content-Type: application/json" \\');
        console.log('  -d \'{"email":"owner@schoolidstudio.com","password":"admin123"}\'');

    } catch (error) {
        console.error('❌ Setup error:', error);
    }
}

setup();