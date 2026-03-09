'use client';
import { useState } from 'react';

export default function TranslationAgent() {
  const [step, setStep] = useState('input');
  const [sourceUrl, setSourceUrl] = useState('');
  const [rawText, setRawText] = useState('');
  const [segments, setSegments] = useState([]);
  const [stats, setStats] = useState(null);
  const [engine, setEngine] = useState('openai');
  const [enUrl, setEnUrl] = useState('');
  const [alignResult, setAlignResult] = useState(null);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState(null);

  async function handleTranslate() {
    if (!sourceUrl && !rawText) return alert('Please enter a URL or paste Chinese text');
    setLoading(true);
    setStep('translating');
    try {
      const res = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: sourceUrl || undefined, rawText: rawText || undefined, engine }),
      });
      const data = await res.json();
      if (data.success) {
        setSegments(data.segments);
        setStats(data.stats);
        setStep('review');
      } else {
        alert('Error: ' + data.error);
        setStep('input');
      }
    } catch (e) {
      alert('Error: ' + e.message);
      setStep('input');
    }
    setLoading(false);
  }

  function copyHtml() {
    const html = segments.map((s) => `<${s.tag}>${s.target}</${s.tag}>`).join('\n');
    navigator.clipboard.writeText(html);
    alert('✅ English HTML copied!');
  }

  function updateSegment(id, newTarget) {
    setSegments((prev) => prev.map((s) => (s.id === id ? { ...s, target: newTarget, origin: 'Manual' } : s)));
  }

  async function handleChat() {
    if (!chatInput.trim()) return;
    const msg = chatInput;
    setChatMessages((prev) => [...prev, { role: 'user', content: msg }]);
    setChatInput('');
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: msg, segments, segmentId: editingId }),
    });
    const data = await res.json();
    setChatMessages((prev) => [...prev, { role: 'assistant', content: data.answer }]);
    if (data.revisedTarget && data.segmentId) {
      setSegments((prev) => prev.map((s) => (s.id === data.segmentId ? { ...s, target: data.revisedTarget } : s)));
    }
  }

  async function handleAlign() {
    if (!enUrl || !sourceUrl) return alert('Please enter both URLs');
    setLoading(true);
    try {
      const res = await fetch('/api/align', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ zhUrl: sourceUrl, enUrl }),
      });
      const data = await res.json();
      if (data.success) { setAlignResult(data); setStep('align'); }
      else alert('Error: ' + data.error);
    } catch (e) { alert('Error: ' + e.message); }
    setLoading(false);
  }

  function downloadExcel() {
    if (!alignResult?.excelBase64) return;
    const blob = new Blob([Uint8Array.from(atob(alignResult.excelBase64), (c) => c.charCodeAt(0))], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `translation_memory_${new Date().toISOString().split('T')[0]}.xlsx`;
    a.click();
  }

  const th = { padding: '10px 12px', textAlign: 'left', fontSize: 13, borderBottom: '2px solid #e2e8f0' };
  const td = { padding: '10px 12px', fontSize: 13, verticalAlign: 'top', borderBottom: '1px solid #f1f5f9' };

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: 20, fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      <h1 style={{ borderBottom: '3px solid #0070f3', paddingBottom: 10 }}>🌐 Translation Agent</h1>
      <p style={{ color: '#666', marginBottom: 24 }}>Chinese API Docs → English | TM + Glossary + AI</p>

      {/* INPUT */}
      <div style={{ background: '#f6f8fa', padding: 20, borderRadius: 8, marginBottom: 20 }}>
        <h3 style={{ marginTop: 0 }}>① Input</h3>
        <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
          <input value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} placeholder="Chinese doc URL (e.g. https://open.dingtalk.com/...)" style={{ flex: 1, padding: '10px 14px', borderRadius: 6, border: '1px solid #ddd', fontSize: 14 }} />
          <select value={engine} onChange={(e) => setEngine(e.target.value)} style={{ padding: '10px 14px', borderRadius: 6, border: '1px solid #ddd' }}>
            <option value="openai">OpenAI GPT-4o</option>
            <option value="rapunzel">Rapunzel</option>
          </select>
        </div>
        <textarea value={rawText} onChange={(e) => setRawText(e.target.value)} placeholder="Or paste Chinese text here..." rows={4} style={{ width: '100%', padding: '10px 14px', borderRadius: 6, border: '1px solid #ddd', fontSize: 14, resize: 'vertical', boxSizing: 'border-box' }} />
        <button onClick={handleTranslate} disabled={loading} style={{ marginTop: 10, padding: '12px 28px', borderRadius: 6, border: 'none', background: loading ? '#ccc' : '#0070f3', color: 'white', cursor: loading ? 'wait' : 'pointer', fontWeight: 'bold', fontSize: 15 }}>
          {loading ? '⏳ Translating...' : '🚀 Translate'}
        </button>
      </div>

      {/* REVIEW */}
      {step === 'review' && (
        <>
          {stats && (
            <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
              {[
                { label: 'Total', value: stats.totalSegments, color: '#0070f3' },
                { label: 'TM 100%', value: stats.tmExactMatches, color: '#10b981' },
                { label: 'TM Fuzzy', value: stats.tmFuzzyMatches, color: '#f59e0b' },
                { label: 'AI', value: stats.aiTranslated, color: '#8b5cf6' },
              ].map((s) => (
                <div key={s.label} style={{ flex: 1, padding: 14, borderRadius: 8, background: 'white', border: `2px solid ${s.color}`, textAlign: 'center' }}>
                  <div style={{ fontSize: 26, fontWeight: 'bold', color: s.color }}>{s.value}</div>
                  <div style={{ fontSize: 11, color: '#666' }}>{s.label}</div>
                </div>
              ))}
            </div>
          )}

          <button onClick={copyHtml} style={{ padding: '10px 20px', borderRadius: 6, border: '2px solid #10b981', background: '#ecfdf5', color: '#065f46', fontWeight: 'bold', cursor: 'pointer', marginBottom: 16 }}>📋 Copy English HTML</button>

          <h3>② Review & Edit</h3>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 20 }}>
              <thead>
                <tr style={{ background: '#f1f5f9' }}>
                  <th style={{ ...th, width: 36 }}>#</th>
                  <th style={{ ...th, width: '40%' }}>Chinese</th>
                  <th style={{ ...th, width: '40%' }}>English (click to edit)</th>
                  <th style={{ ...th, width: 90 }}>Origin</th>
                </tr>
              </thead>
              <tbody>
                {segments.map((seg, i) => (
                  <tr key={seg.id}>
                    <td style={td}>{i + 1}</td>
                    <td style={{ ...td, color: '#374151' }}>{seg.source}</td>
                    <td style={{ ...td, cursor: 'text', background: editingId === seg.id ? '#fffbeb' : 'white' }} contentEditable suppressContentEditableWarning onBlur={(e) => updateSegment(seg.id, e.target.innerText)} onClick={() => setEditingId(seg.id)}>{seg.target}</td>
                    <td style={{ ...td, fontSize: 11, color: '#9ca3af' }}>{seg.origin}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* CHAT */}
          <div style={{ background: '#f8fafc', padding: 20, borderRadius: 8, marginBottom: 20 }}>
            <h3 style={{ marginTop: 0 }}>💬 Ask & Modify</h3>
            <div style={{ maxHeight: 250, overflowY: 'auto', marginBottom: 10 }}>
              {chatMessages.map((m, i) => (
                <div key={i} style={{ padding: 10, marginBottom: 6, borderRadius: 8, background: m.role === 'user' ? '#dbeafe' : '#f0fdf4', whiteSpace: 'pre-wrap' }}>
                  <strong>{m.role === 'user' ? 'You' : 'Agent'}:</strong> {m.content}
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <input value={chatInput} onChange={(e) => setChatInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleChat()} placeholder={editingId ? `Ask about segment ${editingId}...` : 'Ask about the translation...'} style={{ flex: 1, padding: '10px 14px', borderRadius: 6, border: '1px solid #ddd' }} />
              <button onClick={handleChat} style={{ padding: '10px 20px', borderRadius: 6, border: 'none', background: '#0070f3', color: 'white', cursor: 'pointer' }}>Send</button>
            </div>
          </div>

          {/* ENGLISH URL */}
          <div style={{ background: '#fefce8', padding: 20, borderRadius: 8, marginBottom: 20 }}>
            <h3 style={{ marginTop: 0 }}>③ Final English URL</h3>
            <div style={{ display: 'flex', gap: 10 }}>
              <input value={enUrl} onChange={(e) => setEnUrl(e.target.value)} placeholder="https://open.dingtalk.com/document/en/..." style={{ flex: 1, padding: '10px 14px', borderRadius: 6, border: '1px solid #ddd' }} />
              <button onClick={handleAlign} disabled={loading} style={{ padding: '10px 20px', borderRadius: 6, border: 'none', background: loading ? '#ccc' : '#f59e0b', color: 'white', cursor: loading ? 'wait' : 'pointer', fontWeight: 'bold' }}>
                {loading ? '⏳...' : '🔗 Align & Save TM'}
              </button>
            </div>
          </div>
        </>
      )}

      {/* ALIGN RESULTS */}
      {step === 'align' && alignResult && (
        <div>
          <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
            {[
              { label: 'Aligned Pairs', value: alignResult.totalPairs, color: '#10b981' },
              { label: 'Saved to TM', value: alignResult.tmUpdated, color: '#3b82f6' },
              { label: 'Term Candidates', value: alignResult.termCandidates?.length || 0, color: '#f59e0b' },
            ].map((s) => (
              <div key={s.label} style={{ flex: 1, padding: 14, borderRadius: 8, background: 'white', border: `2px solid ${s.color}`, textAlign: 'center' }}>
                <div style={{ fontSize: 26, fontWeight: 'bold', color: s.color }}>{s.value}</div>
                <div style={{ fontSize: 11 }}>{s.label}</div>
              </div>
            ))}
          </div>
          <button onClick={downloadExcel} style={{ padding: '12px 24px', borderRadius: 6, border: 'none', background: '#10b981', color: 'white', cursor: 'pointer', fontWeight: 'bold', fontSize: 15, marginBottom: 20 }}>📥 Download Excel</button>
          <h3>Preview (first 50 pairs)</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr style={{ background: '#f1f5f9' }}><th style={th}>#</th><th style={{ ...th, width: '45%' }}>Chinese</th><th style={{ ...th, width: '45%' }}>English</th></tr></thead>
            <tbody>
              {alignResult.preview.map((p) => (
                <tr key={p.index}><td style={td}>{p.index}</td><td style={td}>{p.source}</td><td style={td}>{p.target}</td></tr>
              ))}
            </tbody>
          </table>
          {alignResult.termCandidates?.length > 0 && (
            <>
              <h3 style={{ marginTop: 30 }}>🔤 Term Candidates</h3>
              <table style={{ width: 400, borderCollapse: 'collapse' }}>
                <thead><tr style={{ background: '#fef3c7' }}><th style={th}>Term</th><th style={th}>Freq</th></tr></thead>
                <tbody>{alignResult.termCandidates.map((t, i) => (<tr key={i}><td style={td}>{t.source}</td><td style={td}>{t.count}×</td></tr>))}</tbody>
              </table>
            </>
          )}
        </div>
      )}
    </div>
  );
}
