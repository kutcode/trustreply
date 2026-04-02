'use client';

import { useState, useEffect, useCallback, useRef, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { getSettings, listAgentModels, saveSettings, testAgentConnection } from '@/lib/api';
import SubTabs from '@/components/SubTabs';
import LearnedFormatsContent from '@/components/LearnedFormatsContent';
import AgentLearningContent from '@/components/AgentLearningContent';
import ActivityLogContent from '@/components/ActivityLogContent';

const SETTINGS_TABS = [
    { key: 'configuration', label: 'Configuration', icon: '⚙' },
    { key: 'formats', label: 'Learned Formats', icon: '🧠' },
    { key: 'learning', label: 'Agent Learning', icon: '🤖' },
    { key: 'activity', label: 'Activity Log', icon: '📜' },
];

const PROVIDER_CONFIGS = {
    openai: {
        label: 'OpenAI', provider: 'openai', apiBase: 'https://api.openai.com/v1',
        defaultModel: 'gpt-4.1-nano', keyHint: 'sk-...',
        settingsKeyField: 'agent_openai_api_key', settingsModelField: 'agent_openai_model',
        hasKeyField: 'agent_openai_has_key', modelField: 'agent_openai_model',
    },
    anthropic: {
        label: 'Claude (Anthropic)', provider: 'anthropic', apiBase: 'https://api.anthropic.com/v1',
        defaultModel: 'claude-sonnet-4-6', keyHint: 'sk-ant-...',
        settingsKeyField: 'agent_anthropic_api_key', settingsModelField: 'agent_anthropic_model',
        hasKeyField: 'agent_anthropic_has_key', modelField: 'agent_anthropic_model',
    },
};

const STATIC_PROVIDER_MODELS = {
    openai: [
        { id: 'gpt-4.1-nano', label: 'gpt-4.1-nano' },
        { id: 'gpt-4.1-mini', label: 'gpt-4.1-mini' },
        { id: 'gpt-4.1', label: 'gpt-4.1' },
        { id: 'gpt-5-mini', label: 'gpt-5-mini' },
    ],
    anthropic: [
        { id: 'claude-sonnet-4-6', label: 'claude-sonnet-4-6' },
        { id: 'claude-3-5-haiku-latest', label: 'claude-3-5-haiku-latest' },
        { id: 'claude-3-5-sonnet-latest', label: 'claude-3-5-sonnet-latest' },
    ],
};

function ProviderCard({
    providerKey, config, hasKey, model, isEditing, onToggleEdit,
    apiKeyValue, onApiKeyChange, selectedModel, onModelChange,
    modelOptions, loadingModels, modelLoadError, onRefreshModels,
    onTestConnection, testingConnection, onSaveProvider, savingProvider,
}) {
    const connected = hasKey;
    const modelInOptions = modelOptions.some((opt) => opt.id === selectedModel);
    const selectedModelValue = modelInOptions ? selectedModel : '__custom__';

    return (
        <div className="card" style={{ padding: '1.25rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <span style={{ display: 'inline-block', width: '12px', height: '12px', borderRadius: '50%', background: connected ? 'var(--success, #22c55e)' : 'var(--text-muted, #888)', flexShrink: 0 }} />
                    <div>
                        <h3 style={{ margin: 0, fontSize: '1.1rem' }}>{config.label}</h3>
                        <span style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>{connected ? `Model: ${model}` : 'Not configured'}</span>
                    </div>
                </div>
                <span style={{ display: 'inline-block', padding: '0.2rem 0.65rem', borderRadius: '999px', fontSize: '0.75rem', fontWeight: 600, background: connected ? 'var(--success, #22c55e)' : 'var(--text-muted, #888)', color: '#fff' }}>
                    {connected ? 'Connected' : 'Disconnected'}
                </span>
            </div>
            <button className="btn btn-secondary btn-sm" onClick={onToggleEdit}>{isEditing ? 'Close' : 'Configure'}</button>
            {isEditing && (
                <div style={{ marginTop: '1rem', borderTop: '1px solid var(--border)', paddingTop: '1rem' }}>
                    <div style={{ marginBottom: '1rem' }}>
                        <label className="form-label">API Key {hasKey && !apiKeyValue && <span className="chip" style={{ marginLeft: '0.5rem', fontSize: '0.7rem' }}>saved</span>}</label>
                        <input className="form-input" type="password" value={apiKeyValue} onChange={(e) => onApiKeyChange(e.target.value)} placeholder={hasKey ? 'Leave blank to keep current key' : config.keyHint} />
                    </div>
                    <div style={{ marginBottom: '1rem' }}>
                        <label className="form-label">Model</label>
                        <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
                            <select className="form-select" value={selectedModelValue} onChange={(e) => { if (e.target.value !== '__custom__') onModelChange(e.target.value); }}>
                                {modelOptions.map((opt) => <option key={opt.id} value={opt.id}>{opt.label || opt.id}</option>)}
                                <option value="__custom__">Custom model (manual entry)</option>
                            </select>
                            <button type="button" className="btn btn-secondary btn-sm" onClick={onRefreshModels} disabled={loadingModels}>{loadingModels ? '...' : '↻'}</button>
                        </div>
                        {selectedModelValue === '__custom__' && <input className="form-input" value={selectedModel} onChange={(e) => onModelChange(e.target.value)} placeholder={config.defaultModel} style={{ marginTop: '0.6rem' }} />}
                        {modelLoadError && <div style={{ color: 'var(--warning)', fontSize: '0.82rem', marginTop: '0.45rem' }}>{modelLoadError}</div>}
                    </div>
                    <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
                        <button type="button" className="btn btn-secondary btn-sm" onClick={onTestConnection} disabled={testingConnection}>{testingConnection ? 'Testing...' : 'Test Connection'}</button>
                        <button type="button" className="btn btn-primary btn-sm" onClick={onSaveProvider} disabled={savingProvider}>{savingProvider ? 'Saving...' : 'Save'}</button>
                    </div>
                </div>
            )}
        </div>
    );
}

function SettingsConfigContent() {
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [savingProvider, setSavingProvider] = useState(null);
    const [toast, setToast] = useState(null);
    const [similarityThreshold, setSimilarityThreshold] = useState(0.75);
    const [defaultParserProfile, setDefaultParserProfile] = useState('default');
    const [parserProfiles, setParserProfiles] = useState([]);
    const [agentEnabled, setAgentEnabled] = useState(false);
    const [agentTimeoutSeconds, setAgentTimeoutSeconds] = useState(45);
    const [agentMaxQuestionsPerCall, setAgentMaxQuestionsPerCall] = useState(20);
    const [agentProvider, setAgentProvider] = useState('openai');
    const [openaiHasKey, setOpenaiHasKey] = useState(false);
    const [openaiModel, setOpenaiModel] = useState('gpt-4.1-nano');
    const [openaiApiKey, setOpenaiApiKey] = useState('');
    const [openaiModelOptions, setOpenaiModelOptions] = useState(STATIC_PROVIDER_MODELS.openai);
    const [openaiLoadingModels, setOpenaiLoadingModels] = useState(false);
    const [openaiModelError, setOpenaiModelError] = useState('');
    const [anthropicHasKey, setAnthropicHasKey] = useState(false);
    const [anthropicModel, setAnthropicModel] = useState('claude-sonnet-4-6');
    const [anthropicApiKey, setAnthropicApiKey] = useState('');
    const [anthropicModelOptions, setAnthropicModelOptions] = useState(STATIC_PROVIDER_MODELS.anthropic);
    const [anthropicLoadingModels, setAnthropicLoadingModels] = useState(false);
    const [anthropicModelError, setAnthropicModelError] = useState('');
    const [editingProvider, setEditingProvider] = useState(null);
    const [testingConnection, setTestingConnection] = useState(null);

    const toastTimeout = useRef(null);
    const showToast = useCallback((msg, type = 'info') => {
        if (toastTimeout.current) clearTimeout(toastTimeout.current);
        setToast({ message: msg, type });
        toastTimeout.current = setTimeout(() => setToast(null), 4000);
    }, []);

    const fetchModelsForProvider = useCallback(async (providerKey, apiKey = '') => {
        const cfg = PROVIDER_CONFIGS[providerKey];
        const setLoading_ = providerKey === 'openai' ? setOpenaiLoadingModels : setAnthropicLoadingModels;
        const setOptions = providerKey === 'openai' ? setOpenaiModelOptions : setAnthropicModelOptions;
        const setError = providerKey === 'openai' ? setOpenaiModelError : setAnthropicModelError;
        const currentModel = providerKey === 'openai' ? openaiModel : anthropicModel;
        const setModel = providerKey === 'openai' ? setOpenaiModel : setAnthropicModel;
        setLoading_(true); setError('');
        try {
            const data = await listAgentModels({ provider: cfg.provider, apiBase: cfg.apiBase, apiKey });
            const options = Array.isArray(data.models) ? data.models : [];
            setOptions(options);
            if (options.length > 0 && !options.some((o) => o.id === currentModel)) setModel(options[0].id);
        } catch (err) { setOptions(STATIC_PROVIDER_MODELS[providerKey] || []); setError(err.message || 'Failed to load models'); }
        finally { setLoading_(false); }
    }, [openaiModel, anthropicModel]);

    useEffect(() => {
        getSettings()
            .then((data) => {
                setSimilarityThreshold(data.similarity_threshold ?? 0.75);
                setDefaultParserProfile(data.default_parser_profile || 'default');
                setParserProfiles(data.parser_profiles || []);
                setAgentEnabled(Boolean(data.agent_enabled));
                setAgentTimeoutSeconds(data.agent_timeout_seconds ?? 45);
                setAgentMaxQuestionsPerCall(data.agent_max_questions_per_call ?? 20);
                setAgentProvider(data.agent_provider || 'openai');
                const oaiHasKey = Boolean(data.agent_openai_has_key);
                setOpenaiHasKey(oaiHasKey);
                setOpenaiModel(data.agent_openai_model || 'gpt-4.1-nano');
                if (oaiHasKey) fetchModelsForProvider('openai');
                const antHasKey = Boolean(data.agent_anthropic_has_key);
                setAnthropicHasKey(antHasKey);
                setAnthropicModel(data.agent_anthropic_model || 'claude-sonnet-4-6');
                if (antHasKey) fetchModelsForProvider('anthropic');
            })
            .catch(() => showToast('Failed to load settings', 'error'))
            .finally(() => setLoading(false));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleTestConnection = async (providerKey) => {
        const cfg = PROVIDER_CONFIGS[providerKey];
        const apiKey = providerKey === 'openai' ? openaiApiKey : anthropicApiKey;
        setTestingConnection(providerKey);
        try { const result = await testAgentConnection({ provider: cfg.provider, apiBase: cfg.apiBase, apiKey }); showToast(result.message, 'success'); }
        catch (err) { showToast(err.message, 'error'); }
        finally { setTestingConnection(null); }
    };

    const handleSaveProvider = async (providerKey) => {
        const cfg = PROVIDER_CONFIGS[providerKey];
        const apiKey = providerKey === 'openai' ? openaiApiKey : anthropicApiKey;
        const model = providerKey === 'openai' ? openaiModel : anthropicModel;
        setSavingProvider(providerKey);
        try {
            const payload = { [cfg.settingsModelField]: model, agent_enabled: true };
            if (apiKey) payload[cfg.settingsKeyField] = apiKey;
            if (providerKey === agentProvider) {
                payload.agent_provider = cfg.provider; payload.agent_api_base = cfg.apiBase; payload.agent_model = model;
                if (apiKey) payload.agent_api_key = apiKey;
            }
            const updated = await saveSettings(payload);
            if (providerKey === 'openai') { setOpenaiHasKey(Boolean(updated.agent_openai_has_key)); setOpenaiModel(updated.agent_openai_model || model); setOpenaiApiKey(''); }
            else { setAnthropicHasKey(Boolean(updated.agent_anthropic_has_key)); setAnthropicModel(updated.agent_anthropic_model || model); setAnthropicApiKey(''); }
            setAgentEnabled(Boolean(updated.agent_enabled));
            fetchModelsForProvider(providerKey);
            showToast(`${cfg.label} settings saved!`, 'success');
        } catch (err) { showToast(`Failed to save: ${err.message}`, 'error'); }
        finally { setSavingProvider(null); }
    };

    const handleSaveGeneral = async () => {
        setSaving(true);
        try {
            const payload = { similarity_threshold: similarityThreshold, default_parser_profile: defaultParserProfile, agent_enabled: agentEnabled, agent_timeout_seconds: agentTimeoutSeconds, agent_max_questions_per_call: agentMaxQuestionsPerCall, agent_default_mode: 'agent', agent_provider: agentProvider };
            const cfg = PROVIDER_CONFIGS[agentProvider === 'anthropic' ? 'anthropic' : 'openai'];
            payload.agent_api_base = cfg.apiBase;
            payload.agent_model = agentProvider === 'anthropic' ? anthropicModel : openaiModel;
            await saveSettings(payload);
            showToast('General settings saved!', 'success');
        } catch (err) { showToast(`Failed to save: ${err.message}`, 'error'); }
        finally { setSaving(false); }
    };

    if (loading) {
        return (
            <div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.25rem' }}>
                    <div className="card" style={{ padding: '1.25rem' }}><div className="skeleton skeleton-text" style={{ width: '50%', marginBottom: '1rem' }} /><div className="skeleton" style={{ height: 38 }} /></div>
                    <div className="card" style={{ padding: '1.25rem' }}><div className="skeleton skeleton-text" style={{ width: '50%', marginBottom: '1rem' }} /><div className="skeleton" style={{ height: 38 }} /></div>
                </div>
                <div className="card" style={{ padding: '1.25rem' }}><div className="skeleton skeleton-text" style={{ width: '40%', marginBottom: '1rem' }} /></div>
            </div>
        );
    }

    return (
        <>
            {toast && (
                <div className="toast-container" role="status" aria-live="polite">
                    <div className={`toast toast-${toast.type}`}>{toast.message}</div>
                </div>
            )}

            <div className="section-header" style={{ marginBottom: '0.75rem' }}>
                <div className="section-header-icon">&#128268;</div>
                <h2>Connected APIs</h2>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }}>
                <ProviderCard providerKey="openai" config={PROVIDER_CONFIGS.openai} hasKey={openaiHasKey} model={openaiModel}
                    isEditing={editingProvider === 'openai'} onToggleEdit={() => setEditingProvider(editingProvider === 'openai' ? null : 'openai')}
                    apiKeyValue={openaiApiKey} onApiKeyChange={setOpenaiApiKey} selectedModel={openaiModel} onModelChange={setOpenaiModel}
                    modelOptions={openaiModelOptions} loadingModels={openaiLoadingModels} modelLoadError={openaiModelError}
                    onRefreshModels={() => fetchModelsForProvider('openai', openaiApiKey)} onTestConnection={() => handleTestConnection('openai')}
                    testingConnection={testingConnection === 'openai'} onSaveProvider={() => handleSaveProvider('openai')} savingProvider={savingProvider === 'openai'} />
                <ProviderCard providerKey="anthropic" config={PROVIDER_CONFIGS.anthropic} hasKey={anthropicHasKey} model={anthropicModel}
                    isEditing={editingProvider === 'anthropic'} onToggleEdit={() => setEditingProvider(editingProvider === 'anthropic' ? null : 'anthropic')}
                    apiKeyValue={anthropicApiKey} onApiKeyChange={setAnthropicApiKey} selectedModel={anthropicModel} onModelChange={setAnthropicModel}
                    modelOptions={anthropicModelOptions} loadingModels={anthropicLoadingModels} modelLoadError={anthropicModelError}
                    onRefreshModels={() => fetchModelsForProvider('anthropic', anthropicApiKey)} onTestConnection={() => handleTestConnection('anthropic')}
                    testingConnection={testingConnection === 'anthropic'} onSaveProvider={() => handleSaveProvider('anthropic')} savingProvider={savingProvider === 'anthropic'} />
            </div>

            <div className="card" style={{ marginBottom: '1.25rem', padding: '1.25rem' }}>
                <div className="section-header"><div className="section-header-icon">&#127919;</div><h2>Matching Settings</h2></div>
                <div style={{ display: 'grid', gap: '1rem', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
                    <div>
                        <label className="form-label">Similarity Threshold</label>
                        <input className="form-input" type="number" min="0" max="1" step="0.05" value={similarityThreshold} onChange={(e) => setSimilarityThreshold(parseFloat(e.target.value) || 0)} />
                        <div style={{ color: 'var(--text-muted)', fontSize: '0.82rem', marginTop: '0.3rem' }}>Minimum cosine similarity for a KB answer to be used.</div>
                    </div>
                    <div>
                        <label className="form-label">Default Parser Profile</label>
                        <select className="form-select" value={defaultParserProfile} onChange={(e) => setDefaultParserProfile(e.target.value)}>
                            {parserProfiles.map((p) => <option key={p.name} value={p.name}>{p.label}</option>)}
                        </select>
                        <div style={{ color: 'var(--text-muted)', fontSize: '0.82rem', marginTop: '0.3rem' }}>Default parser profile for uploads.</div>
                    </div>
                </div>
            </div>

            <div className="card" style={{ marginBottom: '1.25rem', padding: '1.25rem' }}>
                <div className="section-header"><div className="section-header-icon">&#129504;</div><h2>Agent Defaults</h2></div>
                <div style={{ display: 'grid', gap: '1rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <label className="toggle-switch">
                            <input type="checkbox" checked={agentEnabled} onChange={(e) => setAgentEnabled(e.target.checked)} />
                            <span className="toggle-track" /><span className="toggle-label">Enable AI Agent</span>
                        </label>
                        <span style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>When enabled, agent modes become available on Upload.</span>
                    </div>
                    <div className="divider" />
                    <div style={{ display: 'grid', gap: '1rem', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
                        <div>
                            <label className="form-label">Default Provider</label>
                            <select className="form-select" value={agentProvider} onChange={(e) => setAgentProvider(e.target.value)}>
                                <option value="openai">OpenAI</option>
                                <option value="anthropic">Claude (Anthropic)</option>
                            </select>
                        </div>
                        <div>
                            <label className="form-label">Default Agent Mode</label>
                            <input className="form-input" value="Agent" readOnly style={{ opacity: 0.7, cursor: 'default' }} />
                        </div>
                    </div>
                    <div style={{ display: 'grid', gap: '1rem', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
                        <div>
                            <label className="form-label">Timeout (seconds)</label>
                            <input className="form-input" type="number" min="1" max="300" value={agentTimeoutSeconds} onChange={(e) => setAgentTimeoutSeconds(parseInt(e.target.value, 10) || 45)} />
                        </div>
                        <div>
                            <label className="form-label">Max Questions Per Call</label>
                            <input className="form-input" type="number" min="1" max="100" value={agentMaxQuestionsPerCall} onChange={(e) => setAgentMaxQuestionsPerCall(parseInt(e.target.value, 10) || 20)} />
                            <div style={{ color: 'var(--text-muted)', fontSize: '0.82rem', marginTop: '0.3rem' }}>Questions are batched into chunks of this size.</div>
                        </div>
                    </div>
                </div>
            </div>

            <div style={{ textAlign: 'center', marginTop: '1.5rem' }}>
                <button className="btn btn-primary btn-lg" onClick={handleSaveGeneral} disabled={saving}>{saving ? 'Saving...' : 'Save General Settings'}</button>
            </div>
        </>
    );
}

function SettingsPageInner() {
    const searchParams = useSearchParams();
    const router = useRouter();
    const initialTab = searchParams.get('tab') || 'configuration';
    const [activeTab, setActiveTab] = useState(initialTab);

    const handleTabChange = (tab) => {
        setActiveTab(tab);
        router.replace(`/settings?tab=${tab}`, { scroll: false });
    };

    return (
        <div className="page-container">
            <div className="page-header">
                <h1>Settings</h1>
                <p>Configure AI providers, matching parameters, formats, and view system activity.</p>
            </div>
            <SubTabs tabs={SETTINGS_TABS} activeTab={activeTab} onChange={handleTabChange} />
            {activeTab === 'configuration' && <SettingsConfigContent />}
            {activeTab === 'formats' && <LearnedFormatsContent />}
            {activeTab === 'learning' && <AgentLearningContent />}
            {activeTab === 'activity' && <ActivityLogContent />}
        </div>
    );
}

export default function SettingsPage() {
    return (
        <Suspense fallback={<div className="page-container"><div className="page-header"><h1>Settings</h1><p>Loading...</p></div></div>}>
            <SettingsPageInner />
        </Suspense>
    );
}
