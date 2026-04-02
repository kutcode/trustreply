'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { listTemplates, createTemplate, deleteTemplate, getTemplate, updateTemplateAnswer, getApiBaseHint } from '@/lib/api';
import LoadingSkeleton from '@/components/LoadingSkeleton';

function formatDate(ts) {
    if (!ts) return '—';
    return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function TemplatesPage() {
    const [templates, setTemplates] = useState(null);
    const [total, setTotal] = useState(0);
    const [toast, setToast] = useState(null);
    const [confirmDelete, setConfirmDelete] = useState(null);

    // Detail view
    const [viewTemplate, setViewTemplate] = useState(null);
    const [viewAnswers, setViewAnswers] = useState([]);
    const [answerSearch, setAnswerSearch] = useState('');
    const [editingAnswerId, setEditingAnswerId] = useState(null);
    const [editingText, setEditingText] = useState('');

    const toastTimeout = useRef(null);
    const showToast = useCallback((msg, type = 'info') => {
        if (toastTimeout.current) clearTimeout(toastTimeout.current);
        setToast({ message: msg, type });
        toastTimeout.current = setTimeout(() => setToast(null), 4000);
    }, []);

    const loadData = useCallback(async () => {
        try {
            const data = await listTemplates();
            setTemplates(data.items || []);
            setTotal(data.total || 0);
        } catch (err) {
            showToast(`Failed to load templates: ${err.message || getApiBaseHint()}`, 'error');
        }
    }, []);

    useEffect(() => { loadData(); }, [loadData]);

    const handleDelete = async (id) => {
        try {
            await deleteTemplate(id);
            setConfirmDelete(null);
            showToast('🗑️ Template deleted', 'success');
            loadData();
        } catch (err) {
            showToast(`❌ ${err.message}`, 'error');
        }
    };

    const handleView = async (id) => {
        try {
            const data = await getTemplate(id);
            setViewTemplate(data);
            setViewAnswers(data.answers || []);
            setAnswerSearch('');
            setEditingAnswerId(null);
        } catch (err) {
            showToast(err.message, 'error');
        }
    };

    const handleSaveAnswer = async () => {
        if (!editingAnswerId || !viewTemplate) return;
        try {
            const updated = await updateTemplateAnswer(viewTemplate.id, editingAnswerId, editingText);
            setViewAnswers((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
            setEditingAnswerId(null);
            setEditingText('');
            showToast('Answer updated', 'success');
        } catch (err) {
            showToast(err.message, 'error');
        }
    };

    const filteredAnswers = answerSearch
        ? viewAnswers.filter((a) =>
            a.question_text.toLowerCase().includes(answerSearch.toLowerCase()) ||
            a.answer_text.toLowerCase().includes(answerSearch.toLowerCase())
        )
        : viewAnswers;

    return (
        <div className="page-container">
            {toast && (
                <div className="toast-container" role="status" aria-live="polite">
                    <div className={`toast toast-${toast.type}`}>{toast.message}</div>
                </div>
            )}

            <div className="page-header">
                <h1>Templates</h1>
                <p>Saved questionnaire responses that can be reused to pre-fill future uploads.</p>
            </div>

            <div className="stats-grid">
                <div className="stat-card">
                    <div className="stat-value">{total}</div>
                    <div className="stat-label">Saved Templates</div>
                </div>
            </div>

            {/* Detail/Answers View */}
            {viewTemplate && (
                <div className="card" style={{ marginBottom: '1.5rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                        <div>
                            <h2 style={{ margin: 0, fontSize: '1.1rem' }}>{viewTemplate.name}</h2>
                            {viewTemplate.description && (
                                <p style={{ color: 'var(--text-secondary)', margin: '0.25rem 0 0', fontSize: '0.85rem' }}>
                                    {viewTemplate.description}
                                </p>
                            )}
                            <p style={{ color: 'var(--text-tertiary)', margin: '0.25rem 0 0', fontSize: '0.8rem' }}>
                                {viewAnswers.length} Q&A pairs · Source: {viewTemplate.source_filename || '—'}
                            </p>
                        </div>
                        <button className="btn btn-secondary" onClick={() => setViewTemplate(null)}>← Back</button>
                    </div>

                    <div className="search-bar" style={{ marginBottom: '0.75rem' }}>
                        <div className="search-input-wrapper">
                            <span className="search-icon">🔍</span>
                            <input
                                type="text"
                                placeholder="Search template answers..."
                                value={answerSearch}
                                onChange={(e) => setAnswerSearch(e.target.value)}
                            />
                        </div>
                    </div>

                    {filteredAnswers.length > 0 ? (
                        <div style={{ overflow: 'hidden', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}>
                            <table className="data-table">
                                <thead>
                                    <tr>
                                        <th style={{ width: '40px' }}>#</th>
                                        <th>Question</th>
                                        <th>Answer</th>
                                        <th style={{ width: '90px' }}>Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredAnswers.map((a, i) => (
                                        <tr key={a.id}>
                                            <td style={{ color: 'var(--text-tertiary)', fontSize: '0.8rem' }}>{a.question_index ?? i + 1}</td>
                                            <td className="cell-truncate">{a.question_text}</td>
                                            <td>
                                                {editingAnswerId === a.id ? (
                                                    <div>
                                                        <textarea
                                                            className="inline-edit-area"
                                                            value={editingText}
                                                            onChange={(e) => setEditingText(e.target.value)}
                                                            rows={3}
                                                        />
                                                        <div className="inline-edit-actions">
                                                            <button className="btn btn-sm btn-primary" onClick={handleSaveAnswer}>Save</button>
                                                            <button className="btn btn-sm btn-secondary" onClick={() => { setEditingAnswerId(null); setEditingText(''); }}>Cancel</button>
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <span className="cell-truncate">{a.answer_text}</span>
                                                )}
                                            </td>
                                            <td>
                                                {editingAnswerId !== a.id && (
                                                    <button
                                                        className="btn btn-sm btn-secondary"
                                                        onClick={() => { setEditingAnswerId(a.id); setEditingText(a.answer_text); }}
                                                    >
                                                        Edit
                                                    </button>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ) : (
                        <p style={{ color: 'var(--text-tertiary)', textAlign: 'center', padding: '1rem' }}>No matching answers.</p>
                    )}
                </div>
            )}

            {/* Template List */}
            {!viewTemplate && (
                templates === null ? (
                    <LoadingSkeleton lines={6} showHeader />
                ) : templates.length > 0 ? (
                    <div className="card table-responsive" style={{ padding: 0, overflow: 'hidden' }}>
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <th>Name</th>
                                    <th>Source File</th>
                                    <th style={{ width: '80px' }}>Questions</th>
                                    <th style={{ width: '80px' }}>Times Used</th>
                                    <th style={{ width: '110px' }}>Last Used</th>
                                    <th style={{ width: '110px' }}>Created</th>
                                    <th style={{ width: '120px' }}>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {templates.map((t) => (
                                    <tr key={t.id}>
                                        <td style={{ fontWeight: 500 }}>{t.name}</td>
                                        <td className="cell-truncate" style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                                            {t.source_filename || '—'}
                                        </td>
                                        <td style={{ textAlign: 'center', fontWeight: 600 }}>{t.question_count}</td>
                                        <td style={{ textAlign: 'center' }}>{t.times_used}</td>
                                        <td style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>{formatDate(t.last_used_at)}</td>
                                        <td style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>{formatDate(t.created_at)}</td>
                                        <td>
                                            <div style={{ display: 'flex', gap: '0.25rem' }}>
                                                <button className="btn btn-sm btn-secondary" onClick={() => handleView(t.id)}>👁️ View</button>
                                                <button className="btn btn-sm btn-danger" onClick={() => setConfirmDelete(t.id)}>🗑️</button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                ) : (
                    <div className="empty-state">
                        <div className="empty-state-icon">📋</div>
                        <div className="empty-state-title">No templates yet</div>
                        <p>After finalizing a job in the review queue, you can save it as a reusable template to pre-fill future questionnaires.</p>
                    </div>
                )
            )}

            {confirmDelete && (
                <div className="modal-overlay" role="dialog" aria-modal="true" onClick={() => setConfirmDelete(null)}>
                    <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '420px' }}>
                        <div className="modal-header">
                            <h2>Confirm</h2>
                            <button className="modal-close" onClick={() => setConfirmDelete(null)}>×</button>
                        </div>
                        <p style={{ color: 'var(--text-secondary)', marginBottom: '1.25rem' }}>
                            Delete this template? All stored Q&A pairs within it will be permanently removed.
                        </p>
                        <div className="modal-actions">
                            <button className="btn btn-secondary" onClick={() => setConfirmDelete(null)}>Cancel</button>
                            <button className="btn btn-danger" onClick={() => handleDelete(confirmDelete)}>Delete</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
