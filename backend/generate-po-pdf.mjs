import fs from 'node:fs';
import pool from './src/config/db.js';
import { fetchRecord, renderRecordPdf } from './src/services/exports.js';

const id = Number(process.argv[2] || 210);
const output = process.argv[3] || 'C:\\Users\\Lily\\AppData\\Local\\Temp\\opencode\\po-image2-style.pdf';
const record = await fetchRecord('purchaseOrder', id, { id: 1, role: 'procurement', departmentId: null });
const pdf = await renderRecordPdf(record);
fs.writeFileSync(output, pdf);
console.log(JSON.stringify({ id, reference: record.reference, bytes: pdf.length, output }));
await pool.end();
