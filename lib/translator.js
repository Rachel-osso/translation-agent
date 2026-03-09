/**
 * 翻译引擎 - 优化版
 * 核心优化：将所有句段合并为一次 API 调用，10秒内返回
 */
export async function translateSegments(segments, tmEntries, glossaryEntries, engine = 'gemini') {
  // Step 1: 分离 TM 命中 vs 需要 AI 翻译的句段
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

  // Step 2: 如果没有需要 AI 翻译的，直接返回
  if (needAI.length === 0) return tmResults;

  // Step 3: 术语表
  const termList = glossaryEntries
    .filter((g) => needAI.some((seg) => seg.source.includes(g.source)))
    .map((t) => `"${t.source}" → "${t.target}"`)
    .join('\n');

  // Step 4: 合并所有句段为一次请求
  const numberedSource = needAI
    .map((seg, i) => `[${i + 1}] ${seg.source}`)
    .join('\n');

  const prompt = `You are a professional technical translator for API documentation.

RULES:
1. Translate each numbered Chinese segment to English
2. Keep the same numbering format: [1] translation [2] translation ...
3. Each translation must be on its own line starting with [number]
4. Keep code, variable names, URLs, JSON keys, HTML tags unchanged
5. Use standard technical English (like Microsoft or Google API docs)
6. Be concise and professional
7. Output ONLY the translations with numbers, nothing else
${termList ? `\nMANDATORY TERMINOLOGY:\n${termList}` : ''}

TRANSLATE:
${numberedSource}`;

  let translated;
  try {
    if (engine === 'gemini') {
      translated = await geminiTranslate(prompt);
    } else if (engine === 'openai') {
      translated = await openaiTranslate(prompt);
    } else if (engine === 'custom') {
      translated = await customTranslate(prompt);
    } else {
      translated = await geminiTranslate(prompt);
    }
  } catch (err) {
    console.error(`Primary engine (${engine}) failed:`, err.message);
    // 回退
    try {
      if (engine === 'gemini' && process.env.OPENAI_API_KEY) {
        translated = await openaiTranslate(prompt);
      } else if (engine !== 'gemini' && process.env.GEMINI_API_KEY) {
        translated = await geminiTranslate(prompt);
      } else {
        // 全部标记为错误
        return [
          ...tmResults,
          ...needAI.map((seg) => ({ ...seg, target: `[Translation Error: ${err.message}]`, origin: 'error', tmScore: 0 })),
        ];
      }
    } catch (e2) {
      return [
        ...tmResults,
        ...needAI.map((seg) => ({ ...seg, target: `[Error] ${seg.source}`, origin: 'error', tmScore: 0 })),
      ];
    }
  }

  // Step 5: 解析编号结果
  const aiResults = parseNumberedTranslation(translated, needAI, engine);

  return [...tmResults, ...aiResults];
}

/**
 * 解析编号格式的翻译结果
 * 输入: "[1] Hello\n[2] World"
 * 输出: 对应到每个句段
 */
function parseNumberedTranslation(text, segments, engine) {
  const lines = text.split('\n').filter((l) => l.trim());
  const results = [];

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    // 查找 [i+1] 开头的行
    const pattern = new RegExp(`^\\[${i + 1}\\]\\s*(.+)`, 'm');
    const match = text.match(pattern);

    if (match) {
      results.push({
        ...seg,
        target: match[1].trim(),
        origin: engine,
        tmScore: 0,
      });
    } else if (lines[i]) {
      // 回退：按行号顺序匹配
      const fallback = lines[i].replace(/^\[\d+\]\s*/, '').trim();
      results.push({
        ...seg,
        target: fallback || seg.source,
        origin: `${engine} (fallback)`,
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
// Google Gemini 2.0 Flash (免费)
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
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 8192,
        },
      }),
    }
  );

  const responseText = await response.text();

  let data;
  try {
    data = JSON.parse(responseText);
  } catch (e) {
    throw new Error(`Gemini returned invalid response (${response.status}): ${responseText.substring(0, 300)}`);
  }

  if (data.error) {
    throw new Error(`Gemini error: ${data.error.message || JSON.stringify(data.error)}`);
  }

  const result = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!result) throw new Error('Empty Gemini response');
  return result.trim();
}

// ==========================================
// OpenAI (付费备选)
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
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ text: prompt }),
  });

  const data = await res.json();
  return data.translation || data.text || data.result || '';
}
