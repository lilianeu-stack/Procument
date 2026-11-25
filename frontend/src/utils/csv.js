export function parseCsv(text) {
  const source = String(text || '').replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') { field += '"'; index += 1; }
      else if (character === '"') quoted = false;
      else field += character;
    } else if (character === '"') quoted = true;
    else if (character === ',') { row.push(field); field = ''; }
    else if (character === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (character !== '\r') field += character;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((entry) => entry.some((cell) => String(cell ?? '').trim() !== ''));
}

export function toCsv(rows) {
  return rows.map((row) => row.map((cell) => {
    const value = String(cell ?? '');
    return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
  }).join(',')).join('\r\n');
}

const CANONICAL_HEADERS = {
  'first name': 'firstName', firstname: 'firstName', first_name: 'firstName',
  'last name': 'lastName', lastname: 'lastName', last_name: 'lastName',
  email: 'email', 'email address': 'email',
  role: 'role',
  department: 'department', 'department name': 'department',
  subdepartment: 'department', 'sub department': 'department', 'subdepartment name': 'department',
  phone: 'phone', 'phone number': 'phone', phonenumber: 'phone'
};

export function csvRowsToUsers(rows) {
  if (!rows.length) return [];
  const headers = rows[0].map((header) => String(header).trim().toLowerCase().replace(/\s+/g, ' '));
  const missing = ['email', 'role'].filter((header) => !headers.includes(header));
  if (!headers.includes('department') && !headers.includes('subdepartment')) missing.push('Subdepartment');
  if (missing.length) throw new Error(`The template must include ${missing.map((header) => header[0].toUpperCase() + header.slice(1)).join(', ')} column(s).`);
  return rows.slice(1).map((cells) => Object.fromEntries(
    headers.map((header, index) => [CANONICAL_HEADERS[header] || header, cells[index] ?? ''])
  ));
}

export function downloadCsv(filename, rows) {
  const blob = new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
