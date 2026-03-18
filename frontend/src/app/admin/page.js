'use client';

import { useState, useEffect, useCallback } from 'react';
import {
    listQAPairs,
    createQAPair,
    updateQAPair,
    deleteQAPair,
    importQAPairs,
    listCategories,
    getApiBaseHint,
    getQAExportUrl,
} from '@/lib/api';

export default function AdminPage() {
    const IMPORT_EXTENSIONS = new Set(['csv', 'json']);
    const [qaPairs, setQaPairs] = useState([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [pageSize] = useState(20);
    const [search, setSearch] = useState('');
    const [categoryFilter, setCategoryFilter] = useState('');
    const [categories, setCategories] = useState([]);
    const [toast, setToast] = useState(null);

    // Modal state
    const [showModal, setShowModal] = useState(false);
    const [editingId, setEditingId] = useState(null);
    const [formData, setFormData] = useState({ category: '', question: '', answer: '' });
    const [showNewCategoryInput, setShowNewCategoryInput] = useState(false);
    const [newCategoryName, setNewCategoryName] = useState('');

    // Confirm action state
    const [confirmAction, setConfirmAction] = useState(null);

    // Import state
    const [showImport, setShowImport] = useState(false);
    const [importDragover, setImportDragover] = useState(false);
    const [importing, setImporting] = useState(false);

    const showToast = (message, type = 'info') => {
        setToast({ message, type });
        setTimeout(() => setToast(null), 4000);
    };

    const loadData = useCallback(async () => {
        try {
            const data = await listQAPairs({ page, pageSize, search, category: categoryFilter });
            setQaPairs(data.items || []);
            setTotal(data.total || 0);
        } catch (err) {
            showToast(`Failed to load Q&A pairs: ${err.message || getApiBaseHint()}`, 'error');
        }
    }, [page, pageSize, search, categoryFilter]);

    const loadCategories = useCallback(async () => {
        try {
            const data = await listCategories();
            setCategories(data.categories || []);
        } catch (err) { }
    }, []);

    const resetCategoryControls = () => {
        setShowNewCategoryInput(false);
        setNewCategoryName('');
    };

    const applyNewCategory = () => {
        const trimmed = newCategoryName.trim();
        if (!trimmed) {
            showToast('❌ Category name is required', 'error');
            return;
        }

        const existing = categories.find((category) => category.toLowerCase() === trimmed.toLowerCase());
        const nextCategory = existing || trimmed;
        if (!existing) {
            setCategories((current) => [...current, trimmed].sort((a, b) => a.localeCompare(b)));
        }
        setFormData((current) => ({ ...current, category: nextCategory }));
        resetCategoryControls();
    };

    useEffect(() => {
        loadData();
    }, [loadData]);

    useEffect(() => {
        loadCategories();
    }, [loadCategories]);

    // Create / Update
    const handleSubmit = async (e) => {
        e.preventDefault();
        try {
            const payload = {
                ...formData,
                category: formData.category.trim(),
            };
            if (!payload.category) {
                showToast('❌ Category is required', 'error');
                return;
            }

            if (editingId) {
                await updateQAPair(editingId, payload);
                showToast('✅ Q&A pair updated', 'success');
            } else {
                await createQAPair(payload);
                showToast('✅ Q&A pair created', 'success');
            }
            setShowModal(false);
            setEditingId(null);
            setFormData({ category: '', question: '', answer: '' });
            resetCategoryControls();
            loadData();
            loadCategories();
        } catch (err) {
            showToast(`❌ ${err.message}`, 'error');
        }
    };

    // Delete
    const handleDelete = (id) => {
        setConfirmAction({
            message: 'Delete this Q&A pair? This action cannot be undone.',
            onConfirm: async () => {
                setConfirmAction(null);
                try {
                    await deleteQAPair(id);
                    showToast('🗑️ Deleted', 'success');
                    loadData();
                    loadCategories();
                } catch (err) {
                    showToast('❌ Delete failed', 'error');
                }
            },
        });
    };

    // Edit
    const handleEdit = (qa) => {
        setEditingId(qa.id);
        setFormData({ category: qa.category || '', question: qa.question, answer: qa.answer });
        resetCategoryControls();
        setShowModal(true);
    };

    const handleImportFile = async (file) => {
        if (!file) return;

        const ext = file.name.split('.').pop()?.toLowerCase();
        if (!ext || !IMPORT_EXTENSIONS.has(ext)) {
            showToast('❌ Only CSV and JSON files can be imported', 'error');
            return;
        }

        setImporting(true);
        try {
            const result = await importQAPairs(file);
            const parts = [`Imported ${result.imported} Q&A pair(s)`];
            if (result.duplicates > 0) {
                parts.push(`skipped ${result.duplicates} duplicate(s)`);
            }
            showToast(`✅ ${parts.join(', ')}`, result.duplicates > 0 ? 'info' : 'success');
            if (result.errors?.length) {
                showToast(`⚠️ ${result.errors.length} row(s) had errors`, 'error');
            }
            loadData();
            loadCategories();
            setShowImport(false);
        } catch (err) {
            showToast(`❌ ${err.message}`, 'error');
        } finally {
            setImporting(false);
            setImportDragover(false);
        }
    };

    // Import
    const handleImport = async (e) => {
        const file = e.target.files?.[0];
        await handleImportFile(file);
        e.target.value = '';
    };

    const handleImportDragOver = (e) => {
        e.preventDefault();
        setImportDragover(true);
    };

    const handleImportDragLeave = () => setImportDragover(false);

    const handleImportDrop = async (e) => {
        e.preventDefault();
        setImportDragover(false);
        const file = e.dataTransfer.files?.[0];
        await handleImportFile(file);
    };

    const totalPages = Math.ceil(total / pageSize);

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
                <h1>Knowledge Base</h1>
                <p>Manage your question-answer pairs used to auto-fill uploaded questionnaires.</p>
            </div>

            {/* Stats */}
            <div className="stats-grid">
                <div className="stat-card">
                    <div className="stat-value">{total}</div>
                    <div className="stat-label">Total Q&A Pairs</div>
                </div>
                <div className="stat-card">
                    <div className="stat-value">{categories.length}</div>
                    <div className="stat-label">Categories</div>
                </div>
            </div>

            {/* Search & Actions */}
            <div className="search-bar">
                <div className="search-input-wrapper">
                    <span className="search-icon">🔍</span>
                    <input
                        type="text"
                        placeholder="Search questions or answers..."
                        value={search}
                        onChange={(e) => {
                            setSearch(e.target.value);
                            setPage(1);
                        }}
                    />
                </div>
                {categories.length > 0 && (
                    <select
                        className="form-select"
                        value={categoryFilter}
                        onChange={(e) => {
                            setCategoryFilter(e.target.value);
                            setPage(1);
                        }}
                        style={{ width: 'auto', minWidth: '160px' }}
                    >
                        <option value="">All Categories</option>
                        {categories.map((c) => (
                            <option key={c} value={c}>{c}</option>
                        ))}
                    </select>
                )}
                <button
                    className="btn btn-primary"
                    onClick={() => {
                        setEditingId(null);
                        setFormData({ category: '', question: '', answer: '' });
                        resetCategoryControls();
                        setShowModal(true);
                    }}
                >
                    + Add Q&A
                </button>
                <button className="btn btn-secondary" onClick={() => setShowImport(true)}>
                    📥 Import
                </button>
                <a
                    href={getQAExportUrl('csv', categoryFilter)}
                    className="btn btn-secondary"
                    download
                >
                    📤 Export
                </a>
            </div>

            {/* Table */}
            {qaPairs.length > 0 ? (
                <>
                    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <th style={{ width: '120px' }}>Category</th>
                                    <th>Question</th>
                                    <th>Answer</th>
                                    <th style={{ width: '120px' }}>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {qaPairs.map((qa) => (
                                    <tr key={qa.id}>
                                        <td>
                                            {qa.category && (
                                                <span className="status-badge status-processing">{qa.category}</span>
                                            )}
                                        </td>
                                        <td className="cell-truncate">{qa.question}</td>
                                        <td className="cell-truncate">{qa.answer}</td>
                                        <td>
                                            <div style={{ display: 'flex', gap: '0.25rem' }}>
                                                <button className="btn btn-sm btn-secondary" onClick={() => handleEdit(qa)}>
                                                    ✏️
                                                </button>
                                                <button className="btn btn-sm btn-danger" onClick={() => handleDelete(qa.id)}>
                                                    🗑️
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    {/* Pagination */}
                    {totalPages > 1 && (
                        <div className="pagination">
                            <button disabled={page <= 1} onClick={() => setPage(page - 1)}>
                                ←
                            </button>
                            {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                                const pageNum = i + 1;
                                return (
                                    <button
                                        key={pageNum}
                                        className={page === pageNum ? 'active' : ''}
                                        onClick={() => setPage(pageNum)}
                                    >
                                        {pageNum}
                                    </button>
                                );
                            })}
                            <button disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
                                →
                            </button>
                        </div>
                    )}
                </>
            ) : (
                <div className="empty-state">
                    <div className="empty-state-icon">📚</div>
                    <div className="empty-state-title">No Q&A pairs yet</div>
                    <p>Add some question-answer pairs to get started, or import from a CSV/JSON file.</p>
                </div>
            )}

            {/* Create/Edit Modal */}
            {showModal && (
                <div className="modal-overlay" onClick={() => setShowModal(false)}>
                    <div className="modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>{editingId ? 'Edit Q&A Pair' : 'Add Q&A Pair'}</h2>
                            <button className="modal-close" onClick={() => setShowModal(false)}>×</button>
                        </div>
                        <form onSubmit={handleSubmit}>
                            <div className="form-group">
                                <label className="form-label">Category</label>
                                <select
                                    className="form-select"
                                    value={formData.category}
                                    onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                                    required
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
                            <div className="form-group">
                                <label className="form-label">Question</label>
                                <textarea
                                    className="form-textarea"
                                    placeholder="Enter the question..."
                                    value={formData.question}
                                    onChange={(e) => setFormData({ ...formData, question: e.target.value })}
                                    required
                                />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Answer</label>
                                <textarea
                                    className="form-textarea"
                                    placeholder="Enter the answer..."
                                    value={formData.answer}
                                    onChange={(e) => setFormData({ ...formData, answer: e.target.value })}
                                    required
                                    style={{ minHeight: '140px' }}
                                />
                            </div>
                            <div className="modal-actions">
                                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>
                                    Cancel
                                </button>
                                <button type="submit" className="btn btn-primary">
                                    {editingId ? 'Save Changes' : 'Create'}
                                </button>
                            </div>
                        </form>
                    </div>
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
                            <button className="btn btn-danger" onClick={confirmAction.onConfirm}>Delete</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Import Modal */}
            {showImport && (
                <div className="modal-overlay" onClick={() => setShowImport(false)}>
                    <div className="modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>Import Q&A Pairs</h2>
                            <button className="modal-close" onClick={() => setShowImport(false)}>×</button>
                        </div>
                        <p style={{ color: 'var(--text-secondary)', marginBottom: '1rem', fontSize: '0.9rem' }}>
                            Upload a CSV or JSON file containing your Q&A pairs.
                        </p>
                        <div style={{ background: 'var(--bg-input)', padding: '1rem', borderRadius: 'var(--radius-md)', marginBottom: '1rem', fontSize: '0.85rem', fontFamily: 'var(--font-mono)' }}>
                            <strong>CSV format:</strong><br />
                            category,question,answer<br />
                            Security,&quot;Do you encrypt data?&quot;,&quot;Yes, AES-256&quot;
                        </div>
                        <div style={{ background: 'var(--bg-input)', padding: '1rem', borderRadius: 'var(--radius-md)', marginBottom: '1.5rem', fontSize: '0.85rem', fontFamily: 'var(--font-mono)' }}>
                            <strong>JSON format:</strong><br />
                            {`[{"category":"Security","question":"...","answer":"..."}]`}
                        </div>
                        <div
                            className={`upload-zone ${importDragover ? 'dragover' : ''}`}
                            onDragOver={handleImportDragOver}
                            onDragLeave={handleImportDragLeave}
                            onDrop={handleImportDrop}
                            style={{ padding: '2rem 1.25rem' }}
                        >
                            <input
                                type="file"
                                accept=".csv,.json"
                                onChange={handleImport}
                                disabled={importing}
                            />
                            <span className="upload-zone-icon" style={{ fontSize: '2.25rem', marginBottom: '0.75rem' }}>📥</span>
                            <div className="upload-zone-title" style={{ fontSize: '1rem' }}>
                                {importing ? 'Importing file...' : 'Drop a CSV or JSON file here'}
                            </div>
                            <div className="upload-zone-subtitle">
                                {importing ? 'Please wait while we import your knowledge base entries.' : 'Or click anywhere in this area to choose a file.'}
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
