import { isAuthEnabled, createClient, getAccessToken } from '@/lib/supabase';

const CONFIGURED_API_BASE = process.env.NEXT_PUBLIC_API_URL || '';
const DEFAULT_API_PORTS = ['8000', '8001', '8002'];

let resolvedApiBase = CONFIGURED_API_BASE || '';
let resolveApiBasePromise = null;
let lastResolveFailure = 0;
const RESOLVE_RETRY_DELAY_MS = 5000;

function normalizeBase(base) {
    return base.replace(/\/+$/, '');
}

function getDiscoveryBases() {
    const configured = CONFIGURED_API_BASE ? [normalizeBase(CONFIGURED_API_BASE)] : [];

    if (typeof window === 'undefined') {
        const localFallbacks = DEFAULT_API_PORTS.map((port) => `http://localhost:${port}`);
        return [...new Set([...configured, ...localFallbacks])];
    }

    const protocol = window.location.protocol || 'http:';
    const hostname = window.location.hostname || 'localhost';
    const localFallbacks = DEFAULT_API_PORTS.map((port) => `${protocol}//${hostname}:${port}`);

    // Keep configured API first, but still probe local fallback ports to recover
    // from local port drift (e.g. backend restarted on a different port).
    return [...new Set([...configured, ...localFallbacks].map(normalizeBase))];
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 1200) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } finally {
        clearTimeout(timeoutId);
    }
}

async function probeApiBase(base) {
    try {
        const res = await fetchWithTimeout(`${base}/api/health`, {}, 900);
        if (!res.ok) return null;

        const data = await res.json().catch(() => null);
        if (data?.status === 'ok') {
            return base;
        }
    } catch (err) { }

    return null;
}

async function resolveApiBase() {
    if (resolvedApiBase) return resolvedApiBase;

    if (Date.now() - lastResolveFailure < RESOLVE_RETRY_DELAY_MS) {
        throw new Error('API discovery recently failed. Retrying shortly.');
    }

    if (!resolveApiBasePromise) {
        resolveApiBasePromise = (async () => {
            const candidates = [...new Set(getDiscoveryBases().map(normalizeBase))];
            const results = await Promise.all(candidates.map((base) => probeApiBase(base)));
            const match = results.find(Boolean);

            if (!match) {
                lastResolveFailure = Date.now();
                throw new Error(`No healthy API backend found. Checked: ${candidates.join(', ')}`);
            }

            resolvedApiBase = match;
            return match;
        })().finally(() => {
            resolveApiBasePromise = null;
        });
    }

    return resolveApiBasePromise;
}

async function _getAuthToken() {
    if (!isAuthEnabled) return null;

    // Fast path: use cached token from AuthProvider
    const cached = getAccessToken();
    if (cached) return cached;

    // Slow path: ask Supabase client (triggers refresh if needed)
    try {
        const supabase = createClient();
        if (supabase) {
            const { data } = await supabase.auth.getSession();
            return data?.session?.access_token || null;
        }
    } catch (e) {
        console.warn('Failed to get auth token:', e);
    }
    return null;
}

async function _refreshAuthToken() {
    if (!isAuthEnabled) return null;
    try {
        const supabase = createClient();
        if (supabase) {
            const { data, error } = await supabase.auth.refreshSession();
            if (!error && data?.session?.access_token) {
                return data.session.access_token;
            }
        }
    } catch (e) {
        console.warn('Failed to refresh auth token:', e);
    }
    return null;
}

async function apiFetch(path, options = {}) {
    const base = await resolveApiBase();

    // Inject auth token
    const token = await _getAuthToken();
    if (token) {
        options.headers = {
            ...options.headers,
            'Authorization': `Bearer ${token}`,
        };
    }

    let res;
    try {
        res = await fetch(`${base}${path}`, options);
    } catch (err) {
        // Network error — clear cached base so next call re-resolves
        resolvedApiBase = '';
        throw err;
    }

    // On 401, try refreshing the token once before giving up
    if (res.status === 401 && isAuthEnabled) {
        const freshToken = await _refreshAuthToken();
        if (freshToken) {
            options.headers = {
                ...options.headers,
                'Authorization': `Bearer ${freshToken}`,
            };
            try {
                return await fetch(`${base}${path}`, options);
            } catch (err) {
                throw err;
            }
        }
    }

    return res;
}

export function getApiBaseHint() {
    return resolvedApiBase || CONFIGURED_API_BASE || getDiscoveryBases().join(', ');
}

/**
 * Upload a document for processing.
 * @param {File} file
 * @returns {Promise<object>} Job object
 */
export async function uploadDocument(
    file,
    parserProfile = null,
    {
        agentMode = null,
        agentInstructions = '',
        agentConfig = null,
        templateId = null,
    } = {},
) {
    const formData = new FormData();
    formData.append('file', file);
    if (parserProfile) {
        formData.append('parser_profile', parserProfile);
    }
    if (agentMode) {
        formData.append('agent_mode', agentMode);
    }
    if (agentInstructions && agentInstructions.trim()) {
        formData.append('agent_instructions', agentInstructions.trim());
    }
    if (agentConfig) {
        if (agentConfig.provider) {
            formData.append('agent_provider', agentConfig.provider);
        }
        if (agentConfig.apiBase) {
            formData.append('agent_api_base', agentConfig.apiBase);
        }
        if (agentConfig.apiKey) {
            formData.append('agent_api_key', agentConfig.apiKey);
        }
        if (agentConfig.model) {
            formData.append('agent_model', agentConfig.model);
        }
    }
    if (templateId) {
        formData.append('template_id', templateId);
    }
    const res = await apiFetch('/api/upload', {
        method: 'POST',
        body: formData,
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Upload failed');
    }
    return res.json();
}

export async function uploadDocuments(
    files,
    parserProfile = null,
    {
        agentMode = null,
        agentInstructions = '',
        agentConfig = null,
    } = {},
) {
    const formData = new FormData();
    for (const file of files) {
        formData.append('files', file);
    }
    if (parserProfile) {
        formData.append('parser_profile', parserProfile);
    }
    if (agentMode) {
        formData.append('agent_mode', agentMode);
    }
    if (agentInstructions && agentInstructions.trim()) {
        formData.append('agent_instructions', agentInstructions.trim());
    }
    if (agentConfig) {
        if (agentConfig.provider) {
            formData.append('agent_provider', agentConfig.provider);
        }
        if (agentConfig.apiBase) {
            formData.append('agent_api_base', agentConfig.apiBase);
        }
        if (agentConfig.apiKey) {
            formData.append('agent_api_key', agentConfig.apiKey);
        }
        if (agentConfig.model) {
            formData.append('agent_model', agentConfig.model);
        }
    }
    const res = await apiFetch('/api/upload/bulk', {
        method: 'POST',
        body: formData,
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Bulk upload failed');
    }
    return res.json();
}

/**
 * Get job status.
 * @param {number} jobId
 * @returns {Promise<object>}
 */
export async function getJob(jobId) {
    const res = await apiFetch(`/api/jobs/${jobId}`);
    if (!res.ok) throw new Error('Failed to get job');
    return res.json();
}

export async function getBatchJobs(batchId) {
    const res = await apiFetch(`/api/jobs/batch/${batchId}`);
    if (!res.ok) throw new Error('Failed to get batch jobs');
    return res.json();
}

export function getBatchDownloadUrl(batchId) {
    const base = resolvedApiBase || normalizeBase(CONFIGURED_API_BASE || getDiscoveryBases()[0]);
    return `${base}/api/jobs/batch/${batchId}/download`;
}

/**
 * Download a file with auth token injected (for Supabase auth).
 * Falls back to direct URL navigation when auth is disabled.
 */
export async function downloadWithAuth(url, fallbackFilename = 'download') {
    if (!isAuthEnabled) {
        window.open(url, '_blank');
        return;
    }
    let token = await _getAuthToken();
    let res = await fetch(url, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
    });
    // On 401, try refreshing the token once
    if (res.status === 401) {
        const freshToken = await _refreshAuthToken();
        if (freshToken) {
            token = freshToken;
            res = await fetch(url, {
                headers: { 'Authorization': `Bearer ${token}` },
            });
        }
    }
    if (!res.ok) {
        throw new Error(`Download failed: ${res.status}`);
    }
    const blob = await res.blob();
    const disposition = res.headers.get('content-disposition') || '';
    const match = disposition.match(/filename="?([^";\n]+)"?/);
    const filename = match ? match[1] : fallbackFilename;

    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
        URL.revokeObjectURL(a.href);
        a.remove();
    }, 100);
}

/**
 * List all jobs.
 * @returns {Promise<object>}
 */
export async function listJobs() {
    const res = await apiFetch('/api/jobs');
    if (!res.ok) throw new Error('Failed to list jobs');
    return res.json();
}

export async function getSettings() {
    const res = await apiFetch('/api/settings');
    if (!res.ok) throw new Error('Failed to load settings');
    return res.json();
}

export async function saveSettings(data) {
    const res = await apiFetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Failed to save settings');
    }
    return res.json();
}

export async function listAgentModels({
    provider = null,
    apiBase = '',
    apiKey = '',
} = {}) {
    const payload = {};
    if (provider) payload.provider = provider;
    if (apiBase) payload.api_base = apiBase;
    if (apiKey) payload.api_key = apiKey;

    const res = await apiFetch('/api/settings/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Failed to load provider models');
    }
    return res.json();
}

export async function testAgentConnection({
    provider = null,
    apiBase = '',
    apiKey = '',
} = {}) {
    const payload = {};
    if (provider) payload.provider = provider;
    if (apiBase) payload.api_base = apiBase;
    if (apiKey) payload.api_key = apiKey;

    const res = await apiFetch('/api/settings/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Connection test failed');
    }
    return res.json();
}

export async function troubleshootDocument(
    file,
    {
        analyzeWithAgent = false,
        agentInstructions = '',
        agentConfig = null,
    } = {},
) {
    const formData = new FormData();
    formData.append('file', file);
    if (analyzeWithAgent) {
        formData.append('analyze_with_agent', 'true');
    }
    if (agentInstructions && agentInstructions.trim()) {
        formData.append('agent_instructions', agentInstructions.trim());
    }
    if (agentConfig) {
        if (agentConfig.provider) {
            formData.append('agent_provider', agentConfig.provider);
        }
        if (agentConfig.apiBase) {
            formData.append('agent_api_base', agentConfig.apiBase);
        }
        if (agentConfig.apiKey) {
            formData.append('agent_api_key', agentConfig.apiKey);
        }
        if (agentConfig.model) {
            formData.append('agent_model', agentConfig.model);
        }
    }
    const res = await apiFetch('/api/troubleshoot', {
        method: 'POST',
        body: formData,
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Troubleshooting failed');
    }
    return res.json();
}

/**
 * Get download URL for a completed job.
 * @param {number} jobId
 * @returns {string}
 */
export function getDownloadUrl(jobId) {
    const base = resolvedApiBase || normalizeBase(CONFIGURED_API_BASE || getDiscoveryBases()[0]);
    return `${base}/api/jobs/${jobId}/download`;
}

/**
 * Download a single job result with auth.
 */
export async function downloadJobResult(jobId) {
    const url = getDownloadUrl(jobId);
    return downloadWithAuth(url, `filled_result_${jobId}`);
}

/**
 * Download batch results with auth.
 */
export async function downloadBatchResult(batchId) {
    const url = getBatchDownloadUrl(batchId);
    return downloadWithAuth(url, `batch_${batchId}.zip`);
}

// ── Q&A CRUD ──────────────────────────────────────────────────────

export async function listQAPairs({ page = 1, pageSize = 20, search = '', category = '' } = {}) {
    const params = new URLSearchParams({ page, page_size: pageSize, search, category });
    const res = await apiFetch(`/api/qa?${params}`);
    if (!res.ok) throw new Error('Failed to list Q&A pairs');
    return res.json();
}

export async function createQAPair(data) {
    const res = await apiFetch('/api/qa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Failed to create Q&A pair');
    }
    return res.json();
}

export async function updateQAPair(id, data) {
    const res = await apiFetch(`/api/qa/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Failed to update Q&A pair');
    }
    return res.json();
}

export async function deleteQAPair(id) {
    const res = await apiFetch(`/api/qa/${id}`, { method: 'DELETE' });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Failed to delete Q&A pair (${res.status})`);
    }
    return res.json();
}

export async function importQAPairs(file) {
    const formData = new FormData();
    formData.append('file', file);
    const res = await apiFetch('/api/qa/import', {
        method: 'POST',
        body: formData,
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Import failed');
    }
    return res.json();
}

export function getQAExportUrl(format = 'csv', category = '') {
    const base = resolvedApiBase || normalizeBase(CONFIGURED_API_BASE || getDiscoveryBases()[0]);
    const params = new URLSearchParams({ format });
    if (category) params.set('category', category);
    return `${base}/api/qa/export?${params}`;
}

export async function downloadQAExport(format = 'csv', category = '') {
    const url = getQAExportUrl(format, category);
    return downloadWithAuth(url, `qa_export.${format}`);
}

export async function listCategories() {
    const res = await apiFetch('/api/qa/categories');
    if (!res.ok) throw new Error('Failed to list categories');
    return res.json();
}

// ── KB Deduplication ─────────────────────────────────────────────

export async function detectDuplicates(threshold = 0.85, category = null) {
    const params = new URLSearchParams({ threshold: threshold.toString() });
    if (category) params.set('category', category);
    return apiFetch(`/api/qa/duplicates?${params}`);
}

export async function mergeKBEntries(keepId, deleteIds) {
    return apiFetch('/api/qa/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keep_id: keepId, delete_ids: deleteIds }),
    });
}

export async function bulkMergeKBEntries(merges) {
    return apiFetch('/api/qa/merge/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ merges }),
    });
}

// ── Duplicate Review (AI-powered) ────────────────────────────────

export async function classifyDuplicates(threshold = 0.85, category = null) {
    const res = await apiFetch('/api/qa/duplicates/classify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ threshold, category: category || null }),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Failed to classify duplicates');
    }
    return res.json();
}

export async function listDuplicateReviews({ status = 'all', page = 1, pageSize = 20 } = {}) {
    const params = new URLSearchParams({ status, page, page_size: pageSize });
    const res = await apiFetch(`/api/qa/duplicates/reviews?${params}`);
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Failed to list duplicate reviews');
    }
    return res.json();
}

export async function actionDuplicateReview(reviewId, action) {
    const res = await apiFetch(`/api/qa/duplicates/reviews/${reviewId}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Failed to process duplicate review action');
    }
    return res.json();
}

export async function bulkActionDuplicateReviews(actions) {
    const res = await apiFetch('/api/qa/duplicates/reviews/bulk-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actions }),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Failed to process bulk duplicate review actions');
    }
    return res.json();
}

export async function getContradictionCount() {
    const res = await apiFetch('/api/qa/contradictions/count');
    if (!res.ok) return { count: 0 };
    return res.json();
}

// ── Audit Trail ───────────────────────────────────────────────────

export async function listAuditLogs({ jobId = null, actionType = null, entityType = null, fromDate = null, toDate = null, page = 1, pageSize = 50 } = {}) {
    const params = new URLSearchParams({ page, page_size: pageSize });
    if (jobId !== null) params.set('job_id', jobId);
    if (actionType) params.set('action_type', actionType);
    if (entityType) params.set('entity_type', entityType);
    if (fromDate) params.set('from_date', fromDate);
    if (toDate) params.set('to_date', toDate);
    const res = await apiFetch(`/api/audit?${params}`);
    if (!res.ok) throw new Error('Failed to load audit logs');
    return res.json();
}

// ── Flagged Questions ─────────────────────────────────────────────

export async function listFlaggedQuestions({ resolved = null, jobId = null } = {}) {
    const params = new URLSearchParams();
    if (resolved !== null) params.set('resolved', resolved);
    if (jobId !== null) params.set('job_id', jobId);
    const res = await apiFetch(`/api/flagged?${params}`);
    if (!res.ok) throw new Error('Failed to list flagged questions');
    return res.json();
}

export function getFlaggedExportUrl({ resolved = false, jobId = null } = {}) {
    const params = new URLSearchParams();
    if (resolved !== null) params.set('resolved', resolved);
    if (jobId !== null) params.set('job_id', jobId);
    const query = params.toString();
    const base = resolvedApiBase || normalizeBase(CONFIGURED_API_BASE || getDiscoveryBases()[0]);
    return `${base}/api/flagged/export${query ? `?${query}` : ''}`;
}

export async function downloadFlaggedExport(opts = {}) {
    const url = getFlaggedExportUrl(opts);
    return downloadWithAuth(url, 'flagged_export.csv');
}

export async function syncFlaggedQuestions({ jobId = null } = {}) {
    const params = new URLSearchParams();
    if (jobId !== null) params.set('job_id', jobId);
    const query = params.toString();
    const res = await apiFetch(`/api/flagged/sync${query ? `?${query}` : ''}`, {
        method: 'POST',
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Failed to sync flagged questions');
    }
    return res.json();
}

export async function resolveFlaggedQuestion(id, data) {
    const res = await apiFetch(`/api/flagged/${id}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Failed to resolve');
    }
    return res.json();
}

export async function dismissFlaggedQuestion(id) {
    const res = await apiFetch(`/api/flagged/${id}/dismiss`, { method: 'POST' });
    if (!res.ok) throw new Error('Failed to dismiss');
    return res.json();
}

export async function deduplicateFlaggedQuestions() {
    const res = await apiFetch('/api/flagged/deduplicate', { method: 'POST' });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Failed to deduplicate');
    }
    return res.json();
}

export async function purgeDismissedFlagged() {
    const res = await apiFetch('/api/flagged/dismissed', { method: 'DELETE' });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Failed to purge dismissed items');
    }
    return res.json();
}

export async function dismissFlaggedQuestionsBulk(ids) {
    const res = await apiFetch('/api/flagged/dismiss-bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Failed to dismiss selected questions');
    }
    return res.json();
}

// ── Question Results (Review Queue) ───────────────────────────────

export async function listQuestionResults(jobId) {
    const res = await apiFetch(`/api/jobs/${jobId}/questions`);
    if (!res.ok) throw new Error('Failed to load question results');
    return res.json();
}

export async function updateQuestionResult(jobId, questionId, answerText) {
    const res = await apiFetch(`/api/jobs/${jobId}/questions/${questionId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answer_text: answerText }),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Failed to update answer');
    }
    return res.json();
}

export async function approveQuestionResult(jobId, questionId) {
    const res = await apiFetch(`/api/jobs/${jobId}/questions/${questionId}/approve`, {
        method: 'POST',
    });
    if (!res.ok) throw new Error('Failed to approve question');
    return res.json();
}

export async function approveAllQuestionResults(jobId) {
    const res = await apiFetch(`/api/jobs/${jobId}/questions/approve-all`, {
        method: 'POST',
    });
    if (!res.ok) throw new Error('Failed to approve all');
    return res.json();
}

export async function finalizeJob(jobId) {
    const res = await apiFetch(`/api/jobs/${jobId}/finalize`, {
        method: 'POST',
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Failed to finalize');
    }
    return res.json();
}

// ── Format Fingerprints ───────────────────────────────────────────

export async function listFingerprints({ page = 1, pageSize = 50 } = {}) {
    const params = new URLSearchParams({ page, page_size: pageSize });
    const res = await apiFetch(`/api/fingerprints?${params}`);
    if (!res.ok) throw new Error('Failed to list fingerprints');
    return res.json();
}

export async function updateFingerprint(id, data) {
    const res = await apiFetch(`/api/fingerprints/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error('Failed to update fingerprint');
    return res.json();
}

export async function deleteFingerprint(id) {
    const res = await apiFetch(`/api/fingerprints/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to delete fingerprint');
    return res.json();
}

// ── Answer Corrections ────────────────────────────────────────────

export async function listCorrections({ jobId = null, autoAdded = null, page = 1, pageSize = 50 } = {}) {
    const params = new URLSearchParams({ page, page_size: pageSize });
    if (jobId !== null) params.set('job_id', jobId);
    if (autoAdded !== null) params.set('auto_added', autoAdded);
    const res = await apiFetch(`/api/corrections?${params}`);
    if (!res.ok) throw new Error('Failed to list corrections');
    return res.json();
}

export async function getCorrectionStats() {
    const res = await apiFetch('/api/corrections/stats');
    if (!res.ok) throw new Error('Failed to load correction stats');
    return res.json();
}

// ── Templates ─────────────────────────────────────────────────────

export async function listTemplates({ page = 1, pageSize = 50 } = {}) {
    const params = new URLSearchParams({ page, page_size: pageSize });
    const res = await apiFetch(`/api/templates?${params}`);
    if (!res.ok) throw new Error('Failed to list templates');
    return res.json();
}

export async function createTemplate(data) {
    const res = await apiFetch('/api/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Failed to create template');
    }
    return res.json();
}

export async function getTemplate(id) {
    const res = await apiFetch(`/api/templates/${id}`);
    if (!res.ok) throw new Error('Failed to get template');
    return res.json();
}

export async function updateTemplate(id, data) {
    const res = await apiFetch(`/api/templates/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error('Failed to update template');
    return res.json();
}

export async function deleteTemplate(id) {
    const res = await apiFetch(`/api/templates/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to delete template');
    return res.json();
}

export async function updateTemplateAnswer(templateId, answerId, answerText) {
    const res = await apiFetch(`/api/templates/${templateId}/answers/${answerId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answer_text: answerText }),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Failed to update answer');
    }
    return res.json();
}

// ── Presets ──────────────────────────────────────────────────────

export async function listPresets() {
    const res = await apiFetch('/api/presets');
    if (!res.ok) throw new Error('Failed to list presets');
    return res.json();
}

export async function createPreset(data) {
    const res = await apiFetch('/api/presets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Failed to create preset');
    }
    return res.json();
}

export async function deletePreset(id) {
    const res = await apiFetch(`/api/presets/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to delete preset');
    return res.json();
}
