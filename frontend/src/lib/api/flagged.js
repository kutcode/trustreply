import { apiFetch, getBaseUrl, downloadWithAuth } from './client';

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
    return `${getBaseUrl()}/api/flagged/export${query ? `?${query}` : ''}`;
}

export async function downloadFlaggedExport(opts = {}) {
    return downloadWithAuth(getFlaggedExportUrl(opts), 'flagged_export.csv');
}

export async function syncFlaggedQuestions({ jobId = null } = {}) {
    const params = new URLSearchParams();
    if (jobId !== null) params.set('job_id', jobId);
    const query = params.toString();
    const res = await apiFetch(`/api/flagged/sync${query ? `?${query}` : ''}`, { method: 'POST' });
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
