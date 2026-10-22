import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { query } from './db.js';

import getShiftRoutes from './routes/shift.routes.js'
dotenv.config();

const app = express();
const PORT = process.env.PORT || 4001;
console.log('[DIAGNOSTIC] process.env.PORT =', process.env.PORT);
let databaseReady = false;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

console.log('[STARTUP] server.js is loading');

app.get('/', (req, res) => {
  res.send('API is alive');
});

app.use('/api/shift', getShiftRoutes)

app.get('/api/health', (req, res) => {
  res.status(databaseReady ? 200 : 503).json({
    status: databaseReady ? 'ok' : 'unavailable',
    message: databaseReady ? 'Backend and database are running' : 'Backend is running but database is unavailable',
  });
});


app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({
      message: 'API endpoint not found'
    });
  }

  return res.status(404).send('Not found');
});

console.log('[STARTUP] About to start Express');

async function start() {
  app.listen(PORT, () => {
    console.log('[STARTUP] Express is listening');
    console.log(`Backend listening on port ${PORT}`);
  });

  try {
    await query('SELECT 1 AS ok');
    databaseReady = true;
    console.log('Database connection established');
  } catch (err) {
    console.error('Database connection failed; HTTP server remains available:', err);
  }
}

start();
