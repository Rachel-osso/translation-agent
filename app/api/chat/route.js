import { NextResponse } from 'next/server';

export async function POST(request) {
  const { question, segments, segmentId } = await request.json();

  const seg = segmentId ? segments.find((s) => s.id === segmentId) : null;
  const context = seg
    ? `Segment:\nChinese: ${seg.source}\nEnglish: ${seg.target}`
    : `Translation:\n${segments.slice(0, 20).map((s) => `ZH: ${s.source}\nEN: ${s.target}`).join('\n\n')}`;

  const prompt = `You are a translation review assistant for API docs. Help modify translations. Respond in the user's language. When suggesting a revision, clearly mark it with "Revised: ..."\n\n${context}\n\nQuestion: ${question}`;

  let answer;

  // 优先 Gemini（免费）
  const geminiKey = process.env.GEMINI_API_KEY;
  if (geminiKey) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.3 },
          }),
        }
      );
      const text = await res.text();
      const data = JSON.parse(text);
      answer = data.candidates?.[0]?.content?.parts?.[0]?.text || 'No response';
    } catch (e) {
      answer = `Gemini error: ${e.message}`;
    }
  } else if (process.env.OPENAI_API_KEY) {
    // 回退 OpenAI
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
  } else {
    answer = 'No API key configured. Please set GEMINI_API_KEY or OPENAI_API_KEY.';
  }

  const revisedMatch = answer.match(/(?:Revised|修改后|建议译文)[^:：]*[：:]\s*(.+)/i);

  return NextResponse.json({
    answer,
    revisedTarget: revisedMatch ? revisedMatch[1].trim() : null,
    segmentId,
  });
}
