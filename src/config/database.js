const mysql = require('mysql2/promise');
require('dotenv').config();

// Create connection pool
const pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 3306,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    waitForConnections: true,
    connectionLimit: 20,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0
});

// Test connection
(async () => {
    try {
        const connection = await pool.getConnection();
        console.log('✅ MySQL Database connected successfully');
        connection.release();
    } catch (err) {
        console.error('❌ Database connection error:', err.message);
    }
})();

module.exports = {
    query: async (text, params) => {
        const [rows] = await pool.execute(text, params);
        return { rows };
    },
    pool,
    // Transaction helper
    transaction: async (callback) => {
        const connection = await pool.getConnection();
        await connection.beginTransaction();
        try {
            const result = await callback(connection);
            await connection.commit();
            return result;
        } catch (e) {
            await connection.rollback();
            throw e;
        } finally {
            connection.release();
        }
    },
    // Helper to get connection for transactions
    getConnection: async () => {
        return await pool.getConnection();
    }
};