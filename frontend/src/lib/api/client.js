import { isAuthEnabled, createClient, getAccessToken } from '@/lib/supabase';

const CONFIGURED_API_BASE = process.env.NEXT_PUBLIC_API_URL || '';
const DEFAULT_API_PORTS = ['8000', '8001', '8002'];
const RESOLVE_RETRY_DELAY_MS = 5000;

let resolvedApiBase = CONFIGURED_API_BASE || '';
let resolveApiBasePromise = null;
let lastResolveFailure = 0;

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

    // Probe local fallback ports so we recover if backend restarts on a different port.
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
        if (data?.status === 'ok') return base;
    } catch {
        /* ignore — probe failure just means this base isn't available */
    }
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

async function getAuthToken() {
    if (!isAuthEnabled) return null;

    const cached = getAccessToken();
    if (cached) return cached;

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

async function refreshAuthToken() {
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

export async function apiFetch(path, options = {}) {
    const base = await resolveApiBase();

    const token = await getAuthToken();
    if (token) {
        options.headers = {
            ...options.headers,
            Authorization: `Bearer ${token}`,
        };
    }

    let res;
    try {
        res = await fetch(`${base}${path}`, options);
    } catch (err) {
        // Clear the cached base so the next call re-probes discovery.
        resolvedApiBase = '';
        throw err;
    }

    if (res.status === 401 && isAuthEnabled) {
        const freshToken = await refreshAuthToken();
        if (freshToken) {
            options.headers = {
                ...options.headers,
                Authorization: `Bearer ${freshToken}`,
            };
            return fetch(`${base}${path}`, options);
        }
    }

    return res;
}

export function getApiBaseHint() {
    return resolvedApiBase || CONFIGURED_API_BASE || getDiscoveryBases().join(', ');
}

export function getBaseUrl() {
    return resolvedApiBase || normalizeBase(CONFIGURED_API_BASE || getDiscoveryBases()[0]);
}

export async function downloadWithAuth(url, fallbackFilename = 'download') {
    if (!isAuthEnabled) {
        window.open(url, '_blank');
        return;
    }
    let token = await getAuthToken();
    let res = await fetch(url, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (res.status === 401) {
        const freshToken = await refreshAuthToken();
        if (freshToken) {
            token = freshToken;
            res = await fetch(url, {
                headers: { Authorization: `Bearer ${token}` },
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
