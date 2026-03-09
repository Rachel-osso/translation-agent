import * as XLSX from 'xlsx';
import { getSheetData, appendSheetData } from './sheets.js';

const TM_SHEET_ID = process.env.GOOGLE_TM_SHEET_ID;

export async function loadTM() {
  try {
    if (TM_SHEET_ID) {
      const rows = await getSheetData(TM_SHEET_ID, 'TM!A:D');
      return rows.map((row) => ({
        source: row[0],
        target: row[1],
        project: row[2] || '',
        date: row[3] || '',
      }));
    }
  } catch (e) {
    console.warn('Failed to load TM:', e.message);
  }
  return [];
}

export function matchTM(source, tmEntries) {
  const norm = (s) => s.replace(/\s+/g, ' ').trim();
  const exact = tmEntries.find((e) => norm(e.source) === norm(source));
  if (exact) return { ...exact, score: 100 };

  let best = null;
  let bestScore = 0;
  for (const entry of tmEntries) {
    const score = similarity(norm(source), norm(entry.source));
    if (score > bestScore && score >= 70) {
      bestScore = score;
      best = { ...entry, score };
    }
  }
  return best;
}

export async function saveTM(entries) {
  if (!TM_SHEET_ID) return;
  const rows = entries.map((e) => [
    e.source,
    e.target,
    e.project || 'translation-agent',
    new Date().toISOString().split('T')[0],
  ]);
  await appendSheetData(TM_SHEET_ID, 'TM!A:D', rows);
}

export function generateTMExcel(entries) {
  const wb = XLSX.utils.book_new();
  const data = [
    ['Source (Chinese)', 'Target (English)', 'Project', 'Date'],
    ...entries.map((e) => [e.source, e.target, e.project || '', e.date || '']),
  ];
  const ws = XLSX.utils.aoa_to_sheet(data);
  ws['!cols'] = [{ wch: 60 }, { wch: 60 }, { wch: 20 }, { wch: 15 }];
  XLSX.utils.book_append_sheet(wb, ws, 'Translation Memory');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

function similarity(a, b) {
  if (a === b) return 100;
  const longer = a.length > b.length ? a : b;
  const shorter = a.length > b.length ? b : a;
  if (longer.length === 0) return 100;
  const dist = levenshtein(longer, shorter);
  return Math.round(((longer.length - dist) / longer.length) * 100);
}

function levenshtein(a, b) {
  const m = [];
  for (let i = 0; i <= b.length; i++) m[i] = [i];
  for (let j = 0; j <= a.length; j++) m[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      m[i][j] =
        b[i - 1] === a[j - 1]
          ? m[i - 1][j - 1]
          : Math.min(m[i - 1][j - 1] + 1, m[i][j - 1] + 1, m[i - 1][j] + 1);
    }
  }
  return m[b.length][a.length];
}
