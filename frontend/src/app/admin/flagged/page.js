'use client';

import { useState, useEffect, useCallback } from 'react';
import {
    listFlaggedQuestions,
    resolveFlaggedQuestion,
    dismissFlaggedQuestion,
    listCategories,
    getFlaggedExportUrl,
    syncFlaggedQuestions,
} from '@/lib/api';

export default function FlaggedPage() {
    const [flagged, setFlagged] = useState([]);
    const [total, setTotal] = useState(0);
    const [filter, setFilter] = useState('unresolved'); // 'all' | 'unresolved' | 'resolved'
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

    const showToast = (message, type = 'info') => {
        setToast({ message, type });
        setTimeout(() => setToast(null), 4000);
    };

    const loadData = useCallback(async () => {
        try {
            const resolved =
                filter === 'all' ? null : filter === 'resolved' ? true : false;
            const data = await listFlaggedQuestions({ resolved });
            setFlagged(data.items || []);
            setTotal(data.total || 0);
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
            showToast(`Dismissed ${target?.occurrence_count || 1} occurrence(s)`, 'info');
            loadData();
        } catch (err) {
            showToast('❌ Failed to dismiss', 'error');
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
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem' }}>
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
            </div>

            <div style={{ color: 'var(--text-muted)', fontSize: '0.88rem', marginBottom: '1.25rem' }}>
                Export this list as a simple `category,question,answer` CSV, fill in the blank `category` and `answer` cells, then import it from the Knowledge Base page. After import, use `Sync with KB` to clear any newly answered items from this list.
            </div>

            {/* Flagged list */}
            {flagged.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    {flagged.map((fq) => (
                        <div key={fq.id} className="card">
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
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
                    <div className="empty-state-icon">✅</div>
                    <div className="empty-state-title">
                        {filter === 'unresolved'
                            ? 'No unresolved flagged questions'
                            : 'No flagged questions found'}
                    </div>
                    <p>Questions that can&apos;t be matched will appear here after processing documents.</p>
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
