'use client';

import { useState, useEffect, useCallback } from 'react';
import { getSettings, listAgentModels, saveSettings, testAgentConnection } from '@/lib/api';

const AGENT_PROVIDER_PRESETS = {
  openai: {
    label: 'OpenAI API',
    provider: 'openai',
    apiBase: 'https://api.openai.com/v1',
    model: 'gpt-4.1-nano',
    keyHint: 'Use your OpenAI API key',
  },
  claude: {
    label: 'Claude API (Anthropic)',
    provider: 'anthropic',
    apiBase: 'https://api.anthropic.com/v1',
    model: 'claude-3-5-haiku-latest',
    keyHint: 'Use your Anthropic API key',
  },
};

const STATIC_PROVIDER_MODELS = {
  openai: [
    { id: 'gpt-4.1-nano', label: 'gpt-4.1-nano' },
    { id: 'gpt-4.1-mini', label: 'gpt-4.1-mini' },
    { id: 'gpt-4.1', label: 'gpt-4.1' },
    { id: 'gpt-5-mini', label: 'gpt-5-mini' },
  ],
  claude: [
    { id: 'claude-3-5-haiku-latest', label: 'claude-3-5-haiku-latest' },
    { id: 'claude-3-5-sonnet-latest', label: 'claude-3-5-sonnet-latest' },
    { id: 'claude-3-opus-latest', label: 'claude-3-opus-latest' },
  ],
};

function detectPreset(provider, apiBase) {
  if (provider === 'anthropic' || provider === 'claude' || (apiBase && apiBase.includes('anthropic.com'))) {
    return 'claude';
  }
  return 'openai';
}

function SkeletonSettings() {
  return (
    <div className="page-container">
      <div className="page-header">
        <h1>Settings</h1>
        <p>Loading configuration...</p>
      </div>
      <div className="card" style={{ marginBottom: '1.25rem', padding: '1.25rem' }}>
        <div className="skeleton skeleton-text" style={{ width: '35%', marginBottom: '1rem' }} />
        <div style={{ display: 'grid', gap: '1rem', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
          <div>
            <div className="skeleton skeleton-text-short" />
            <div className="skeleton" style={{ height: 38 }} />
          </div>
          <div>
            <div className="skeleton skeleton-text-short" />
            <div className="skeleton" style={{ height: 38 }} />
          </div>
        </div>
      </div>
      <div className="card" style={{ padding: '1.25rem' }}>
        <div className="skeleton skeleton-text" style={{ width: '40%', marginBottom: '1rem' }} />
        <div className="skeleton" style={{ height: 24, width: 120, marginBottom: '1rem' }} />
        <div style={{ display: 'grid', gap: '1rem', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
          <div>
            <div className="skeleton skeleton-text-short" />
            <div className="skeleton" style={{ height: 38 }} />
          </div>
          <div>
            <div className="skeleton skeleton-text-short" />
            <div className="skeleton" style={{ height: 38 }} />
          </div>
        </div>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);

  // Matching settings
  const [similarityThreshold, setSimilarityThreshold] = useState(0.75);
  const [defaultParserProfile, setDefaultParserProfile] = useState('default');
  const [parserProfiles, setParserProfiles] = useState([]);

  // Agent settings
  const [agentEnabled, setAgentEnabled] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState('openai');
  const [agentProvider, setAgentProvider] = useState('openai');
  const [agentApiBase, setAgentApiBase] = useState('https://api.openai.com/v1');
  const [agentModel, setAgentModel] = useState('gpt-4.1-nano');
  const [agentApiKey, setAgentApiKey] = useState('');
  const [agentHasKey, setAgentHasKey] = useState(false);
  const [agentTimeoutSeconds, setAgentTimeoutSeconds] = useState(45);
  const [agentMaxQuestionsPerCall, setAgentMaxQuestionsPerCall] = useState(20);
  const [modelOptions, setModelOptions] = useState([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelLoadError, setModelLoadError] = useState('');
  const [testingConnection, setTestingConnection] = useState(false);

  const showToast = useCallback((message, type = 'info') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  }, []);

  const getStaticModels = useCallback((providerName) => {
    const presetKey = detectPreset(providerName, '');
    return STATIC_PROVIDER_MODELS[presetKey] || [];
  }, []);

  const fetchModels = useCallback(async ({
    provider,
    apiBase,
    apiKey = '',
    currentModel = '',
  }) => {
    if (!provider || !apiBase) {
      setModelOptions(getStaticModels(provider));
      setModelLoadError('Provider and API base are required to load models.');
      return;
    }

    setLoadingModels(true);
    setModelLoadError('');
    try {
      const data = await listAgentModels({
        provider,
        apiBase,
        apiKey,
      });
      const options = Array.isArray(data.models) ? data.models : [];
      setModelOptions(options);
      if (options.length > 0 && !options.some((option) => option.id === currentModel)) {
        setAgentModel(options[0].id);
      }
    } catch (err) {
      const fallback = getStaticModels(provider);
      setModelOptions(fallback);
      setModelLoadError(err.message || 'Failed to load models');
    } finally {
      setLoadingModels(false);
    }
  }, [getStaticModels]);

  useEffect(() => {
    getSettings()
      .then((data) => {
        setSimilarityThreshold(data.similarity_threshold ?? 0.75);
        setDefaultParserProfile(data.default_parser_profile || 'default');
        setParserProfiles(data.parser_profiles || []);
        setAgentEnabled(Boolean(data.agent_enabled));
        const provider = data.agent_provider || 'openai';
        const apiBase = data.agent_api_base || 'https://api.openai.com/v1';
        const model = data.agent_model || 'gpt-4.1-nano';

        setAgentProvider(provider);
        setAgentApiBase(apiBase);
        setAgentModel(model);
        setAgentHasKey(Boolean(data.agent_has_key));
        setAgentTimeoutSeconds(data.agent_timeout_seconds ?? 45);
        setAgentMaxQuestionsPerCall(data.agent_max_questions_per_call ?? 20);
        setSelectedPreset(detectPreset(provider, apiBase));

        if (data.agent_has_key) {
          fetchModels({ provider, apiBase, currentModel: model });
        } else {
          setModelOptions(getStaticModels(provider));
          setModelLoadError('Enter an API key and click Refresh models to load provider model options.');
        }
      })
      .catch(() => showToast('Failed to load settings', 'error'))
      .finally(() => setLoading(false));
  }, [fetchModels, getStaticModels, showToast]);

  const handlePresetChange = (presetName) => {
    const preset = AGENT_PROVIDER_PRESETS[presetName] || AGENT_PROVIDER_PRESETS.openai;
    setSelectedPreset(presetName);
    setAgentProvider(preset.provider);
    setAgentApiBase(preset.apiBase);
    setAgentModel(preset.model);
    setAgentApiKey('');
    setModelOptions([]);
    setModelLoadError('');

    if (agentHasKey) {
      fetchModels({
        provider: preset.provider,
        apiBase: preset.apiBase,
        currentModel: preset.model,
      });
    } else {
      setModelOptions(getStaticModels(preset.provider));
      setModelLoadError('Enter an API key and click Refresh models to load provider model options.');
    }
  };

  const handleTestConnection = async () => {
    setTestingConnection(true);
    try {
      const result = await testAgentConnection({
        provider: agentProvider,
        apiBase: agentApiBase,
        apiKey: agentApiKey,
      });
      showToast(`✅ ${result.message}`, 'success');
    } catch (err) {
      showToast(`❌ ${err.message}`, 'error');
    } finally {
      setTestingConnection(false);
    }
  };

  const handleRefreshModels = () => {
    fetchModels({
      provider: agentProvider,
      apiBase: agentApiBase,
      apiKey: agentApiKey,
      currentModel: agentModel,
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = {
        similarity_threshold: similarityThreshold,
        default_parser_profile: defaultParserProfile,
        agent_enabled: agentEnabled,
        agent_default_mode: 'agent',
        agent_provider: agentProvider,
        agent_api_base: agentApiBase,
        agent_model: agentModel,
        agent_timeout_seconds: agentTimeoutSeconds,
        agent_max_questions_per_call: agentMaxQuestionsPerCall,
      };
      // Only send API key if the user typed a new one
      if (agentApiKey) {
        payload.agent_api_key = agentApiKey;
      }
      const updated = await saveSettings(payload);
      setAgentHasKey(Boolean(updated.agent_has_key));
      setAgentApiKey('');
      fetchModels({
        provider: agentProvider,
        apiBase: agentApiBase,
        currentModel: agentModel,
      });
      showToast('Settings saved successfully!', 'success');
    } catch (err) {
      showToast(`Failed to save: ${err.message}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <SkeletonSettings />;
  }

  const modelInOptions = modelOptions.some((option) => option.id === agentModel);
  const selectedModelValue = modelInOptions ? agentModel : '__custom__';

  return (
    <div className="page-container">
      {toast && (
        <div className="toast-container">
          <div className={`toast toast-${toast.type}`}>{toast.message}</div>
        </div>
      )}

      <div className="page-header">
        <h1>Settings</h1>
        <p>
          Configure matching parameters, AI agent provider, and application defaults.
          Changes are applied immediately and persisted across restarts.
        </p>
      </div>

      {/* ── Matching Settings ─────────────────────────── */}
      <div className="card" style={{ marginBottom: '1.25rem', padding: '1.25rem' }}>
        <div className="section-header">
          <div className="section-header-icon">🎯</div>
          <h2>Matching Settings</h2>
        </div>
        <div style={{ display: 'grid', gap: '1rem', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
          <div>
            <label className="form-label">Similarity Threshold</label>
            <input
              className="form-input"
              type="number"
              min="0"
              max="1"
              step="0.05"
              value={similarityThreshold}
              onChange={(e) => setSimilarityThreshold(parseFloat(e.target.value) || 0)}
            />
            <div style={{ color: 'var(--text-muted)', fontSize: '0.82rem', marginTop: '0.3rem' }}>
              Minimum cosine similarity (0 - 1) for a KB answer to be used. Lower = more matches, higher = stricter.
            </div>
          </div>
          <div>
            <label className="form-label">Default Parser Profile</label>
            <select
              className="form-select"
              value={defaultParserProfile}
              onChange={(e) => setDefaultParserProfile(e.target.value)}
            >
              {parserProfiles.map((profile) => (
                <option key={profile.name} value={profile.name}>
                  {profile.label}
                </option>
              ))}
            </select>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.82rem', marginTop: '0.3rem' }}>
              Parser profile used by default when no profile is specified during upload.
            </div>
          </div>
        </div>
      </div>

      {/* ── AI Agent Settings ─────────────────────────── */}
      <div className="card" style={{ marginBottom: '1.25rem', padding: '1.25rem' }}>
        <div className="section-header">
          <div className="section-header-icon">🧠</div>
          <h2>AI Agent Settings</h2>
        </div>

        <div style={{ display: 'grid', gap: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <label className="toggle-switch">
              <input
                type="checkbox"
                checked={agentEnabled}
                onChange={(e) => setAgentEnabled(e.target.checked)}
              />
              <span className="toggle-track" />
              <span className="toggle-label">Enable AI Agent</span>
            </label>
            <span style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>
              When enabled, agent modes become available on the Upload page.
            </span>
          </div>

          <div className="divider" />

          <div style={{ display: 'grid', gap: '1rem', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
            <div>
              <label className="form-label">Default Agent Mode</label>
              <input className="form-input" value="Agent" readOnly style={{ opacity: 0.7, cursor: 'default' }} />
              <div style={{ color: 'var(--text-muted)', fontSize: '0.82rem', marginTop: '0.3rem' }}>
                Default mode is fixed to Agent for all new uploads.
              </div>
            </div>
            <div>
              <label className="form-label">Provider</label>
              <select
                className="form-select"
                value={selectedPreset}
                onChange={(e) => handlePresetChange(e.target.value)}
              >
                {Object.entries(AGENT_PROVIDER_PRESETS).map(([key, preset]) => (
                  <option key={key} value={key}>{preset.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div style={{ display: 'grid', gap: '1rem', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
            <div>
              <label className="form-label">API Base URL</label>
              <input
                className="form-input"
                value={agentApiBase}
                onChange={(e) => setAgentApiBase(e.target.value)}
                placeholder={AGENT_PROVIDER_PRESETS[selectedPreset]?.apiBase || 'https://api.openai.com/v1'}
              />
            </div>
            <div>
              <label className="form-label">Model</label>
              <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
                <select
                  className="form-select"
                  value={selectedModelValue}
                  onChange={(e) => {
                    const value = e.target.value;
                    if (value === '__custom__') {
                      if (modelInOptions) {
                        setAgentModel('');
                      }
                      return;
                    }
                    setAgentModel(value);
                  }}
                >
                  {modelOptions.map((option) => (
                    <option key={option.id} value={option.id}>{option.label || option.id}</option>
                  ))}
                  <option value="__custom__">Custom model (manual entry)</option>
                </select>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={handleRefreshModels}
                  disabled={loadingModels}
                >
                  {loadingModels ? '...' : '↻'}
                </button>
              </div>
              {selectedModelValue === '__custom__' && (
                <input
                  className="form-input"
                  value={agentModel}
                  onChange={(e) => setAgentModel(e.target.value)}
                  placeholder={AGENT_PROVIDER_PRESETS[selectedPreset]?.model || 'gpt-4.1-nano'}
                  style={{ marginTop: '0.6rem' }}
                />
              )}
              {modelLoadError && (
                <div style={{ color: 'var(--warning)', fontSize: '0.82rem', marginTop: '0.45rem' }}>
                  {modelLoadError}
                </div>
              )}
            </div>
          </div>

          <div
            style={{
              padding: '0.85rem',
              borderRadius: 'var(--radius-md)',
              background: 'var(--bg-input)',
              color: 'var(--text-secondary)',
              fontSize: '0.86rem',
              borderLeft: '3px solid var(--accent-primary)',
            }}
          >
            <strong>OpenAI:</strong> use <code style={{ color: 'var(--text-accent)' }}>https://api.openai.com/v1</code> with models like <code style={{ color: 'var(--text-accent)' }}>gpt-4.1-nano</code>.<br />
            <strong>Claude:</strong> use <code style={{ color: 'var(--text-accent)' }}>https://api.anthropic.com/v1</code> with models like <code style={{ color: 'var(--text-accent)' }}>claude-3-5-haiku-latest</code>.
          </div>

          <div style={{ display: 'grid', gap: '1rem', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
            <div>
              <label className="form-label">
                API Key
                {agentHasKey && !agentApiKey && (
                  <span className="chip" style={{ marginLeft: '0.5rem', fontSize: '0.7rem' }}>
                    ✓ saved
                  </span>
                )}
              </label>
              <input
                className="form-input"
                type="password"
                value={agentApiKey}
                onChange={(e) => setAgentApiKey(e.target.value)}
                placeholder={agentHasKey ? 'Leave blank to keep current key' : (AGENT_PROVIDER_PRESETS[selectedPreset]?.keyHint || 'API key')}
              />
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={handleTestConnection}
                disabled={testingConnection}
                style={{ marginTop: '0.5rem' }}
              >
                {testingConnection ? 'Testing...' : '🔌 Test Connection'}
              </button>
            </div>
          </div>

          <div className="divider" />

          <div style={{ display: 'grid', gap: '1rem', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
            <div>
              <label className="form-label">Timeout (seconds)</label>
              <input
                className="form-input"
                type="number"
                min="1"
                max="300"
                value={agentTimeoutSeconds}
                onChange={(e) => setAgentTimeoutSeconds(parseInt(e.target.value, 10) || 45)}
              />
            </div>
            <div>
              <label className="form-label">Max Questions Per Call</label>
              <input
                className="form-input"
                type="number"
                min="1"
                max="100"
                value={agentMaxQuestionsPerCall}
                onChange={(e) => setAgentMaxQuestionsPerCall(parseInt(e.target.value, 10) || 20)}
              />
              <div style={{ color: 'var(--text-muted)', fontSize: '0.82rem', marginTop: '0.3rem' }}>
                Questions are batched into chunks of this size for each LLM call.
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Save Button ───────────────────────────────── */}
      <div style={{ textAlign: 'center', marginTop: '1.5rem' }}>
        <button
          className="btn btn-primary btn-lg"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? 'Saving...' : 'Save Settings'}
        </button>
      </div>
    </div>
  );
}
