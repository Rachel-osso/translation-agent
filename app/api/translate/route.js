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

    // 代码块不翻译
    const toTranslate = segments.filter((s) => !s.noTranslate);
    const codeBlocks = segments.filter((s) => s.noTranslate);

    const translated = await translateSegments(toTranslate, tmEntries, glossaryEntries, engine);

    // 合并代码块（原样保留）
    const allSegments = [...translated, ...codeBlocks.map((s) => ({ ...s, target: s.source, origin: 'Code (no translate)' }))];
    allSegments.sort((a, b) => {
      const numA = parseInt(a.id.split('_')[1]);
      const numB = parseInt(b.id.split('_')[1]);
      return numA - numB;
    });

    // 生成适配文档平台的 HTML
    const outputHtml = assembleHtml(allSegments);

    const stats = {
      totalSegments: segments.length,
      tmExactMatches: translated.filter((s) => s.tmScore === 100).length,
      tmFuzzyMatches: translated.filter((s) => s.tmScore >= 70 && s.tmScore < 100).length,
      aiTranslated: translated.filter((s) => s.origin?.startsWith('AI')).length,
      codeBlocks: codeBlocks.length,
    };

    return NextResponse.json({ success: true, segments: allSegments, outputHtml, stats });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * 按文档平台 HTML 格式组装输出
 * 
 * 格式规范:
 *   一级标题:  <h2>...</h2>
 *   二级标题:  <h3>...</h3>
 *   三级标题:  <p><strong>...</strong></p>
 *   加粗:      <p><strong>...</strong></p>
 *   代码块:    <pre class="snippet">...</pre>
 *   斜体:      <p><em>...</em></p>
 *   路径:      <span class="ed_lujing">...</span>
 *   公式:      <span class="ed_gongshi">...</span>
 *   高亮:      <span class="ed_jinggao">...</span>
 *   SQL:       <span class="ed_sql">...</span>
 *   有序列表:  <ol><li><p>...</p></li></ol>
 *   无序列表:  <ul><li><p>...</p></li></ul>
 *   表格:      <table><tbody><tr>...</tr></tbody></table>
 *   空格:      &nbsp;
 */
function assembleHtml(segments) {
  const lines = [];
  let inOrderedList = false;
  let inUnorderedList = false;
  let inTable = false;
  let tableRows = [];

  for (const seg of segments) {
    // 关闭之前的列表/表格（如果当前不是同类型）
    if (seg.format !== 'ordered-list' && inOrderedList) {
      lines.push('</ol>');
      inOrderedList = false;
    }
    if (seg.format !== 'unordered-list' && inUnorderedList) {
      lines.push('</ul>');
      inUnorderedList = false;
    }

    switch (seg.format) {
      case 'heading':
        // h2 = 一级标题, h3 = 二级标题
        lines.push(`<${seg.htmlTag}>\n    ${seg.target}\n</${seg.htmlTag}>`);
        break;

      case 'sub-heading':
        // 三级标题: <p><strong>...</strong></p>
        lines.push(`<p>\n    <strong>${seg.target}</strong>\n</p>`);
        break;

      case 'code':
        // 代码块: <pre class="snippet">...</pre>
        lines.push(`<pre class="snippet">${seg.target}</pre>`);
        break;

      case 'ordered-list':
        if (!inOrderedList) {
          lines.push('<ol style="list-style-type: decimal;">');
          inOrderedList = true;
        }
        lines.push(`    <li>\n        <p>\n            ${seg.target}\n        </p>\n    </li>`);
        break;

      case 'unordered-list':
        if (!inUnorderedList) {
          lines.push('<ul style="list-style-type: disc;">');
          inUnorderedList = true;
        }
        lines.push(`    <li>\n        <p>\n            ${seg.target}\n        </p>\n    </li>`);
        break;

      case 'table-cell':
        // 表格单元格暂存
        tableRows.push({ tag: seg.htmlTag, content: seg.target });
        break;

      case 'paragraph':
      default:
        // 普通段落，处理内联格式
        let text = seg.target;
        if (seg.inlineFormats?.includes('bold')) {
          text = `<strong>${text}</strong>`;
        }
        if (seg.inlineFormats?.includes('italic')) {
          text = `<em>${text}</em>`;
        }
        lines.push(`<p>\n    ${text}\n</p>`);
        break;
    }
  }

  // 关闭未关闭的列表
  if (inOrderedList) lines.push('</ol>');
  if (inUnorderedList) lines.push('</ul>');

  // 处理表格
  if (tableRows.length > 0) {
    lines.push('<table>\n    <tbody>');
    // 简单按每2个单元格一行处理
    for (let i = 0; i < tableRows.length; i += 2) {
      const cell1 = tableRows[i];
      const cell2 = tableRows[i + 1];
      const isHeader = cell1?.tag === 'th';
      const rowClass = i === 0 ? ' class="firstRow"' : '';
      let row = `        <tr${rowClass}>\n`;
      if (cell1) {
        const tag = cell1.tag;
        const attrs = tag === 'th' ? ' width="368" valign="middle" align="left"' : ' width="368" valign="top"';
        row += `            <${tag}${attrs}>${cell1.content}</${tag}>\n`;
      }
      if (cell2) {
        const tag = cell2.tag;
        const attrs = tag === 'th' ? ' width="368" valign="middle" align="left"' : ' width="368" valign="top"';
        row += `            <${tag}${attrs}>${cell2.content}</${tag}>\n`;
      }
      row += `        </tr>`;
      lines.push(row);
    }
    lines.push('    </tbody>\n</table>');
  }

  return lines.join('\n\n');
}
