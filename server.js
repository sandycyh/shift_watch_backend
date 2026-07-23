import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { query } from './db.js'; 
import { getPool } from './db.js';

import getShiftRoutes from './routes/shift.routes.js'
dotenv.config();

const app = express();
const PORT = process.env.PORT;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/', (req, res) => {
  res.send('API is alive');
});

app.use('/api/shift', getShiftRoutes)

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Staff record backend is running' });
});

app.get('/api/record', async (req, res) => {
  try{
    const rows = await query('SELECT * FROM Staffing_Record'); 
    res.json(rows);
  } catch (err) { 
    console.error('DB query error', err ); 
    res.status(500).json({ message: 'Database error' });
  }
})


app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ message: 'API endpoint not found' });
  }
});

async function start() {
  try {
    // The import of ./db.js already starts pool.connect(); awaiting a quick test query ensures connectivity
    await query('SELECT 1 AS ok');
    app.listen(PORT, () => {
      console.log(`Backend listening on http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error('Failed to connect to DB:', err);
    process.exit(1);
  }
}

start();