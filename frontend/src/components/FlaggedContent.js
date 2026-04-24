'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import useToast from '@/hooks/useToast';
import {
    listFlaggedQuestions,
    resolveFlaggedQuestion,
    dismissFlaggedQuestion,
    dismissFlaggedQuestionsBulk,
    purgeDismissedFlagged,
    deduplicateFlaggedQuestions,
    listCategories,
    downloadFlaggedExport,
    syncFlaggedQuestions,
} from '@/lib/api';
import LoadingSkeleton from '@/components/LoadingSkeleton';

export default function FlaggedContent() {
    const [flagged, setFlagged] = useState(null);
    const [total, setTotal] = useState(0);
    const [filter, setFilter] = useState('unresolved');
    const [searchQuery, setSearchQuery] = useState('');
    const { toast, showToast } = useToast();
    const [resolving, setResolving] = useState(null);
    const [resolveAnswer, setResolveAnswer] = useState('');
    const [resolveCategory, setResolveCategory] = useState('');
    const [addToKB, setAddToKB] = useState(true);
    const [categories, setCategories] = useState([]);
    const [showNewCategoryInput, setShowNewCategoryInput] = useState(false);
    const [newCategoryName, setNewCategoryName] = useState('');
    const [syncing, setSyncing] = useState(false);
    const [deduplicating, setDeduplicating] = useState(false);
    const [selectedIds, setSelectedIds] = useState([]);
    const [confirmAction, setConfirmAction] = useState(null);

    const loadData = useCallback(async () => {
        try {
            const resolved = filter === 'all' ? null : filter === 'dismissed' ? true : filter === 'resolved' ? true : false;
            const data = await listFlaggedQuestions({ resolved });
            let items = data.items || [];
            if (filter === 'dismissed') items = items.filter((item) => item.resolved_answer === '[Dismissed]');
            else if (filter === 'resolved') items = items.filter((item) => item.resolved && item.resolved_answer !== '[Dismissed]');
            setFlagged(items);
            setTotal(items.length);
            const unresolvedIds = new Set(items.filter((item) => !item.resolved).map((item) => item.id));
            setSelectedIds((current) => current.filter((id) => unresolvedIds.has(id)));
        } catch (err) { showToast('Failed to load flagged questions', 'error'); }
    }, [filter]);

    const loadCategories = useCallback(async () => {
        try { const data = await listCategories(); setCategories(data.categories || []); } catch (err) { console.warn('Failed to load categories:', err.message); }
    }, []);

    const resetCategoryControls = () => { setResolveCategory(''); setShowNewCategoryInput(false); setNewCategoryName(''); };

    const applyNewCategory = () => {
        const trimmed = newCategoryName.trim();
        if (!trimmed) { showToast('Category is required', 'error'); return; }
        const existing = categories.find((c) => c.toLowerCase() === trimmed.toLowerCase());
        const nextCategory = existing || trimmed;
        if (!existing) setCategories((cur) => [...cur, trimmed].sort((a, b) => a.localeCompare(b)));
        setResolveCategory(nextCategory);
        setShowNewCategoryInput(false);
        setNewCategoryName('');
    };

    useEffect(() => { loadData(); }, [loadData]);
    useEffect(() => { loadCategories(); }, [loadCategories]);

    const handleResolve = async (e) => {
        e.preventDefault();
        if (!resolving) return;
        try {
            if (addToKB && !resolveCategory.trim()) { showToast('Category is required', 'error'); return; }
            await resolveFlaggedQuestion(resolving.id, {
                answer: resolveAnswer, add_to_knowledge_base: addToKB, category: addToKB ? resolveCategory.trim() : null,
            });
            showToast(`Resolved ${resolving.occurrence_count || 1} occurrence(s)${addToKB ? ' & added to KB' : ''}`, 'success');
            setResolving(null);
            setResolveAnswer('');
            resetCategoryControls();
            loadData();
            loadCategories();
        } catch (err) { showToast(err.message, 'error'); }
    };

    const handleDismiss = async (id) => {
        const target = flagged.find((item) => item.id === id);
        try {
            await dismissFlaggedQuestion(id);
            setSelectedIds((current) => current.filter((sid) => sid !== id));
            showToast(`Dismissed ${target?.occurrence_count || 1} occurrence(s)`, 'success');
            await loadData();
        } catch (err) { showToast(`Failed to dismiss: ${err?.message || 'Unknown error'}`, 'error'); }
    };

    const filteredFlagged = useMemo(() => {
        if (!flagged) return [];
        if (!searchQuery.trim()) return flagged;
        const q = searchQuery.toLowerCase().trim();
        return flagged.filter((fq) =>
            fq.extracted_question?.toLowerCase().includes(q)
            || fq.best_match_question?.toLowerCase().includes(q)
            || fq.resolved_answer?.toLowerCase().includes(q)
            || fq.filenames?.some((fn) => fn.toLowerCase().includes(q))
        );
    }, [flagged, searchQuery]);

    const unresolvedVisibleIds = filteredFlagged.filter((item) => !item.resolved).map((item) => item.id);
    const allVisibleUnresolvedSelected = unresolvedVisibleIds.length > 0 && unresolvedVisibleIds.every((id) => selectedIds.includes(id));

    const handleToggleSelectAll = () => {
        if (allVisibleUnresolvedSelected) {
            setSelectedIds((cur) => cur.filter((id) => !unresolvedVisibleIds.includes(id)));
            return;
        }
        setSelectedIds((cur) => { const next = new Set(cur); unresolvedVisibleIds.forEach((id) => next.add(id)); return Array.from(next); });
    };

    const handleToggleRowSelection = (id, checked) => {
        setSelectedIds((cur) => checked ? (cur.includes(id) ? cur : [...cur, id]) : cur.filter((sid) => sid !== id));
    };

    const handleBulkDismiss = async () => {
        if (selectedIds.length === 0) return;
        try {
            const result = await dismissFlaggedQuestionsBulk(selectedIds);
            setSelectedIds([]);
            showToast(`Dismissed ${result.dismissed_occurrences} occurrence(s) across ${result.dismissed_groups} group(s)`, 'success');
            await loadData();
        } catch (err) { showToast(err.message, 'error'); }
    };

    const handleSync = async () => {
        setSyncing(true);
        try {
            const result = await syncFlaggedQuestions();
            if (result.synced_occurrences > 0) {
                showToast(`Synced ${result.synced_occurrences} flagged occurrence(s) across ${result.synced_groups} question group(s) from the knowledge base.`, 'success');
            } else { showToast('No new knowledge-base matches were found for unresolved flagged questions.', 'info'); }
            loadData();
        } catch (err) { showToast(err.message, 'error'); }
        finally { setSyncing(false); }
    };

    const handlePurgeDismissed = async () => {
        setConfirmAction({
            message: 'Permanently delete all dismissed flagged questions? This cannot be undone.',
            onConfirm: async () => {
                setConfirmAction(null);
                try {
                    const result = await purgeDismissedFlagged();
                    showToast(`Permanently removed ${result.purged} dismissed question(s)`, 'success');
                    await loadData();
                } catch (err) { showToast(err.message, 'error'); }
            },
        });
    };

    const handleDeduplicate = async () => {
        setDeduplicating(true);
        try {
            const result = await deduplicateFlaggedQuestions();
            if (result.duplicates_removed > 0) {
                showToast(`Removed ${result.duplicates_removed} duplicate row(s). ${result.total_after} remaining.`, 'success');
            } else { showToast('No duplicate rows found.', 'info'); }
            loadData();
        } catch (err) { showToast(err.message, 'error'); }
        finally { setDeduplicating(false); }
    };

    const resolvedFilterValue = filter === 'all' ? null : (filter === 'resolved' || filter === 'dismissed') ? true : false;

    return (
        <>
            {toast && (
                <div className="toast-container" role="status" aria-live="polite">
                    <div className={`toast toast-${toast.type}`}>{toast.message}</div>
                </div>
            )}

            {/* Stats */}
            <div className="stats-grid">
                <div className="stat-card">
                    <div className="stat-value">{total}</div>
                    <div className="stat-label">
                        {filter === 'all' ? 'Total' : filter === 'dismissed' ? 'Dismissed' : filter === 'resolved' ? 'Resolved' : 'Unresolved'}
                    </div>
                </div>
            </div>

            {/* Toolbar */}
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
                {[
                    { key: 'unresolved', label: 'Unresolved' },
                    { key: 'resolved', label: 'Resolved' },
                    { key: 'dismissed', label: 'Dismissed' },
                    { key: 'all', label: 'All' },
                ].map((f) => (
                    <button key={f.key} className={`btn btn-sm ${filter === f.key ? 'btn-primary' : 'btn-secondary'}`}
                        onClick={() => setFilter(f.key)}>{f.label}</button>
                ))}
                <button className="btn btn-sm btn-secondary" onClick={() => downloadFlaggedExport({ resolved: resolvedFilterValue })}>
                    Export CSV
                </button>
                <button className="btn btn-sm btn-secondary" onClick={handleSync} disabled={syncing}>
                    {syncing ? 'Syncing...' : 'Sync with KB'}
                </button>
                <button className="btn btn-sm btn-secondary" onClick={handleDeduplicate} disabled={deduplicating}>
                    {deduplicating ? 'Cleaning...' : 'Remove Duplicates'}
                </button>
                {filter === 'dismissed' && total > 0 && (
                    <button className="btn btn-sm btn-danger" onClick={handlePurgeDismissed}>Purge All Dismissed</button>
                )}
                <div className="search-input-wrapper" style={{ flex: '1 1 auto', minWidth: '180px' }}>
                    <span className="search-icon">🔍</span>
                    <input type="text" placeholder="Search flagged questions..." value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)} />
                </div>
            </div>
            {searchQuery.trim() && (
                <div style={{ fontSize: '0.84rem', color: 'var(--text-muted)', marginBottom: '0.75rem', marginTop: '-0.5rem' }}>
                    Showing {filteredFlagged.length} of {flagged.length} question group(s)
                </div>
            )}

            {unresolvedVisibleIds.length > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', cursor: 'pointer', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                        <input type="checkbox" checked={allVisibleUnresolvedSelected} onChange={handleToggleSelectAll} />
                        Select all shown
                    </label>
                    <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>{selectedIds.length} selected</span>
                    <button className="btn btn-sm btn-secondary"
                        onClick={() => {
                            if (selectedIds.length === 0) return;
                            setConfirmAction({
                                message: `Dismiss ${selectedIds.length} selected question(s)? This cannot be undone.`,
                                onConfirm: async () => { setConfirmAction(null); await handleBulkDismiss(); },
                            });
                        }}
                        disabled={selectedIds.length === 0}>Dismiss selected</button>
                </div>
            )}

            <div style={{ color: 'var(--text-muted)', fontSize: '0.88rem', marginBottom: '1.25rem' }}>
                Export this list as a simple CSV, fill in the blank cells, then import from the Entries tab. After import, use Sync with KB to clear matched items.
            </div>

            {/* Flagged list */}
            {flagged === null ? (
                <LoadingSkeleton lines={6} showHeader />
            ) : filteredFlagged.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    {filteredFlagged.map((fq) => (
                        <div key={fq.id} className="card">
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
                                <div style={{ display: 'flex', gap: '0.65rem', alignItems: 'flex-start' }}>
                                    {!fq.resolved && (
                                        <input type="checkbox" checked={selectedIds.includes(fq.id)}
                                            onChange={(e) => handleToggleRowSelection(fq.id, e.target.checked)}
                                            style={{ marginTop: '0.2rem' }} />
                                    )}
                                    <div>
                                        <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>
                                            {fq.occurrence_count} occurrence{fq.occurrence_count === 1 ? '' : 's'}
                                            {fq.job_ids?.length > 0 && <span style={{ marginLeft: '0.75rem' }}>{fq.job_ids.length} file{fq.job_ids.length === 1 ? '' : 's'}</span>}
                                            {fq.similarity_score !== null && <span style={{ marginLeft: '0.75rem' }}>Match score: {(fq.similarity_score * 100).toFixed(0)}%</span>}
                                        </div>
                                        <div style={{ fontWeight: 600, fontSize: '1rem' }}>{fq.extracted_question}</div>
                                    </div>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                    {fq.assigned_to && (
                                        <span style={{ display: 'inline-block', padding: '0.15rem 0.55rem', borderRadius: '999px', fontSize: '0.72rem', fontWeight: 600, background: 'var(--primary, #7c3aed)', color: '#fff' }}>
                                            {fq.assigned_to}
                                        </span>
                                    )}
                                    <span className={`status-badge ${fq.resolved ? fq.resolved_answer === '[Dismissed]' ? 'status-error' : 'status-done' : 'status-pending'}`}>
                                        {fq.resolved ? fq.resolved_answer === '[Dismissed]' ? 'Dismissed' : 'Resolved' : 'Pending'}
                                    </span>
                                </div>
                            </div>

                            {fq.best_match_question && (
                                <div style={{ background: 'var(--bg-input)', padding: '0.6rem 0.85rem', borderRadius: 'var(--radius-sm)', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.75rem' }}>
                                    <strong>Closest match:</strong> {fq.best_match_question}
                                </div>
                            )}

                            {fq.filenames?.length > 0 && (
                                <div style={{ background: 'var(--bg-input)', padding: '0.6rem 0.85rem', borderRadius: 'var(--radius-sm)', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.75rem' }}>
                                    <strong>Affected files:</strong> {fq.filenames.slice(0, 4).join(', ')}
                                    {fq.filenames.length > 4 && ` and ${fq.filenames.length - 4} more`}
                                </div>
                            )}

                            {fq.resolved && fq.resolved_answer && fq.resolved_answer !== '[Dismissed]' && (
                                <div style={{ background: 'var(--success-bg)', padding: '0.6rem 0.85rem', borderRadius: 'var(--radius-sm)', fontSize: '0.85rem', color: 'var(--success)', marginBottom: '0.5rem' }}>
                                    <strong>Answer:</strong> {fq.resolved_answer}
                                </div>
                            )}
                            {fq.resolved && fq.resolved_answer === '[Dismissed]' && (
                                <div style={{ background: 'var(--error-bg, rgba(239,68,68,0.1))', padding: '0.6rem 0.85rem', borderRadius: 'var(--radius-sm)', fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
                                    This question was dismissed and will be ignored in future processing.
                                </div>
                            )}

                            {!fq.resolved && (
                                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                                    <button className="btn btn-sm btn-primary"
                                        onClick={() => { setResolving(fq); setResolveAnswer(''); setAddToKB(true); resetCategoryControls(); }}>
                                        Provide Answer
                                    </button>
                                    <button className="btn btn-sm btn-secondary" onClick={() => handleDismiss(fq.id)}>Dismiss</button>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            ) : (
                <div className="empty-state">
                    <div className="empty-state-icon">{searchQuery.trim() ? '\uD83D\uDD0D' : '\u2705'}</div>
                    <div className="empty-state-title">
                        {searchQuery.trim() ? 'No flagged questions match your search'
                            : filter === 'unresolved' ? 'No unresolved flagged questions' : 'No flagged questions found'}
                    </div>
                    <p>{searchQuery.trim() ? 'Try a different search term or clear the search.'
                        : 'Questions that can\'t be matched will appear here after processing documents.'}</p>
                </div>
            )}

            {/* Confirm Modal */}
            {confirmAction && (
                <div className="modal-overlay" role="dialog" aria-modal="true" onClick={() => setConfirmAction(null)}>
                    <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '420px' }}>
                        <div className="modal-header">
                            <h2>Confirm</h2>
                            <button className="modal-close" onClick={() => setConfirmAction(null)}>&times;</button>
                        </div>
                        <p style={{ color: 'var(--text-secondary)', marginBottom: '1.25rem' }}>{confirmAction.message}</p>
                        <div className="modal-actions">
                            <button className="btn btn-secondary" onClick={() => setConfirmAction(null)}>Cancel</button>
                            <button className="btn btn-danger" onClick={confirmAction.onConfirm}>Dismiss</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Resolve Modal */}
            {resolving && (
                <div className="modal-overlay" role="dialog" aria-modal="true" onClick={() => setResolving(null)}>
                    <div className="modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>Provide Answer</h2>
                            <button className="modal-close" onClick={() => setResolving(null)}>&times;</button>
                        </div>
                        <div style={{ background: 'var(--bg-input)', padding: '0.85rem', borderRadius: 'var(--radius-md)', marginBottom: '1.25rem', fontSize: '0.95rem', fontWeight: 600 }}>
                            {resolving.extracted_question}
                        </div>
                        <div style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', marginBottom: '1rem' }}>
                            This will resolve {resolving.occurrence_count || 1} grouped occurrence(s) of the same question.
                        </div>
                        <form onSubmit={handleResolve}>
                            <div className="form-group">
                                <label className="form-label">Your Answer</label>
                                <textarea className="form-textarea" placeholder="Type the answer for this question..."
                                    value={resolveAnswer} onChange={(e) => setResolveAnswer(e.target.value)} required
                                    style={{ minHeight: '120px' }} />
                            </div>
                            <div className="form-group">
                                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.9rem' }}>
                                    <input type="checkbox" checked={addToKB} onChange={(e) => setAddToKB(e.target.checked)} />
                                    Also add to Knowledge Base for future matching
                                </label>
                            </div>
                            {addToKB && (
                                <div className="form-group">
                                    <label className="form-label">Category</label>
                                    <select className="form-select" value={resolveCategory}
                                        onChange={(e) => setResolveCategory(e.target.value)} required={addToKB}>
                                        <option value="">Select a category</option>
                                        {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                                    </select>
                                    <button type="button" onClick={() => setShowNewCategoryInput((c) => !c)}
                                        style={{ marginTop: '0.55rem', background: 'none', border: 'none', padding: 0, color: 'var(--text-secondary)', fontSize: '0.85rem', textDecoration: 'underline', cursor: 'pointer' }}>
                                        {showNewCategoryInput ? 'Hide new category' : '+ Add new category'}
                                    </button>
                                    {showNewCategoryInput && (
                                        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem', alignItems: 'center' }}>
                                            <input className="form-input" type="text" placeholder="New category name"
                                                value={newCategoryName} onChange={(e) => setNewCategoryName(e.target.value)} />
                                            <button type="button" className="btn btn-sm btn-secondary" onClick={applyNewCategory}>Add</button>
                                        </div>
                                    )}
                                </div>
                            )}
                            <div className="modal-actions">
                                <button type="button" className="btn btn-secondary" onClick={() => setResolving(null)}>Cancel</button>
                                <button type="submit" className="btn btn-success">Resolve</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </>
    );
}
