import { apiFetch } from './client';

export async function listTemplates({ page = 1, pageSize = 50 } = {}) {
    const params = new URLSearchParams({ page, page_size: pageSize });
    const res = await apiFetch(`/api/templates?${params}`);
    if (!res.ok) throw new Error('Failed to list templates');
    return res.json();
}

export async function createTemplate(data) {
    const res = await apiFetch('/api/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Failed to create template');
    }
    return res.json();
}

export async function getTemplate(id) {
    const res = await apiFetch(`/api/templates/${id}`);
    if (!res.ok) throw new Error('Failed to get template');
    return res.json();
}

export async function updateTemplate(id, data) {
    const res = await apiFetch(`/api/templates/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error('Failed to update template');
    return res.json();
}

export async function deleteTemplate(id) {
    const res = await apiFetch(`/api/templates/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to delete template');
    return res.json();
}

export async function updateTemplateAnswer(templateId, answerId, answerText) {
    const res = await apiFetch(`/api/templates/${templateId}/answers/${answerId}`, {
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
