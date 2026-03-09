/**
 * 按中文句号、标题、列表等拆分文档为翻译句段
 * 适配文档平台 HTML 格式规范
 */
export function segmentChinese(html) {
  const segments = [];

  // ---- 1. 提取标题 (h2=一级, h3=二级) ----
  const headingPattern = /<(h[1-6])[^>]*>([\s\S]*?)<\/\1>/gi;
  let match;
  const processed = new Set();

  while ((match = headingPattern.exec(html)) !== null) {
    const tag = match[1].toLowerCase();
    const inner = stripTags(match[2]).trim();
    if (!inner) continue;
    segments.push({
      id: `seg_${segments.length}`,
      source: inner,
      tag: tag,
      htmlTag: tag, // h2, h3
      format: 'heading',
    });
    processed.add(match.index);
  }

  // ---- 2. 提取三级标题 <p><strong>...</strong></p> (整段都是 strong) ----
  const strongTitlePattern = /<p[^>]*>\s*<strong>([\s\S]*?)<\/strong>\s*<\/p>/gi;
  while ((match = strongTitlePattern.exec(html)) !== null) {
    const inner = stripTags(match[1]).trim();
    if (!inner) continue;
    segments.push({
      id: `seg_${segments.length}`,
      source: inner,
      tag: 'p',
      htmlTag: 'p_strong',
      format: 'sub-heading',
    });
  }

  // ---- 3. 提取代码块 <pre class="snippet"> ----
  const codePattern = /<pre[^>]*class="snippet"[^>]*>([\s\S]*?)<\/pre>/gi;
  while ((match = codePattern.exec(html)) !== null) {
    const inner = match[1].trim();
    if (!inner) continue;
    segments.push({
      id: `seg_${segments.length}`,
      source: inner,
      tag: 'pre',
      htmlTag: 'pre_snippet',
      format: 'code',
      noTranslate: true, // 代码块不翻译
    });
  }

  // ---- 4. 提取表格单元格 ----
  const cellPattern = /<t([hd])[^>]*>([\s\S]*?)<\/t\1>/gi;
  while ((match = cellPattern.exec(html)) !== null) {
    const cellTag = match[1] === 'h' ? 'th' : 'td';
    const inner = stripTags(match[2]).trim();
    if (!inner) continue;
    segments.push({
      id: `seg_${segments.length}`,
      source: inner,
      tag: cellTag,
      htmlTag: cellTag,
      format: 'table-cell',
    });
  }

  // ---- 5. 提取列表项 ----
  const liPattern = /<li[^>]*>([\s\S]*?)<\/li>/gi;
  while ((match = liPattern.exec(html)) !== null) {
    const inner = stripTags(match[1]).trim();
    if (!inner) continue;
    // 判断是有序还是无序
    const beforeLi = html.substring(Math.max(0, match.index - 100), match.index);
    const isOrdered = /<ol[^>]*>/i.test(beforeLi);
    segments.push({
      id: `seg_${segments.length}`,
      source: inner,
      tag: 'li',
      htmlTag: 'li',
      format: isOrdered ? 'ordered-list' : 'unordered-list',
    });
  }

  // ---- 6. 提取普通段落 <p>...</p> ----
  const pPattern = /<p[^>]*>([\s\S]*?)<\/p>/gi;
  while ((match = pPattern.exec(html)) !== null) {
    const raw = match[1].trim();
    if (!raw) continue;

    // 跳过已被三级标题匹配的 <p><strong>
    if (/^\s*<strong>[\s\S]*<\/strong>\s*$/.test(raw)) continue;

    // 检测内联格式
    const inlineFormats = detectInlineFormats(raw);
    const plainText = stripTags(raw).trim();
    if (!plainText) continue;

    // 按中文句号拆分
    const sentences = splitBySentence(plainText);
    sentences.forEach((sentence) => {
      if (sentence.trim()) {
        segments.push({
          id: `seg_${segments.length}`,
          source: sentence.trim(),
          tag: 'p',
          htmlTag: 'p',
          format: 'paragraph',
          inlineFormats: inlineFormats,
        });
      }
    });
  }

  // ---- 7. 如果没有匹配到任何 HTML，按纯文本处理 ----
  if (segments.length === 0) {
    const sentences = splitBySentence(html.replace(/<[^>]+>/g, ''));
    sentences.forEach((sentence) => {
      if (sentence.trim()) {
        segments.push({
          id: `seg_${segments.length}`,
          source: sentence.trim(),
          tag: 'p',
          htmlTag: 'p',
          format: 'paragraph',
          inlineFormats: [],
        });
      }
    });
  }

  return segments;
}

/**
 * 检测段落内的内联格式标签
 */
function detectInlineFormats(html) {
  const formats = [];
  if (/<strong>/.test(html)) formats.push('bold');
  if (/<em>/.test(html)) formats.push('italic');
  if (/class="ed_lujing"/.test(html)) formats.push('path');
  if (/class="ed_gongshi"/.test(html)) formats.push('formula');
  if (/class="ed_jinggao"/.test(html)) formats.push('highlight');
  if (/class="ed_sql"/.test(html)) formats.push('sql');
  if (/<code/.test(html)) formats.push('inline-code');
  return formats;
}

/**
 * 按中文句号拆分
 */
function splitBySentence(text) {
  return text
    .split(/(?<=[。！？；\.\!\?])\s*/)
    .filter((s) => s.trim().length > 0);
}

/**
 * 去除 HTML 标签
 */
function stripTags(html) {
  return html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
