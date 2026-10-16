import { Router } from 'express';
import { createShiftRecord, getShift, getWeeklyReportData, updateShiftRecord } from '../services/shiftService.js';

const router = Router();

router.post('/', async (req, res) => {
  try {
    const created = await createShiftRecord(req.body || {});
    res.status(201).json({
      success: true,
      message: 'Shift saved successfully',
      data: created,
    });
  } catch (err) {
    console.error('DB insert error', err);
    res.status(500).json({ message: 'Failed to save shift', error: err.message });
  }
});

router.get('/reports/:week', async (req, res) => {
  try {
    const data = await getWeeklyReportData(req.params.week);
    res.json(data ?? []);
  } catch (err) {
    console.error('Weekly report fetch error', err);
    res.status(500).json({ message: 'Database error' });
  }
});

router.put('/:date/:shift', async (req, res) => {
  try {
    const updated = await updateShiftRecord(req.params.date, req.params.shift, req.body || {});
    if (!updated) {
      return res.status(404).json({ message: 'Shift record not found' });
    }

    return res.json({ success: true, message: 'Shift updated successfully' });
  } catch (err) {
    console.error('DB update error', err);
    return res.status(500).json({ message: 'Failed to update shift', error: err.message });
  }
});

router.get('/:date/:shift', async (req, res) => {
  try {
    const { date, shift } = req.params;
    const shifts = await getShift(date, shift);
    res.json(shifts ?? null);
  } catch (err) {
    console.error('DB query error', err);
    res.status(500).json({ message: 'Database error' });
  }
});

export default router;
