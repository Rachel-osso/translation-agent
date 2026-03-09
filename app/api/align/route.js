import { NextResponse } from 'next/server';
import { segmentChinese } from '@/lib/segmenter';
import { saveTM, generateTMExcel } from '@/lib/memory';
import { extractTermCandidates } from '@/lib/glossary';

export const maxDuration = 60;

export async function POST(request) {
  try {
    const { zhUrl, enUrl } = await request.json();

    const [zhRes, enRes] = await Promise.all([
      fetch(zhUrl, { headers: { 'User-Agent': 'TranslationAgent/1.0' } }),
      fetch(enUrl, { headers: { 'User-Agent': 'TranslationAgent/1.0' } }),
    ]);
    const [zhHtml, enHtml] = await Promise.all([zhRes.text(), enRes.text()]);

    const zhSegs = segmentChinese(zhHtml);
    const enSentences = enHtml
      .replace(/<[^>]+>/g, ' ')
      .split(/(?<=[.!?])\s+/)
      .filter((s) => s.trim());

    const aligned = [];
    const maxLen = Math.max(zhSegs.length, enSentences.length);
    for (let i = 0; i < maxLen; i++) {
      aligned.push({
        index: i + 1,
        source: zhSegs[i]?.source || '',
        target: enSentences[i]?.trim() || '',
      });
    }

    const excelBuffer = generateTMExcel(
      aligned.filter((a) => a.source && a.target).map((a) => ({
        source: a.source,
        target: a.target,
        project: new URL(zhUrl).hostname,
        date: new Date().toISOString().split('T')[0],
      }))
    );

    const validPairs = aligned.filter((a) => a.source && a.target);
    await saveTM(validPairs);

    const termCandidates = extractTermCandidates(zhSegs.map((s) => s.source));

    return NextResponse.json({
      success: true,
      totalPairs: aligned.length,
      preview: aligned.slice(0, 50),
      termCandidates: termCandidates.slice(0, 30),
      excelBase64: Buffer.from(excelBuffer).toString('base64'),
      tmUpdated: validPairs.length,
    });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
