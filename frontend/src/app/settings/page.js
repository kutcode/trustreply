'use client';

import { useState, useEffect, useCallback } from 'react';
import { getSettings, saveSettings } from '@/lib/api';

const AGENT_PROVIDER_PRESETS = {
  openai: {
    label: 'OpenAI API',
    provider: 'openai',
    apiBase: 'https://api.openai.com/v1',
    model: 'gpt-4.1-nano',
    keyHint: 'Use your OpenAI API key',
  },
  ollama: {
    label: 'Ollama (Local)',
    provider: 'ollama',
    apiBase: 'http://127.0.0.1:11434/v1',
    model: 'qwen2.5:7b',
    keyHint: 'Use local or any placeholder value',
  },
  custom: {
    label: 'Custom OpenAI-Compatible',
    provider: 'custom',
    apiBase: '',
    model: '',
    keyHint: 'Provider key',
  },
};

function detectPreset(provider, apiBase) {
  if (provider === 'ollama' || (apiBase && apiBase.includes('11434'))) return 'ollama';
  if (provider === 'openai' || (apiBase && apiBase.includes('openai.com'))) return 'openai';
  return 'custom';
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
  const [agentDefaultMode, setAgentDefaultMode] = useState('off');
  const [selectedPreset, setSelectedPreset] = useState('openai');
  const [agentProvider, setAgentProvider] = useState('openai');
  const [agentApiBase, setAgentApiBase] = useState('https://api.openai.com/v1');
  const [agentModel, setAgentModel] = useState('gpt-4.1-nano');
  const [agentApiKey, setAgentApiKey] = useState('');
  const [agentHasKey, setAgentHasKey] = useState(false);
  const [agentTimeoutSeconds, setAgentTimeoutSeconds] = useState(45);
  const [agentMaxQuestionsPerCall, setAgentMaxQuestionsPerCall] = useState(20);

  const showToast = useCallback((message, type = 'info') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  }, []);

  useEffect(() => {
    getSettings()
      .then((data) => {
        setSimilarityThreshold(data.similarity_threshold ?? 0.75);
        setDefaultParserProfile(data.default_parser_profile || 'default');
        setParserProfiles(data.parser_profiles || []);
        setAgentEnabled(Boolean(data.agent_enabled));
        setAgentDefaultMode(data.agent_default_mode || 'off');
        setAgentProvider(data.agent_provider || 'openai');
        setAgentApiBase(data.agent_api_base || 'https://api.openai.com/v1');
        setAgentModel(data.agent_model || 'gpt-4.1-nano');
        setAgentHasKey(Boolean(data.agent_has_key));
        setAgentTimeoutSeconds(data.agent_timeout_seconds ?? 45);
        setAgentMaxQuestionsPerCall(data.agent_max_questions_per_call ?? 20);
        setSelectedPreset(detectPreset(data.agent_provider, data.agent_api_base));
      })
      .catch(() => showToast('Failed to load settings', 'error'))
      .finally(() => setLoading(false));
  }, [showToast]);

  const handlePresetChange = (presetName) => {
    const preset = AGENT_PROVIDER_PRESETS[presetName] || AGENT_PROVIDER_PRESETS.custom;
    setSelectedPreset(presetName);
    setAgentProvider(preset.provider);
    setAgentApiBase(preset.apiBase);
    setAgentModel(preset.model);
    if (presetName === 'ollama') {
      setAgentApiKey('local');
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = {
        similarity_threshold: similarityThreshold,
        default_parser_profile: defaultParserProfile,
        agent_enabled: agentEnabled,
        agent_default_mode: agentDefaultMode,
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
      showToast('Settings saved successfully!', 'success');
    } catch (err) {
      showToast(`Failed to save: ${err.message}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="page-container">
        <div className="page-header">
          <h1>Settings</h1>
          <p>Loading...</p>
        </div>
      </div>
    );
  }

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
        <h2 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '1rem' }}>
          Matching Settings
        </h2>
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
        <h2 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '1rem' }}>
          AI Agent Settings
        </h2>

        <div style={{ display: 'grid', gap: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-secondary)', fontSize: '0.95rem' }}>
              <input
                type="checkbox"
                checked={agentEnabled}
                onChange={(e) => setAgentEnabled(e.target.checked)}
              />
              Enable AI Agent
            </label>
            <span style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>
              When enabled, agent modes become available on the Upload page.
            </span>
          </div>

          <div style={{ display: 'grid', gap: '1rem', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
            <div>
              <label className="form-label">Default Agent Mode</label>
              <select
                className="form-select"
                value={agentDefaultMode}
                onChange={(e) => setAgentDefaultMode(e.target.value)}
              >
                <option value="off">Semantic Only</option>
                <option value="agent">Agent</option>
              </select>
            </div>
            <div>
              <label className="form-label">Provider Preset</label>
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
                placeholder="https://api.openai.com/v1"
              />
            </div>
            <div>
              <label className="form-label">Model</label>
              <input
                className="form-input"
                value={agentModel}
                onChange={(e) => setAgentModel(e.target.value)}
                placeholder="gpt-4.1-nano"
              />
            </div>
          </div>

          <div style={{ display: 'grid', gap: '1rem', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
            <div>
              <label className="form-label">
                API Key
                {agentHasKey && !agentApiKey && (
                  <span style={{ color: 'var(--success)', fontWeight: 400, marginLeft: '0.5rem', fontSize: '0.82rem' }}>
                    (saved)
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
            </div>
          </div>

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
