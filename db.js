import sql from 'mssql'; 
import express from 'express'; 
import cors from 'cors';
import dotenv from 'dotenv'; 
dotenv.config();

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

export async function close() {
    const p = await poolConnect; 
    await p.close(); 
}