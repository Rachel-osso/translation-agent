/**
 * 翻译引擎：支持 Gemini (免费) / OpenAI (付费) / Custom (自定义)
 */
export async function translateSegments(segments, tmEntries, glossaryEntries, engine = 'gemini') {
  const results = [];
  const batchSize = 3;

  for (let i = 0; i < segments.length; i += batchSize) {
    const batch = segments.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map((seg) => translateOne(seg, tmEntries, glossaryEntries, engine))
    );
    results.push(...batchResults);

    if (engine === 'gemini' && i + batchSize < segments.length) {
      await sleep(3000);
    }
  }

  return results;
}

async function translateOne(segment, tmEntries, glossaryEntries, engine) {
  const norm = (s) => s.replace(/\s+/g, ' ').trim();

  // 1. TM 精确匹配
  const exact = tmEntries.find((e) => norm(e.source) === norm(segment.source));
  if (exact) {
    return { ...segment, target: exact.target, origin: 'TM (100%)', tmScore: 100 };
  }

  // 2. TM 模糊匹配
  let fuzzy = null;
  for (const entry of tmEntries) {
    const score = quickSimilarity(norm(segment.source), norm(entry.source));
    if (score >= 70 && (!fuzzy || score > fuzzy.score)) {
      fuzzy = { ...entry, score };
    }
  }

  // 3. 术语匹配
  const terms = glossaryEntries.filter((g) => segment.source.includes(g.source));

  // 4. 构建 prompt
  let termPrompt = '';
  if (terms.length > 0) {
    termPrompt = '\n\nMandatory terminology (MUST use these exact translations):\n';
    termPrompt += terms.map((t) => `- "${t.source}" → "${t.target}"`).join('\n');
  }

  let tmPrompt = '';
  if (fuzzy) {
    tmPrompt = `\n\nSimilar previous translation (${fuzzy.score}% match):\nZH: ${fuzzy.source}\nEN: ${fuzzy.target}`;
  }

  const systemPrompt = `You are a professional technical translator for API documentation. Translate Chinese to English:
1. Maintain technical accuracy matching official API docs style
2. Keep code, variable names, URLs, JSON keys unchanged
3. Use standard technical English terminology
4. Be concise and professional
5. Preserve HTML tags if any
6. Output ONLY the translation, no explanation${termPrompt}${tmPrompt}`;

  // 5. 调用翻译引擎
  let translated;
  let usedEngine = engine;

  try {
    if (engine === 'gemini') {
      translated = await geminiTranslate(systemPrompt, segment.source);
    } else if (engine === 'custom') {
      translated = await customTranslate(segment.source, terms);
    } else {
      translated = await openaiTranslate(systemPrompt, segment.source);
    }
  } catch (err) {
    console.error(`Translation error (${engine}):`, err.message);
    // 回退机制
    try {
      if (engine === 'gemini' && process.env.OPENAI_API_KEY) {
        translated = await openaiTranslate(systemPrompt, segment.source);
        usedEngine = 'openai-fallback';
      } else if (engine !== 'gemini' && process.env.GEMINI_API_KEY) {
        translated = await geminiTranslate(systemPrompt, segment.source);
        usedEngine = 'gemini-fallback';
      } else {
        translated = `[ERROR] ${err.message}`;
      }
    } catch (e2) {
      translated = `[ERROR] ${e2.message}`;
    }
  }

  return {
    ...segment,
    target: translated,
    origin: fuzzy ? `${usedEngine} + TM ref (${fuzzy.score}%)` : usedEngine,
    tmScore: fuzzy?.score || 0,
    appliedTerms: terms,
  };
}

// ==========================================
// Google Gemini (免费)
// ==========================================
async function geminiTranslate(systemPrompt, text) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not set');

  // 使用 gemini-2.0-flash 稳定版（免费且可靠）
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

  const body = {
    contents: [
      {
        role: 'user',
        parts: [
          { text: `${systemPrompt}\n\n---\nTranslate the following Chinese text to English:\n\n${text}` }
        ],
      },
    ],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 2048,
    },
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const responseText = await response.text();

  // 检查是否是有效的 JSON
  let data;
  try {
    data = JSON.parse(responseText);
  } catch (e) {
    throw new Error(`Gemini returned invalid JSON (status ${response.status}): ${responseText.substring(0, 200)}`);
  }

  // 检查 API 错误
  if (data.error) {
    throw new Error(`Gemini API error: ${data.error.message || JSON.stringify(data.error)}`);
  }

  const result = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!result) {
    throw new Error(`Empty Gemini response: ${JSON.stringify(data).substring(0, 200)}`);
  }

  return result.trim();
}

// ==========================================
// OpenAI (付费备选)
// ==========================================
async function openaiTranslate(systemPrompt, text) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not set');

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: text },
      ],
      temperature: 0.1,
    }),
  });

  const data = await response.json();
  if (data.error) throw new Error(data.error.message);
  return data.choices[0].message.content.trim();
}

// ==========================================
// Custom Engine (预留接口)
// ==========================================
async function customTranslate(source, terms) {
  const apiUrl = process.env.CUSTOM_ENGINE_API_URL;
  const apiKey = process.env.CUSTOM_ENGINE_API_KEY;
  if (!apiUrl || !apiKey) throw new Error('Custom engine not configured. Set CUSTOM_ENGINE_API_URL and CUSTOM_ENGINE_API_KEY.');

  const res = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      source_lang: 'zh',
      target_lang: 'en',
      text: source,
      glossary: terms.map((t) => ({ source: t.source, target: t.target })),
    }),
  });

  const data = await res.json();
  return data.translation || data.text || data.result || source;
}

// ==========================================
// 工具函数
// ==========================================
function quickSimilarity(a, b) {
  if (a === b) return 100;
  const longer = a.length > b.length ? a : b;
  const shorter = a.length > b.length ? b : a;
  if (longer.length === 0) return 100;
  let matches = 0;
  for (let i = 0; i < shorter.length; i++) {
    if (longer.includes(shorter[i])) matches++;
  }
  return Math.round((matches / longer.length) * 100);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
