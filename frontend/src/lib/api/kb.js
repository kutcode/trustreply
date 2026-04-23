import { apiFetch, getBaseUrl, downloadWithAuth } from './client';

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
    const res = await apiFetch('/api/qa/import', { method: 'POST', body: formData });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Import failed');
    }
    return res.json();
}

export function getQAExportUrl(format = 'csv', category = '') {
    const params = new URLSearchParams({ format });
    if (category) params.set('category', category);
    return `${getBaseUrl()}/api/qa/export?${params}`;
}

export async function downloadQAExport(format = 'csv', category = '') {
    return downloadWithAuth(getQAExportUrl(format, category), `qa_export.${format}`);
}

export async function listCategories() {
    const res = await apiFetch('/api/qa/categories');
    if (!res.ok) throw new Error('Failed to list categories');
    return res.json();
}

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
