import OpenAI from 'openai';

export async function translateSegments(segments, tmEntries, glossaryEntries, engine = 'openai') {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const results = [];

  // 批量处理，每批 10 个句段
  const batchSize = 10;
  for (let i = 0; i < segments.length; i += batchSize) {
    const batch = segments.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map((seg) => translateOne(seg, tmEntries, glossaryEntries, openai, engine))
    );
    results.push(...batchResults);
  }

  return results;
}

async function translateOne(segment, tmEntries, glossaryEntries, openai, engine) {
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

  // 4. AI 翻译
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

  if (engine === 'rapunzel' && process.env.RAPUNZEL_API_URL) {
    const translated = await rapunzelTranslate(segment.source, terms);
    return { ...segment, target: translated, origin: 'Rapunzel', tmScore: 0, appliedTerms: terms };
  }

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: segment.source },
    ],
    temperature: 0.1,
  });

  return {
    ...segment,
    target: response.choices[0].message.content.trim(),
    origin: fuzzy ? `AI + TM ref (${fuzzy.score}%)` : 'AI',
    tmScore: fuzzy?.score || 0,
    appliedTerms: terms,
  };
}

async function rapunzelTranslate(source, terms) {
  const res = await fetch(process.env.RAPUNZEL_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.RAPUNZEL_API_KEY}`,
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
