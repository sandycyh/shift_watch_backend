import sql from 'mssql';
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const config = {
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    server: process.env.DB_SERVER,
    database: process.env.DB_DATABASE,
    port: process.env.DB_PORT ? Number(process.env.DB_PORT) : undefined,
    options: {
        trustServerCertificate: process.env.DB_TRUST_CERT === 'true',
    }
};

const pool = new sql.ConnectionPool(config)
const poolConnect = pool.connect().then(() => pool);

pool.on('error', err => {
    console.error('SQL Pool Error', err);
});

export async function query(sqlText, params = {}) {
    const p = await poolConnect;
    const request = p.request();
    for (const [name, value] of Object.entries(params)) {
        request.input(name, value);
    }
    const result = await request.query(sqlText);
    return result.recordset;
}

export async function getPool() {
    if (pool) return pool;
    try {
        pool = await sql.connect(dbConfig);
        console.log('Connected to SQL');
        return pool;
    } catch (err) {
        console.error('SQL connection error:', err);
        pool = null;
        throw err;
    }
}

export async function getShift() {
    try {
        const pool = await getPool();
        const result = await pool.request()
            .query(`USE staffing_data
                    SELECT  w.ward_name, s.shift_date, s.shift_type, sr.RN_count, 
		                    sr.EN_count, sr.AIN_count, sr.permanent_count, 
                            sr.planned_staff, sr.actual_staff, sr.NUM_present
                    FROM SHIFT as s 
                    JOIN Staffing_Record AS sr 
                    ON s.id = sr.shift_id
                    JOIN Ward as w
                    ON s.ward_id = w.id`);
        return result.recordset;
    } catch (error) {
        console.error(error.message);
    }
}

export async function close() {
    const p = await poolConnect;
    await p.close();
}