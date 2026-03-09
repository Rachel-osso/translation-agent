import { NextResponse } from 'next/server';

export async function POST(request) {
  const { question, segments, segmentId } = await request.json();

  const seg = segmentId ? segments.find((s) => s.id === segmentId) : null;
  const context = seg
    ? `Segment:\nChinese: ${seg.source}\nEnglish: ${seg.target}`
    : `Translation:\n${segments.slice(0, 20).map((s) => `ZH: ${s.source}\nEN: ${s.target}`).join('\n\n')}`;

  const systemPrompt = `You are a translation review assistant for API docs. Help modify translations. Respond in the user's language. When suggesting a revision, clearly mark it with "Revised: ..."`;
  const userMessage = `${context}\n\nQuestion: ${question}`;

  let answer;

  // 优先用 Gemini（免费）
  const geminiKey = process.env.GEMINI_API_KEY;
  if (geminiKey) {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemPrompt }] },
          contents: [{ parts: [{ text: userMessage }] }],
          generationConfig: { temperature: 0.3 },
        }),
      }
    );
    const data = await res.json();
    answer = data.candidates?.[0]?.content?.parts?.[0]?.text || 'No response from Gemini';
  } else {
    // 回退到 OpenAI
    const OpenAI = (await import('openai')).default;
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
    });
    answer = response.choices[0].message.content;
  }

  const revisedMatch = answer.match(/(?:Revised|修改后|建议译文)[^:：]*[：:]\s*(.+)/i);

  return NextResponse.json({
    answer,
    revisedTarget: revisedMatch ? revisedMatch[1].trim() : null,
    segmentId,
  });
}
