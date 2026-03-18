const CONFIGURED_API_BASE = process.env.NEXT_PUBLIC_API_URL || '';
const DEFAULT_API_PORTS = ['8000', '8001', '8002'];

let resolvedApiBase = CONFIGURED_API_BASE || '';
let resolveApiBasePromise = null;

function normalizeBase(base) {
    return base.replace(/\/+$/, '');
}

function getDiscoveryBases() {
    if (CONFIGURED_API_BASE) {
        return [normalizeBase(CONFIGURED_API_BASE)];
    }

    if (typeof window === 'undefined') {
        return ['http://localhost:8000'];
    }

    const protocol = window.location.protocol || 'http:';
    const hostname = window.location.hostname || 'localhost';

    return DEFAULT_API_PORTS.map((port) => `${protocol}//${hostname}:${port}`);
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

    if (!resolveApiBasePromise) {
        resolveApiBasePromise = (async () => {
            const candidates = [...new Set(getDiscoveryBases().map(normalizeBase))];
            const results = await Promise.all(candidates.map((base) => probeApiBase(base)));
            const match = results.find(Boolean);

            if (!match) {
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

async function apiFetch(path, options = {}, retry = true) {
    const base = await resolveApiBase();

    try {
        return await fetch(`${base}${path}`, options);
    } catch (err) {
        if (retry && !CONFIGURED_API_BASE) {
            resolvedApiBase = '';
            return apiFetch(path, options, false);
        }
        throw err;
    }
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
    if (!res.ok) throw new Error('Failed to delete Q&A pair');
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

export async function listCategories() {
    const res = await apiFetch('/api/qa/categories');
    if (!res.ok) throw new Error('Failed to list categories');
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
