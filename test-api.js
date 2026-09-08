const axios = require('axios');
const BASE_URL = 'http://localhost:5000/api';

async function test() {
    try {
        console.log('=====================================');
        console.log('School ID Studio - API Test');
        console.log('=====================================\n');

        // 1. Login as Owner
        console.log('1. Logging in as Owner...');
        const loginResponse = await axios.post(`${BASE_URL}/auth/login`, {
            email: 'owner@schoolidstudio.com',
            password: 'admin123'
        });

        const ownerToken = loginResponse.data.token;
        console.log('✅ Owner logged in successfully');
        console.log(`   Token: ${ownerToken.substring(0, 30)}...\n`);

        // 2. Get or Create School
        console.log('2. Getting schools...');
        let schoolsResponse = await axios.get(`${BASE_URL}/owner/schools`, {
            headers: { Authorization: `Bearer ${ownerToken}` }
        });

        let schoolId;
        if (schoolsResponse.data.length === 0) {
            console.log('   No schools found. Creating one...');
            const createSchool = await axios.post(`${BASE_URL}/owner/schools`, {
                name: 'ABC International School',
                address: '123 Education Street, City',
                phone: '1234567890',
                email: 'contact@abcschool.com'
            }, {
                headers: { Authorization: `Bearer ${ownerToken}` }
            });
            schoolId = createSchool.data.id;
            console.log(`✅ Created school with ID: ${schoolId}\n`);
        } else {
            schoolId = schoolsResponse.data[0].id;
            console.log(`✅ Found school with ID: ${schoolId}\n`);
        }

        // 3. Add Credits
        console.log('3. Adding credits to school...');
        await axios.post(`${BASE_URL}/owner/schools/${schoolId}/credits`, {
            amount: 1000,
            reason: 'Initial credits'
        }, {
            headers: { Authorization: `Bearer ${ownerToken}` }
        });
        console.log('✅ Added 1000 credits to school\n');

        // 4. Create School Admin
        console.log('4. Creating School Admin...');
        const adminEmail = `admin${Date.now()}@abcschool.com`;
        const adminResponse = await axios.post(`${BASE_URL}/owner/users/admin`, {
            email: adminEmail,
            password: 'admin123',
            schoolId: schoolId
        }, {
            headers: { Authorization: `Bearer ${ownerToken}` }
        });
        console.log(`✅ School Admin created: ${adminEmail}\n`);

        // 5. Login as School Admin
        console.log('5. Logging in as School Admin...');
        const adminLogin = await axios.post(`${BASE_URL}/auth/login`, {
            email: adminEmail,
            password: 'admin123'
        });
        const adminToken = adminLogin.data.token;
        console.log('✅ School Admin logged in successfully\n');

        // 6. Create Student
        console.log('6. Creating a student...');
        const student = await axios.post(`${BASE_URL}/school-admin/students`, {
            name: 'John Doe',
            fatherName: 'Jane Doe',
            phone: '1234567890',
            address: '123 Student Street',
            class: '10',
            section: 'A',
            admissionNumber: `2024${Date.now().toString().slice(-4)}`
        }, {
            headers: { Authorization: `Bearer ${adminToken}` }
        });
        console.log(`✅ Student created: ${student.data.name} (${student.data.admission_number})\n`);

        // 7. Get All Students
        console.log('7. Getting all students...');
        const students = await axios.get(`${BASE_URL}/school-admin/students`, {
            headers: { Authorization: `Bearer ${adminToken}` }
        });
        console.log(`✅ Total students: ${students.data.length}\n`);

        // 8. Check Credit Balance
        console.log('8. Checking credit balance...');
        const balance = await axios.get(`${BASE_URL}/school-admin/credits/balance`, {
            headers: { Authorization: `Bearer ${adminToken}` }
        });
        console.log(`✅ Available credits: ${balance.data.balance}\n`);

        // 9. Platform Stats (Owner only)
        console.log('9. Getting platform stats...');
        const stats = await axios.get(`${BASE_URL}/owner/platform/stats`, {
            headers: { Authorization: `Bearer ${ownerToken}` }
        });
        console.log('✅ Platform Statistics:');
        console.log(`   Total Schools: ${stats.data.total_schools}`);
        console.log(`   Total Users: ${stats.data.total_users}`);
        console.log(`   Total Students: ${stats.data.total_students}`);
        console.log(`   Total ID Cards: ${stats.data.total_cards}`);
        console.log(`   Total Credits: ${stats.data.total_credits}\n`);

        console.log('=====================================');
        console.log('✅ All tests passed!');
        console.log('=====================================');
        console.log('\n📋 Summary:');
        console.log(`   Owner: owner@schoolidstudio.com / admin123`);
        console.log(`   School Admin: ${adminEmail} / admin123`);
        console.log(`   School ID: ${schoolId}`);
        console.log(`   Credits: 1000`);

    } catch (error) {
        console.error('\n❌ Error:', error.response?.data || error.message);
        if (error.response) {
            console.error('   Status:', error.response.status);
            console.error('   Data:', error.response.data);
        }
    }
}

test();