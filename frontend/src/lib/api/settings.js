import { apiFetch } from './client';

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

function buildProviderPayload({ provider = null, apiBase = '', apiKey = '' } = {}) {
    const payload = {};
    if (provider) payload.provider = provider;
    if (apiBase) payload.api_base = apiBase;
    if (apiKey) payload.api_key = apiKey;
    return payload;
}

export async function listAgentModels(opts = {}) {
    const res = await apiFetch('/api/settings/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildProviderPayload(opts)),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Failed to load provider models');
    }
    return res.json();
}

export async function testAgentConnection(opts = {}) {
    const res = await apiFetch('/api/settings/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildProviderPayload(opts)),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Connection test failed');
    }
    return res.json();
}
