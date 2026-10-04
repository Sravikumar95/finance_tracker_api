function isValidDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function parseAmount(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const text = String(value).trim();
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(text) || !/[1-9]/.test(text)) return null;
  const [whole, fraction = ''] = text.split('.');
  return `${whole}.${fraction.padEnd(2, '0')}`;
}

module.exports = { isValidDate, parseAmount };