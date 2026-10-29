import sql from 'mssql';
import { getPool } from '../db.js';

function toInt(value, fallback = 0) {
  const numericValue = Number(String(value ?? '').replace(/\s+/g, ''));
  return Number.isFinite(numericValue) ? Math.trunc(numericValue) : fallback;
}

function toNullableInt(value) {
  const normalizedValue = String(value ?? '').replace(/\s+/g, '');
  if (normalizedValue === '') {
    return null;
  }

  const numericValue = Number(normalizedValue);
  return Number.isFinite(numericValue) ? Math.trunc(numericValue) : null;
}

function toFlagInt(value) {
  return ['yes', '1', 'true'].includes(String(value ?? '').toLowerCase()) ? 1 : 0;
}

function toYesNo(value) {
  return toFlagInt(value) ? 'Yes' : 'No';
}

function formatSqlDate(value) {
  const raw = String(value ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return new Date().toISOString().slice(0, 10);
  }
  return raw;
}

function getIsoWeekRange(weekValue) {
  if (!weekValue || !/^\d{4}-W\d{2}$/.test(weekValue)) {
    return null;
  }

  const [yearText, weekText] = weekValue.split('-W');
  const year = Number(yearText);
  const week = Number(weekText);

  if (!year || !week) {
    return null;
  }

  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4day = jan4.getUTCDay() || 7;
  const firstMonday = new Date(Date.UTC(year, 0, 4 - jan4day + 1));

  const start = new Date(firstMonday);
  start.setUTCDate(start.getUTCDate() + (week - 1) * 7);

  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 6);

  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  };
}

export async function getShift(shiftDate, shiftType) {
  const pool = await getPool();
  const result = await pool.request()
    .input('shift_date', sql.Date, shiftDate)
    .input('shift_type', sql.VarChar, shiftType)
    .query(`SELECT
        w.ward_name, s.shift_date, s.shift_type,
        sr.RN_count, sr.EN_count, sr.AIN_count,
        sr.permanent_count, sr.casual_agency_count,
        sr.IPS_planned, sr.IPS_actual, sr.TL, sr.TL_pt_load,
        sr.planned_staff, sr.actual_staff, sr.NUM_present,
        sr.unfilled_pos, sr.comments,
        pa.admission, pa.discharge, pa.high_acuity, pa.high_dependency,
        pa.specials_1to1, pa.falls_risk, pa.behavioural_patients
      FROM dbo.Shift as s
      JOIN dbo.Staffing_Record AS sr ON sr.shift_id = s.id
      JOIN dbo.Ward as w ON w.id = s.ward_id
      LEFT JOIN dbo.Patient_Acuity AS pa ON pa.shift_id = s.id
      WHERE s.shift_date = @shift_date AND s.shift_type = @shift_type`);

  return result.recordset[0] ?? null;
}

export async function getWeeklyReportData(weekValue) {
  const range = getIsoWeekRange(weekValue);
  if (!range) {
    return [];
  }

  const pool = await getPool();
  const result = await pool.request()
    .input('startDate', sql.Date, range.startDate)
    .input('endDate', sql.Date, range.endDate)
    .query(`SELECT
          s.shift_date,
          s.shift_type,
          w.ward_name,
          sr.planned_staff,
          sr.actual_staff,
          sr.RN_count,
          sr.EN_count,
          sr.AIN_count,
          sr.permanent_count,
          sr.casual_agency_count,
          sr.IPS_planned, 
          sr.IPS_actual,
          sr.TL, 
          sr.TL_pt_load,
          sr.unfilled_pos,
          sr.NUM_present,
          sr.comments
        FROM dbo.Shift s
        INNER JOIN dbo.Staffing_Record sr ON sr.shift_id = s.id
        INNER JOIN dbo.Ward w ON w.id = s.ward_id
        WHERE w.ward_name = '5East'
          AND s.shift_date BETWEEN @startDate AND @endDate
      ORDER BY s.shift_date, s.shift_type`);

  return result.recordset ?? [];
}

async function getNextTableId(transaction, tableName) {
  const result = await transaction.request().query(`
    SELECT ISNULL(MAX(id), 0) + 1 AS nextId
    FROM dbo.${tableName} WITH (UPDLOCK, HOLDLOCK)`);
  return result.recordset[0].nextId;
}

async function rollbackTransaction(transaction) {
  try {
    await transaction.rollback();
  } catch (error) {
    console.error('Failed to roll back shift transaction', error);
  }
}

function getAcuityValues(payload = {}) {
  return {
    admission: toNullableInt(payload.admission),
    discharge: toNullableInt(payload.discharge),
    high_acuity: toNullableInt(payload.high_acuity),
    high_dependency: toNullableInt(payload.high_dependency),
    specials_1to1: toNullableInt(payload.specials_1to1),
    falls_risk: toNullableInt(payload.falls_risk),
    behavioural_patients: toNullableInt(payload.behavioural_patients),
  };
}

async function insertPatientAcuity(transaction, shiftId, payload = {}) {
  const values = getAcuityValues(payload);
  const nextId = await getNextTableId(transaction, 'Patient_Acuity');
  console.log(`[Patient_Acuity] Starting insert through shift transaction (shift_id=${shiftId}).`);

  const result = await transaction.request()
    .input('id', sql.Int, nextId)
    .input('shift_id', sql.Int, shiftId)
    .input('admission', sql.Int, values.admission)
    .input('discharge', sql.Int, values.discharge)
    .input('high_acuity', sql.Int, values.high_acuity)
    .input('high_dependency', sql.Int, values.high_dependency)
    .input('specials_1to1', sql.Int, values.specials_1to1)
    .input('falls_risk', sql.Int, values.falls_risk)
    .input('behavioural_patients', sql.Int, values.behavioural_patients)
    .query(`INSERT INTO dbo.Patient_Acuity (
        id, shift_id, admission, discharge,
        high_dependency, high_acuity, specials_1to1, 
        falls_risk, behavioural_patients
      )
      VALUES (
        @id, @shift_id, @admission, @discharge, 
        @high_dependency, @high_acuity, @specials_1to1, 
        @falls_risk, @behavioural_patients
      )`);
  console.log(`[Patient_Acuity] Insert query completed (shift_id=${shiftId}, rows_affected=${result.rowsAffected[0]}).`);
}

export async function getWardIDByName(wardName) {
  const pool = await getPool();
  const result = await pool.request()
    .input('ward_name', sql.NVarChar(100), wardName)
    .query(`SELECT TOP 1 id, ward_name
      FROM dbo.Ward
      WHERE ward_name = @ward_name`);

  return result.recordset[0] || null;
}

export async function createShiftRecord(payload = {}) {
  const pool = await getPool();
  const wardName = String(payload.ward_name || '5East');
  const shiftDate = formatSqlDate(payload.date || new Date().toISOString().slice(0, 10));
  const shiftType = String(payload.shift_type || 'AM').toUpperCase();

  const ward = await getWardIDByName(wardName);
  if (!ward) {
    throw new Error(`Ward not found: ${wardName}`);
  }

  const transaction = new sql.Transaction(pool);
  await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);

  try {
    const existingShift = await transaction.request()
      .input('shift_date', sql.Date, shiftDate)
      .input('shift_type', sql.VarChar(20), shiftType)
      .query(`SELECT TOP 1 id
        FROM dbo.Shift WITH (UPDLOCK, HOLDLOCK)
        WHERE shift_date = @shift_date AND shift_type = @shift_type`);

    if (existingShift.recordset.length > 0) {
      const error = new Error('A shift already exists for this date and shift type. Please edit the existing shift instead.');
      error.code = 'SHIFT_ALREADY_EXISTS';
      throw error;
    }

    const nextShiftId = await getNextTableId(transaction, 'Shift');
    const nextRecordId = await getNextTableId(transaction, 'Staffing_Record');
    const shiftInsert = await transaction.request()
      .input('id', sql.Int, nextShiftId)
      .input('ward_id', sql.Int, ward.id)
      .input('shift_date', sql.Date, shiftDate)
      .input('shift_type', sql.VarChar(20), shiftType)
      .query(`INSERT INTO dbo.Shift (id, ward_id, shift_date, shift_type)
        OUTPUT INSERTED.id
        VALUES (@id, @ward_id, @shift_date, @shift_type)`);

    const shiftId = shiftInsert.recordset[0].id;
    const NUM_present = String(payload.NUM_present ?? 'NO').toUpperCase();
    const rnCount = toInt(payload.RN_count);
    const enCount = toInt(payload.EN_count);
    const ainCount = toInt(payload.AIN_count);
    const casualAgencyCount = toInt(payload.casual_agency_count);
    const plannedStaff = toInt(payload.planned_staff);
    const actualStaff = toInt(payload.actual_staff);
    const IPS_planned = toInt(payload.IPS_planned);
    const IPS_actual = toInt(payload.IPS_actual);
    const TL = toFlagInt(payload.TL);
    const TL_pt_load = toYesNo(payload.TL_pt_load);
    const unfilledPos = toInt(payload.unfilled_pos);
    const permanentCount = toInt(payload.permanent_count);
    const comments = payload.comments ?? null;

    await transaction.request()
      .input('id', sql.Int, nextRecordId)
      .input('shift_id', sql.Int, shiftId)
      .input('RN_count', sql.Int, rnCount)
      .input('EN_count', sql.Int, enCount)
      .input('AIN_count', sql.Int, ainCount)
      .input('casual_agency_count', sql.Int, casualAgencyCount)
      .input('permanent_count', sql.Int, permanentCount)
      .input('NUM_present', sql.VarChar(20), NUM_present)
      .input('planned_staff', sql.Int, plannedStaff)
      .input('actual_staff', sql.Int, actualStaff)
      .input('IPS_planned', sql.Int, IPS_planned)
      .input('IPS_actual', sql.Int, IPS_actual)
      .input('TL', sql.Int, TL)
      .input('TL_pt_load', sql.VarChar(3), TL_pt_load)
      .input('unfilled_pos', sql.Int, unfilledPos)
      .input('comments', sql.VarChar(5000), comments)
      .query(`INSERT INTO dbo.Staffing_Record (
        id, shift_id, RN_count, EN_count, AIN_count,
        casual_agency_count, permanent_count,
        NUM_present, planned_staff, actual_staff, 
        IPS_planned, IPS_actual, TL, TL_pt_load,
        unfilled_pos, comments
      )
      VALUES (
        @id, @shift_id, @RN_count, @EN_count, @AIN_count,
        @casual_agency_count, @permanent_count,
        @NUM_present, @planned_staff, @actual_staff,
        @IPS_planned, @IPS_actual, @TL, @TL_pt_load,
        @unfilled_pos, @comments
      )`);

    await insertPatientAcuity(transaction, shiftId, payload);
    await transaction.commit();
    console.log(`[Shift] Transaction committed after Patient_Acuity insert (shift_id=${shiftId}).`);

    return {
      wardId: ward.id,
      shiftId,
      staffingRecordId: nextRecordId,
    };
  } catch (error) {
    await rollbackTransaction(transaction);
    throw error;
  }
}

export async function updateShiftRecord(shiftDate, shiftType, payload = {}) {
  const pool = await getPool();
  const transaction = new sql.Transaction(pool);
  await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);

  try {
    const NUM_present = String(payload.NUM_present ?? 'NO').toUpperCase();
    const result = await transaction.request()
      .input('shift_date', sql.Date, formatSqlDate(shiftDate))
      .input('shift_type', sql.VarChar(20), String(shiftType).toUpperCase())
      .input('ward_name', sql.NVarChar(100), String(payload.ward_name || '5East'))
      .input('RN_count', sql.Int, toInt(payload.RN_count))
      .input('EN_count', sql.Int, toInt(payload.EN_count))
      .input('AIN_count', sql.Int, toInt(payload.AIN_count))
      .input('permanent_count', sql.Int, toInt(payload.permanent_count))
      .input('casual_agency_count', sql.Int, toInt(payload.casual_agency_count))
      .input('planned_staff', sql.Int, toInt(payload.planned_staff))
      .input('actual_staff', sql.Int, toInt(payload.actual_staff))
      .input('IPS_planned', sql.Int, toInt(payload.IPS_planned))
      .input('IPS_actual', sql.Int, toInt(payload.IPS_actual))
      .input('TL', sql.Int, toFlagInt(payload.TL))
      .input('TL_pt_load', sql.VarChar(3), toYesNo(payload.TL_pt_load))
      .input('unfilled_pos', sql.Int, toInt(payload.unfilled_pos))
      .input('NUM_present', sql.VarChar(20), NUM_present)
      .input('comments', sql.VarChar(5000), payload.comments ?? null)
      .query(`UPDATE sr
        SET
          RN_count = @RN_count,
          EN_count = @EN_count,
          AIN_count = @AIN_count,
          permanent_count = @permanent_count,
          casual_agency_count = @casual_agency_count,
          planned_staff = @planned_staff,
          actual_staff = @actual_staff,
          IPS_planned = @IPS_planned,
          IPS_actual = @IPS_actual,
          TL = @TL,
          TL_pt_load = @TL_pt_load,
          unfilled_pos = @unfilled_pos,
          NUM_present = @NUM_present,
          comments = @comments
        FROM dbo.Staffing_Record sr
        INNER JOIN dbo.Shift s ON s.id = sr.shift_id
        INNER JOIN dbo.Ward w ON w.id = s.ward_id
        WHERE s.shift_date = @shift_date
          AND s.shift_type = @shift_type
          AND w.ward_name = @ward_name`);

    if (result.rowsAffected[0] === 0) {
      await transaction.rollback();
      return false;
    }

    const shiftResult = await transaction.request()
      .input('shift_date', sql.Date, formatSqlDate(shiftDate))
      .input('shift_type', sql.VarChar(20), String(shiftType).toUpperCase())
      .input('ward_name', sql.NVarChar(100), String(payload.ward_name || '5East'))
      .query(`SELECT s.id
        FROM dbo.Shift s
        INNER JOIN dbo.Ward w ON w.id = s.ward_id
        WHERE s.shift_date = @shift_date
          AND s.shift_type = @shift_type
          AND w.ward_name = @ward_name`);

    const shiftId = shiftResult.recordset[0]?.id;
    if (!shiftId) {
      await transaction.rollback();
      return false;
    }

    const acuityValues = getAcuityValues(payload);
    const acuityUpdate = await transaction.request()
      .input('shift_id', sql.Int, shiftId)
      .input('admission', sql.Int, acuityValues.admission)
      .input('discharge', sql.Int, acuityValues.discharge)
      .input('high_acuity', sql.Int, acuityValues.high_acuity)
      .input('high_dependency', sql.Int, acuityValues.high_dependency)
      .input('specials_1to1', sql.Int, acuityValues.specials_1to1)
      .input('falls_risk', sql.Int, acuityValues.falls_risk)
      .input('behavioural_patients', sql.Int, acuityValues.behavioural_patients)
      .query(`UPDATE dbo.Patient_Acuity
        SET admission = @admission,
            discharge = @discharge,
            high_acuity = @high_acuity,
            high_dependency = @high_dependency,
            specials_1to1 = @specials_1to1,
            falls_risk = @falls_risk,
            behavioural_patients = @behavioural_patients
        WHERE shift_id = @shift_id`);

    if (acuityUpdate.rowsAffected[0] === 0) {
      await insertPatientAcuity(transaction, shiftId, payload);
    }

    await transaction.commit();
    console.log(`[Shift] Transaction committed after Patient_Acuity save (shift_id=${shiftId}).`);
    return true;
  } catch (error) {
    await rollbackTransaction(transaction);
    throw error;
  }
}
