import { NextResponse } from 'next/server';
import { segmentChinese } from '@/lib/segmenter';
import { loadTM } from '@/lib/memory';
import { loadGlossary } from '@/lib/glossary';
import { translateSegments } from '@/lib/translator';

export const maxDuration = 60;

export async function POST(request) {
  const startTime = Date.now();

  try {
    const { url, rawText, engine = 'gemini' } = await request.json();

    let content = rawText || '';

    // 抓取 URL
    if (url && !content) {
      try {
        const res = await fetch(url, {
          headers: { 'User-Agent': 'Mozilla/5.0 TranslationAgent/1.0' },
          signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        content = await res.text();
      } catch (e) {
        return NextResponse.json({ error: `Failed to fetch URL: ${e.message}` }, { status: 400 });
      }
    }

    if (!content) {
      return NextResponse.json({ error: 'No content provided' }, { status: 400 });
    }

    // 拆分句段
    const segments = segmentChinese(content);
    if (segments.length === 0) {
      return NextResponse.json({ error: 'No translatable content found' }, { status: 400 });
    }

    // 加载 TM + 术语库（并行）
    let tmEntries = [];
    let glossaryEntries = [];
    try {
      [tmEntries, glossaryEntries] = await Promise.all([loadTM(), loadGlossary()]);
    } catch (e) {
      // 使用内置术语库
      const { loadGlossary: lg } = await import('@/lib/glossary');
      glossaryEntries = await lg();
    }

    // 分离代码块
    const toTranslate = segments.filter((s) => !s.noTranslate);
    const codeBlocks = segments.filter((s) => s.noTranslate);

    // 🚀 一次调用翻译所有句段
    const translated = await translateSegments(toTranslate, tmEntries, glossaryEntries, engine);

    // 合并结果
    const allSegments = [
      ...translated,
      ...codeBlocks.map((s) => ({ ...s, target: s.source, origin: 'Code (kept)' })),
    ].sort((a, b) => parseInt(a.id.split('_')[1]) - parseInt(b.id.split('_')[1]));

    const outputHtml = allSegments.map((s) => `<${s.tag}>${s.target}</${s.tag}>`).join('\n');

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    const stats = {
      totalSegments: segments.length,
      tmExactMatches: translated.filter((s) => s.tmScore === 100).length,
      tmFuzzyMatches: translated.filter((s) => s.tmScore >= 70 && s.tmScore < 100).length,
      aiTranslated: translated.filter((s) => s.origin && !s.origin.startsWith('TM')).length,
      codeBlocks: codeBlocks.length,
      timeSeconds: elapsed,
    };

    return NextResponse.json({ success: true, segments: allSegments, outputHtml, stats });
  } catch (error) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.error(`Translation failed after ${elapsed}s:`, error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
