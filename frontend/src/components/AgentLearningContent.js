'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { listCorrections, getCorrectionStats, getApiBaseHint } from '@/lib/api';
import LoadingSkeleton from '@/components/LoadingSkeleton';

function formatDate(ts) {
    if (!ts) return '—';
    return new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function truncate(text, max = 100) { return !text ? '—' : text.length > max ? text.slice(0, max) + '...' : text; }

const SOURCE_LABELS = {
    agent: { label: 'AI Agent', color: 'var(--color-info, #60a5fa)' },
    kb_match: { label: 'KB Match', color: 'var(--color-success)' },
    kb_direct: { label: 'KB Direct', color: 'var(--color-success)' },
    template: { label: 'Template', color: 'var(--color-warning)' },
    unmatched: { label: 'Unmatched', color: 'var(--text-tertiary)' },
};

export default function AgentLearningContent() {
    const [corrections, setCorrections] = useState(null);
    const [total, setTotal] = useState(0);
    const [stats, setStats] = useState(null);
    const [page, setPage] = useState(1);
    const [pageSize] = useState(30);
    const [sourceFilter, setSourceFilter] = useState('');
    const [autoFilter, setAutoFilter] = useState('');
    const [toast, setToast] = useState(null);

    const toastTimeout = useRef(null);
    useEffect(() => {
        return () => {
            if (toastTimeout.current) clearTimeout(toastTimeout.current);
        };
    }, []);
    const showToast = useCallback((msg, type = 'info') => {
        if (toastTimeout.current) clearTimeout(toastTimeout.current);
        setToast({ message: msg, type });
        toastTimeout.current = setTimeout(() => setToast(null), 4000);
    }, []);

    const loadData = useCallback(async () => {
        try {
            const params = { page, pageSize };
            if (autoFilter === 'true') params.autoAdded = true;
            if (autoFilter === 'false') params.autoAdded = false;
            const data = await listCorrections(params);
            setCorrections(data.items || []); setTotal(data.total || 0);
        } catch (err) { showToast(`Failed to load corrections: ${err.message || getApiBaseHint()}`, 'error'); }
    }, [page, pageSize, autoFilter]);

    const loadStats = useCallback(async () => {
        try { const data = await getCorrectionStats(); setStats(data); } catch (err) { }
    }, []);

    useEffect(() => { loadData(); }, [loadData]);
    useEffect(() => { loadStats(); }, [loadStats]);

    const totalPages = Math.ceil(total / pageSize);
    const filteredCorrections = sourceFilter ? (corrections || []).filter((c) => c.original_source === sourceFilter) : (corrections || []);

    return (
        <>
            {toast && (
                <div className="toast-container" role="status" aria-live="polite">
                    <div className={`toast toast-${toast.type}`}>{toast.message}</div>
                </div>
            )}

            <div className="stats-grid">
                <div className="stat-card"><div className="stat-value">{stats?.total_corrections ?? 0}</div><div className="stat-label">Total Corrections</div></div>
                <div className="stat-card"><div className="stat-value">{stats?.auto_added_to_kb ?? 0}</div><div className="stat-label">Auto-Added to KB</div></div>
                <div className="stat-card"><div className="stat-value">{stats?.total_corrections > 0 ? Math.round(((stats?.auto_added_to_kb ?? 0) / stats.total_corrections) * 100) : 0}%</div><div className="stat-label">KB Enrichment Rate</div></div>
            </div>

            <div className="search-bar">
                <select className="form-select" value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)} style={{ width: 'auto', minWidth: '150px' }}>
                    <option value="">All Sources</option>
                    {Object.entries(SOURCE_LABELS).map(([key, { label }]) => <option key={key} value={key}>{label}</option>)}
                </select>
                <select className="form-select" value={autoFilter} onChange={(e) => { setAutoFilter(e.target.value); setPage(1); }} style={{ width: 'auto', minWidth: '160px' }}>
                    <option value="">All Corrections</option>
                    <option value="true">Auto-Added to KB</option>
                    <option value="false">Not Added to KB</option>
                </select>
            </div>

            {corrections === null ? (
                <LoadingSkeleton lines={6} showHeader />
            ) : filteredCorrections.length > 0 ? (
                <>
                    <div className="card table-responsive" style={{ padding: 0, overflow: 'hidden' }}>
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <th>Question</th>
                                    <th>Original Answer</th>
                                    <th>Corrected Answer</th>
                                    <th style={{ width: '100px' }}>Source</th>
                                    <th style={{ width: '80px' }}>Confidence</th>
                                    <th style={{ width: '80px' }}>Auto KB</th>
                                    <th style={{ width: '110px' }}>Date</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredCorrections.map((c) => {
                                    const sourceMeta = SOURCE_LABELS[c.original_source] || { label: c.original_source || '—', color: 'var(--text-secondary)' };
                                    return (
                                        <tr key={c.id}>
                                            <td className="cell-truncate" style={{ maxWidth: '200px' }}>{truncate(c.question_text, 80)}</td>
                                            <td className="cell-truncate" style={{ color: 'var(--color-danger)', maxWidth: '160px', fontSize: '0.82rem' }}>{truncate(c.original_answer, 60)}</td>
                                            <td className="cell-truncate" style={{ color: 'var(--color-success)', maxWidth: '160px', fontSize: '0.82rem' }}>{truncate(c.corrected_answer, 60)}</td>
                                            <td>
                                                <span style={{ padding: '0.15rem 0.45rem', borderRadius: 'var(--radius-sm)', background: `color-mix(in srgb, ${sourceMeta.color} 12%, transparent)`, color: sourceMeta.color, fontSize: '0.78rem', fontWeight: 500 }}>
                                                    {sourceMeta.label}
                                                </span>
                                            </td>
                                            <td style={{ textAlign: 'center', fontSize: '0.82rem', fontFamily: 'var(--font-mono)' }}>{c.original_confidence != null ? (c.original_confidence * 100).toFixed(0) + '%' : '—'}</td>
                                            <td style={{ textAlign: 'center' }}>{c.auto_added_to_kb ? <span style={{ color: 'var(--color-success)' }}>Yes</span> : <span style={{ color: 'var(--text-tertiary)' }}>—</span>}</td>
                                            <td style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>{formatDate(c.created_at)}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                    {totalPages > 1 && (
                        <div className="pagination">
                            <button disabled={page <= 1} onClick={() => setPage(page - 1)}>{"\u2190"}</button>
                            <span style={{ padding: '0.4rem 0.75rem', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Page {page} of {totalPages}</span>
                            <button disabled={page >= totalPages} onClick={() => setPage(page + 1)}>{"\u2192"}</button>
                        </div>
                    )}
                </>
            ) : (
                <div className="empty-state">
                    <div className="empty-state-icon">🤖</div>
                    <div className="empty-state-title">No corrections yet</div>
                    <p>When you edit answers during review and finalize a job, corrections are captured here.</p>
                </div>
            )}
        </>
    );
}
