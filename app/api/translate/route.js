import { NextResponse } from 'next/server';
import { segmentChinese } from '@/lib/segmenter';
import { loadTM } from '@/lib/memory';
import { loadGlossary } from '@/lib/glossary';
import { translateSegments } from '@/lib/translator';

export const maxDuration = 300;

export async function POST(request) {
  try {
    const { url, rawText, engine = 'gemini' } = await request.json();

    let content = rawText || '';

    // 抓取 URL 内容
    if (url && !content) {
      try {
        const res = await fetch(url, {
          headers: { 'User-Agent': 'Mozilla/5.0 TranslationAgent/1.0' },
          signal: AbortSignal.timeout(15000),
        });
        if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
        content = await res.text();
      } catch (fetchErr) {
        return NextResponse.json(
          { error: `Failed to fetch URL: ${fetchErr.message}` },
          { status: 400 }
        );
      }
    }

    if (!content) {
      return NextResponse.json({ error: 'No content to translate' }, { status: 400 });
    }

    // 拆分句段
    const segments = segmentChinese(content);

    if (segments.length === 0) {
      return NextResponse.json({ error: 'No translatable content found' }, { status: 400 });
    }

    // 加载 TM 和术语库
    let tmEntries = [];
    let glossaryEntries = [];
    try {
      [tmEntries, glossaryEntries] = await Promise.all([loadTM(), loadGlossary()]);
    } catch (e) {
      console.warn('Failed to load TM/Glossary, using defaults:', e.message);
      const { loadGlossary: lg } = await import('@/lib/glossary');
      glossaryEntries = await lg();
    }

    // 代码块不翻译
    const toTranslate = segments.filter((s) => !s.noTranslate);
    const codeBlocks = segments.filter((s) => s.noTranslate);

    // 翻译
    const translated = await translateSegments(toTranslate, tmEntries, glossaryEntries, engine);

    // 合并
    const allSegments = [
      ...translated,
      ...codeBlocks.map((s) => ({ ...s, target: s.source, origin: 'Code (kept)' })),
    ].sort((a, b) => parseInt(a.id.split('_')[1]) - parseInt(b.id.split('_')[1]));

    // 生成 HTML
    const outputHtml = allSegments
      .map((s) => `<${s.tag}>${s.target}</${s.tag}>`)
      .join('\n');

    const stats = {
      totalSegments: segments.length,
      tmExactMatches: translated.filter((s) => s.tmScore === 100).length,
      tmFuzzyMatches: translated.filter((s) => s.tmScore >= 70 && s.tmScore < 100).length,
      aiTranslated: translated.filter((s) => s.origin && !s.origin.startsWith('TM')).length,
      codeBlocks: codeBlocks.length,
    };

    return NextResponse.json({ success: true, segments: allSegments, outputHtml, stats });
  } catch (error) {
    console.error('Translation API error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
