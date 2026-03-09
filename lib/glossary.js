import { getSheetData, appendSheetData } from './sheets.js';

const GLOSSARY_SHEET_ID = process.env.GOOGLE_GLOSSARY_SHEET_ID;

export async function loadGlossary() {
  try {
    if (GLOSSARY_SHEET_ID) {
      const rows = await getSheetData(GLOSSARY_SHEET_ID, 'Glossary!A:D');
      if (rows.length > 0) {
        return rows.map((row) => ({
          source: row[0],
          target: row[1],
          category: row[2] || '',
          note: row[3] || '',
        }));
      }
    }
  } catch (e) {
    console.warn('Failed to load glossary from Google Sheets:', e.message);
  }
  return getBuiltinGlossary();
}

export function applyGlossary(text, glossaryEntries) {
  const sorted = [...glossaryEntries].sort(
    (a, b) => b.source.length - a.source.length
  );
  return sorted.filter((entry) => text.includes(entry.source));
}

export function extractTermCandidates(zhSegments) {
  const freq = {};
  for (const seg of zhSegments) {
    const words = seg.match(/[\u4e00-\u9fa5]{2,6}/g) || [];
    words.forEach((w) => (freq[w] = (freq[w] || 0) + 1));
  }
  return Object.entries(freq)
    .filter(([, count]) => count >= 2)
    .map(([word, count]) => ({ source: word, count }))
    .sort((a, b) => b.count - a.count);
}

export async function saveGlossary(entries) {
  if (!GLOSSARY_SHEET_ID) return;
  const rows = entries.map((e) => [e.source, e.target, e.category || '', e.note || '']);
  await appendSheetData(GLOSSARY_SHEET_ID, 'Glossary!A:D', rows);
}

function getBuiltinGlossary() {
  return [
    { source: '接口', target: 'API', category: 'API' },
    { source: '请求', target: 'request', category: 'API' },
    { source: '响应', target: 'response', category: 'API' },
    { source: '参数', target: 'parameter', category: 'API' },
    { source: '返回值', target: 'return value', category: 'API' },
    { source: '必填', target: 'required', category: 'API' },
    { source: '选填', target: 'optional', category: 'API' },
    { source: '请求方式', target: 'request method', category: 'API' },
    { source: '请求地址', target: 'request URL', category: 'API' },
    { source: '错误码', target: 'error code', category: 'API' },
    { source: '权限', target: 'permission', category: 'API' },
    { source: '鉴权', target: 'authentication', category: 'API' },
    { source: '访问令牌', target: 'access token', category: 'API' },
    { source: '分页', target: 'pagination', category: 'API' },
    { source: '回调', target: 'callback', category: 'API' },
    { source: '调用频率', target: 'rate limit', category: 'API' },
    { source: '部门', target: 'department', category: 'Org' },
    { source: '用户', target: 'user', category: 'Org' },
    { source: '员工', target: 'employee', category: 'Org' },
    { source: '组织', target: 'organization', category: 'Org' },
    { source: '企业', target: 'company', category: 'Org' },
    { source: '通讯录', target: 'contacts', category: 'Org' },
    { source: '考勤', target: 'attendance', category: 'Org' },
    { source: '审批', target: 'approval', category: 'Org' },
    { source: '工作流', target: 'workflow', category: 'Org' },
    { source: '应用', target: 'application', category: 'Org' },
    { source: '开发者', target: 'developer', category: 'Org' },
    { source: '管理员', target: 'administrator', category: 'Org' },
    { source: '子部门', target: 'sub-department', category: 'Org' },
    { source: '父部门', target: 'parent department', category: 'Org' },
  ];
}
