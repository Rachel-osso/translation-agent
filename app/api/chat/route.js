import { NextResponse } from 'next/server';
import OpenAI from 'openai';

export async function POST(request) {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const { question, segments, segmentId } = await request.json();

  const seg = segmentId ? segments.find((s) => s.id === segmentId) : null;
  const context = seg
    ? `Segment:\nChinese: ${seg.source}\nEnglish: ${seg.target}`
    : `Translation:\n${segments.slice(0, 20).map((s) => `ZH: ${s.source}\nEN: ${s.target}`).join('\n\n')}`;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `You are a translation review assistant for API docs. Help modify translations. Respond in the user's language. When suggesting a revision, clearly mark it with "Revised: ..."`,
      },
      { role: 'user', content: `${context}\n\nQuestion: ${question}` },
    ],
  });

  const answer = response.choices[0].message.content;
  const revisedMatch = answer.match(/(?:Revised|修改后|建议译文)[^:：]*[：:]\s*(.+)/i);

  return NextResponse.json({
    answer,
    revisedTarget: revisedMatch ? revisedMatch[1].trim() : null,
    segmentId,
  });
}
