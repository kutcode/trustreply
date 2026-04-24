'use client';

// Re-exports the duplicates page content as a component.
// The actual implementation lives in the duplicates page, which already
// has its own internal tabs (Review Queue / Scan & Merge).
// We import and re-render it here, stripping the page-container wrapper.

import { useState, useCallback, useEffect } from 'react';
import useToast from '@/hooks/useToast';
import {
    detectDuplicates,
    mergeKBEntries,
    bulkMergeKBEntries,
    listCategories,
    classifyDuplicates,
    listDuplicateReviews,
    actionDuplicateReview,
    bulkActionDuplicateReviews,
} from '@/lib/api';
import LoadingSkeleton from '@/components/LoadingSkeleton';

const formatDate = (dateStr) => {
    if (!dateStr) return '';
    try { return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
    catch { return dateStr; }
};
const truncate = (text, max = 120) => (!text ? '' : text.length > max ? text.slice(0, max) + '...' : text);

function ClassBadge({ classification }) {
    const map = {
        definitely_same: { label: 'Definitely Same', color: '#ef4444', bg: 'rgba(239, 68, 68, 0.12)' },
        probably_same: { label: 'Probably Same', color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.12)' },
        different: { label: 'Different', color: '#22c55e', bg: 'rgba(34, 197, 94, 0.12)' },
    };
    const info = map[classification] || { label: classification || 'Unknown', color: 'var(--text-muted)', bg: 'var(--bg-input)' };
    return (
        <span style={{ display: 'inline-block', padding: '0.2rem 0.6rem', borderRadius: '9999px', fontSize: '0.75rem', fontWeight: 700, color: info.color, background: info.bg, textTransform: 'uppercase', letterSpacing: '0.03em' }}>
            {info.label}
        </span>
    );
}

function SimilarityBar({ score }) {
    const pct = Math.round(score * 100);
    const color = pct >= 95 ? '#ef4444' : pct >= 85 ? '#f59e0b' : '#22c55e';
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <div style={{ flex: 1, height: 6, background: 'var(--bg-input)', borderRadius: 3, overflow: 'hidden', minWidth: 60 }}>
                <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 3 }} />
            </div>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', fontWeight: 600, color }}>{pct}%</span>
        </div>
    );
}

function ScanAndMergeTab({ showToast }) {
    const [threshold, setThreshold] = useState(0.85);
    const [categoryFilter, setCategoryFilter] = useState('');
    const [categories, setCategories] = useState([]);
    const [clusters, setClusters] = useState(null);
    const [scanning, setScanning] = useState(false);
    const [merging, setMerging] = useState({});
    const [mergingAll, setMergingAll] = useState(false);
    const [selectedKeep, setSelectedKeep] = useState({});
    const [expandedClusters, setExpandedClusters] = useState({});
    const [mergeSummary, setMergeSummary] = useState(null);
    const [confirmAction, setConfirmAction] = useState(null);

    const loadCategories = useCallback(async () => {
        try { const data = await listCategories(); setCategories(data.categories || []); } catch (err) { console.warn('Failed to load categories:', err.message); }
    }, []);
    useEffect(() => { loadCategories(); }, [loadCategories]);

    const pickDefault = (entries) => {
        if (!entries || entries.length === 0) return null;
        return entries.reduce((best, entry) => {
            const bestDate = best.updated_at || best.created_at || '';
            const entryDate = entry.updated_at || entry.created_at || '';
            return entryDate > bestDate ? entry : best;
        }).id;
    };

    const handleScan = useCallback(async () => {
        setScanning(true); setClusters(null); setMergeSummary(null);
        try {
            const res = await detectDuplicates(threshold, categoryFilter || null);
            if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.detail || 'Scan failed'); }
            const data = await res.json();
            const items = data.clusters || [];
            setClusters(items);
            const defaults = {}, expanded = {};
            items.forEach((c, idx) => { defaults[idx] = pickDefault(c.entries); expanded[idx] = true; });
            setSelectedKeep(defaults); setExpandedClusters(expanded);
            if (items.length === 0) showToast('No duplicates found at this threshold.', 'info');
        } catch (err) { showToast(`Failed to scan: ${err.message}`, 'error'); }
        finally { setScanning(false); }
    }, [threshold, categoryFilter, showToast]);

    const handleMergeCluster = useCallback(async (clusterIdx) => {
        const cluster = clusters[clusterIdx];
        const keepId = selectedKeep[clusterIdx];
        if (!keepId) return;
        const deleteIds = cluster.entries.map((e) => e.id).filter((id) => id !== keepId);
        if (deleteIds.length === 0) return;
        setMerging((prev) => ({ ...prev, [clusterIdx]: true }));
        try {
            const res = await mergeKBEntries(keepId, deleteIds);
            if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.detail || 'Merge failed'); }
            showToast(`Merged cluster: kept 1, removed ${deleteIds.length}`, 'success');
            setClusters((prev) => prev.filter((_, i) => i !== clusterIdx));
            setSelectedKeep((prev) => { const next = {}; Object.keys(prev).forEach((k) => { const ki = parseInt(k); if (ki < clusterIdx) next[ki] = prev[k]; else if (ki > clusterIdx) next[ki - 1] = prev[k]; }); return next; });
            setExpandedClusters((prev) => { const next = {}; Object.keys(prev).forEach((k) => { const ki = parseInt(k); if (ki < clusterIdx) next[ki] = prev[k]; else if (ki > clusterIdx) next[ki - 1] = prev[k]; }); return next; });
        } catch (err) { showToast(`Merge failed: ${err.message}`, 'error'); }
        finally { setMerging((prev) => { const next = { ...prev }; delete next[clusterIdx]; return next; }); }
    }, [clusters, selectedKeep, showToast]);

    const handleMergeAll = useCallback(async () => {
        if (!clusters || clusters.length === 0) return;
        setMergingAll(true);
        try {
            const merges = clusters.map((c, idx) => ({ keep_id: selectedKeep[idx], delete_ids: c.entries.map((e) => e.id).filter((id) => id !== selectedKeep[idx]) })).filter((m) => m.delete_ids.length > 0);
            if (merges.length === 0) { showToast('Nothing to merge.', 'info'); return; }
            const res = await bulkMergeKBEntries(merges);
            if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.detail || 'Bulk merge failed'); }
            const data = await res.json();
            setMergeSummary({ clusters: data.merged_clusters || merges.length, removed: data.removed_entries || merges.reduce((s, m) => s + m.delete_ids.length, 0) });
            setClusters([]); setSelectedKeep({}); setExpandedClusters({});
            showToast('Merge complete', 'success');
        } catch (err) { showToast(`Bulk merge failed: ${err.message}`, 'error'); }
        finally { setMergingAll(false); }
    }, [clusters, selectedKeep, showToast]);

    const toggleCluster = (idx) => setExpandedClusters((prev) => ({ ...prev, [idx]: !prev[idx] }));
    const totalDupes = clusters ? clusters.reduce((s, c) => s + (c.entries?.length || 0), 0) : 0;

    return (
        <>
            <div className="card" style={{ marginBottom: '1.5rem' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                        <label className="form-label" style={{ margin: 0, minWidth: '80px' }}>Threshold</label>
                        <input type="range" min="0.70" max="0.95" step="0.01" value={threshold} onChange={(e) => setThreshold(parseFloat(e.target.value))} style={{ flex: '1 1 200px', maxWidth: '300px' }} />
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-primary)', minWidth: '40px' }}>{threshold.toFixed(2)}</span>
                    </div>
                    <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
                        {categories.length > 0 && (
                            <select className="form-select" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} style={{ width: 'auto', minWidth: '180px' }}>
                                <option value="">All Categories</option>
                                {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                            </select>
                        )}
                        <button className="btn btn-primary" onClick={handleScan} disabled={scanning}>{scanning ? 'Scanning...' : 'Scan for Duplicates'}</button>
                    </div>
                </div>
            </div>

            {scanning && <LoadingSkeleton lines={6} showHeader />}
            {mergeSummary && (
                <div className="card" style={{ marginBottom: '1.5rem', background: 'var(--success-bg)', borderColor: 'var(--success)' }}>
                    <div style={{ color: 'var(--success)', fontWeight: 600 }}>Merged {mergeSummary.clusters} cluster{mergeSummary.clusters === 1 ? '' : 's'}, removed {mergeSummary.removed} duplicate{mergeSummary.removed === 1 ? '' : 's'}</div>
                </div>
            )}

            {clusters !== null && !scanning && clusters.length > 0 && (
                <>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.75rem' }}>
                        <div style={{ color: 'var(--text-secondary)', fontSize: '0.95rem' }}>Found <strong>{clusters.length}</strong> cluster{clusters.length === 1 ? '' : 's'} ({totalDupes} entries)</div>
                        <button className="btn btn-primary" onClick={() => setConfirmAction({ message: `Merge all ${clusters.length} cluster(s)?`, onConfirm: async () => { setConfirmAction(null); await handleMergeAll(); } })} disabled={mergingAll}>{mergingAll ? 'Merging...' : `Merge All (${clusters.length})`}</button>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                        {clusters.map((cluster, idx) => {
                            const isExpanded = expandedClusters[idx] !== false;
                            const keepId = selectedKeep[idx];
                            return (
                                <div key={idx} className="card" style={{ padding: 0, overflow: 'hidden' }}>
                                    <div onClick={() => toggleCluster(idx)} style={{ padding: '0.85rem 1.25rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', borderBottom: isExpanded ? '1px solid var(--border-color)' : 'none', userSelect: 'none' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                            <span style={{ transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.15s', display: 'inline-block', fontSize: '0.85rem', color: 'var(--text-muted)' }}>{"\u25B6"}</span>
                                            <span style={{ fontWeight: 600 }}>Cluster {idx + 1}</span>
                                            <span className="status-badge status-processing">{cluster.entries?.length} entries</span>
                                        </div>
                                    </div>
                                    {isExpanded && (
                                        <div style={{ padding: '0.75rem 1.25rem' }}>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                                {cluster.entries?.map((entry) => {
                                                    const isSelected = keepId === entry.id;
                                                    return (
                                                        <label key={entry.id} style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start', cursor: 'pointer', padding: '0.75rem', borderRadius: 'var(--radius-sm)', border: isSelected ? '1px solid var(--accent)' : '1px solid var(--border-color)', background: isSelected ? 'rgba(99,102,241,0.06)' : 'var(--bg-input)' }}>
                                                            <input type="radio" name={`cluster-${idx}`} checked={isSelected} onChange={() => setSelectedKeep((p) => ({ ...p, [idx]: entry.id }))} style={{ marginTop: '0.2rem' }} />
                                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                                <div style={{ fontWeight: 600, fontSize: '0.95rem', marginBottom: '0.3rem' }}>{entry.question}</div>
                                                                <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.35rem' }}>{truncate(entry.answer)}</div>
                                                                <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                                                                    {entry.category && <span className="status-badge status-processing" style={{ fontSize: '0.75rem' }}>{entry.category}</span>}
                                                                    {isSelected && <span style={{ color: 'var(--accent)', fontWeight: 600, fontSize: '0.78rem' }}>KEEP</span>}
                                                                </div>
                                                            </div>
                                                        </label>
                                                    );
                                                })}
                                            </div>
                                            <div style={{ marginTop: '0.85rem', display: 'flex', justifyContent: 'flex-end' }}>
                                                <button className="btn btn-primary btn-sm" onClick={() => handleMergeCluster(idx)} disabled={merging[idx] || !keepId}>{merging[idx] ? 'Merging...' : `Merge cluster`}</button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </>
            )}

            {clusters !== null && !scanning && clusters.length === 0 && !mergeSummary && (
                <div className="empty-state"><div className="empty-state-icon">✅</div><div className="empty-state-title">No duplicates found</div><p>Try lowering the threshold.</p></div>
            )}

            {confirmAction && (
                <div className="modal-overlay" role="dialog" aria-modal="true" onClick={() => setConfirmAction(null)}>
                    <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '420px' }}>
                        <div className="modal-header"><h2>Confirm</h2><button className="modal-close" onClick={() => setConfirmAction(null)}>x</button></div>
                        <p style={{ color: 'var(--text-secondary)', marginBottom: '1.25rem' }}>{confirmAction.message}</p>
                        <div className="modal-actions">
                            <button className="btn btn-secondary" onClick={() => setConfirmAction(null)}>Cancel</button>
                            <button className="btn btn-primary" onClick={confirmAction.onConfirm}>Merge All</button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}

function ReviewQueueTab({ showToast }) {
    const [reviews, setReviews] = useState([]);
    const [total, setTotal] = useState(0);
    const [pendingCount, setPendingCount] = useState(0);
    const [reviewedCount, setReviewedCount] = useState(0);
    const [statusFilter, setStatusFilter] = useState('pending');
    const [page, setPage] = useState(1);
    const [loading, setLoading] = useState(true);
    const [classifying, setClassifying] = useState(false);
    const [classifyThreshold, setClassifyThreshold] = useState(0.85);
    const [actionInProgress, setActionInProgress] = useState({});
    const [bulkProcessing, setBulkProcessing] = useState(false);
    const [confirmAction, setConfirmAction] = useState(null);
    const pageSize = 20;

    const loadReviews = useCallback(async () => {
        setLoading(true);
        try {
            const data = await listDuplicateReviews({ status: statusFilter, page, pageSize });
            setReviews(data.items || []); setTotal(data.total || 0); setPendingCount(data.pending_count || 0); setReviewedCount(data.reviewed_count || 0);
        } catch (err) { showToast(`Failed to load reviews: ${err.message}`, 'error'); }
        finally { setLoading(false); }
    }, [statusFilter, page, pageSize, showToast]);

    useEffect(() => { loadReviews(); }, [loadReviews]);

    const handleClassify = useCallback(async () => {
        setClassifying(true);
        try {
            const data = await classifyDuplicates(classifyThreshold);
            showToast(`Classified ${data.total_classified} pairs using ${data.llm_model}`, 'success');
            await loadReviews();
        } catch (err) { showToast(`Classification failed: ${err.message}`, 'error'); }
        finally { setClassifying(false); }
    }, [classifyThreshold, loadReviews, showToast]);

    const handleAction = useCallback(async (reviewId, action) => {
        setActionInProgress((p) => ({ ...p, [reviewId]: action }));
        try {
            await actionDuplicateReview(reviewId, action);
            showToast(`Action applied`, 'success');
            await loadReviews();
        } catch (err) { showToast(`Action failed: ${err.message}`, 'error'); }
        finally { setActionInProgress((p) => { const n = { ...p }; delete n[reviewId]; return n; }); }
    }, [loadReviews, showToast]);

    const handleBulkAcceptAI = useCallback(async () => {
        const items = reviews.filter((r) => r.status === 'pending' && r.classification && r.classification !== 'different');
        if (items.length === 0) { showToast('No pending recommendations to apply.', 'info'); return; }
        setBulkProcessing(true);
        try {
            const actions = items.map((r) => ({ review_id: r.id, action: r.recommended_keep_id === r.entry_a?.id ? 'keep_left' : 'keep_right' }));
            const result = await bulkActionDuplicateReviews(actions);
            showToast(`Processed ${result.processed} reviews`, result.errors?.length ? 'warning' : 'success');
            await loadReviews();
        } catch (err) { showToast(`Bulk action failed: ${err.message}`, 'error'); }
        finally { setBulkProcessing(false); }
    }, [reviews, loadReviews, showToast]);

    const handleDismissAll = useCallback(async () => {
        const items = reviews.filter((r) => r.status === 'pending' && r.classification === 'different');
        if (items.length === 0) { showToast('No "different" pairs to dismiss.', 'info'); return; }
        setBulkProcessing(true);
        try {
            const actions = items.map((r) => ({ review_id: r.id, action: 'keep_both' }));
            const result = await bulkActionDuplicateReviews(actions);
            showToast(`Dismissed ${result.processed} pairs`, 'success');
            await loadReviews();
        } catch (err) { showToast(`Dismiss failed: ${err.message}`, 'error'); }
        finally { setBulkProcessing(false); }
    }, [reviews, loadReviews, showToast]);

    const totalPages = Math.ceil(total / pageSize);

    return (
        <>
            <div className="card" style={{ marginBottom: '1.5rem' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                        <label className="form-label" style={{ margin: 0, minWidth: '80px' }}>Threshold</label>
                        <input type="range" min="0.70" max="0.95" step="0.01" value={classifyThreshold} onChange={(e) => setClassifyThreshold(parseFloat(e.target.value))} style={{ flex: '1 1 200px', maxWidth: '300px' }} />
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.95rem', fontWeight: 600, minWidth: '40px' }}>{classifyThreshold.toFixed(2)}</span>
                    </div>
                    <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
                        <button className="btn btn-primary" onClick={handleClassify} disabled={classifying}>{classifying ? 'Classifying...' : 'Scan & Classify'}</button>
                        <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Detect and classify duplicate pairs using semantic analysis</span>
                    </div>
                </div>
            </div>

            <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                    {['pending', 'reviewed', 'dismissed', 'all'].map((s) => (
                        <button key={s} className={`btn btn-sm ${statusFilter === s ? 'btn-primary' : 'btn-secondary'}`}
                            onClick={() => { setStatusFilter(s); setPage(1); }}>
                            {s === 'pending' ? `Pending (${pendingCount})` : s === 'reviewed' ? `Reviewed (${reviewedCount})` : s === 'all' ? `All (${total})` : 'Dismissed'}
                        </button>
                    ))}
                </div>
                <div style={{ flex: 1 }} />
                {statusFilter === 'pending' && pendingCount > 0 && (
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button className="btn btn-sm btn-secondary" onClick={() => setConfirmAction({ message: 'Dismiss all "different" pairs?', onConfirm: async () => { setConfirmAction(null); await handleDismissAll(); } })} disabled={bulkProcessing}>Dismiss "Different"</button>
                        <button className="btn btn-sm btn-primary" onClick={() => setConfirmAction({ message: 'Accept recommendations for all duplicate pairs?', onConfirm: async () => { setConfirmAction(null); await handleBulkAcceptAI(); } })} disabled={bulkProcessing}>{bulkProcessing ? 'Processing...' : 'Accept All'}</button>
                    </div>
                )}
            </div>

            {(pendingCount + reviewedCount) > 0 && (
                <div style={{ marginBottom: '1.25rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.3rem' }}>
                        <span>Review Progress</span><span>{reviewedCount} / {pendingCount + reviewedCount} reviewed</span>
                    </div>
                    <div style={{ height: 6, background: 'var(--bg-input)', borderRadius: 3, overflow: 'hidden' }}>
                        <div style={{ width: `${(pendingCount + reviewedCount) > 0 ? (reviewedCount / (pendingCount + reviewedCount) * 100) : 0}%`, height: '100%', background: 'var(--accent)', borderRadius: 3, transition: 'width 0.3s ease' }} />
                    </div>
                </div>
            )}

            {loading && <LoadingSkeleton lines={6} showHeader />}

            {!loading && reviews.length === 0 && (
                <div className="empty-state">
                    <div className="empty-state-icon">🔍</div>
                    <div className="empty-state-title">{statusFilter === 'pending' ? 'No pending reviews' : 'No reviews found'}</div>
                    <p>{statusFilter === 'pending' ? 'Run "Scan & Classify" to detect duplicates.' : 'No duplicate reviews match this filter.'}</p>
                </div>
            )}

            {!loading && reviews.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    {reviews.map((review) => {
                        const isProcessing = !!actionInProgress[review.id];
                        const isPending = review.status === 'pending';
                        const recIsLeft = review.recommended_keep_id === review.entry_a?.id;
                        const recIsRight = review.recommended_keep_id === review.entry_b?.id;
                        return (
                            <div key={review.id} className="card" style={{ padding: 0, overflow: 'hidden', opacity: isProcessing ? 0.7 : 1 }}>
                                <div style={{ padding: '0.75rem 1.25rem', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                                        <ClassBadge classification={review.classification} />
                                        {review.contradicts === true && (
                                            <span style={{ display: 'inline-block', padding: '0.2rem 0.6rem', borderRadius: '9999px', fontSize: '0.75rem', fontWeight: 700, color: '#ef4444', background: 'rgba(239, 68, 68, 0.12)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                                                Contradiction
                                            </span>
                                        )}
                                        <SimilarityBar score={review.similarity_score} />
                                        {review.source === 'auto_flag' && <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', background: 'var(--bg-input)', padding: '0.15rem 0.45rem', borderRadius: '4px' }}>AUTO</span>}
                                    </div>
                                    {review.reviewed_action && <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--success)' }}>{review.reviewed_action === 'keep_left' ? 'Kept Left' : review.reviewed_action === 'keep_right' ? 'Kept Right' : review.reviewed_action === 'keep_both' ? 'Kept Both' : 'Merged'}</span>}
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0 }}>
                                    {[{ entry: review.entry_a, label: 'Entry A', isRec: recIsLeft }, { entry: review.entry_b, label: 'Entry B', isRec: recIsRight }].map(({ entry, label, isRec }) => (
                                        <div key={label} style={{ padding: '1rem 1.25rem', borderRight: label === 'Entry A' ? '1px solid var(--border-color)' : 'none', background: isRec ? 'rgba(99,102,241,0.04)' : 'transparent' }}>
                                            <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.5rem' }}>
                                                {label} {isRec && <span style={{ color: 'var(--accent)' }}>(Recommended)</span>}
                                            </div>
                                            <div style={{ fontWeight: 600, fontSize: '0.95rem', marginBottom: '0.4rem', lineHeight: 1.35 }}>{entry?.question}</div>
                                            <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: '0.4rem' }}>{truncate(entry?.answer, 200)}</div>
                                            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                                {entry?.category && <span className="status-badge status-processing" style={{ fontSize: '0.7rem' }}>{entry.category}</span>}
                                                <span>{formatDate(entry?.updated_at || entry?.created_at)}</span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                                {review.reason && (
                                    <div style={{ padding: '0.6rem 1.25rem', borderTop: '1px solid var(--border-color)', fontSize: '0.85rem', color: 'var(--text-secondary)', background: 'var(--bg-input)' }}>
                                        <span style={{ fontWeight: 600, color: 'var(--text-muted)', fontSize: '0.75rem', textTransform: 'uppercase', marginRight: '0.5rem' }}>Reason:</span>{review.reason}
                                    </div>
                                )}
                                {isPending && (
                                    <div style={{ padding: '0.75rem 1.25rem', borderTop: '1px solid var(--border-color)', display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                                        <button className={`btn btn-sm ${recIsLeft ? 'btn-primary' : 'btn-secondary'}`} onClick={() => handleAction(review.id, 'keep_left')} disabled={isProcessing}>Keep Left</button>
                                        <button className={`btn btn-sm ${recIsRight ? 'btn-primary' : 'btn-secondary'}`} onClick={() => handleAction(review.id, 'keep_right')} disabled={isProcessing}>Keep Right</button>
                                        <button className="btn btn-sm btn-secondary" onClick={() => handleAction(review.id, 'keep_both')} disabled={isProcessing}>Keep Both</button>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            {!loading && totalPages > 1 && (
                <div style={{ display: 'flex', justifyContent: 'center', gap: '0.5rem', marginTop: '1.25rem' }}>
                    <button className="btn btn-sm btn-secondary" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>Prev</button>
                    <span style={{ display: 'flex', alignItems: 'center', fontSize: '0.85rem', color: 'var(--text-muted)', padding: '0 0.5rem' }}>Page {page} of {totalPages}</span>
                    <button className="btn btn-sm btn-secondary" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}>Next</button>
                </div>
            )}

            {confirmAction && (
                <div className="modal-overlay" role="dialog" aria-modal="true" onClick={() => setConfirmAction(null)}>
                    <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '480px' }}>
                        <div className="modal-header"><h2>Confirm</h2><button className="modal-close" onClick={() => setConfirmAction(null)}>x</button></div>
                        <p style={{ color: 'var(--text-secondary)', marginBottom: '1.25rem' }}>{confirmAction.message}</p>
                        <div className="modal-actions">
                            <button className="btn btn-secondary" onClick={() => setConfirmAction(null)}>Cancel</button>
                            <button className="btn btn-primary" onClick={confirmAction.onConfirm}>Confirm</button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}

export default function DuplicatesContent() {
    const [activeTab, setActiveTab] = useState('review');
    const { toast, showToast } = useToast();

    return (
        <>
            {toast && (
                <div className="toast-container" role="status" aria-live="polite">
                    <div className={`toast toast-${toast.type}`}>{toast.message}</div>
                </div>
            )}

            {/* Inner tabs for Review Queue vs Scan & Merge */}
            <div style={{ display: 'flex', gap: '0', marginBottom: '1.5rem', borderBottom: '2px solid var(--border-color)' }}>
                {[{ id: 'review', label: 'Review Queue' }, { id: 'scan', label: 'Scan & Merge' }].map((tab) => (
                    <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{
                        padding: '0.55rem 1rem', border: 'none', background: 'transparent',
                        color: activeTab === tab.id ? 'var(--accent)' : 'var(--text-muted)',
                        fontWeight: activeTab === tab.id ? 700 : 500, fontSize: '0.9rem', cursor: 'pointer',
                        borderBottom: activeTab === tab.id ? '2px solid var(--accent)' : '2px solid transparent',
                        marginBottom: '-2px', transition: 'color 0.15s, border-color 0.15s',
                    }}>{tab.label}</button>
                ))}
            </div>

            {activeTab === 'review' && <ReviewQueueTab showToast={showToast} />}
            {activeTab === 'scan' && <ScanAndMergeTab showToast={showToast} />}
        </>
    );
}
