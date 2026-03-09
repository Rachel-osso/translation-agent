import { NextResponse } from 'next/server';

export async function POST(request) {
  const { question, segments, segmentId } = await request.json();

  const seg = segmentId ? segments.find((s) => s.id === segmentId) : null;
  const context = seg
    ? `Segment:\nChinese: ${seg.source}\nEnglish: ${seg.target}`
    : `Translation:\n${segments.slice(0, 20).map((s) => `ZH: ${s.source}\nEN: ${s.target}`).join('\n\n')}`;

  const prompt = `You are a translation review assistant for API docs. Help modify translations. Respond in the user's language. When suggesting a revision, clearly mark it with "Revised: ..."\n\n${context}\n\nQuestion: ${question}`;

  let answer = 'No API key configured';

  // 优先 DeepSeek
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
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.3,
        }),
      });
      const data = await res.json();
      answer = data.choices?.[0]?.message?.content || 'No response';
    } catch (e) {
      answer = `DeepSeek error: ${e.message}`;
    }
  } else if (process.env.GEMINI_API_KEY) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
          }),
        }
      );
      const data = await res.json();
      answer = data.candidates?.[0]?.content?.parts?.[0]?.text || 'No response';
    } catch (e) {
      answer = `Gemini error: ${e.message}`;
    }
  } else if (process.env.OPENAI_API_KEY) {
    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o',
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      const data = await res.json();
      answer = data.choices?.[0]?.message?.content || 'No response';
    } catch (e) {
      answer = `OpenAI error: ${e.message}`;
    }
  }

  const revisedMatch = answer.match(/(?:Revised|修改后|建议译文)[^:：]*[：:]\s*(.+)/i);

  return NextResponse.json({
    answer,
    revisedTarget: revisedMatch ? revisedMatch[1].trim() : null,
    segmentId,
  });
}
