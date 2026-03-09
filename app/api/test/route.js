import { NextResponse } from 'next/server';

export async function GET() {
  const results = {
    geminiKeySet: !!process.env.GEMINI_API_KEY,
    geminiKeyPrefix: process.env.GEMINI_API_KEY ? process.env.GEMINI_API_KEY.substring(0, 8) + '...' : 'NOT SET',
    openaiKeySet: !!process.env.OPENAI_API_KEY,
    deepseekKeySet: !!process.env.DEEPSEEK_API_KEY,
    geminiTest: null,
    deepseekTest: null,
    errors: [],
  };

  // 测试 Gemini
  if (process.env.GEMINI_API_KEY) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: 'Translate to English: 接口文档' }] }],
            generationConfig: { temperature: 0.1, maxOutputTokens: 100 },
          }),
        }
      );
      const text = await res.text();
      try {
        const data = JSON.parse(text);
        if (data.error) {
          results.errors.push('Gemini: ' + data.error.message);
        } else {
          results.geminiTest = data.candidates?.[0]?.content?.parts?.[0]?.text || 'empty';
        }
      } catch (e) {
        results.errors.push('Gemini not JSON: ' + text.substring(0, 300));
      }
    } catch (e) {
      results.errors.push('Gemini fetch error: ' + e.message);
    }
  }

  // 测试 DeepSeek
  if (process.env.DEEPSEEK_API_KEY) {
    try {
      const res = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: [{ role: 'user', content: 'Translate to English: 接口文档' }],
          temperature: 0.1,
          max_tokens: 100,
        }),
      });
      const data = await res.json();
      if (data.error) {
        results.errors.push('DeepSeek: ' + (data.error.message || JSON.stringify(data.error)));
      } else {
        results.deepseekTest = data.choices?.[0]?.message?.content || 'empty';
      }
    } catch (e) {
      results.errors.push('DeepSeek fetch error: ' + e.message);
    }
  }

  return NextResponse.json(results, { status: 200 });
}
