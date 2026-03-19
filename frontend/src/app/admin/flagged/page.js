'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
    listFlaggedQuestions,
    resolveFlaggedQuestion,
    dismissFlaggedQuestion,
    dismissFlaggedQuestionsBulk,
    deduplicateFlaggedQuestions,
    listCategories,
    getFlaggedExportUrl,
    syncFlaggedQuestions,
} from '@/lib/api';

export default function FlaggedPage() {
    const [flagged, setFlagged] = useState([]);
    const [total, setTotal] = useState(0);
    const [filter, setFilter] = useState('unresolved'); // 'all' | 'unresolved' | 'resolved'
    const [searchQuery, setSearchQuery] = useState('');
    const [toast, setToast] = useState(null);

    // Resolve modal
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

    const showToast = (message, type = 'info') => {
        setToast({ message, type });
        setTimeout(() => setToast(null), 4000);
    };

    const loadData = useCallback(async () => {
        try {
            const resolved =
                filter === 'all' ? null : filter === 'resolved' ? true : false;
            const data = await listFlaggedQuestions({ resolved });
            const items = data.items || [];
            setFlagged(items);
            setTotal(data.total || 0);
            const unresolvedIds = new Set(items.filter((item) => !item.resolved).map((item) => item.id));
            setSelectedIds((current) => current.filter((id) => unresolvedIds.has(id)));
        } catch (err) {
            showToast('Failed to load flagged questions', 'error');
        }
    }, [filter]);

    const loadCategories = useCallback(async () => {
        try {
            const data = await listCategories();
            setCategories(data.categories || []);
        } catch (err) { }
    }, []);

    const resetCategoryControls = () => {
        setResolveCategory('');
        setShowNewCategoryInput(false);
        setNewCategoryName('');
    };

    const applyNewCategory = () => {
        const trimmed = newCategoryName.trim();
        if (!trimmed) {
            showToast('❌ Category is required', 'error');
            return;
        }
        const existing = categories.find((category) => category.toLowerCase() === trimmed.toLowerCase());
        const nextCategory = existing || trimmed;
        if (!existing) {
            setCategories((current) => [...current, trimmed].sort((a, b) => a.localeCompare(b)));
        }
        setResolveCategory(nextCategory);
        setShowNewCategoryInput(false);
        setNewCategoryName('');
    };

    useEffect(() => {
        loadData();
    }, [loadData]);

    useEffect(() => {
        loadCategories();
    }, [loadCategories]);

    // Resolve
    const handleResolve = async (e) => {
        e.preventDefault();
        if (!resolving) return;
        try {
            if (addToKB && !resolveCategory.trim()) {
                showToast('❌ Category is required', 'error');
                return;
            }
            await resolveFlaggedQuestion(resolving.id, {
                answer: resolveAnswer,
                add_to_knowledge_base: addToKB,
                category: addToKB ? resolveCategory.trim() : null,
            });
            showToast(
                `✅ Resolved ${resolving.occurrence_count || 1} occurrence(s)` + (addToKB ? ' & added to KB' : ''),
                'success',
            );
            setResolving(null);
            setResolveAnswer('');
            resetCategoryControls();
            loadData();
            loadCategories();
        } catch (err) {
            showToast(`❌ ${err.message}`, 'error');
        }
    };

    // Dismiss
    const handleDismiss = async (id) => {
        const target = flagged.find((item) => item.id === id);
        try {
            await dismissFlaggedQuestion(id);
            setSelectedIds((current) => current.filter((selectedId) => selectedId !== id));
            showToast(`Dismissed ${target?.occurrence_count || 1} occurrence(s)`, 'info');
            loadData();
        } catch (err) {
            showToast('❌ Failed to dismiss', 'error');
        }
    };

    const filteredFlagged = useMemo(() => {
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
    const allVisibleUnresolvedSelected =
        unresolvedVisibleIds.length > 0 && unresolvedVisibleIds.every((id) => selectedIds.includes(id));

    const handleToggleSelectAll = () => {
        if (allVisibleUnresolvedSelected) {
            setSelectedIds((current) => current.filter((id) => !unresolvedVisibleIds.includes(id)));
            return;
        }
        setSelectedIds((current) => {
            const next = new Set(current);
            unresolvedVisibleIds.forEach((id) => next.add(id));
            return Array.from(next);
        });
    };

    const handleToggleRowSelection = (id, checked) => {
        setSelectedIds((current) => {
            if (checked) {
                return current.includes(id) ? current : [...current, id];
            }
            return current.filter((selectedId) => selectedId !== id);
        });
    };

    const handleBulkDismiss = async () => {
        if (selectedIds.length === 0) return;
        try {
            const result = await dismissFlaggedQuestionsBulk(selectedIds);
            setSelectedIds([]);
            showToast(
                `Dismissed ${result.dismissed_occurrences} occurrence(s) across ${result.dismissed_groups} question group(s).`,
                'info',
            );
            loadData();
        } catch (err) {
            showToast(`❌ ${err.message}`, 'error');
        }
    };

    const handleSync = async () => {
        setSyncing(true);
        try {
            const result = await syncFlaggedQuestions();
            if (result.synced_occurrences > 0) {
                showToast(
                    `✅ Synced ${result.synced_occurrences} flagged occurrence(s) across ${result.synced_groups} question group(s) from the knowledge base.`,
                    'success',
                );
            } else {
                showToast('No new knowledge-base matches were found for unresolved flagged questions.', 'info');
            }
            loadData();
        } catch (err) {
            showToast(`❌ ${err.message}`, 'error');
        } finally {
            setSyncing(false);
        }
    };

    const handleDeduplicate = async () => {
        setDeduplicating(true);
        try {
            const result = await deduplicateFlaggedQuestions();
            if (result.duplicates_removed > 0) {
                showToast(
                    `Removed ${result.duplicates_removed} duplicate row(s). ${result.total_after} remaining.`,
                    'success',
                );
            } else {
                showToast('No duplicate rows found.', 'info');
            }
            loadData();
        } catch (err) {
            showToast(`❌ ${err.message}`, 'error');
        } finally {
            setDeduplicating(false);
        }
    };

    const resolvedFilterValue =
        filter === 'all' ? null : filter === 'resolved' ? true : false;

    return (
        <div className="page-container">
            {/* Toast */}
            {toast && (
                <div className="toast-container">
                    <div className={`toast toast-${toast.type}`}>{toast.message}</div>
                </div>
            )}

            {/* Header */}
            <div className="page-header">
                <h1>Flagged Questions</h1>
                <p>
                    Questions that couldn&apos;t be matched to your knowledge base. Provide answers to resolve
                    them and optionally add to the KB for future matching.
                </p>
            </div>

            {/* Stats */}
            <div className="stats-grid">
                <div className="stat-card">
                    <div className="stat-value">{total}</div>
                    <div className="stat-label">
                        {filter === 'all' ? 'Total' : filter === 'resolved' ? 'Resolved' : 'Unresolved'}
                    </div>
                </div>
            </div>

            {/* Filter tabs */}
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
                {['unresolved', 'resolved', 'all'].map((f) => (
                    <button
                        key={f}
                        className={`btn btn-sm ${filter === f ? 'btn-primary' : 'btn-secondary'}`}
                        onClick={() => setFilter(f)}
                    >
                        {f.charAt(0).toUpperCase() + f.slice(1)}
                    </button>
                ))}
                <a
                    href={getFlaggedExportUrl({ resolved: resolvedFilterValue })}
                    className="btn btn-sm btn-secondary"
                    download
                >
                    ⬇️ Export CSV
                </a>
                <button
                    className="btn btn-sm btn-secondary"
                    onClick={handleSync}
                    disabled={syncing}
                >
                    {syncing ? 'Syncing…' : '↻ Sync with KB'}
                </button>
                <button
                    className="btn btn-sm btn-secondary"
                    onClick={handleDeduplicate}
                    disabled={deduplicating}
                >
                    {deduplicating ? 'Cleaning…' : '🧹 Remove Duplicates'}
                </button>
                <button
                    className="btn btn-sm btn-secondary"
                    onClick={loadData}
                >
                    ↻ Refresh
                </button>
            </div>

            {/* Search */}
            <div style={{ marginBottom: '1.25rem' }}>
                <input
                    className="form-input"
                    type="text"
                    placeholder="Search flagged questions, answers, or filenames..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    style={{ maxWidth: '480px', width: '100%' }}
                />
                {searchQuery.trim() && (
                    <div style={{ fontSize: '0.84rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
                        Showing {filteredFlagged.length} of {flagged.length} question group(s)
                    </div>
                )}
            </div>

            {unresolvedVisibleIds.length > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', cursor: 'pointer', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                        <input
                            type="checkbox"
                            checked={allVisibleUnresolvedSelected}
                            onChange={handleToggleSelectAll}
                        />
                        Select all shown
                    </label>
                    <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>
                        {selectedIds.length} selected
                    </span>
                    <button
                        className="btn btn-sm btn-secondary"
                        onClick={() => {
                            if (selectedIds.length === 0) return;
                            setConfirmAction({
                                message: `Dismiss ${selectedIds.length} selected question(s)? This cannot be undone.`,
                                onConfirm: async () => {
                                    setConfirmAction(null);
                                    await handleBulkDismiss();
                                },
                            });
                        }}
                        disabled={selectedIds.length === 0}
                    >
                        Dismiss selected
                    </button>
                </div>
            )}

            <div style={{ color: 'var(--text-muted)', fontSize: '0.88rem', marginBottom: '1.25rem' }}>
                Export this list as a simple `category,question,answer` CSV, fill in the blank `category` and `answer` cells, then import it from the Knowledge Base page. After import, use `Sync with KB` to clear any newly answered items from this list.
            </div>

            {/* Flagged list */}
            {filteredFlagged.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    {filteredFlagged.map((fq) => (
                        <div key={fq.id} className="card">
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
                                <div style={{ display: 'flex', gap: '0.65rem', alignItems: 'flex-start' }}>
                                    {!fq.resolved && (
                                        <input
                                            type="checkbox"
                                            checked={selectedIds.includes(fq.id)}
                                            onChange={(e) => handleToggleRowSelection(fq.id, e.target.checked)}
                                            style={{ marginTop: '0.2rem' }}
                                        />
                                    )}
                                    <div>
                                    <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>
                                        {fq.occurrence_count} occurrence{fq.occurrence_count === 1 ? '' : 's'}
                                        {fq.job_ids?.length > 0 && (
                                            <span style={{ marginLeft: '0.75rem' }}>
                                                {fq.job_ids.length} file{fq.job_ids.length === 1 ? '' : 's'}
                                            </span>
                                        )}
                                        {fq.similarity_score !== null && (
                                            <span style={{ marginLeft: '0.75rem' }}>
                                                Match score: {(fq.similarity_score * 100).toFixed(0)}%
                                            </span>
                                        )}
                                    </div>
                                    <div style={{ fontWeight: 600, fontSize: '1rem' }}>{fq.extracted_question}</div>
                                    </div>
                                </div>
                                <span className={`status-badge ${fq.resolved ? 'status-done' : 'status-pending'}`}>
                                    {fq.resolved ? 'Resolved' : 'Pending'}
                                </span>
                            </div>

                            {fq.best_match_question && (
                                <div style={{
                                    background: 'var(--bg-input)',
                                    padding: '0.6rem 0.85rem',
                                    borderRadius: 'var(--radius-sm)',
                                    fontSize: '0.85rem',
                                    color: 'var(--text-secondary)',
                                    marginBottom: '0.75rem',
                                }}>
                                    <strong>Closest match:</strong> {fq.best_match_question}
                                </div>
                            )}

                            {fq.filenames?.length > 0 && (
                                <div style={{
                                    background: 'var(--bg-input)',
                                    padding: '0.6rem 0.85rem',
                                    borderRadius: 'var(--radius-sm)',
                                    fontSize: '0.85rem',
                                    color: 'var(--text-secondary)',
                                    marginBottom: '0.75rem',
                                }}>
                                    <strong>Affected files:</strong> {fq.filenames.slice(0, 4).join(', ')}
                                    {fq.filenames.length > 4 && ` and ${fq.filenames.length - 4} more`}
                                </div>
                            )}

                            {fq.resolved && fq.resolved_answer && (
                                <div style={{
                                    background: 'var(--success-bg)',
                                    padding: '0.6rem 0.85rem',
                                    borderRadius: 'var(--radius-sm)',
                                    fontSize: '0.85rem',
                                    color: 'var(--success)',
                                    marginBottom: '0.5rem',
                                }}>
                                    <strong>Answer:</strong> {fq.resolved_answer}
                                </div>
                            )}

                            {!fq.resolved && (
                                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                                    <button
                                        className="btn btn-sm btn-primary"
                                        onClick={() => {
                                            setResolving(fq);
                                            setResolveAnswer('');
                                            setAddToKB(true);
                                            resetCategoryControls();
                                        }}
                                    >
                                        ✏️ Provide Answer
                                    </button>
                                    <button
                                        className="btn btn-sm btn-secondary"
                                        onClick={() => handleDismiss(fq.id)}
                                    >
                                        Dismiss
                                    </button>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            ) : (
                <div className="empty-state">
                    <div className="empty-state-icon">{searchQuery.trim() ? '🔍' : '✅'}</div>
                    <div className="empty-state-title">
                        {searchQuery.trim()
                            ? 'No flagged questions match your search'
                            : filter === 'unresolved'
                                ? 'No unresolved flagged questions'
                                : 'No flagged questions found'}
                    </div>
                    <p>
                        {searchQuery.trim()
                            ? 'Try a different search term or clear the search.'
                            : 'Questions that can\'t be matched will appear here after processing documents.'}
                    </p>
                </div>
            )}

            {/* Confirm Modal */}
            {confirmAction && (
                <div className="modal-overlay" onClick={() => setConfirmAction(null)}>
                    <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '420px' }}>
                        <div className="modal-header">
                            <h2>Confirm</h2>
                            <button className="modal-close" onClick={() => setConfirmAction(null)}>×</button>
                        </div>
                        <p style={{ color: 'var(--text-secondary)', marginBottom: '1.25rem' }}>
                            {confirmAction.message}
                        </p>
                        <div className="modal-actions">
                            <button className="btn btn-secondary" onClick={() => setConfirmAction(null)}>Cancel</button>
                            <button className="btn btn-danger" onClick={confirmAction.onConfirm}>Dismiss</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Resolve Modal */}
            {resolving && (
                <div className="modal-overlay" onClick={() => setResolving(null)}>
                    <div className="modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>Provide Answer</h2>
                            <button className="modal-close" onClick={() => setResolving(null)}>×</button>
                        </div>

                        <div style={{
                            background: 'var(--bg-input)',
                            padding: '0.85rem',
                            borderRadius: 'var(--radius-md)',
                            marginBottom: '1.25rem',
                            fontSize: '0.95rem',
                            fontWeight: 600,
                        }}>
                            {resolving.extracted_question}
                        </div>

                        <div style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', marginBottom: '1rem' }}>
                            This will resolve {resolving.occurrence_count || 1} grouped occurrence(s) of the same question.
                        </div>

                        <form onSubmit={handleResolve}>
                            <div className="form-group">
                                <label className="form-label">Your Answer</label>
                                <textarea
                                    className="form-textarea"
                                    placeholder="Type the answer for this question..."
                                    value={resolveAnswer}
                                    onChange={(e) => setResolveAnswer(e.target.value)}
                                    required
                                    style={{ minHeight: '120px' }}
                                />
                            </div>

                            <div className="form-group">
                                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.9rem' }}>
                                    <input
                                        type="checkbox"
                                        checked={addToKB}
                                        onChange={(e) => setAddToKB(e.target.checked)}
                                    />
                                    Also add to Knowledge Base for future matching
                                </label>
                            </div>

                            {addToKB && (
                                <div className="form-group">
                                    <label className="form-label">Category</label>
                                    <select
                                        className="form-select"
                                        value={resolveCategory}
                                        onChange={(e) => setResolveCategory(e.target.value)}
                                        required={addToKB}
                                    >
                                        <option value="">Select a category</option>
                                        {categories.map((category) => (
                                            <option key={category} value={category}>{category}</option>
                                        ))}
                                    </select>
                                    <button
                                        type="button"
                                        onClick={() => setShowNewCategoryInput((current) => !current)}
                                        style={{
                                            marginTop: '0.55rem',
                                            background: 'none',
                                            border: 'none',
                                            padding: 0,
                                            color: 'var(--text-secondary)',
                                            fontSize: '0.85rem',
                                            textDecoration: 'underline',
                                            cursor: 'pointer',
                                        }}
                                    >
                                        {showNewCategoryInput ? 'Hide new category' : '+ Add new category'}
                                    </button>
                                    {showNewCategoryInput && (
                                        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem', alignItems: 'center' }}>
                                            <input
                                                className="form-input"
                                                type="text"
                                                placeholder="New category name"
                                                value={newCategoryName}
                                                onChange={(e) => setNewCategoryName(e.target.value)}
                                            />
                                            <button type="button" className="btn btn-sm btn-secondary" onClick={applyNewCategory}>
                                                Add
                                            </button>
                                        </div>
                                    )}
                                </div>
                            )}

                            <div className="modal-actions">
                                <button type="button" className="btn btn-secondary" onClick={() => setResolving(null)}>
                                    Cancel
                                </button>
                                <button type="submit" className="btn btn-success">
                                    ✅ Resolve
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
