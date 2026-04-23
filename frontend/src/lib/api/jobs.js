import { apiFetch, getBaseUrl, downloadWithAuth } from './client';

function appendAgentConfig(formData, agentConfig) {
    if (!agentConfig) return;
    if (agentConfig.provider) formData.append('agent_provider', agentConfig.provider);
    if (agentConfig.apiBase) formData.append('agent_api_base', agentConfig.apiBase);
    if (agentConfig.apiKey) formData.append('agent_api_key', agentConfig.apiKey);
    if (agentConfig.model) formData.append('agent_model', agentConfig.model);
}

export async function uploadDocument(
    file,
    parserProfile = null,
    { agentMode = null, agentInstructions = '', agentConfig = null, templateId = null } = {},
) {
    const formData = new FormData();
    formData.append('file', file);
    if (parserProfile) formData.append('parser_profile', parserProfile);
    if (agentMode) formData.append('agent_mode', agentMode);
    if (agentInstructions?.trim()) formData.append('agent_instructions', agentInstructions.trim());
    appendAgentConfig(formData, agentConfig);
    if (templateId) formData.append('template_id', templateId);

    const res = await apiFetch('/api/upload', { method: 'POST', body: formData });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Upload failed');
    }
    return res.json();
}

export async function uploadDocuments(
    files,
    parserProfile = null,
    { agentMode = null, agentInstructions = '', agentConfig = null } = {},
) {
    const formData = new FormData();
    for (const file of files) formData.append('files', file);
    if (parserProfile) formData.append('parser_profile', parserProfile);
    if (agentMode) formData.append('agent_mode', agentMode);
    if (agentInstructions?.trim()) formData.append('agent_instructions', agentInstructions.trim());
    appendAgentConfig(formData, agentConfig);

    const res = await apiFetch('/api/upload/bulk', { method: 'POST', body: formData });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Bulk upload failed');
    }
    return res.json();
}

export async function getJob(jobId) {
    const res = await apiFetch(`/api/jobs/${jobId}`);
    if (!res.ok) throw new Error('Failed to get job');
    return res.json();
}

export async function getBatchJobs(batchId) {
    const res = await apiFetch(`/api/jobs/batch/${batchId}`);
    if (!res.ok) throw new Error('Failed to get batch jobs');
    return res.json();
}

export async function listJobs() {
    const res = await apiFetch('/api/jobs');
    if (!res.ok) throw new Error('Failed to list jobs');
    return res.json();
}

export function getDownloadUrl(jobId) {
    return `${getBaseUrl()}/api/jobs/${jobId}/download`;
}

export function getBatchDownloadUrl(batchId) {
    return `${getBaseUrl()}/api/jobs/batch/${batchId}/download`;
}

export async function downloadJobResult(jobId) {
    return downloadWithAuth(getDownloadUrl(jobId), `filled_result_${jobId}`);
}

export async function downloadBatchResult(batchId) {
    return downloadWithAuth(getBatchDownloadUrl(batchId), `batch_${batchId}.zip`);
}

export async function troubleshootDocument(
    file,
    { analyzeWithAgent = false, agentInstructions = '', agentConfig = null } = {},
) {
    const formData = new FormData();
    formData.append('file', file);
    if (analyzeWithAgent) formData.append('analyze_with_agent', 'true');
    if (agentInstructions?.trim()) formData.append('agent_instructions', agentInstructions.trim());
    appendAgentConfig(formData, agentConfig);

    const res = await apiFetch('/api/troubleshoot', { method: 'POST', body: formData });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Troubleshooting failed');
    }
    return res.json();
}

// Re-export so existing imports of downloadWithAuth through @/lib/api keep working.
export { downloadWithAuth };
