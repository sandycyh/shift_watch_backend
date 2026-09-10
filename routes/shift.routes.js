import { Router } from 'express';
import { getShift } from '../db.js';

const router = Router();

// router.get('/:date/:shift', (req, res) => {
//   res.json([
//     {
//       ward_name: 'Ward 1',
//       shift_type: req.params.shift,
//       planned_staff: 8,
//       actual_staff: 6
//     }
//   ]);
// });


router.get('/:date/:shift', async (req, res) => {
  try {
    const { date, shift } = req.params;
    const Shifts = await getShift(date, shift);
    res.json(Shifts);
  } catch (err) {
    console.error('DB query error', err);
    res.status(500).json({ message: 'Database error' });
  }
})

export default router; 
