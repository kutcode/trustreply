'use client';

import React from 'react';
import Link from 'next/link';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import useToast from '@/hooks/useToast';
import {
  uploadDocument,
  uploadDocuments,
  getJob,
  getBatchJobs,
  listJobs,
  downloadJobResult,
  downloadBatchResult,
  getSettings,
  listQuestionResults,
  listAuditLogs,
  listTemplates,
} from '@/lib/api';

import Toast from '@/components/Toast';
import UploadZone from '@/components/UploadZone';
import ConfigPanel from '@/components/ConfigPanel';
import ReviewQueue from '@/components/ReviewQueue';

const SUPPORTED_EXTENSIONS = new Set(['docx', 'pdf', 'xlsx', 'xls', 'csv']);
const FALLBACK_MAX_BULK_FILES = 50;

const SESSION_JOB_KEY = 'trustreply_current_job_id';
const SESSION_BATCH_KEY = 'trustreply_current_batch_id';

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
  const [uploading, setUploading] = useState(false);
  const [currentJob, setCurrentJob] = useState(null);
  const [currentBatch, setCurrentBatch] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [selectedParserProfile, setSelectedParserProfile] = useState('default');
  const [selectedAgentMode, setSelectedAgentMode] = useState('agent');
  const [agentInstructions, setAgentInstructions] = useState('');
  const [agentAvailable, setAgentAvailable] = useState(false);
  const [maxBulkFiles, setMaxBulkFiles] = useState(FALLBACK_MAX_BULK_FILES);
  const { toast, showToast } = useToast();
  const [questionResults, setQuestionResults] = useState(null);
  const [auditLogs, setAuditLogs] = useState(null);
  const [showAuditTrail, setShowAuditTrail] = useState(false);
  const [templatesList, setTemplatesList] = useState([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [openaiHasKey, setOpenaiHasKey] = useState(false);
  const [anthropicHasKey, setAnthropicHasKey] = useState(false);
  const [openaiModel, setOpenaiModel] = useState('');
  const [anthropicModel, setAnthropicModel] = useState('');
  const [selectedProvider, setSelectedProvider] = useState(null);
  const pollRef = useRef(null);
  const thinkingRef = useRef(null);
  const pollingInFlight = useRef(false);

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
        setOpenaiHasKey(Boolean(data.agent_openai_has_key));
        setAnthropicHasKey(Boolean(data.agent_anthropic_has_key));
        setOpenaiModel(data.agent_openai_model || '');
        setAnthropicModel(data.agent_anthropic_model || '');
        // Default selected provider based on what's configured
        const defaultProvider = data.agent_provider || 'openai';
        setSelectedProvider(defaultProvider === 'anthropic' ? 'anthropic' : 'openai');
      })
      .catch(() => { });
    listTemplates().then((data) => setTemplatesList(data.items || [])).catch(() => { });
  }, []);

  // Restore current job/batch from sessionStorage on mount (tab switch persistence)
  useEffect(() => {
    const savedJobId = sessionStorage.getItem(SESSION_JOB_KEY);
    const savedBatchId = sessionStorage.getItem(SESSION_BATCH_KEY);

    if (savedBatchId) {
      getBatchJobs(savedBatchId)
        .then((batch) => {
          setCurrentBatch(batch);
          const allDone = batch.items.every((j) => isFinishedStatus(j.status));
          if (!allDone) {
            pollRef.current = setInterval(() => pollBatch(savedBatchId), 1500);
          }
        })
        .catch(() => sessionStorage.removeItem(SESSION_BATCH_KEY));
    } else if (savedJobId) {
      getJob(Number(savedJobId))
        .then((job) => {
          setCurrentJob(job);
          if (!isFinishedStatus(job.status)) {
            pollRef.current = setInterval(() => pollJob(job.id), 1500);
          }
        })
        .catch(() => sessionStorage.removeItem(SESSION_JOB_KEY));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Audit Trail ─────────────────────────────────────────────

  const loadAuditLogs = useCallback(async (jobId) => {
    try {
      const data = await listAuditLogs({ jobId, pageSize: 100 });
      setAuditLogs(data);
    } catch {
      setAuditLogs(null);
    }
  }, []);

  // ── Review Queue ─────────────────────────────────────────────

  const loadQuestionResults = useCallback(async (jobId) => {
    try {
      const data = await listQuestionResults(jobId);
      setQuestionResults(data.total > 0 ? data : null);
    } catch {
      setQuestionResults(null);
    }
  }, []);

  const handleResultsChange = useCallback(() => {
    if (currentJob) {
      loadQuestionResults(currentJob.id);
      if (showAuditTrail) loadAuditLogs(currentJob.id);
    }
  }, [currentJob, showAuditTrail, loadQuestionResults, loadAuditLogs]);

  const handleAuditRefresh = useCallback(() => {
    if (currentJob && showAuditTrail) {
      loadAuditLogs(currentJob.id);
    }
  }, [currentJob, showAuditTrail, loadAuditLogs]);

  const handleTemplatesRefresh = useCallback(() => {
    listTemplates().then((data) => setTemplatesList(data.items || [])).catch(() => { });
  }, []);

  const pollJob = useCallback(async (jobId) => {
    if (pollingInFlight.current) return;
    pollingInFlight.current = true;
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
    } finally {
      pollingInFlight.current = false;
    }
  }, [refreshJobs, showToast, stopPolling]);

  const pollBatch = useCallback(async (batchId) => {
    if (pollingInFlight.current) return;
    pollingInFlight.current = true;
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
    } finally {
      pollingInFlight.current = false;
    }
  }, [refreshJobs, showToast, stopPolling]);

  const clearCurrentResults = useCallback(() => {
    stopPolling();
    setCurrentJob(null);
    setCurrentBatch(null);
    setQuestionResults(null);
    sessionStorage.removeItem(SESSION_JOB_KEY);
    sessionStorage.removeItem(SESSION_BATCH_KEY);
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

    // Build per-upload agent config when both providers are available or a specific one is selected
    const agentConfig = (() => {
      if (selectedProvider === 'anthropic' && anthropicHasKey) {
        return { provider: 'anthropic', apiBase: 'https://api.anthropic.com/v1', model: anthropicModel || undefined };
      }
      if (selectedProvider === 'openai' && openaiHasKey) {
        return { provider: 'openai', apiBase: 'https://api.openai.com/v1', model: openaiModel || undefined };
      }
      return null;
    })();

    try {
      if (selectedFiles.length === 1) {
        const job = await uploadDocument(
          selectedFiles[0],
          selectedParserProfile,
          {
            agentMode: selectedAgentMode,
            agentInstructions,
            agentConfig,
            templateId: selectedTemplateId || undefined,
          },
        );
        setCurrentBatch(null);
        setCurrentJob(job);
        setSelectedFiles([]);
        sessionStorage.setItem(SESSION_JOB_KEY, String(job.id));
        sessionStorage.removeItem(SESSION_BATCH_KEY);
        showToast('Document uploaded. Processing...', 'info');
        pollRef.current = setInterval(() => pollJob(job.id), 1500);
      } else {
        const batch = await uploadDocuments(
          selectedFiles,
          selectedParserProfile,
          {
            agentMode: selectedAgentMode,
            agentInstructions,
            agentConfig,
          },
        );
        setCurrentJob(null);
        setCurrentBatch(batch);
        setSelectedFiles([]);
        sessionStorage.setItem(SESSION_BATCH_KEY, batch.batch_id);
        sessionStorage.removeItem(SESSION_JOB_KEY);
        showToast(`${batch.total} documents uploaded. Processing batch...`, 'info');
        pollRef.current = setInterval(() => pollBatch(batch.batch_id), 1500);
      }
    } catch (err) {
      showToast(`${err.message}`, 'error');
    } finally {
      setUploading(false);
    }
  };

  useEffect(() => {
    if (currentJob?.status === 'done') {
      loadQuestionResults(currentJob.id);
      loadAuditLogs(currentJob.id);
    } else {
      setQuestionResults(null);
      setAuditLogs(null);
    }
  }, [currentJob?.status, currentJob?.id, loadQuestionResults, loadAuditLogs]);

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
        lines.push('Waiting for activity...');
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
        return 'Waiting for activity across the current batch...';
      }

      flattened
        .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
        .slice(-160)
        .forEach((entry) => batchLines.push(entry.line));
      return batchLines.join('\n');
    }

    return 'No activity logs yet. Upload a file and pick an answering mode.';
  }, [currentJob, batchSummary]);

  useEffect(() => {
    if (thinkingRef.current) {
      thinkingRef.current.scrollTop = thinkingRef.current.scrollHeight;
    }
  }, [thinkingLogText]);

  return (
    <div className="page-container">
      <Toast toast={toast} />

      <div className="page-header" style={{ textAlign: 'center', marginBottom: '2.5rem' }}>
        <h1 style={{ fontSize: '2.5rem', marginBottom: '0.65rem' }}>TrustReply</h1>
        <p style={{ maxWidth: '600px', margin: '0 auto' }}>
          Upload one or many .docx, .pdf, .xlsx, or .csv questionnaires and TrustReply will auto-fill answers from your knowledge base.
        </p>
      </div>

      <ConfigPanel
        selectedAgentMode={selectedAgentMode}
        onAgentModeChange={setSelectedAgentMode}
        agentInstructions={agentInstructions}
        onInstructionsChange={setAgentInstructions}
        agentAvailable={agentAvailable}
        templatesList={templatesList}
        selectedTemplateId={selectedTemplateId}
        onTemplateChange={setSelectedTemplateId}
        showToast={showToast}
        openaiHasKey={openaiHasKey}
        anthropicHasKey={anthropicHasKey}
        openaiModel={openaiModel}
        anthropicModel={anthropicModel}
        selectedProvider={selectedProvider}
        onProviderChange={setSelectedProvider}
      />

      <UploadZone
        selectedFiles={selectedFiles}
        maxBulkFiles={maxBulkFiles}
        onFilesSelected={handleSelectedFiles}
      />

      {selectedFiles.length > 0 && !uploading && (
        <div style={{ textAlign: 'center', marginTop: '1.5rem' }}>
          <button className="btn btn-primary btn-lg" onClick={handleUpload} disabled={agentModeBlocked}>
            Process {selectedFiles.length === 1 ? 'Document' : `${selectedFiles.length} Documents`}
          </button>
          {agentModeBlocked && (
            <div style={{ marginTop: '0.55rem', color: 'var(--warning)', fontSize: '0.84rem' }}>
              Configure provider in <Link href="/settings" style={{ color: 'var(--warning)', textDecoration: 'underline' }}>Settings</Link> or switch back to Semantic Only.
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

            {currentJob.agent_mode && currentJob.agent_mode !== 'off' && !isFinishedStatus(currentJob.status) && (
              <div style={{ marginBottom: '1rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.4rem' }}>
                  <span style={{ fontSize: '0.9rem' }}>💭</span>
                  <span style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Processing Log</span>
                </div>
                <textarea
                  ref={thinkingRef}
                  className="form-textarea"
                  readOnly
                  value={thinkingLogText}
                  rows={8}
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '0.78rem',
                    lineHeight: 1.45,
                    whiteSpace: 'pre',
                  }}
                />
              </div>
            )}

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
                    <div className="stat-label">Questions</div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-value">{currentJob.matched_questions}</div>
                    <div className="stat-label">Matched</div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-value">{currentJob.flagged_questions_count}</div>
                    <div className="stat-label">Flagged</div>
                  </div>
                  {currentJob.agent_llm_calls > 0 && (
                    <div className="stat-card">
                      <div className="stat-value">{currentJob.agent_llm_calls}</div>
                      <div className="stat-label">Engine Calls</div>
                    </div>
                  )}
                  {(currentJob.agent_input_tokens > 0 || currentJob.agent_output_tokens > 0) && (
                    <div className="stat-card">
                      <div className="stat-value">
                        {((currentJob.agent_input_tokens || 0) + (currentJob.agent_output_tokens || 0)).toLocaleString()}
                      </div>
                      <div className="stat-label">Tokens Used</div>
                    </div>
                  )}
                  {currentJob.agent_kb_routed > 0 && (
                    <div className="stat-card">
                      <div className="stat-value">{currentJob.agent_kb_routed}</div>
                      <div className="stat-label">KB Direct</div>
                    </div>
                  )}
                </div>
                <div className="job-detail-meta">
                  <span>Parser: <strong>{currentJob.parser_profile_name || 'default'}</strong></span>
                  <span>Strategy: <strong>{currentJob.parser_strategy || 'heuristic'}</strong></span>
                  {typeof currentJob.parse_confidence === 'number' && (
                    <span>Confidence: <strong>{Math.round(currentJob.parse_confidence * 100)}%</strong></span>
                  )}
                  {currentJob.agent_model && currentJob.agent_mode !== 'off' && (
                    <span>Model: <strong>{currentJob.agent_model}</strong></span>
                  )}
                  {currentJob.agent_input_tokens > 0 && currentJob.agent_output_tokens > 0 && (
                    <span>In/Out: <strong>{(currentJob.agent_input_tokens || 0).toLocaleString()}</strong> / <strong>{(currentJob.agent_output_tokens || 0).toLocaleString()}</strong></span>
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
                    {currentJob.flagged_questions_count} question(s) need review. The downloaded document marks those answers with a review-required placeholder.
                  </div>
                )}

                {/* ── Review Queue ─────────────────────────── */}
                <ReviewQueue
                  currentJob={currentJob}
                  questionResults={questionResults}
                  onResultsChange={handleResultsChange}
                  onAuditRefresh={handleAuditRefresh}
                  onTemplatesRefresh={handleTemplatesRefresh}
                  showToast={showToast}
                />

                {/* ── Audit Trail ─────────────────────────── */}
                {questionResults && questionResults.total > 0 && (
                  <div style={{ marginTop: '2rem', borderTop: '1px solid var(--border-color, #e0e0e0)', paddingTop: '1rem' }}>
                    <button
                      className="btn btn-sm btn-secondary"
                      onClick={() => {
                        setShowAuditTrail((prev) => !prev);
                        if (!auditLogs && currentJob) loadAuditLogs(currentJob.id);
                      }}
                      style={{ marginBottom: '0.5rem' }}
                    >
                      {showAuditTrail ? '▾ Hide Audit Trail' : '▸ Show Audit Trail'}
                    </button>
                    {showAuditTrail && (
                      <div style={{ maxHeight: '300px', overflowY: 'auto', fontSize: '0.82rem' }}>
                        {auditLogs && auditLogs.items && auditLogs.items.length > 0 ? (
                          <table className="data-table" style={{ fontSize: '0.8rem' }}>
                            <thead>
                              <tr>
                                <th style={{ width: '10rem' }}>Time</th>
                                <th style={{ width: '8rem' }}>Action</th>
                                <th style={{ width: '6rem' }}>Entity</th>
                                <th>Details</th>
                              </tr>
                            </thead>
                            <tbody>
                              {auditLogs.items.map((log) => (
                                <tr key={log.id}>
                                  <td style={{ whiteSpace: 'nowrap' }}>
                                    {new Date(log.timestamp).toLocaleString()}
                                  </td>
                                  <td>
                                    <span style={{
                                      padding: '0.1rem 0.4rem',
                                      borderRadius: '3px',
                                      background: log.action_type.includes('approve') ? 'var(--success-bg, #d4edda)' :
                                        log.action_type.includes('edit') ? 'var(--info-bg, #d1ecf1)' :
                                        log.action_type.includes('delete') || log.action_type.includes('dismiss') ? 'var(--error-bg, #f8d7da)' :
                                        'var(--surface-alt, #f0f0f0)',
                                      fontSize: '0.75rem',
                                    }}>
                                      {log.action_type.replace(/_/g, ' ')}
                                    </span>
                                  </td>
                                  <td>{log.entity_type}</td>
                                  <td style={{ maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                    {log.before_value && log.after_value
                                      ? `"${log.before_value.slice(0, 40)}${log.before_value.length > 40 ? '...' : ''}" → "${log.after_value.slice(0, 40)}${log.after_value.length > 40 ? '...' : ''}"`
                                      : log.details
                                        ? JSON.stringify(log.details).slice(0, 80)
                                        : log.after_value
                                          ? log.after_value.slice(0, 80)
                                          : '—'}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        ) : (
                          <div style={{ color: 'var(--text-muted)', padding: '1rem', textAlign: 'center' }}>
                            No audit events recorded for this job yet.
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
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

            {batchSummary.items.some((j) => j.agent_mode && j.agent_mode !== 'off') && (batchSummary.processingCount > 0 || batchSummary.pendingCount > 0) && (
              <div style={{ marginBottom: '1rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.4rem' }}>
                  <span style={{ fontSize: '0.9rem' }}>💭</span>
                  <span style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Processing Log</span>
                </div>
                <textarea
                  ref={thinkingRef}
                  className="form-textarea"
                  readOnly
                  value={thinkingLogText}
                  rows={8}
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '0.78rem',
                    lineHeight: 1.45,
                    whiteSpace: 'pre',
                  }}
                />
              </div>
            )}

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
                <button
                  className="btn btn-success btn-lg"
                  onClick={() => downloadBatchResult(currentBatch.batch_id)}
                >
                  Download All Results (.zip)
                </button>
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
                        <span>Agent ({job.agent_status || job.agent_mode})</span>
                      )}
                      {job.agent_llm_calls > 0 && (
                        <span>{job.agent_llm_calls} calls · {((job.agent_input_tokens || 0) + (job.agent_output_tokens || 0)).toLocaleString()} tokens</span>
                      )}
                      {job.agent_kb_routed > 0 && (
                        <span>{job.agent_kb_routed} KB-direct</span>
                      )}
                      {job.total_questions === 0 && (
                        <span style={{ color: 'var(--warning)' }}>No questions found</span>
                      )}
                      {job.fallback_recommended && (
                        <span style={{ color: 'var(--warning)' }}>Review parser</span>
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
                      <button
                        className="btn btn-sm btn-secondary"
                        onClick={() => downloadJobResult(job.id)}
                      >
                        Download
                      </button>
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
                    <span>{job.matched_questions}/{job.total_questions} matched</span>
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
                      <span>Agent ({job.agent_status || job.agent_mode})</span>
                    )}
                    {job.agent_llm_calls > 0 && (
                      <span>{job.agent_llm_calls} calls · {((job.agent_input_tokens || 0) + (job.agent_output_tokens || 0)).toLocaleString()} tokens</span>
                    )}
                    {job.agent_kb_routed > 0 && (
                      <span>{job.agent_kb_routed} KB-direct</span>
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
                    <button
                      className="btn btn-sm btn-secondary"
                      onClick={() => downloadJobResult(job.id)}
                    >
                      Download
                    </button>
                  )}
                  {job.batch_id && (
                    <button
                      className="btn btn-sm btn-secondary"
                      onClick={() => downloadBatchResult(job.batch_id)}
                    >
                      Batch ZIP
                    </button>
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

    </div>
  );
}
