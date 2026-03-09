import OpenAI from 'openai';

/**
 * 翻译引擎：支持 Gemini (免费) / OpenAI (付费) / Custom (自定义)
 */
export async function translateSegments(segments, tmEntries, glossaryEntries, engine = 'gemini') {
  const results = [];
  const batchSize = 5;

  for (let i = 0; i < segments.length; i += batchSize) {
    const batch = segments.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map((seg) => translateOne(seg, tmEntries, glossaryEntries, engine))
    );
    results.push(...batchResults);

    // Gemini 免费版限制 15 RPM，加个小延迟
    if (engine === 'gemini' && i + batchSize < segments.length) {
      await sleep(2000);
    }
  }

  return results;
}

async function translateOne(segment, tmEntries, glossaryEntries, engine) {
  // 1. TM 精确匹配
  const norm = (s) => s.replace(/\s+/g, ' ').trim();
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

  // 4. 构建翻译 prompt
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
1. Maintain technical accuracy matching official API docs style (like Microsoft Graph, Slack API)
2. Keep code, variable names, URLs, JSON keys unchanged
3. Use standard technical English terminology
4. Be concise and professional
5. Preserve HTML tags
6. Output ONLY the translation, no explanation${termPrompt}${tmPrompt}`;

  // 5. 调用翻译引擎
  let translated;
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
    // 如果 Gemini 失败，尝试回退到 OpenAI
    if (engine === 'gemini' && process.env.OPENAI_API_KEY) {
      try {
        translated = await openaiTranslate(systemPrompt, segment.source);
        engine = 'openai-fallback';
      } catch (e2) {
        translated = `[Translation Error] ${segment.source}`;
      }
    } else {
      translated = `[Translation Error] ${segment.source}`;
    }
  }

  return {
    ...segment,
    target: translated,
    origin: fuzzy ? `${engine} + TM ref (${fuzzy.score}%)` : engine,
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

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: {
          parts: [{ text: systemPrompt }],
        },
        contents: [
          {
            parts: [{ text: text }],
          },
        ],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 2048,
        },
      }),
    }
  );

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Gemini API error ${response.status}: ${err}`);
  }

  const data = await response.json();
  const result = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!result) throw new Error('Empty Gemini response');
  return result.trim();
}

// ==========================================
// OpenAI (付费，作为备选)
// ==========================================
async function openaiTranslate(systemPrompt, text) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not set');

  const openai = new OpenAI({ apiKey });
  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: text },
    ],
    temperature: 0.1,
  });

  return response.choices[0].message.content.trim();
}

// ==========================================
// Custom (自定义引擎，预留接口)
// ==========================================
async function customTranslate(source, terms) {
  const apiUrl = process.env.CUSTOM_ENGINE_API_URL;
  const apiKey = process.env.CUSTOM_ENGINE_API_KEY;
  if (!apiUrl || !apiKey) throw new Error('Custom translation engine not configured. Set CUSTOM_ENGINE_API_URL and CUSTOM_ENGINE_API_KEY.');

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
