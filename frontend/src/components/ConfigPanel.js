'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';

const AGENT_MODES = [
  {
    name: 'off',
    label: 'Semantic Only',
    description: 'Use only knowledge-base semantic matching.',
  },
  {
    name: 'agent',
    label: 'Agent',
    description: 'Full-analysis mode: handles all answers using document context + KB and flags uncertain fields (no semantic auto-match fallback).',
  },
];

const BUILT_IN_PRESETS = [
  { name: 'Concise Answers', instructions: 'Provide brief, factual answers. Keep responses under 2 sentences.' },
  { name: 'Detailed Explanations', instructions: 'Provide thorough, detailed answers with context and reasoning.' },
  { name: 'Policy-Focused', instructions: 'Answer from a compliance and policy perspective. Reference industry standards where applicable.' },
  { name: 'Technical', instructions: 'Provide technical answers with specific details. Include version numbers and specifications where relevant.' },
];

const PRESETS_STORAGE_KEY = 'trustreply_agent_presets';

function loadCustomPresets() {
  try {
    const raw = typeof window !== 'undefined' ? localStorage.getItem(PRESETS_STORAGE_KEY) : null;
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveCustomPresets(presets) {
  localStorage.setItem(PRESETS_STORAGE_KEY, JSON.stringify(presets));
}

export default function ConfigPanel({
  selectedAgentMode,
  onAgentModeChange,
  agentInstructions,
  onInstructionsChange,
  agentAvailable,
  templatesList,
  selectedTemplateId,
  onTemplateChange,
  showToast,
  openaiHasKey,
  anthropicHasKey,
  openaiModel,
  anthropicModel,
  selectedProvider,
  onProviderChange,
}) {
  const [showPresetMenu, setShowPresetMenu] = useState(false);
  const [customPresets, setCustomPresets] = useState([]);
  const presetMenuRef = useRef(null);

  useEffect(() => {
    setCustomPresets(loadCustomPresets());
  }, []);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (presetMenuRef.current && !presetMenuRef.current.contains(e.target)) {
        setShowPresetMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelectPreset = (instructions) => {
    onInstructionsChange(instructions);
    setShowPresetMenu(false);
  };

  const handleSavePreset = () => {
    const trimmed = agentInstructions.trim();
    if (!trimmed) {
      showToast('Enter instructions first', 'error');
      return;
    }
    const name = prompt('Preset name:');
    if (!name || !name.trim()) return;
    const updated = [...customPresets, { name: name.trim(), instructions: trimmed }];
    setCustomPresets(updated);
    saveCustomPresets(updated);
    showToast('Preset saved', 'success');
    setShowPresetMenu(false);
  };

  const handleDeletePreset = (index) => {
    const updated = customPresets.filter((_, i) => i !== index);
    setCustomPresets(updated);
    saveCustomPresets(updated);
  };

  const agentModeBlocked = selectedAgentMode !== 'off' && !agentAvailable;

  return (
    <>
      {openaiHasKey && anthropicHasKey && onProviderChange && (
        <div className="card" style={{ marginBottom: '1.25rem', padding: '1rem 1.25rem' }}>
          <label className="form-label">MODEL FOR THIS UPLOAD</label>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              className={`btn ${selectedProvider === 'openai' ? 'btn-primary' : 'btn-secondary'} btn-sm`}
              onClick={() => onProviderChange('openai')}
              type="button"
            >
              Provider A — {openaiModel || 'gpt-4.1-nano'}
            </button>
            <button
              className={`btn ${selectedProvider === 'anthropic' ? 'btn-primary' : 'btn-secondary'} btn-sm`}
              onClick={() => onProviderChange('anthropic')}
              type="button"
            >
              Provider B — {anthropicModel || 'claude-sonnet-4-6'}
            </button>
          </div>
        </div>
      )}

      <div className="card" style={{ marginBottom: '1.25rem', padding: '1rem 1.25rem' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'end' }}>
          <div style={{ flex: '1 1 260px' }}>
            <label className="form-label">Answering Mode</label>
            <select
              className="form-select"
              value={selectedAgentMode}
              onChange={(e) => onAgentModeChange(e.target.value)}
            >
              {AGENT_MODES.map((mode) => (
                <option key={mode.name} value={mode.name}>
                  {mode.label}
                </option>
              ))}
            </select>
          </div>
          <div style={{ flex: '2 1 360px', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
            <div>
              {AGENT_MODES.find((mode) => mode.name === selectedAgentMode)?.description}
            </div>
            {selectedAgentMode !== 'off' && (
              <div style={{ marginTop: '0.35rem' }}>
                TrustReply still uses the default parser internally to anchor exact question/answer placement.
              </div>
            )}
          </div>
        </div>

        {selectedAgentMode !== 'off' && (
          <>
            {agentModeBlocked && (
              <div
                style={{
                  marginTop: '0.8rem',
                  padding: '0.7rem 0.9rem',
                  borderRadius: 'var(--radius-md)',
                  background: 'var(--warning-bg)',
                  color: 'var(--warning)',
                  fontSize: '0.88rem',
                }}
              >
                Agent is not configured. Go to{' '}
                <Link href="/settings" style={{ color: 'var(--warning)', textDecoration: 'underline', textUnderlineOffset: '0.15rem' }}>
                  Settings
                </Link>{' '}
                to set up your provider credentials.
              </div>
            )}

            <div style={{ marginTop: '0.9rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.35rem' }}>
                <label className="form-label" style={{ margin: 0 }}>Agent Instructions (Optional)</label>
                <div style={{ position: 'relative' }} ref={presetMenuRef}>
                  <button
                    type="button"
                    className="btn btn-sm btn-secondary"
                    onClick={() => setShowPresetMenu(!showPresetMenu)}
                    aria-expanded={showPresetMenu}
                    aria-haspopup="menu"
                  >
                    Presets ▾
                  </button>
                  {showPresetMenu && (
                    <div className="preset-dropdown" role="menu">
                      {BUILT_IN_PRESETS.map((preset) => (
                        <button key={preset.name} className="preset-dropdown-item" role="menuitem" onClick={() => handleSelectPreset(preset.instructions)}>
                          {preset.name}
                        </button>
                      ))}
                      {customPresets.length > 0 && <div className="preset-dropdown-divider" />}
                      {customPresets.map((preset, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'center' }}>
                          <button className="preset-dropdown-item" role="menuitem" style={{ flex: 1 }} onClick={() => handleSelectPreset(preset.instructions)}>
                            {preset.name}
                          </button>
                          <button className="preset-dropdown-delete" onClick={() => handleDeletePreset(i)} title="Remove preset" aria-label={`Remove preset ${preset.name}`}>
                            &times;
                          </button>
                        </div>
                      ))}
                      <div className="preset-dropdown-divider" />
                      <button className="preset-dropdown-item preset-dropdown-save" role="menuitem" onClick={handleSavePreset}>
                        + Save current as preset
                      </button>
                    </div>
                  )}
                </div>
              </div>
              <textarea
                className="form-textarea"
                rows={3}
                placeholder="Example: prioritize context from this document over generic answers, and flag unknown legal/entity-specific fields."
                value={agentInstructions}
                onChange={(e) => onInstructionsChange(e.target.value)}
              />
            </div>
          </>
        )}
      </div>

      {templatesList.length > 0 && (
        <div className="card" style={{ marginBottom: '1.25rem', padding: '1rem 1.25rem' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'end' }}>
            <div style={{ flex: '1 1 260px' }}>
              <label className="form-label">Pre-fill from Template</label>
              <select
                className="form-select"
                value={selectedTemplateId}
                onChange={(e) => onTemplateChange(e.target.value)}
              >
                <option value="">None (start fresh)</option>
                {templatesList.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.question_count} answers)
                  </option>
                ))}
              </select>
            </div>
            <div style={{ flex: '2 1 360px', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
              Pre-fill answers from a previously saved template before matching runs.
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export { AGENT_MODES, BUILT_IN_PRESETS };
