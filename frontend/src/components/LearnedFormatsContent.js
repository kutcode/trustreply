'use client';

import { useState, useEffect, useCallback } from 'react';
import useToast from '@/hooks/useToast';
import { listFingerprints, updateFingerprint, deleteFingerprint, getApiBaseHint } from '@/lib/api';
import LoadingSkeleton from '@/components/LoadingSkeleton';

function formatDate(ts) {
    if (!ts) return '—';
    return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function LearnedFormatsContent() {
    const [fingerprints, setFingerprints] = useState(null);
    const [total, setTotal] = useState(0);
    const { toast, showToast } = useToast();
    const [editingId, setEditingId] = useState(null);
    const [editName, setEditName] = useState('');
    const [confirmDelete, setConfirmDelete] = useState(null);

    const loadData = useCallback(async () => {
        try { const data = await listFingerprints(); setFingerprints(data.items || []); setTotal(data.total || 0); }
        catch (err) { showToast(`Failed to load formats: ${err.message || getApiBaseHint()}`, 'error'); }
    }, []);

    useEffect(() => { loadData(); }, [loadData]);

    const handleSaveName = async (id) => {
        try { await updateFingerprint(id, { name: editName }); setEditingId(null); showToast('Name updated', 'success'); loadData(); }
        catch (err) { showToast(err.message, 'error'); }
    };

    const handleDelete = async (id) => {
        try { await deleteFingerprint(id); setConfirmDelete(null); showToast('Fingerprint deleted', 'success'); loadData(); }
        catch (err) { showToast(err.message, 'error'); }
    };

    return (
        <>
            {toast && (
                <div className="toast-container" role="status" aria-live="polite">
                    <div className={`toast toast-${toast.type}`}>{toast.message}</div>
                </div>
            )}

            <div className="stats-grid">
                <div className="stat-card">
                    <div className="stat-value">{total}</div>
                    <div className="stat-label">Formats Learned</div>
                </div>
            </div>

            {fingerprints === null ? (
                <LoadingSkeleton lines={6} showHeader />
            ) : fingerprints.length > 0 ? (
                <div className="card table-responsive" style={{ padding: 0, overflow: 'hidden' }}>
                    <table className="data-table">
                        <thead>
                            <tr>
                                <th>Name</th>
                                <th style={{ width: '120px' }}>Parser Profile</th>
                                <th style={{ width: '100px' }}>Columns</th>
                                <th>Header Signature</th>
                                <th style={{ width: '80px' }}>Uses</th>
                                <th style={{ width: '110px' }}>Last Used</th>
                                <th style={{ width: '100px' }}>Source File</th>
                                <th style={{ width: '80px' }}>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {fingerprints.map((fp) => (
                                <tr key={fp.id}>
                                    <td>
                                        {editingId === fp.id ? (
                                            <div style={{ display: 'flex', gap: '0.25rem' }}>
                                                <input className="form-input" style={{ fontSize: '0.85rem', padding: '0.25rem 0.5rem' }}
                                                    value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="Enter a name..." autoFocus
                                                    onKeyDown={(e) => e.key === 'Enter' && handleSaveName(fp.id)} />
                                                <button className="btn btn-sm btn-primary" onClick={() => handleSaveName(fp.id)}>Save</button>
                                                <button className="btn btn-sm btn-secondary" onClick={() => setEditingId(null)}>Cancel</button>
                                            </div>
                                        ) : (
                                            <span style={{ cursor: 'pointer', color: fp.name ? 'var(--text-primary)' : 'var(--text-tertiary)' }}
                                                onClick={() => { setEditingId(fp.id); setEditName(fp.name || ''); }}>
                                                {fp.name || 'Click to name...'}
                                            </span>
                                        )}
                                    </td>
                                    <td><span className="status-badge status-processing">{fp.parser_profile}</span></td>
                                    <td style={{ textAlign: 'center' }}>{fp.column_count ?? '—'}</td>
                                    <td className="cell-truncate" style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>{fp.header_signature || '—'}</td>
                                    <td style={{ textAlign: 'center', fontWeight: 600 }}>{fp.success_count}</td>
                                    <td style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>{formatDate(fp.last_used_at)}</td>
                                    <td className="cell-truncate" style={{ fontSize: '0.8rem' }}>{fp.source_filename || '—'}</td>
                                    <td><button className="btn btn-sm btn-danger" onClick={() => setConfirmDelete(fp.id)}>Del</button></td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            ) : (
                <div className="empty-state">
                    <div className="empty-state-icon">🧠</div>
                    <div className="empty-state-title">No formats learned yet</div>
                    <p>Process a questionnaire to start building format memory.</p>
                </div>
            )}

            {confirmDelete && (
                <div className="modal-overlay" role="dialog" aria-modal="true" onClick={() => setConfirmDelete(null)}>
                    <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '420px' }}>
                        <div className="modal-header"><h2>Confirm</h2><button className="modal-close" onClick={() => setConfirmDelete(null)}>&times;</button></div>
                        <p style={{ color: 'var(--text-secondary)', marginBottom: '1.25rem' }}>Delete this learned format?</p>
                        <div className="modal-actions">
                            <button className="btn btn-secondary" onClick={() => setConfirmDelete(null)}>Cancel</button>
                            <button className="btn btn-danger" onClick={() => handleDelete(confirmDelete)}>Delete</button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
