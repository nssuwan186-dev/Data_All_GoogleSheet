// lib/db.ts
import mysql from 'mysql2/promise';

const pool = mysql.createPool({
  host: 'gateway01.ap-southeast-1.prod.aws.tidbcloud.com',
  port: 4000,
  user: '2c5pzkZKRXuXxZs.root',
  password: 'sEG1tCFcq7DbJ6Lo',
  database: 'test', // Using the 'test' database as per the new connection string
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  ssl: {
    rejectUnauthorized: true, // Enable SSL and reject unauthorized certificates
    // If you encounter issues, you might need to provide a 'ca' property here
    // e.g., ca: fs.readFileSync('/path/to/your/ca.pem')
  }
});

export default pool;
