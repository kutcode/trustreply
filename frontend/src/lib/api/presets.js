import { apiFetch } from './client';

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
