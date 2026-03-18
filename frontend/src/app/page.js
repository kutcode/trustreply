'use client';

import Link from 'next/link';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  uploadDocument,
  uploadDocuments,
  getJob,
  getBatchJobs,
  listJobs,
  getDownloadUrl,
  getBatchDownloadUrl,
  getSettings,
} from '@/lib/api';

const SUPPORTED_EXTENSIONS = new Set(['docx', 'pdf', 'csv']);
const FALLBACK_MAX_BULK_FILES = 50;

const AGENT_MODES = [
  {
    name: 'off',
    label: 'Semantic Only',
    description: 'Use only knowledge-base semantic matching.',
  },
  {
    name: 'agent',
    label: 'Agent',
    description: 'AI-first mode: agent handles all answers using document context + KB and flags uncertain fields (no semantic auto-match fallback).',
  },
];

const BUILT_IN_PRESETS = [
  { name: 'Concise Answers', instructions: 'Provide brief, factual answers. Keep responses under 2 sentences.' },
  { name: 'Detailed Explanations', instructions: 'Provide thorough, detailed answers with context and reasoning.' },
  { name: 'Policy-Focused', instructions: 'Answer from a compliance and policy perspective. Reference industry standards where applicable.' },
  { name: 'Technical', instructions: 'Provide technical answers with specific details. Include version numbers and specifications where relevant.' },
];

const PRESETS_STORAGE_KEY = 'trustreply_agent_presets';

function loadCustomPresets() {
  try {
    const raw = typeof window !== 'undefined' ? localStorage.getItem(PRESETS_STORAGE_KEY) : null;
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveCustomPresets(presets) {
  localStorage.setItem(PRESETS_STORAGE_KEY, JSON.stringify(presets));
}

function isFinishedStatus(status) {
  return status === 'done' || status === 'error';
}

function shortBatchId(batchId) {
  return batchId ? batchId.slice(0, 8) : '';
}

function jobNeedsReview(job) {
  return (
    job.status === 'done'
    && (
      (job.flagged_questions_count || 0) > 0
      || job.fallback_recommended
      || job.total_questions === 0
    )
  );
}

function getJobStatusMeta(job) {
  if (job.status === 'error') {
    return { className: 'error', label: 'error' };
  }
  if (job.status === 'processing') {
    return { className: 'processing', label: 'processing' };
  }
  if (job.status === 'pending') {
    return { className: 'pending', label: 'pending' };
  }
  if (jobNeedsReview(job)) {
    return { className: 'processing', label: 'needs review' };
  }
  return { className: 'done', label: 'done' };
}

function formatThinkingLine(event, prefix = '') {
  const timestamp = event?.timestamp || '--';
  const step = event?.step || 'agent';
  const status = event?.status || 'info';
  const message = event?.message || '';
  return `[${timestamp}] ${prefix}${step}:${status} ${message}`.trim();
}

export default function UploadPage() {
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [dragover, setDragover] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [currentJob, setCurrentJob] = useState(null);
  const [currentBatch, setCurrentBatch] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [selectedParserProfile, setSelectedParserProfile] = useState('default');
  const [selectedAgentMode, setSelectedAgentMode] = useState('agent');
  const [agentInstructions, setAgentInstructions] = useState('');
  const [agentAvailable, setAgentAvailable] = useState(false);
  const [maxBulkFiles, setMaxBulkFiles] = useState(FALLBACK_MAX_BULK_FILES);
  const [toast, setToast] = useState(null);
  const [showPresetMenu, setShowPresetMenu] = useState(false);
  const [customPresets, setCustomPresets] = useState([]);
  const pollRef = useRef(null);
  const thinkingRef = useRef(null);
  const presetMenuRef = useRef(null);

  const showToast = useCallback((message, type = 'info') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  }, []);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const refreshJobs = useCallback(() => {
    listJobs()
      .then((data) => setJobs(data.items || []))
      .catch(() => { });
  }, []);

  useEffect(() => {
    refreshJobs();
  }, [refreshJobs]);

  useEffect(() => {
    getSettings()
      .then((data) => {
        setSelectedParserProfile(data.default_parser_profile || 'default');
        setSelectedAgentMode(data.agent_default_mode || 'agent');
        setAgentAvailable(Boolean(data.agent_available));
        setMaxBulkFiles(data.max_bulk_files || FALLBACK_MAX_BULK_FILES);
      })
      .catch(() => { });
  }, []);

  useEffect(() => {
    setCustomPresets(loadCustomPresets());
  }, []);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (presetMenuRef.current && !presetMenuRef.current.contains(e.target)) {
        setShowPresetMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelectPreset = (instructions) => {
    setAgentInstructions(instructions);
    setShowPresetMenu(false);
  };

  const handleSavePreset = () => {
    const trimmed = agentInstructions.trim();
    if (!trimmed) {
      showToast('Enter instructions first', 'error');
      return;
    }
    const name = prompt('Preset name:');
    if (!name || !name.trim()) return;
    const updated = [...customPresets, { name: name.trim(), instructions: trimmed }];
    setCustomPresets(updated);
    saveCustomPresets(updated);
    showToast('✅ Preset saved', 'success');
    setShowPresetMenu(false);
  };

  const handleDeletePreset = (index) => {
    const updated = customPresets.filter((_, i) => i !== index);
    setCustomPresets(updated);
    saveCustomPresets(updated);
  };

  const pollJob = useCallback(async (jobId) => {
    try {
      const job = await getJob(jobId);
      setCurrentJob(job);

      if (job.status === 'done') {
        stopPolling();
        if (jobNeedsReview(job)) {
          showToast(
            `Warning: Document processed with ${job.flagged_questions_count || 0} question(s) needing review.`,
            'info',
          );
        } else {
          showToast('Document processed successfully!', 'success');
        }
        refreshJobs();
      } else if (job.status === 'error') {
        stopPolling();
        showToast(`Error: ${job.error_message || 'Unknown error'}`, 'error');
        refreshJobs();
      }
    } catch (err) {
      stopPolling();
    }
  }, [refreshJobs, showToast, stopPolling]);

  const pollBatch = useCallback(async (batchId) => {
    try {
      const batch = await getBatchJobs(batchId);
      setCurrentBatch(batch);

      if (batch.items.every((job) => isFinishedStatus(job.status))) {
        stopPolling();
        const doneCount = batch.items.filter((job) => job.status === 'done').length;
        const errorCount = batch.items.filter((job) => job.status === 'error').length;
        const reviewCount = batch.items.filter((job) => jobNeedsReview(job)).length;
        showToast(
          errorCount > 0
            ? `Batch complete: ${doneCount} done, ${errorCount} errors`
            : reviewCount > 0
              ? `Warning: Batch complete: ${reviewCount} file(s) need review before use`
              : `Batch complete: ${doneCount} documents processed`,
          errorCount > 0 || reviewCount > 0 ? 'info' : 'success',
        );
        refreshJobs();
      }
    } catch (err) {
      stopPolling();
    }
  }, [refreshJobs, showToast, stopPolling]);

  const clearCurrentResults = useCallback(() => {
    stopPolling();
    setCurrentJob(null);
    setCurrentBatch(null);
  }, [stopPolling]);

  const handleSelectedFiles = useCallback((incomingFiles) => {
    const candidates = Array.from(incomingFiles || []);
    if (candidates.length === 0) return;

    const validFiles = [];
    const invalidFiles = [];

    for (const candidate of candidates) {
      const ext = candidate.name.split('.').pop().toLowerCase();
      if (SUPPORTED_EXTENSIONS.has(ext)) {
        validFiles.push(candidate);
      } else {
        invalidFiles.push(candidate.name);
      }
    }

    if (invalidFiles.length > 0) {
      showToast(
        `Skipped unsupported files: ${invalidFiles.slice(0, 3).join(', ')}${invalidFiles.length > 3 ? '...' : ''}`,
        'error',
      );
    }

    if (validFiles.length === 0) return;

    let nextFiles = validFiles;
    if (validFiles.length > maxBulkFiles) {
      nextFiles = validFiles.slice(0, maxBulkFiles);
      showToast(
        `Batch upload is limited to ${maxBulkFiles} files. Kept the first ${maxBulkFiles} files.`,
        'info',
      );
    }

    clearCurrentResults();
    setSelectedFiles(nextFiles);
  }, [clearCurrentResults, maxBulkFiles, showToast]);

  const handleUpload = async () => {
    if (selectedFiles.length === 0) return;

    setUploading(true);
    stopPolling();

    try {
      if (selectedFiles.length === 1) {
        const job = await uploadDocument(
          selectedFiles[0],
          selectedParserProfile,
          {
            agentMode: selectedAgentMode,
            agentInstructions,
          },
        );
        setCurrentBatch(null);
        setCurrentJob(job);
        setSelectedFiles([]);
        showToast('Document uploaded. Processing...', 'info');
        pollRef.current = setInterval(() => pollJob(job.id), 1500);
      } else {
        const batch = await uploadDocuments(
          selectedFiles,
          selectedParserProfile,
          {
            agentMode: selectedAgentMode,
            agentInstructions,
          },
        );
        setCurrentJob(null);
        setCurrentBatch(batch);
        setSelectedFiles([]);
        showToast(`${batch.total} documents uploaded. Processing batch...`, 'info');
        pollRef.current = setInterval(() => pollBatch(batch.batch_id), 1500);
      }
    } catch (err) {
      showToast(`${err.message}`, 'error');
    } finally {
      setUploading(false);
    }
  };

  const handleFileChange = (e) => {
    handleSelectedFiles(e.target.files);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setDragover(true);
  };

  const handleDragLeave = () => setDragover(false);

  const handleDrop = (e) => {
    e.preventDefault();
    setDragover(false);
    handleSelectedFiles(e.dataTransfer.files);
  };

  useEffect(() => {
    return () => stopPolling();
  }, [stopPolling]);

  const singleJobProgress = useMemo(() => {
    if (!currentJob) return 0;
    switch (currentJob.status) {
      case 'pending': return 15;
      case 'processing': return 60;
      case 'done': return 100;
      case 'error': return 100;
      default: return 0;
    }
  }, [currentJob]);

  const batchSummary = useMemo(() => {
    if (!currentBatch) return null;

    const items = currentBatch.items || [];
    const total = currentBatch.total || items.length;
    const doneCount = items.filter((job) => job.status === 'done').length;
    const errorCount = items.filter((job) => job.status === 'error').length;
    const processingCount = items.filter((job) => job.status === 'processing').length;
    const pendingCount = items.filter((job) => job.status === 'pending').length;
    const matchedTotal = items.reduce((sum, job) => sum + (job.matched_questions || 0), 0);
    const flaggedTotal = items.reduce((sum, job) => sum + (job.flagged_questions_count || 0), 0);
    const foundTotal = items.reduce((sum, job) => sum + (job.total_questions || 0), 0);
    const completedCount = doneCount + errorCount;
    const needsAttention = items.some(
      (job) => job.status === 'error' || jobNeedsReview(job),
    );

    return {
      items,
      total,
      doneCount,
      errorCount,
      processingCount,
      pendingCount,
      matchedTotal,
      flaggedTotal,
      foundTotal,
      completedCount,
      progressPercent: total > 0 ? Math.round((completedCount / total) * 100) : 0,
      needsAttention,
    };
  }, [currentBatch]);

  const agentModeBlocked = selectedAgentMode !== 'off' && !agentAvailable;

  const thinkingLogText = useMemo(() => {
    if (currentJob) {
      const lines = [];
      if (currentJob.agent_mode && currentJob.agent_mode !== 'off') {
        lines.push(`Mode: ${currentJob.agent_mode}`);
      }
      if (currentJob.agent_model) {
        lines.push(`Model: ${currentJob.agent_model}`);
      }
      if (currentJob.agent_status) {
        lines.push(`Status: ${currentJob.agent_status}`);
      }
      lines.push('');

      const trace = Array.isArray(currentJob.agent_trace) ? currentJob.agent_trace : [];
      if (trace.length > 0) {
        for (const event of trace.slice(-120)) {
          lines.push(formatThinkingLine(event));
        }
      } else {
        lines.push('Waiting for AI activity...');
      }
      return lines.join('\n');
    }

    if (batchSummary && Array.isArray(batchSummary.items)) {
      const batchLines = [];
      const flattened = [];
      for (const job of batchSummary.items) {
        const trace = Array.isArray(job.agent_trace) ? job.agent_trace : [];
        for (const event of trace) {
          flattened.push({
            timestamp: event?.timestamp || '',
            line: formatThinkingLine(event, `${job.original_filename} · `),
          });
        }
      }

      if (flattened.length === 0) {
        return 'Waiting for AI activity across the current batch...';
      }

      flattened
        .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
        .slice(-160)
        .forEach((entry) => batchLines.push(entry.line));
      return batchLines.join('\n');
    }

    return 'No AI thinking logs yet. Upload a file and pick an AI answering mode.';
  }, [currentJob, batchSummary]);

  useEffect(() => {
    if (thinkingRef.current) {
      thinkingRef.current.scrollTop = thinkingRef.current.scrollHeight;
    }
  }, [thinkingLogText]);

  return (
    <div className="page-container">
      {toast && (
        <div className="toast-container">
          <div className={`toast toast-${toast.type}`}>{toast.message}</div>
        </div>
      )}

      <div className="page-header" style={{ textAlign: 'center', marginBottom: '2.5rem' }}>
        <h1 style={{ fontSize: '2.5rem', marginBottom: '0.65rem' }}>TrustReply</h1>
        <p style={{ maxWidth: '600px', margin: '0 auto' }}>
          Upload one or many .docx, .pdf, or .csv questionnaires and TrustReply will auto-fill answers from your knowledge base.
        </p>
      </div>

      <div className="card" style={{ marginBottom: '1.25rem', padding: '1rem 1.25rem' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'end' }}>
          <div style={{ flex: '1 1 260px' }}>
            <label className="form-label">Answering Mode</label>
            <select
              className="form-select"
              value={selectedAgentMode}
              onChange={(e) => setSelectedAgentMode(e.target.value)}
            >
              {AGENT_MODES.map((mode) => (
                <option key={mode.name} value={mode.name}>
                  {mode.label}
                </option>
              ))}
            </select>
          </div>
          <div style={{ flex: '2 1 360px', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
            <div>
              {AGENT_MODES.find((mode) => mode.name === selectedAgentMode)?.description}
            </div>
            {selectedAgentMode !== 'off' && (
              <div style={{ marginTop: '0.35rem' }}>
                TrustReply still uses the default parser internally to anchor exact question/answer placement.
              </div>
            )}
          </div>
        </div>

        {selectedAgentMode !== 'off' && (
          <>
            {agentModeBlocked && (
              <div
                style={{
                  marginTop: '0.8rem',
                  padding: '0.7rem 0.9rem',
                  borderRadius: 'var(--radius-md)',
                  background: 'var(--warning-bg)',
                  color: 'var(--warning)',
                  fontSize: '0.88rem',
                }}
              >
                Agent is not configured. Go to{' '}
                <Link
                  href="/settings"
                  style={{
                    color: 'var(--warning)',
                    textDecoration: 'underline',
                    textUnderlineOffset: '0.15rem',
                  }}
                >
                  Settings
                </Link>{' '}
                to set up your AI provider credentials.
              </div>
            )}

            <div style={{ marginTop: '0.9rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.35rem' }}>
                <label className="form-label" style={{ margin: 0 }}>Agent Instructions (Optional)</label>
                <div style={{ position: 'relative' }} ref={presetMenuRef}>
                  <button
                    type="button"
                    className="btn btn-sm btn-secondary"
                    onClick={() => setShowPresetMenu(!showPresetMenu)}
                  >
                    Presets ▾
                  </button>
                  {showPresetMenu && (
                    <div className="preset-dropdown">
                      {BUILT_IN_PRESETS.map((preset) => (
                        <button key={preset.name} className="preset-dropdown-item" onClick={() => handleSelectPreset(preset.instructions)}>
                          {preset.name}
                        </button>
                      ))}
                      {customPresets.length > 0 && <div className="preset-dropdown-divider" />}
                      {customPresets.map((preset, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'center' }}>
                          <button className="preset-dropdown-item" style={{ flex: 1 }} onClick={() => handleSelectPreset(preset.instructions)}>
                            {preset.name}
                          </button>
                          <button className="preset-dropdown-delete" onClick={() => handleDeletePreset(i)} title="Remove preset">
                            ×
                          </button>
                        </div>
                      ))}
                      <div className="preset-dropdown-divider" />
                      <button className="preset-dropdown-item preset-dropdown-save" onClick={handleSavePreset}>
                        + Save current as preset
                      </button>
                    </div>
                  )}
                </div>
              </div>
              <textarea
                className="form-textarea"
                rows={3}
                placeholder="Example: prioritize context from this document over generic answers, and flag unknown legal/entity-specific fields."
                value={agentInstructions}
                onChange={(e) => setAgentInstructions(e.target.value)}
              />
            </div>
          </>
        )}
      </div>

      <div
        className={`upload-zone ${dragover ? 'dragover' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <input
          type="file"
          accept=".docx,.pdf,.csv"
          multiple
          onChange={handleFileChange}
          id="file-upload"
        />
        <span className="upload-zone-icon">📁</span>
        <div className="upload-zone-title">
          {selectedFiles.length === 0
            ? 'Drop your questionnaire files here'
            : selectedFiles.length === 1
              ? selectedFiles[0].name
              : `${selectedFiles.length} files selected`}
        </div>
        <div className="upload-zone-subtitle">
          {selectedFiles.length === 0
            ? `Supports .docx, .pdf, and .csv files. You can drop multiple files at once, up to ${maxBulkFiles} per batch.`
            : `${(selectedFiles.reduce((total, file) => total + file.size, 0) / 1024).toFixed(1)} KB total`
          }
        </div>
      </div>

      {selectedFiles.length > 0 && (
        <div className="card" style={{ marginTop: '1rem' }}>
          <div style={{ fontWeight: 700, marginBottom: '0.75rem' }}>
            Ready to upload {selectedFiles.length} {selectedFiles.length === 1 ? 'document' : 'documents'}
          </div>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '0.75rem' }}>
            Site limit: up to {maxBulkFiles} files per batch.
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
            {selectedFiles.slice(0, 6).map((selectedFile) => (
              <div key={`${selectedFile.name}-${selectedFile.size}`}>{selectedFile.name}</div>
            ))}
            {selectedFiles.length > 6 && (
              <div style={{ color: 'var(--text-muted)' }}>
                And {selectedFiles.length - 6} more files...
              </div>
            )}
          </div>
        </div>
      )}

      {selectedFiles.length > 0 && !uploading && (
        <div style={{ textAlign: 'center', marginTop: '1.5rem' }}>
          <button className="btn btn-primary btn-lg" onClick={handleUpload} disabled={agentModeBlocked}>
            Process {selectedFiles.length === 1 ? 'Document' : `${selectedFiles.length} Documents`}
          </button>
          {agentModeBlocked && (
            <div style={{ marginTop: '0.55rem', color: 'var(--warning)', fontSize: '0.84rem' }}>
              Configure AI provider in <Link href="/settings" style={{ color: 'var(--warning)', textDecoration: 'underline' }}>Settings</Link> or switch back to Semantic Only.
            </div>
          )}
        </div>
      )}

      {currentJob && (
        <>
          {(() => {
            const statusMeta = getJobStatusMeta(currentJob);
            return (
          <div className="card" style={{ marginTop: '2rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
              <h3 style={{ fontSize: '1.05rem', fontWeight: 600 }}>
                {currentJob.original_filename}
              </h3>
              <span className={`status-badge status-${statusMeta.className}`}>
                {currentJob.status === 'processing' && '⏳ '}
                {statusMeta.label}
              </span>
            </div>

            <div className="progress-bar-wrapper" style={{ marginBottom: '1rem' }}>
              <div className="progress-bar-fill" style={{ width: `${singleJobProgress}%` }} />
            </div>

            {currentJob.agent_mode && currentJob.agent_mode !== 'off' && (
              <div style={{ marginBottom: '0.85rem', color: 'var(--text-secondary)', fontSize: '0.88rem' }}>
                Agent mode: <strong>{currentJob.agent_mode}</strong>
                {' · '}
                Status: <strong>{currentJob.agent_status || 'pending'}</strong>
                {currentJob.agent_model && (
                  <>
                    {' · '}
                    Model: <strong>{currentJob.agent_model}</strong>
                  </>
                )}
              </div>
            )}

            {currentJob.agent_summary && currentJob.agent_mode && currentJob.agent_mode !== 'off' && (
              <div
                style={{
                  marginBottom: '0.9rem',
                  padding: '0.75rem 0.9rem',
                  borderRadius: 'var(--radius-md)',
                  background: currentJob.agent_status === 'error' ? 'var(--error-bg)' : 'var(--bg-input)',
                  color: currentJob.agent_status === 'error' ? 'var(--error)' : 'var(--text-secondary)',
                  fontSize: '0.88rem',
                }}
              >
                {currentJob.agent_summary}
              </div>
            )}

            {currentJob.status === 'done' && (
              <>
                <div className="stats-grid">
                  <div className="stat-card">
                    <div className="stat-value">{currentJob.total_questions}</div>
                    <div className="stat-label">Questions Found</div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-value">{currentJob.matched_questions}</div>
                    <div className="stat-label">Matched</div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-value">{currentJob.flagged_questions_count}</div>
                    <div className="stat-label">Flagged</div>
                  </div>
                </div>
                <div style={{ marginBottom: '1rem', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                  Parser: <strong>{currentJob.parser_profile_name || 'default'}</strong>
                  {' · '}
                  Strategy: <strong>{currentJob.parser_strategy || 'heuristic'}</strong>
                  {typeof currentJob.parse_confidence === 'number' && (
                    <>
                      {' · '}
                      Confidence: <strong>{Math.round(currentJob.parse_confidence * 100)}%</strong>
                    </>
                  )}
                </div>
                {currentJob.fallback_recommended && (
                  <div
                    style={{
                      marginBottom: '1rem',
                      padding: '0.75rem 0.9rem',
                      borderRadius: 'var(--radius-md)',
                      background: 'var(--warning-bg)',
                      color: 'var(--warning)',
                      fontSize: '0.9rem',
                    }}
                  >
                    Parser fallback recommended: {currentJob.fallback_reason || 'heuristic parse looked weak'}
                  </div>
                )}
                {currentJob.flagged_questions_count > 0 && (
                  <div
                    style={{
                      marginBottom: '1rem',
                      padding: '0.75rem 0.9rem',
                      borderRadius: 'var(--radius-md)',
                      background: 'var(--warning-bg)',
                      color: 'var(--warning)',
                      fontSize: '0.9rem',
                    }}
                  >
                    {currentJob.flagged_questions_count} question(s) need review. The downloaded document now marks those answers with a review-required placeholder instead of leaving them blank.
                  </div>
                )}
                <div style={{ textAlign: 'center' }}>
                  <a
                    href={getDownloadUrl(currentJob.id)}
                    className="btn btn-success btn-lg"
                    download
                  >
                    Download Filled File
                  </a>
                </div>
              </>
            )}

            {currentJob.status === 'error' && (
              <div style={{ color: 'var(--error)', fontSize: '0.9rem' }}>
                {currentJob.error_message}
              </div>
            )}
          </div>
            );
          })()}

          {(currentJob.status === 'error' || currentJob.flagged_questions_count > 0 || currentJob.fallback_recommended || currentJob.total_questions === 0) && (
            <div
              style={{
                marginTop: '0.9rem',
                textAlign: 'center',
                color: 'var(--text-muted)',
                fontSize: '0.88rem',
              }}
            >
              {currentJob.flagged_questions_count > 0 ? (
                <>
                  This file was processed, but some questions still need answers. Review them in{' '}
                  <Link
                    href="/admin/flagged"
                    style={{
                      color: 'var(--text-secondary)',
                      textDecoration: 'underline',
                      textUnderlineOffset: '0.15rem',
                    }}
                  >
                    Flagged Questions
                  </Link>
                  . If the extraction itself looks wrong, compare parser profiles in{' '}
                  <Link
                    href="/troubleshoot"
                    style={{
                      color: 'var(--text-secondary)',
                      textDecoration: 'underline',
                      textUnderlineOffset: '0.15rem',
                    }}
                  >
                    Troubleshooting
                  </Link>
                  .
                </>
              ) : (
                <>
                  Valid document but the app says no questions were found?{' '}
                  <Link
                    href="/troubleshoot"
                    style={{
                      color: 'var(--text-secondary)',
                      textDecoration: 'underline',
                      textUnderlineOffset: '0.15rem',
                    }}
                  >
                    Open Troubleshooting
                  </Link>{' '}
                  to compare parser profiles, inspect extracted question previews, and see which parser is most likely to work before re-uploading.
                </>
              )}
            </div>
          )}
        </>
      )}

      {currentBatch && batchSummary && (
        <>
          <div className="card" style={{ marginTop: '2rem' }}>
            {(() => {
              const batchStatusClass =
                batchSummary.processingCount > 0 || batchSummary.pendingCount > 0
                  ? 'processing'
                  : batchSummary.errorCount > 0 && batchSummary.doneCount === 0
                    ? 'error'
                    : batchSummary.needsAttention
                      ? 'processing'
                      : 'done';
              const batchStatusLabel =
                batchSummary.processingCount > 0 || batchSummary.pendingCount > 0
                  ? 'processing'
                  : batchSummary.errorCount > 0 && batchSummary.doneCount === 0
                    ? 'error'
                    : batchSummary.needsAttention
                      ? 'needs review'
                      : 'done';

              return (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
              <div>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginBottom: '0.3rem' }}>
                  Batch #{shortBatchId(currentBatch.batch_id)}
                </div>
                <h3 style={{ fontSize: '1.1rem', fontWeight: 700 }}>
                  {batchSummary.total} documents in this batch
                </h3>
              </div>
              <span className={`status-badge status-${batchStatusClass}`}>
                {batchStatusLabel}
              </span>
            </div>
              );
            })()}

            <div className="progress-bar-wrapper" style={{ marginBottom: '1rem' }}>
              <div className="progress-bar-fill" style={{ width: `${batchSummary.progressPercent}%` }} />
            </div>

            <div className="stats-grid" style={{ marginBottom: '1rem' }}>
              <div className="stat-card">
                <div className="stat-value">{batchSummary.total}</div>
                <div className="stat-label">Files</div>
              </div>
              <div className="stat-card">
                <div className="stat-value">{batchSummary.doneCount}</div>
                <div className="stat-label">Completed</div>
              </div>
              <div className="stat-card">
                <div className="stat-value">{batchSummary.processingCount + batchSummary.pendingCount}</div>
                <div className="stat-label">In Progress</div>
              </div>
              <div className="stat-card">
                <div className="stat-value">{batchSummary.errorCount}</div>
                <div className="stat-label">Errors</div>
              </div>
              <div className="stat-card">
                <div className="stat-value">{batchSummary.matchedTotal}</div>
                <div className="stat-label">Matched</div>
              </div>
              <div className="stat-card">
                <div className="stat-value">{batchSummary.flaggedTotal}</div>
                <div className="stat-label">Flagged</div>
              </div>
            </div>

            <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
              Found {batchSummary.foundTotal} total questions across the batch.
              {batchSummary.flaggedTotal > 0 && ` ${batchSummary.flaggedTotal} question(s) were flagged and marked for review in the output files.`}
            </div>

            {batchSummary.doneCount > 0 && (
              <div style={{ marginTop: '1.25rem', textAlign: 'center' }}>
                <a
                  href={getBatchDownloadUrl(currentBatch.batch_id)}
                  className="btn btn-success btn-lg"
                  download
                >
                  Download All Results (.zip)
                </a>
              </div>
            )}
          </div>

          {batchSummary.needsAttention && (
            <div
              style={{
                marginTop: '0.9rem',
                textAlign: 'center',
                color: 'var(--text-muted)',
                fontSize: '0.88rem',
              }}
            >
              Some files in this batch may need review. Use{' '}
              <Link
                href="/admin/flagged"
                style={{
                  color: 'var(--text-secondary)',
                  textDecoration: 'underline',
                  textUnderlineOffset: '0.15rem',
                }}
              >
                Flagged Questions
              </Link>{' '}
              for missing answers. If a file looks wrong or reports no questions found,{' '}
              <Link
                href="/troubleshoot"
                style={{
                  color: 'var(--text-secondary)',
                  textDecoration: 'underline',
                  textUnderlineOffset: '0.15rem',
                }}
              >
                open Troubleshooting
              </Link>{' '}
              and retry that document with a better parser profile.
            </div>
          )}

          <div style={{ marginTop: '2rem' }}>
            <h2 style={{ fontSize: '1.3rem', fontWeight: 700, marginBottom: '1rem' }}>
              Batch Results
            </h2>
            <div className="job-list">
              {batchSummary.items.map((job) => (
                <div key={job.id} className="job-item" style={{ alignItems: 'flex-start' }}>
                  {(() => {
                    const statusMeta = getJobStatusMeta(job);
                    return (
                      <>
                  <div className="job-item-info" style={{ gap: '0.45rem', flex: 1 }}>
                    <div className="job-item-name">{job.original_filename}</div>
                    <div className="job-item-meta" style={{ flexWrap: 'wrap' }}>
                      <span>{job.matched_questions}/{job.total_questions} matched</span>
                      <span>{job.flagged_questions_count} flagged</span>
                      {job.parser_profile_name && (
                        <span>
                          {job.parser_profile_name}
                          {typeof job.parse_confidence === 'number' && ` (${Math.round(job.parse_confidence * 100)}%)`}
                        </span>
                      )}
                      {job.agent_mode && job.agent_mode !== 'off' && (
                        <span>
                          Agent {job.agent_mode}
                          {job.agent_status ? ` (${job.agent_status})` : ''}
                        </span>
                      )}
                      {job.total_questions === 0 && (
                        <span style={{ color: 'var(--warning)' }}>No questions found</span>
                      )}
                      {job.fallback_recommended && (
                        <span style={{ color: 'var(--warning)' }}>Review parser</span>
                      )}
                      {job.flagged_questions_count > 0 && (
                        <span style={{ color: 'var(--warning)' }}>Review-required placeholders inserted</span>
                      )}
                      {job.status === 'error' && (
                        <span style={{ color: 'var(--error)' }}>Processing error</span>
                      )}
                    </div>
                    {(job.status === 'error' || job.flagged_questions_count > 0 || job.fallback_recommended || job.total_questions === 0) && (
                      <div style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>
                        If this file parsed unexpectedly, re-run it in <Link href="/troubleshoot">Troubleshooting</Link>.
                      </div>
                    )}
                  </div>
                  <div className="job-item-actions">
                    <span className={`status-badge status-${statusMeta.className}`}>
                      {statusMeta.label}
                    </span>
                    {job.status === 'done' && (
                      <a
                        href={getDownloadUrl(job.id)}
                        className="btn btn-sm btn-secondary"
                        download
                      >
                        Download
                      </a>
                    )}
                  </div>
                      </>
                    );
                  })()}
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {jobs.length > 0 && (
        <div style={{ marginTop: '3rem' }}>
          <h2 style={{ fontSize: '1.3rem', fontWeight: 700, marginBottom: '1rem' }}>
            Recent Uploads
          </h2>
          <div className="job-list">
            {jobs.slice(0, 10).map((job) => (
              <div key={job.id} className="job-item">
                {(() => {
                  const statusMeta = getJobStatusMeta(job);
                  return (
                    <>
                <div className="job-item-info">
                  <div className="job-item-name">{job.original_filename}</div>
                  <div className="job-item-meta">
                    <span>
                      {new Date(job.uploaded_at).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                    <span>
                      {job.matched_questions}/{job.total_questions} matched
                    </span>
                    {job.batch_id && (
                      <span>Batch #{shortBatchId(job.batch_id)}</span>
                    )}
                    {job.parser_profile_name && (
                      <span>
                        {job.parser_profile_name}
                        {typeof job.parse_confidence === 'number' && ` (${Math.round(job.parse_confidence * 100)}%)`}
                      </span>
                    )}
                    {job.agent_mode && job.agent_mode !== 'off' && (
                      <span>
                        Agent {job.agent_mode}
                        {job.agent_status ? ` (${job.agent_status})` : ''}
                      </span>
                    )}
                    {job.flagged_questions_count > 0 && (
                      <span style={{ color: 'var(--warning)' }}>
                        {job.flagged_questions_count} flagged
                      </span>
                    )}
                    {job.fallback_recommended && (
                      <span style={{ color: 'var(--warning)' }}>
                        Parser review suggested
                      </span>
                    )}
                  </div>
                </div>
                <div className="job-item-actions">
                  <span className={`status-badge status-${statusMeta.className}`}>
                    {statusMeta.label}
                  </span>
                  {job.status === 'done' && (
                    <a
                      href={getDownloadUrl(job.id)}
                      className="btn btn-sm btn-secondary"
                      download
                    >
                      Download
                    </a>
                  )}
                  {job.batch_id && (
                    <a
                      href={getBatchDownloadUrl(job.batch_id)}
                      className="btn btn-sm btn-secondary"
                      download
                    >
                      Batch ZIP
                    </a>
                  )}
                </div>
                    </>
                  );
                })()}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card card-accent-left" style={{ marginTop: '2rem' }}>
        <div className="section-header" style={{ marginBottom: '0.75rem', paddingBottom: '0.6rem' }}>
          <div className="section-header-icon">💭</div>
          <h2>AI Model Thinking</h2>
        </div>
        <div style={{ color: 'var(--text-muted)', fontSize: '0.84rem', marginBottom: '0.6rem' }}>
          Live trace while uploads are processing.
        </div>
        <textarea
          ref={thinkingRef}
          className="form-textarea"
          readOnly
          value={thinkingLogText}
          rows={12}
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '0.78rem',
            lineHeight: 1.45,
            whiteSpace: 'pre',
          }}
        />
      </div>
    </div>
  );
}
