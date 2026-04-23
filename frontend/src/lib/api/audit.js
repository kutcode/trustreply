import { apiFetch } from './client';

export async function listAuditLogs({
    jobId = null,
    actionType = null,
    entityType = null,
    fromDate = null,
    toDate = null,
    page = 1,
    pageSize = 50,
} = {}) {
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
