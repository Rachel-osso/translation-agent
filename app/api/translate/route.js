import { NextResponse } from 'next/server';
import { segmentChinese } from '@/lib/segmenter';
import { loadGlossary } from '@/lib/glossary';
import { translateSegments } from '@/lib/translator';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

export async function POST(request) {
  const startTime = Date.now();

  try {
    const body = await request.json();
    const { url, rawText, engine = 'siliconflow' } = body;

    let content = rawText || '';

    // 抓取 URL（限时 5 秒）
    if (url && !content) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      try {
        const res = await fetch(url, {
          headers: { 'User-Agent': 'Mozilla/5.0 TranslationAgent/1.0' },
          signal: controller.signal,
        });
        content = await res.text();
      } catch (e) {
        return NextResponse.json({ error: 'Failed to fetch URL: ' + e.message }, { status: 400 });
      } finally {
        clearTimeout(timeout);
      }
    }

    if (!content) {
      return NextResponse.json({ error: 'No content provided' }, { status: 400 });
    }

    // 拆分句段
    const segments = segmentChinese(content);
    if (segments.length === 0) {
      return NextResponse.json({ error: 'No translatable content found in the page' }, { status: 400 });
    }

    // 加载术语库（TM 暂时跳过以加快速度）
    let glossaryEntries = [];
    try {
      glossaryEntries = await loadGlossary();
    } catch (e) {
      console.warn('Glossary load failed, using empty:', e.message);
    }

    // 分离代码块
    const toTranslate = segments.filter((s) => !s.noTranslate);
    const codeBlocks = segments.filter((s) => s.noTranslate);

    // 如果句段太多，分批处理（每批最多 30 段）
    let translated = [];
    const batchSize = 30;
    for (let i = 0; i < toTranslate.length; i += batchSize) {
      const batch = toTranslate.slice(i, i + batchSize);
      const batchResult = await translateSegments(batch, [], glossaryEntries, engine);
      translated.push(...batchResult);
    }

    // 合并
    const allSegments = [
      ...translated,
      ...codeBlocks.map((s) => ({ ...s, target: s.source, origin: 'Code (kept)' })),
    ].sort((a, b) => parseInt(a.id.split('_')[1]) - parseInt(b.id.split('_')[1]));

    const outputHtml = allSegments.map((s) => `<${s.tag}>${s.target}</${s.tag}>`).join('\n');
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    return NextResponse.json({
      success: true,
      segments: allSegments,
      outputHtml,
      stats: {
        totalSegments: segments.length,
        tmExactMatches: translated.filter((s) => s.tmScore === 100).length,
        tmFuzzyMatches: translated.filter((s) => s.tmScore >= 70 && s.tmScore < 100).length,
        aiTranslated: translated.filter((s) => s.origin && !s.origin.startsWith('TM')).length,
        codeBlocks: codeBlocks.length,
        timeSeconds: elapsed,
      },
    });
  } catch (error) {
    console.error('Translate API error:', error);
    return NextResponse.json({ error: error.message || 'Unknown error' }, { status: 500 });
  }
}
