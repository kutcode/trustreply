import { apiFetch } from './client';

export async function listQuestionResults(jobId) {
    const res = await apiFetch(`/api/jobs/${jobId}/questions`);
    if (!res.ok) throw new Error('Failed to load question results');
    return res.json();
}

export async function updateQuestionResult(jobId, questionId, answerText) {
    const res = await apiFetch(`/api/jobs/${jobId}/questions/${questionId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answer_text: answerText }),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Failed to update answer');
    }
    return res.json();
}

export async function approveQuestionResult(jobId, questionId) {
    const res = await apiFetch(`/api/jobs/${jobId}/questions/${questionId}/approve`, { method: 'POST' });
    if (!res.ok) throw new Error('Failed to approve question');
    return res.json();
}

export async function approveAllQuestionResults(jobId) {
    const res = await apiFetch(`/api/jobs/${jobId}/questions/approve-all`, { method: 'POST' });
    if (!res.ok) throw new Error('Failed to approve all');
    return res.json();
}

export async function finalizeJob(jobId) {
    const res = await apiFetch(`/api/jobs/${jobId}/finalize`, { method: 'POST' });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Failed to finalize');
    }
    return res.json();
}
