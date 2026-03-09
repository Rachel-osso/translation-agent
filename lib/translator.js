/**
 * 翻译引擎 v4 - SiliconFlow 优先（免费、台湾可用、质量高）
 */
export async function translateSegments(segments, tmEntries, glossaryEntries, engine = 'siliconflow') {
  const tmResults = [];
  const needAI = [];

  for (const seg of segments) {
    const norm = (s) => s.replace(/\s+/g, ' ').trim();
    const exact = tmEntries.find((e) => norm(e.source) === norm(seg.source));
    if (exact) {
      tmResults.push({ ...seg, target: exact.target, origin: 'TM (100%)', tmScore: 100 });
    } else {
      needAI.push(seg);
    }
  }

  if (needAI.length === 0) return tmResults;

  const termList = glossaryEntries
    .filter((g) => needAI.some((seg) => seg.source.includes(g.source)))
    .map((t) => `"${t.source}" → "${t.target}"`)
    .join('\n');

  const numberedSource = needAI
    .map((seg, i) => `[${i + 1}] ${seg.source}`)
    .join('\n');

  const prompt = `You are a professional technical translator for API documentation.

RULES:
1. Translate each numbered Chinese segment to English
2. Output format: [1] english translation [2] english translation ...
3. Each on its own line starting with [number]
4. Keep code, variable names, URLs, JSON keys, HTML tags unchanged
5. Use standard technical English (Microsoft/Google API docs style)
6. Be concise and professional
7. Output ONLY numbered translations
${termList ? `\nTERMINOLOGY:\n${termList}` : ''}

TRANSLATE:
${numberedSource}`;

  let translated;
  let usedEngine = engine;

  const engines = getAvailableEngines(engine);

  for (const eng of engines) {
    try {
      translated = await callEngine(eng, prompt);
      usedEngine = eng;
      break;
    } catch (err) {
      console.error(`${eng} failed:`, err.message);
    }
  }

  if (!translated) {
    return [...tmResults, ...needAI.map((seg) => ({
      ...seg, target: `[All engines failed] ${seg.source}`, origin: 'error', tmScore: 0,
    }))];
  }

  const aiResults = parseResults(translated, needAI, usedEngine);
  return [...tmResults, ...aiResults];
}

function getAvailableEngines(preferred) {
  const config = {
    siliconflow: () => !!process.env.SILICONFLOW_API_KEY,
    deepseek: () => !!process.env.DEEPSEEK_API_KEY,
    gemini: () => !!process.env.GEMINI_API_KEY,
    openai: () => !!process.env.OPENAI_API_KEY,
    custom: () => !!process.env.CUSTOM_ENGINE_API_URL,
  };
  const all = Object.keys(config);
  const ordered = [preferred, ...all.filter((e) => e !== preferred)];
  return ordered.filter((e) => config[e]?.());
}

function callEngine(engine, prompt) {
  switch (engine) {
    case 'siliconflow': return siliconflowTranslate(prompt);
    case 'deepseek': return deepseekTranslate(prompt);
    case 'gemini': return geminiTranslate(prompt);
    case 'openai': return openaiTranslate(prompt);
    case 'custom': return customTranslate(prompt);
    default: throw new Error(`Unknown engine: ${engine}`);
  }
}

function parseResults(text, segments, engine) {
  const results = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const pattern = new RegExp(`\\[${i + 1}\\]\\s*(.+?)(?=\\n\\[\\d+\\]|$)`, 's');
    const match = text.match(pattern);
    results.push({
      ...seg,
      target: match ? match[1].trim() : seg.source,
      origin: match ? engine : 'untranslated',
      tmScore: 0,
    });
  }
  return results;
}

// ==========================================
// SiliconFlow (免费、台湾可用、质量高)
// ==========================================
async function siliconflowTranslate(prompt) {
  const apiKey = process.env.SILICONFLOW_API_KEY;
  if (!apiKey) throw new Error('SILICONFLOW_API_KEY not set');

  const response = await fetch('https://api.siliconflow.cn/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'Qwen/Qwen2.5-72B-Instruct',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      max_tokens: 8192,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`SiliconFlow ${response.status}: ${err.substring(0, 200)}`);
  }

  const data = await response.json();
  const result = data.choices?.[0]?.message?.content;
  if (!result) throw new Error('Empty SiliconFlow response');
  return result.trim();
}

// ==========================================
// DeepSeek
// ==========================================
async function deepseekTranslate(prompt) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error('DEEPSEEK_API_KEY not set');

  const response = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      max_tokens: 8192,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`DeepSeek ${response.status}: ${err.substring(0, 200)}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content?.trim() || '';
}

// ==========================================
// Google Gemini
// ==========================================
async function geminiTranslate(prompt) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not set');

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 8192 },
      }),
    }
  );

  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { throw new Error(`Gemini invalid: ${text.substring(0, 200)}`); }
  if (data.error) throw new Error(data.error.message);
  return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
}

// ==========================================
// OpenAI
// ==========================================
async function openaiTranslate(prompt) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not set');

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
    }),
  });

  const data = await response.json();
  if (data.error) throw new Error(data.error.message);
  return data.choices[0].message.content.trim();
}

// ==========================================
// Custom
// ==========================================
async function customTranslate(prompt) {
  const apiUrl = process.env.CUSTOM_ENGINE_API_URL;
  const apiKey = process.env.CUSTOM_ENGINE_API_KEY;
  if (!apiUrl || !apiKey) throw new Error('Custom engine not configured');

  const res = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ text: prompt }),
  });
  const data = await res.json();
  return data.translation || data.text || data.result || '';
}
