'use client';

import React, { useState, useMemo, useCallback } from 'react';
import {
  updateQuestionResult,
  approveQuestionResult,
  approveAllQuestionResults,
  finalizeJob,
  downloadJobResult,
  createTemplate,
  listTemplates,
} from '@/lib/api';

export default function ReviewQueue({
  currentJob,
  questionResults,
  onResultsChange,
  onAuditRefresh,
  onTemplatesRefresh,
  showToast,
}) {
  const [editingQuestionId, setEditingQuestionId] = useState(null);
  const [editingText, setEditingText] = useState('');
  const [reviewFilter, setReviewFilter] = useState('all');
  const [finalizing, setFinalizing] = useState(false);
  const [expandedReasoning, setExpandedReasoning] = useState(new Set());
  const [expandedSource, setExpandedSource] = useState(new Set());
  const [savingTemplate, setSavingTemplate] = useState(false);

  const filteredQuestionResults = useMemo(() => {
    if (!questionResults?.items) return [];
    if (reviewFilter === 'unreviewed') return questionResults.items.filter((q) => !q.reviewed);
    if (reviewFilter === 'low_confidence') return questionResults.items.filter((q) => q.confidence_score !== null && q.confidence_score < 0.7);
    return questionResults.items;
  }, [questionResults, reviewFilter]);

  const toggleReasoning = useCallback((qrId) => {
    setExpandedReasoning((prev) => {
      const next = new Set(prev);
      if (next.has(qrId)) next.delete(qrId);
      else next.add(qrId);
      return next;
    });
  }, []);

  const toggleSource = useCallback((qrId) => {
    setExpandedSource((prev) => {
      const next = new Set(prev);
      if (next.has(qrId)) next.delete(qrId);
      else next.add(qrId);
      return next;
    });
  }, []);

  const handleApprove = async (questionId) => {
    try {
      await approveQuestionResult(currentJob.id, questionId);
      onResultsChange();
      onAuditRefresh();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const handleApproveAll = async () => {
    try {
      await approveAllQuestionResults(currentJob.id);
      onResultsChange();
      onAuditRefresh();
      showToast('All questions approved', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const handleStartEdit = (qr) => {
    setEditingQuestionId(qr.id);
    setEditingText(qr.edited_answer_text || qr.answer_text || '');
  };

  const handleSaveEdit = async () => {
    if (!editingQuestionId) return;
    try {
      await updateQuestionResult(currentJob.id, editingQuestionId, editingText);
      setEditingQuestionId(null);
      setEditingText('');
      onResultsChange();
      onAuditRefresh();
      showToast('Answer updated', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const handleCancelEdit = () => {
    setEditingQuestionId(null);
    setEditingText('');
  };

  const handleFinalize = async () => {
    setFinalizing(true);
    try {
      await finalizeJob(currentJob.id);
      showToast('Document finalized. Downloading...', 'success');
      await downloadJobResult(currentJob.id);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setFinalizing(false);
    }
  };

  const handleSaveTemplate = async () => {
    const name = prompt('Give this template a name:');
    if (!name || !name.trim()) return;
    setSavingTemplate(true);
    try {
      await createTemplate({ job_id: currentJob.id, name: name.trim() });
      showToast('Template saved!', 'success');
      onTemplatesRefresh();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setSavingTemplate(false);
    }
  };

  if (!questionResults || questionResults.total === 0) {
    return (
      <div style={{ textAlign: 'center' }}>
        <button className="btn btn-success btn-lg" onClick={() => downloadJobResult(currentJob.id)}>
          Download Filled File
        </button>
      </div>
    );
  }

  return (
    <div style={{ marginTop: '1rem' }}>
      <div className="review-toolbar">
        <span style={{ fontWeight: 700 }}>
          {questionResults.reviewed_count}/{questionResults.total} reviewed
        </span>
        <select
          className="form-select"
          style={{ width: 'auto', minWidth: '160px' }}
          value={reviewFilter}
          onChange={(e) => setReviewFilter(e.target.value)}
        >
          <option value="all">All Questions ({questionResults.total})</option>
          <option value="unreviewed">Needs Review ({questionResults.unreviewed_count})</option>
          <option value="low_confidence">Low Confidence</option>
        </select>
        <button className="btn btn-sm btn-secondary" onClick={handleApproveAll} disabled={questionResults.unreviewed_count === 0}>
          Approve All
        </button>
      </div>

      <div className="table-responsive">
        <table className="data-table">
          <thead>
            <tr>
              <th style={{ width: '3rem' }}>#</th>
              <th style={{ width: '30%' }}>Question</th>
              <th style={{ width: '35%' }}>Answer</th>
              <th style={{ width: '7rem' }}>Confidence</th>
              <th style={{ width: '6rem' }}>Source</th>
              <th style={{ width: '10rem' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredQuestionResults.map((qr) => (
              <React.Fragment key={qr.id}>
                <tr className={qr.reviewed ? 'row-reviewed' : ''}>
                  <td>{qr.question_index + 1}</td>
                  <td style={{ fontSize: '0.85rem' }}>{qr.question_text}</td>
                  <td style={{ fontSize: '0.85rem' }}>
                    {editingQuestionId === qr.id ? (
                      <div>
                        <textarea
                          className="inline-edit-area"
                          value={editingText}
                          onChange={(e) => setEditingText(e.target.value)}
                          rows={3}
                        />
                        <div className="inline-edit-actions">
                          <button className="btn btn-sm btn-primary" onClick={handleSaveEdit}>Save</button>
                          <button className="btn btn-sm btn-secondary" onClick={handleCancelEdit}>Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <span style={{ color: qr.answer_text ? 'var(--text-primary)' : 'var(--error)' }}>
                        {qr.edited_answer_text || qr.answer_text || 'No answer'}
                      </span>
                    )}
                  </td>
                  <td>
                    {(() => {
                      const score = qr.confidence_score;
                      if (score == null) return <span className="confidence-badge confidence-unknown">N/A</span>;
                      if (score >= 0.85) return <span className="confidence-badge confidence-high">{Math.round(score * 100)}%</span>;
                      if (score >= 0.70) return <span className="confidence-badge confidence-medium">{Math.round(score * 100)}%</span>;
                      return <span className="confidence-badge confidence-low">{Math.round(score * 100)}%</span>;
                    })()}
                  </td>
                  <td>
                    {qr.source_kb ? (
                      <button
                        type="button"
                        onClick={() => toggleSource(qr.id)}
                        title="Click to view source KB entry"
                        aria-expanded={expandedSource.has(qr.id)}
                        style={{
                          fontSize: '0.72rem',
                          padding: '0.2rem 0.55rem',
                          borderRadius: '999px',
                          border: '1px solid var(--border, #ddd)',
                          background: expandedSource.has(qr.id) ? 'var(--primary, #7c3aed)' : 'var(--surface-alt, #f3f4f6)',
                          color: expandedSource.has(qr.id) ? '#fff' : 'var(--text-primary)',
                          cursor: 'pointer',
                          fontWeight: 600,
                        }}
                      >
                        [1 source]
                      </button>
                    ) : (
                      <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                        {qr.source === 'kb_match' ? 'KB' : qr.source === 'resolved_flagged' ? 'Resolved' : qr.source === 'agent' ? 'Agent' : 'Unmatched'}
                      </span>
                    )}
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                      {!qr.reviewed && (
                        <button className="btn btn-sm btn-success" onClick={() => handleApprove(qr.id)} title="Approve">
                          ✓
                        </button>
                      )}
                      <button className="btn btn-sm btn-secondary" onClick={() => handleStartEdit(qr)} title="Edit answer">
                        ✏
                      </button>
                      {(qr.agent_reason || (qr.agent_issues && qr.agent_issues.length > 0)) && (
                        <button
                          className="btn btn-sm"
                          style={{ background: 'var(--surface-alt)', fontSize: '0.72rem', padding: '0.15rem 0.4rem' }}
                          onClick={() => toggleReasoning(qr.id)}
                          title="Show AI reasoning"
                          aria-expanded={expandedReasoning.has(qr.id)}
                        >
                          {expandedReasoning.has(qr.id) ? '▾ Why' : '▸ Why'}
                        </button>
                      )}
                      {qr.assigned_to && (
                        <span style={{ display: 'inline-block', padding: '0.1rem 0.45rem', borderRadius: '999px', fontSize: '0.68rem', fontWeight: 600, background: 'var(--primary, #7c3aed)', color: '#fff' }} title={qr.assigned_to}>
                          {qr.assigned_to}
                        </span>
                      )}
                      {qr.reviewed && (
                        <span className="status-badge status-done" style={{ fontSize: '0.72rem' }}>Reviewed</span>
                      )}
                    </div>
                  </td>
                </tr>
                {expandedSource.has(qr.id) && qr.source_kb && (
                  <tr>
                    <td colSpan={6} style={{
                      background: 'var(--surface-alt, #f8f9fa)',
                      padding: '0.7rem 1rem',
                      fontSize: '0.82rem',
                      borderTop: 'none',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.4rem' }}>
                        <strong>Source KB Entry #{qr.source_kb.id}</strong>
                        {qr.source_kb.category && (
                          <span style={{
                            fontSize: '0.7rem',
                            padding: '0.1rem 0.45rem',
                            borderRadius: '999px',
                            background: 'var(--primary, #7c3aed)',
                            color: '#fff',
                          }}>{qr.source_kb.category}</span>
                        )}
                        {qr.confidence_score != null && (
                          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                            similarity {Math.round(qr.confidence_score * 100)}%
                          </span>
                        )}
                      </div>
                      <div style={{ marginBottom: '0.35rem' }}>
                        <span style={{ color: 'var(--text-muted)' }}>Q:</span> {qr.source_kb.question}
                      </div>
                      <div>
                        <span style={{ color: 'var(--text-muted)' }}>A:</span> {qr.source_kb.answer}
                      </div>
                    </td>
                  </tr>
                )}
                {expandedReasoning.has(qr.id) && (qr.agent_reason || (qr.agent_issues && qr.agent_issues.length > 0)) && (
                  <tr>
                    <td colSpan={6} style={{
                      background: 'var(--surface-alt, #f8f9fa)',
                      padding: '0.6rem 1rem',
                      fontSize: '0.82rem',
                      borderTop: 'none',
                    }}>
                      {qr.agent_reason && (
                        <div style={{ marginBottom: qr.agent_issues?.length ? '0.4rem' : 0 }}>
                          <strong>Reasoning:</strong> {qr.agent_reason}
                        </div>
                      )}
                      {qr.agent_issues && qr.agent_issues.length > 0 && (
                        <div>
                          <strong>Issues:</strong>
                          <ul style={{ margin: '0.2rem 0 0 1.2rem', padding: 0 }}>
                            {qr.agent_issues.map((issue, i) => (
                              <li key={i} style={{ color: 'var(--warning, #e67e22)' }}>{issue}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
            {filteredQuestionResults.length === 0 && (
              <tr>
                <td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem' }}>
                  {reviewFilter === 'unreviewed' ? 'All questions have been reviewed!' : 'No questions match this filter.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div style={{ textAlign: 'center', marginTop: '1.5rem' }}>
        <button className="btn btn-success btn-lg" onClick={handleFinalize} disabled={finalizing}>
          {finalizing ? 'Generating...' : 'Finalize & Download'}
        </button>
        {questionResults.unreviewed_count > 0 && (
          <div style={{ color: 'var(--warning)', fontSize: '0.85rem', marginTop: '0.5rem' }}>
            {questionResults.unreviewed_count} question(s) not yet reviewed
          </div>
        )}
      </div>
      <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.5rem', justifyContent: 'center', flexWrap: 'wrap' }}>
        <button
          className="btn btn-sm btn-secondary"
          onClick={handleSaveTemplate}
          disabled={savingTemplate}
          style={{ fontSize: '0.82rem' }}
        >
          {savingTemplate ? 'Saving...' : 'Save as Template'}
        </button>
        <button
          className="btn btn-sm btn-secondary"
          onClick={() => downloadJobResult(currentJob.id)}
          style={{ fontSize: '0.82rem' }}
        >
          Download without review
        </button>
      </div>
    </div>
  );
}
