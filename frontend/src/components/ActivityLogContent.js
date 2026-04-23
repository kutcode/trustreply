'use client';

import React, { useState, useEffect, useCallback } from 'react';
import useToast from '@/hooks/useToast';
import { listAuditLogs, getApiBaseHint } from '@/lib/api';
import LoadingSkeleton from '@/components/LoadingSkeleton';

const ACTION_LABELS = {
    question_edit: { label: 'Answer Edited', icon: '✏️', color: 'var(--color-warning)' },
    question_approve: { label: 'Answer Approved', icon: '✅', color: 'var(--color-success)' },
    bulk_approve: { label: 'Bulk Approved', icon: '✅', color: 'var(--color-success)' },
    job_finalize: { label: 'Job Finalized', icon: '📄', color: 'var(--color-info, #60a5fa)' },
    flagged_resolve: { label: 'Flagged Resolved', icon: '🔓', color: 'var(--color-success)' },
    flagged_dismiss: { label: 'Flagged Dismissed', icon: '🚫', color: 'var(--text-tertiary)' },
    flagged_bulk_dismiss: { label: 'Bulk Dismissed', icon: '🚫', color: 'var(--text-tertiary)' },
    kb_create: { label: 'KB Entry Created', icon: '➕', color: 'var(--color-success)' },
    kb_update: { label: 'KB Entry Updated', icon: '📝', color: 'var(--color-warning)' },
    kb_delete: { label: 'KB Entry Deleted', icon: '🗑️', color: 'var(--color-danger)' },
    kb_import: { label: 'KB Imported', icon: '📥', color: 'var(--color-info, #60a5fa)' },
    correction_auto_kb: { label: 'Auto-Added to KB', icon: '🤖', color: 'var(--color-info, #60a5fa)' },
};
const ENTITY_LABELS = { question_result: 'Question Result', processing_job: 'Processing Job', flagged_question: 'Flagged Question', qa_pair: 'KB Entry', answer_correction: 'Correction' };
const ACTION_TYPES = Object.keys(ACTION_LABELS);
const ENTITY_TYPES = Object.keys(ENTITY_LABELS);

function formatTimestamp(ts) {
    if (!ts) return '—';
    return new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function truncate(text, max = 120) { return !text ? '' : text.length > max ? text.slice(0, max) + '...' : text; }

export default function ActivityLogContent() {
    const [logs, setLogs] = useState(null);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [pageSize] = useState(30);
    const { toast, showToast } = useToast();
    const [actionFilter, setActionFilter] = useState('');
    const [entityFilter, setEntityFilter] = useState('');
    const [jobIdFilter, setJobIdFilter] = useState('');
    const [expandedId, setExpandedId] = useState(null);

    const loadData = useCallback(async () => {
        try {
            const params = { page, pageSize };
            if (actionFilter) params.actionType = actionFilter;
            if (entityFilter) params.entityType = entityFilter;
            if (jobIdFilter && !isNaN(parseInt(jobIdFilter))) params.jobId = parseInt(jobIdFilter);
            const data = await listAuditLogs(params);
            setLogs(data.items || []); setTotal(data.total || 0);
        } catch (err) { showToast(`Failed to load activity log: ${err.message || getApiBaseHint()}`, 'error'); }
    }, [page, pageSize, actionFilter, entityFilter, jobIdFilter]);

    useEffect(() => { loadData(); }, [loadData]);

    const totalPages = Math.ceil(total / pageSize);
    const getActionMeta = (actionType) => ACTION_LABELS[actionType] || { label: actionType, icon: '•', color: 'var(--text-secondary)' };

    const renderDetails = (log) => {
        const parts = [];
        if (log.details) {
            parts.push(
                <div key="details" style={{ marginBottom: '0.5rem' }}>
                    <strong style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Details:</strong>
                    <pre style={{ background: 'var(--bg-input)', padding: '0.5rem', borderRadius: 'var(--radius-sm)', fontSize: '0.8rem', overflow: 'auto', marginTop: '0.25rem', color: 'var(--text-primary)' }}>
                        {JSON.stringify(log.details, null, 2)}
                    </pre>
                </div>
            );
        }
        if (log.before_value || log.after_value) {
            parts.push(
                <div key="diff" style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                    {log.before_value && (
                        <div style={{ flex: 1, minWidth: '200px' }}>
                            <strong style={{ fontSize: '0.8rem', color: 'var(--color-danger)' }}>Before:</strong>
                            <div style={{ background: 'rgba(239,68,68,0.08)', padding: '0.5rem', borderRadius: 'var(--radius-sm)', fontSize: '0.8rem', marginTop: '0.25rem', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{log.before_value}</div>
                        </div>
                    )}
                    {log.after_value && (
                        <div style={{ flex: 1, minWidth: '200px' }}>
                            <strong style={{ fontSize: '0.8rem', color: 'var(--color-success)' }}>After:</strong>
                            <div style={{ background: 'rgba(34,197,94,0.08)', padding: '0.5rem', borderRadius: 'var(--radius-sm)', fontSize: '0.8rem', marginTop: '0.25rem', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{log.after_value}</div>
                        </div>
                    )}
                </div>
            );
        }
        if (!parts.length) return <span style={{ color: 'var(--text-tertiary)', fontSize: '0.8rem' }}>No additional details.</span>;
        return parts;
    };

    return (
        <>
            {toast && (
                <div className="toast-container" role="status" aria-live="polite">
                    <div className={`toast toast-${toast.type}`}>{toast.message}</div>
                </div>
            )}

            <div className="stats-grid">
                <div className="stat-card"><div className="stat-value">{total}</div><div className="stat-label">Total Events</div></div>
            </div>

            <div className="search-bar">
                <select className="form-select" value={actionFilter} onChange={(e) => { setActionFilter(e.target.value); setPage(1); }} style={{ width: 'auto', minWidth: '180px' }}>
                    <option value="">All Actions</option>
                    {ACTION_TYPES.map((type) => <option key={type} value={type}>{ACTION_LABELS[type].label}</option>)}
                </select>
                <select className="form-select" value={entityFilter} onChange={(e) => { setEntityFilter(e.target.value); setPage(1); }} style={{ width: 'auto', minWidth: '160px' }}>
                    <option value="">All Entities</option>
                    {ENTITY_TYPES.map((type) => <option key={type} value={type}>{ENTITY_LABELS[type]}</option>)}
                </select>
                <div className="search-input-wrapper" style={{ maxWidth: '140px' }}>
                    <span className="search-icon">🔍</span>
                    <input type="text" placeholder="Job ID..." value={jobIdFilter} onChange={(e) => { setJobIdFilter(e.target.value); setPage(1); }} />
                </div>
            </div>

            {logs === null ? (
                <LoadingSkeleton lines={6} showHeader />
            ) : logs.length > 0 ? (
                <>
                    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <th style={{ width: '140px' }}>Time</th>
                                    <th style={{ width: '180px' }}>Action</th>
                                    <th style={{ width: '130px' }}>Entity</th>
                                    <th style={{ width: '70px' }}>ID</th>
                                    <th style={{ width: '80px' }}>Actor</th>
                                    <th>Summary</th>
                                </tr>
                            </thead>
                            <tbody>
                                {logs.map((log) => {
                                    const meta = getActionMeta(log.action_type);
                                    const isExpanded = expandedId === log.id;
                                    const summary = log.details ? truncate(Object.entries(log.details).map(([k, v]) => `${k}: ${v}`).join(', ')) : (log.after_value ? truncate(log.after_value, 80) : '—');
                                    return (
                                        <React.Fragment key={log.id}>
                                            <tr onClick={() => setExpandedId(isExpanded ? null : log.id)} style={{ cursor: 'pointer' }}>
                                                <td style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>{formatTimestamp(log.timestamp)}</td>
                                                <td>
                                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', padding: '0.2rem 0.55rem', borderRadius: 'var(--radius-sm)', background: `color-mix(in srgb, ${meta.color} 12%, transparent)`, color: meta.color, fontSize: '0.82rem', fontWeight: 500 }}>
                                                        {meta.icon} {meta.label}
                                                    </span>
                                                </td>
                                                <td style={{ fontSize: '0.82rem' }}>{ENTITY_LABELS[log.entity_type] || log.entity_type}</td>
                                                <td style={{ fontSize: '0.82rem', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>{log.entity_id ?? '—'}</td>
                                                <td style={{ fontSize: '0.82rem' }}>{log.actor}</td>
                                                <td className="cell-truncate" style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>{summary}</td>
                                            </tr>
                                            {isExpanded && (
                                                <tr key={`${log.id}-detail`}>
                                                    <td colSpan="6" style={{ padding: '0.75rem 1rem', background: 'var(--bg-card-alt, var(--bg-input))' }}>
                                                        {renderDetails(log)}
                                                    </td>
                                                </tr>
                                            )}
                                        </React.Fragment>
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
                    <div className="empty-state-icon">📋</div>
                    <div className="empty-state-title">No activity yet</div>
                    <p>Actions like editing answers, resolving flagged questions, and managing KB entries will appear here.</p>
                </div>
            )}
        </>
    );
}
