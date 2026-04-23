import { apiFetch } from './client';

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
