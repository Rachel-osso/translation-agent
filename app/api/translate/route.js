import { NextResponse } from 'next/server';
import { segmentChinese } from '@/lib/segmenter';
import { loadTM } from '@/lib/memory';
import { loadGlossary } from '@/lib/glossary';
import { translateSegments } from '@/lib/translator';

export const maxDuration = 60;

export async function POST(request) {
  try {
    const { url, rawText, engine = 'openai' } = await request.json();

    let content = rawText || '';
    if (url && !content) {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'TranslationAgent/1.0' },
      });
      content = await res.text();
    }

    if (!content) {
      return NextResponse.json({ error: 'No content to translate' }, { status: 400 });
    }

    const segments = segmentChinese(content);
    const [tmEntries, glossaryEntries] = await Promise.all([loadTM(), loadGlossary()]);
    const translated = await translateSegments(segments, tmEntries, glossaryEntries, engine);

    const outputHtml = translated.map((s) => `<${s.tag}>${s.target}</${s.tag}>`).join('\n');

    const stats = {
      totalSegments: segments.length,
      tmExactMatches: translated.filter((s) => s.tmScore === 100).length,
      tmFuzzyMatches: translated.filter((s) => s.tmScore >= 70 && s.tmScore < 100).length,
      aiTranslated: translated.filter((s) => s.origin.startsWith('AI')).length,
    };

    return NextResponse.json({ success: true, segments: translated, outputHtml, stats });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
