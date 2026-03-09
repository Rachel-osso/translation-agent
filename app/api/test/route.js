import { NextResponse } from 'next/server';

export async function GET() {
  const results = {
    siliconflowKeySet: !!process.env.SILICONFLOW_API_KEY,
    deepseekKeySet: !!process.env.DEEPSEEK_API_KEY,
    geminiKeySet: !!process.env.GEMINI_API_KEY,
    openaiKeySet: !!process.env.OPENAI_API_KEY,
    tests: {},
    errors: [],
  };

  // 测试 SiliconFlow
  if (process.env.SILICONFLOW_API_KEY) {
    try {
      const res = await fetch('https://api.siliconflow.cn/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.SILICONFLOW_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'Qwen/Qwen2.5-72B-Instruct',
          messages: [{ role: 'user', content: 'Translate to English: 获取部门用户详情' }],
          temperature: 0.1,
          max_tokens: 100,
        }),
      });
      const data = await res.json();
      if (data.error) {
        results.errors.push('SiliconFlow: ' + (data.error.message || JSON.stringify(data.error)));
      } else {
        results.tests.siliconflow = data.choices?.[0]?.message?.content || 'empty';
      }
    } catch (e) {
      results.errors.push('SiliconFlow: ' + e.message);
    }
  }

  return NextResponse.json(results);
}
