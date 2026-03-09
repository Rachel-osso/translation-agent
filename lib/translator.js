/**
 * 翻译引擎 - 优化版 v3
 * 默认使用 DeepSeek（国内可用、免费、质量高）
 * 所有句段合并为 1 次 API 调用，10秒内返回
 */
export async function translateSegments(segments, tmEntries, glossaryEntries, engine = 'deepseek') {
  // Step 1: 分离 TM 命中 vs 需要 AI 翻译
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

  // Step 2: 术语表
  const termList = glossaryEntries
    .filter((g) => needAI.some((seg) => seg.source.includes(g.source)))
    .map((t) => `"${t.source}" → "${t.target}"`)
    .join('\n');

  // Step 3: 合并所有句段为一次请求
  const numberedSource = needAI
    .map((seg, i) => `[${i + 1}] ${seg.source}`)
    .join('\n');

  const prompt = `You are a professional technical translator for API documentation.

RULES:
1. Translate each numbered Chinese segment to English
2. Keep the same numbering format: [1] translation [2] translation ...
3. Each translation on its own line starting with [number]
4. Keep code, variable names, URLs, JSON keys, HTML tags unchanged
5. Use standard technical English (like Microsoft or Google API docs style)
6. Be concise and professional
7. Output ONLY the numbered translations, nothing else
${termList ? `\nMANDATORY TERMINOLOGY:\n${termList}` : ''}

TRANSLATE:
${numberedSource}`;

  // Step 4: 调用翻译引擎
  let translated;
  let usedEngine = engine;

  const engineOrder = getEngineOrder(engine);

  for (const eng of engineOrder) {
    try {
      translated = await callEngine(eng, prompt);
      usedEngine = eng;
      break;
    } catch (err) {
      console.error(`Engine ${eng} failed:`, err.message);
      continue;
    }
  }

  if (!translated) {
    return [
      ...tmResults,
      ...needAI.map((seg) => ({ ...seg, target: `[All engines failed] ${seg.source}`, origin: 'error', tmScore: 0 })),
    ];
  }

  // Step 5: 解析结果
  const aiResults = parseNumberedTranslation(translated, needAI, usedEngine);
  return [...tmResults, ...aiResults];
}

/**
 * 引擎优先级
 */
function getEngineOrder(preferred) {
  const all = ['deepseek', 'gemini', 'openai'];
  const order = [preferred, ...all.filter((e) => e !== preferred)];
  return order.filter((e) => {
    if (e === 'deepseek') return !!process.env.DEEPSEEK_API_KEY;
    if (e === 'gemini') return !!process.env.GEMINI_API_KEY;
    if (e === 'openai') return !!process.env.OPENAI_API_KEY;
    if (e === 'custom') return !!process.env.CUSTOM_ENGINE_API_URL;
    return false;
  });
}

/**
 * 统一调用引擎
 */
async function callEngine(engine, prompt) {
  switch (engine) {
    case 'deepseek': return await deepseekTranslate(prompt);
    case 'gemini': return await geminiTranslate(prompt);
    case 'openai': return await openaiTranslate(prompt);
    case 'custom': return await customTranslate(prompt);
    default: throw new Error(`Unknown engine: ${engine}`);
  }
}

/**
 * 解析编号格式的翻译结果
 */
function parseNumberedTranslation(text, segments, engine) {
  const results = [];

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const pattern = new RegExp(`\\[${i + 1}\\]\\s*(.+?)(?=\\[\\d+\\]|$)`, 's');
    const match = text.match(pattern);

    if (match) {
      results.push({
        ...seg,
        target: match[1].trim(),
        origin: engine,
        tmScore: 0,
      });
    } else {
      results.push({
        ...seg,
        target: seg.source,
        origin: 'untranslated',
        tmScore: 0,
      });
    }
  }

  return results;
}

// ==========================================
// DeepSeek (国内可用、免费额度大、质量高)
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
    const errText = await response.text();
    throw new Error(`DeepSeek API error ${response.status}: ${errText.substring(0, 200)}`);
  }

  const data = await response.json();
  const result = data.choices?.[0]?.message?.content;
  if (!result) throw new Error('Empty DeepSeek response');
  return result.trim();
}

// ==========================================
// Google Gemini (海外可用)
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

  const responseText = await response.text();
  let data;
  try { data = JSON.parse(responseText); } catch (e) {
    throw new Error(`Gemini invalid response: ${responseText.substring(0, 200)}`);
  }
  if (data.error) throw new Error(`Gemini: ${data.error.message}`);
  const result = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!result) throw new Error('Empty Gemini response');
  return result.trim();
}

// ==========================================
// OpenAI (付费)
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
// Custom Engine (预留)
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
