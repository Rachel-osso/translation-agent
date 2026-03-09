/**
 * 按中文句号、标题、列表等拆分文档为翻译句段
 */
export function segmentChinese(html) {
  const segments = [];

  // 按 HTML 块级元素拆分
  const blockPattern = /<(h[1-6]|p|li|td|th|div|blockquote|figcaption)[^>]*>([\s\S]*?)<\/\1>/gi;
  let match;

  while ((match = blockPattern.exec(html)) !== null) {
    const tag = match[1];
    const innerText = match[2].trim();
    if (!innerText) continue;

    if (tag === 'p' || tag === 'div') {
      const sentences = splitBySentence(innerText);
      sentences.forEach((sentence) => {
        if (sentence.trim()) {
          segments.push({
            id: `seg_${segments.length}`,
            source: sentence.trim(),
            tag: tag,
          });
        }
      });
    } else {
      segments.push({
        id: `seg_${segments.length}`,
        source: innerText,
        tag: tag,
      });
    }
  }

  // 如果没有匹配到 HTML 标签，按纯文本处理
  if (segments.length === 0) {
    const sentences = splitBySentence(html.replace(/<[^>]+>/g, ''));
    sentences.forEach((sentence) => {
      if (sentence.trim()) {
        segments.push({
          id: `seg_${segments.length}`,
          source: sentence.trim(),
          tag: 'p',
        });
      }
    });
  }

  return segments;
}

function splitBySentence(text) {
  return text
    .split(/(?<=[。！？；\.\!\?])\s*/)
    .filter((s) => s.trim().length > 0);
}
