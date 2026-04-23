import { apiFetch } from './client';

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
