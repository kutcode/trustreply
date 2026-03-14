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

const SUPPORTED_EXTENSIONS = new Set(['docx', 'pdf']);
const FALLBACK_MAX_BULK_FILES = 50;

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

export default function UploadPage() {
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [dragover, setDragover] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [currentJob, setCurrentJob] = useState(null);
  const [currentBatch, setCurrentBatch] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [parserProfiles, setParserProfiles] = useState([]);
  const [selectedParserProfile, setSelectedParserProfile] = useState('default');
  const [maxBulkFiles, setMaxBulkFiles] = useState(FALLBACK_MAX_BULK_FILES);
  const [toast, setToast] = useState(null);
  const pollRef = useRef(null);

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
        setParserProfiles(data.parser_profiles || []);
        setSelectedParserProfile(data.default_parser_profile || 'default');
        setMaxBulkFiles(data.max_bulk_files || FALLBACK_MAX_BULK_FILES);
      })
      .catch(() => { });
  }, []);

  const pollJob = useCallback(async (jobId) => {
    try {
      const job = await getJob(jobId);
      setCurrentJob(job);

      if (job.status === 'done') {
        stopPolling();
        if (jobNeedsReview(job)) {
          showToast(
            `⚠️ Document processed with ${job.flagged_questions_count || 0} question(s) needing review.`,
            'info',
          );
        } else {
          showToast('✅ Document processed successfully!', 'success');
        }
        refreshJobs();
      } else if (job.status === 'error') {
        stopPolling();
        showToast(`❌ Error: ${job.error_message || 'Unknown error'}`, 'error');
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
              ? `⚠️ Batch complete: ${reviewCount} file(s) need review before use`
              : `✅ Batch complete: ${doneCount} documents processed`,
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
        `❌ Skipped unsupported files: ${invalidFiles.slice(0, 3).join(', ')}${invalidFiles.length > 3 ? '…' : ''}`,
        'error',
      );
    }

    if (validFiles.length === 0) return;

    let nextFiles = validFiles;
    if (validFiles.length > maxBulkFiles) {
      nextFiles = validFiles.slice(0, maxBulkFiles);
      showToast(
        `⚠️ Batch upload is limited to ${maxBulkFiles} files. Kept the first ${maxBulkFiles} files.`,
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
        const job = await uploadDocument(selectedFiles[0], selectedParserProfile);
        setCurrentBatch(null);
        setCurrentJob(job);
        setSelectedFiles([]);
        showToast('📤 Document uploaded. Processing...', 'info');
        pollRef.current = setInterval(() => pollJob(job.id), 1500);
      } else {
        const batch = await uploadDocuments(selectedFiles, selectedParserProfile);
        setCurrentJob(null);
        setCurrentBatch(batch);
        setSelectedFiles([]);
        showToast(`📤 ${batch.total} documents uploaded. Processing batch...`, 'info');
        pollRef.current = setInterval(() => pollBatch(batch.batch_id), 1500);
      }
    } catch (err) {
      showToast(`❌ ${err.message}`, 'error');
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

  return (
    <div className="page-container">
      {toast && (
        <div className="toast-container">
          <div className={`toast toast-${toast.type}`}>{toast.message}</div>
        </div>
      )}

      <div className="page-header">
        <h1>TrustReply</h1>
        <p>
          Upload one or many .docx or .pdf questionnaires and TrustReply will auto-fill answers from your knowledge base.
        </p>
      </div>

      <div className="card" style={{ marginBottom: '1.25rem', padding: '1rem 1.25rem' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'end' }}>
          <div style={{ flex: '1 1 280px' }}>
            <label className="form-label">Parser Profile</label>
            <select
              className="form-select"
              value={selectedParserProfile}
              onChange={(e) => setSelectedParserProfile(e.target.value)}
            >
              {parserProfiles.map((profile) => (
                <option key={profile.name} value={profile.name}>
                  {profile.label}
                </option>
              ))}
            </select>
          </div>
          {parserProfiles.length > 0 && (
            <div style={{ flex: '2 1 360px', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
              {parserProfiles.find((profile) => profile.name === selectedParserProfile)?.description}
            </div>
          )}
        </div>
      </div>

      <div
        className={`upload-zone ${dragover ? 'dragover' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <input
          type="file"
          accept=".docx,.pdf"
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
            ? `Supports .docx and .pdf files. You can drop multiple files at once, up to ${maxBulkFiles} per batch.`
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
          <button className="btn btn-primary btn-lg" onClick={handleUpload}>
            🚀 Process {selectedFiles.length === 1 ? 'Document' : `${selectedFiles.length} Documents`}
          </button>
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
                    ⬇️ Download Filled Document
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
                  ⬇️ Download All Results (.zip)
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
                    {job.flagged_questions_count > 0 && (
                      <span style={{ color: 'var(--warning)' }}>
                        ⚠️ {job.flagged_questions_count} flagged
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
    </div>
  );
}
