import { apiFetch } from './client';

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
