'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { getSettings, saveSettings, troubleshootDocument } from '@/lib/api';

const FALLBACK_REASON_LABELS = {
    no_questions_found: 'No questions found',
    low_confidence_parse: 'Low confidence parse',
    table_layout_not_understood: 'Table layout not understood',
    parser_error: 'Parser error',
};

function formatPercent(value) {
    return `${Math.round((value || 0) * 100)}%`;
}

function humanizeFallbackReason(reason) {
    if (!reason) return null;
    return FALLBACK_REASON_LABELS[reason] || reason.replaceAll('_', ' ');
}

function formatThinkingLine(event, prefix = '') {
    const timestamp = event?.timestamp || '--';
    const step = event?.step || 'agent';
    const status = event?.status || 'info';
    const message = event?.message || '';
    return `[${timestamp}] ${prefix}${step}:${status} ${message}`.trim();
}

const MAX_FILES = 50;
const ALLOWED_EXTENSIONS = ['docx', 'pdf', 'csv'];

export default function TroubleshootPage() {
    const [files, setFiles] = useState([]);
    const [dragover, setDragover] = useState(false);
    const [analyzing, setAnalyzing] = useState(false);
    const [currentFileIndex, setCurrentFileIndex] = useState(-1);
    const [results, setResults] = useState([]);  // { file, result, error }[]
    const [agentAvailable, setAgentAvailable] = useState(false);
    const [analyzeWithAgent, setAnalyzeWithAgent] = useState(false);
    const [agentInstructions, setAgentInstructions] = useState('');
    const [defaultParserProfile, setDefaultParserProfile] = useState('default');
    const [applyingFix, setApplyingFix] = useState(false);
    const [thinkingLines, setThinkingLines] = useState([]);
    const [toast, setToast] = useState(null);
    const [expandedIndex, setExpandedIndex] = useState(null);
    const thinkingTickerRef = useRef(null);

    // Derive single-result helpers for the expanded result
    const expandedResult = expandedIndex !== null ? results[expandedIndex]?.result : null;

    const recommendedProfile = useMemo(() => {
        if (!expandedResult?.recommended_profile) return null;
        return expandedResult.profiles.find((profile) => profile.profile_name === expandedResult.recommended_profile) || null;
    }, [expandedResult]);

    const profilesWithQuestions = expandedResult?.profiles.filter((profile) => profile.question_count > 0).length || 0;
    const bestQuestionCount = recommendedProfile?.question_count || 0;
    const aiFixPlan = expandedResult?.agent_analysis?.fix_plan || null;

    const toastTimeout = useRef(null);
    useEffect(() => {
        return () => {
            if (toastTimeout.current) clearTimeout(toastTimeout.current);
        };
    }, []);
    const showToast = (msg, type = 'info') => {
        if (toastTimeout.current) clearTimeout(toastTimeout.current);
        setToast({ message: msg, type });
        toastTimeout.current = setTimeout(() => setToast(null), 4000);
    };

    useEffect(() => {
        getSettings()
            .then((data) => {
                const available = Boolean(data.agent_available);
                setAgentAvailable(available);
                setAnalyzeWithAgent(available);
                setDefaultParserProfile(data.default_parser_profile || 'default');
            })
            .catch(() => { });
    }, []);

    useEffect(() => () => {
        if (thinkingTickerRef.current) {
            clearInterval(thinkingTickerRef.current);
            thinkingTickerRef.current = null;
        }
    }, []);

    const thinkingText = useMemo(() => {
        if (thinkingLines.length > 0) {
            return thinkingLines.join('\n');
        }
        const lastResult = results.length > 0 ? results[results.length - 1]?.result : null;
        if (lastResult?.agent_analysis?.status === 'skipped') {
            return 'Advanced diagnostics skipped. Configure provider in Settings to run deep troubleshooting.';
        }
        return 'No troubleshooting logs yet. Analyze a file to view diagnostics.';
    }, [thinkingLines, results]);

    const validateAndSetFiles = (candidates) => {
        if (!candidates || candidates.length === 0) return;
        const valid = [];
        let rejected = 0;
        for (const candidate of candidates) {
            const ext = candidate.name.split('.').pop().toLowerCase();
            if (!ALLOWED_EXTENSIONS.includes(ext)) {
                rejected++;
                continue;
            }
            valid.push(candidate);
        }
        if (valid.length === 0) {
            showToast('Only .docx, .pdf, and .csv files are supported for troubleshooting.', 'error');
            return;
        }
        if (valid.length > MAX_FILES) {
            showToast(`Maximum ${MAX_FILES} files allowed. Only the first ${MAX_FILES} will be used.`, 'info');
            valid.length = MAX_FILES;
        }
        if (rejected > 0) {
            showToast(`${rejected} unsupported file(s) skipped.`, 'info');
        }
        setFiles(valid);
        setResults([]);
        setExpandedIndex(null);
        setThinkingLines([]);
    };

    const handleFileChange = (e) => {
        validateAndSetFiles(Array.from(e.target.files || []));
    };

    const handleDragOver = (e) => {
        e.preventDefault();
        setDragover(true);
    };

    const handleDragLeave = () => setDragover(false);

    const handleDrop = (e) => {
        e.preventDefault();
        setDragover(false);
        validateAndSetFiles(Array.from(e.dataTransfer.files || []));
    };

    const handleAnalyze = async () => {
        if (files.length === 0) return;
        if (thinkingTickerRef.current) {
            clearInterval(thinkingTickerRef.current);
            thinkingTickerRef.current = null;
        }
        setAnalyzing(true);
        setResults([]);
        setExpandedIndex(null);
        const startedAt = new Date().toISOString();
        setThinkingLines([
            formatThinkingLine({ timestamp: startedAt, step: 'analysis', status: 'running', message: `Queued diagnostics for ${files.length} file(s)` }),
        ]);

        const allResults = [];

        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            setCurrentFileIndex(i);
            const now1 = new Date().toISOString();
            setThinkingLines((prev) => [
                ...prev.slice(-180),
                formatThinkingLine({ timestamp: now1, step: 'analysis', status: 'running', message: `[${i + 1}/${files.length}] Analyzing ${file.name}` }),
            ]);

            try {
                const data = await troubleshootDocument(file, {
                    analyzeWithAgent,
                    agentInstructions,
                });
                allResults.push({ file, result: data, error: null });
                setResults([...allResults]);
                const now2 = new Date().toISOString();
                setThinkingLines((prev) => {
                    const lines = [...prev.slice(-180)];
                    lines.push(formatThinkingLine({ timestamp: now2, step: 'analysis', status: 'completed', message: `[${i + 1}/${files.length}] ${file.name} — ${data.recommended_profile || 'no recommendation'}` }));
                    if (data.agent_analysis && Array.isArray(data.agent_analysis.trace) && data.agent_analysis.trace.length > 0) {
                        for (const event of data.agent_analysis.trace) {
                            lines.push(formatThinkingLine(event, `[${file.name}] `));
                        }
                    }
                    return lines.slice(-200);
                });
            } catch (err) {
                allResults.push({ file, result: null, error: err.message || 'Troubleshooting failed' });
                setResults([...allResults]);
                const now2 = new Date().toISOString();
                setThinkingLines((prev) => [
                    ...prev.slice(-180),
                    formatThinkingLine({ timestamp: now2, step: 'analysis', status: 'error', message: `[${i + 1}/${files.length}] ${file.name}: ${err.message || 'Failed'}` }),
                ]);
            }
        }

        setCurrentFileIndex(-1);
        setAnalyzing(false);
        const successCount = allResults.filter((r) => r.result).length;
        const failCount = allResults.filter((r) => r.error).length;
        if (allResults.length === 1 && successCount === 1) {
            setExpandedIndex(0);
        }
        showToast(
            `Diagnostics complete: ${successCount} succeeded${failCount > 0 ? `, ${failCount} failed` : ''}.`,
            failCount > 0 ? 'info' : 'success',
        );
    };

    const handleApplyFix = async () => {
        const parserProfile = aiFixPlan?.parser_profile;
        if (!parserProfile) return;

        setApplyingFix(true);
        try {
            const updates = { default_parser_profile: parserProfile };
            // Also apply parser_hints from the agent (column indices, header rows, etc.)
            const hints = aiFixPlan?.parser_hints;
            if (hints && typeof hints === 'object' && Object.keys(hints).length > 0) {
                updates.parser_hint_overrides = hints;
            } else {
                // Clear any previous overrides when switching profile without hints
                updates.parser_hint_overrides = {};
            }
            await saveSettings(updates);
            setDefaultParserProfile(parserProfile);
            const hintKeys = hints ? Object.keys(hints).filter((k) => hints[k] !== null && hints[k] !== undefined) : [];
            const hintMsg = hintKeys.length > 0 ? ` + ${hintKeys.length} parser hint(s)` : '';
            showToast(`Applied '${parserProfile}' as the default parser profile${hintMsg}.`, 'success');
        } catch (err) {
            showToast(err.message || 'Failed to apply parser fix.', 'error');
        } finally {
            setApplyingFix(false);
        }
    };

    return (
        <div className="page-container">
            {toast && (
                <div className="toast-container" role="status" aria-live="polite">
                    <div className={`toast toast-${toast.type}`}>{toast.message}</div>
                </div>
            )}

            <div className="page-header">
                <h1>Troubleshooting</h1>
                <p>
                    Drop in a problematic questionnaire and we&apos;ll run it through each parser profile, show what
                    was extracted, and recommend the best retry path. Base diagnostics are deterministic and use the
                    same parser stack as normal uploads, and advanced diagnostics can propose a system-level fix.
                </p>
            </div>

            <div
                className={`upload-zone ${dragover ? 'dragover' : ''}`}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
            >
                <input
                    type="file"
                    accept=".docx,.pdf,.csv"
                    multiple
                    onChange={handleFileChange}
                    id="troubleshoot-file-upload"
                />
                <span className="upload-zone-icon">🛠️</span>
                <div className="upload-zone-title">
                    {files.length > 1
                        ? `${files.length} documents selected`
                        : files.length === 1
                            ? files[0].name
                            : 'Drop documents that are parsing incorrectly'}
                </div>
                <div className="upload-zone-subtitle">
                    {files.length > 0
                        ? `${files.map((f) => (f.size / 1024).toFixed(1)).join(' + ')} KB — Ready for diagnostics`
                        : `Supports .docx, .pdf, and .csv — up to ${MAX_FILES} files`}
                </div>
            </div>

            {files.length > 0 && !analyzing && (
                <div style={{ textAlign: 'center', marginTop: '1.5rem' }}>
                    <button className="btn btn-primary btn-lg" onClick={handleAnalyze}>
                        {files.length === 1 ? 'Analyze Document' : `Analyze ${files.length} Documents`}
                    </button>
                </div>
            )}

            <div className="card" style={{ marginTop: '1rem' }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.8rem', alignItems: 'center', justifyContent: 'space-between' }}>
                    <label className="toggle-switch">
                        <input
                            type="checkbox"
                            checked={analyzeWithAgent}
                            onChange={(e) => setAnalyzeWithAgent(e.target.checked)}
                        />
                        <span className="toggle-track" />
                        <span className="toggle-label">Run advanced diagnostics</span>
                    </label>
                    {!agentAvailable && analyzeWithAgent && (
                        <span style={{ color: 'var(--warning)', fontSize: '0.82rem' }}>
                            Provider not configured.{' '}
                            <Link
                                href="/settings"
                                style={{
                                    color: 'var(--warning)',
                                    textDecoration: 'underline',
                                    textUnderlineOffset: '0.15rem',
                                }}
                            >
                                Go to Settings
                            </Link>{' '}
                            to set up your provider.
                        </span>
                    )}
                </div>
                {analyzeWithAgent && (
                    <div style={{ marginTop: '0.9rem' }}>
                        <label className="form-label">Troubleshooting Notes (Optional)</label>
                        <textarea
                            className="form-textarea"
                            rows={3}
                            value={agentInstructions}
                            onChange={(e) => setAgentInstructions(e.target.value)}
                            placeholder="Example: focus on why valid questions are being missed and suggest safe defaults."
                        />
                    </div>
                )}
            </div>

            {analyzing && (
                <div className="card" style={{ marginTop: '1.5rem' }}>
                    <div style={{ fontWeight: 700, marginBottom: '0.4rem' }}>
                        Running parser diagnostics {currentFileIndex >= 0 && `(${currentFileIndex + 1}/${files.length})`}
                    </div>
                    <div style={{ color: 'var(--text-secondary)' }}>
                        {currentFileIndex >= 0 && files[currentFileIndex]
                            ? `Analyzing ${files[currentFileIndex].name}...`
                            : 'Comparing files against all parser profiles and building extraction previews.'}
                    </div>
                    {files.length > 1 && (
                        <div style={{ marginTop: '0.6rem', background: 'var(--bg-input)', borderRadius: '4px', height: '6px', overflow: 'hidden' }}>
                            <div style={{ height: '100%', width: `${((currentFileIndex + 1) / files.length) * 100}%`, background: 'var(--accent-primary)', transition: 'width 0.3s ease' }} />
                        </div>
                    )}
                </div>
            )}

            {/* Results summary list */}
            {results.length > 0 && (
                <div style={{ marginTop: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    <div style={{ fontWeight: 700, fontSize: '1.05rem', marginBottom: '0.25rem' }}>
                        Results ({results.filter((r) => r.result).length}/{results.length} succeeded)
                    </div>
                    {results.map((entry, idx) => (
                        <div
                            key={idx}
                            className="card"
                            onClick={() => entry.result && setExpandedIndex(expandedIndex === idx ? null : idx)}
                            style={{
                                cursor: entry.result ? 'pointer' : 'default',
                                padding: '0.75rem 1rem',
                                borderColor: expandedIndex === idx ? 'var(--accent-primary)' : undefined,
                                boxShadow: expandedIndex === idx ? '0 0 0 1px var(--accent-glow)' : undefined,
                            }}
                        >
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', minWidth: 0 }}>
                                    <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)', flexShrink: 0 }}>{idx + 1}.</span>
                                    <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.file.name}</span>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexShrink: 0 }}>
                                    {entry.result ? (
                                        <>
                                            <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                                                {entry.result.recommended_profile || 'No recommendation'}
                                            </span>
                                            <span className="status-badge status-done">Done</span>
                                        </>
                                    ) : (
                                        <>
                                            <span style={{ fontSize: '0.85rem', color: 'var(--error)' }}>{entry.error}</span>
                                            <span className="status-badge status-error">Error</span>
                                        </>
                                    )}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Expanded detail for selected result */}
            {expandedResult && (
                <>
                    <div className="card" style={{ marginTop: '1rem' }}>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                            <div style={{ flex: '1 1 340px' }}>
                                <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '0.35rem' }}>
                                    Diagnostic Summary
                                </div>
                                <h3 style={{ fontSize: '1.15rem', marginBottom: '0.5rem' }}>{expandedResult.filename}</h3>
                                <div style={{ color: 'var(--text-secondary)', marginBottom: '0.85rem' }}>
                                    {expandedResult.recommendation_reason}
                                </div>
                                {expandedResult.recommended_profile && (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                                        <span className="status-badge status-done">Recommended</span>
                                        <span style={{ fontWeight: 600 }}>
                                            {expandedResult.recommended_profile_label} <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>({expandedResult.recommended_profile})</span>
                                        </span>
                                    </div>
                                )}
                            </div>
                            <div style={{ flex: '1 1 260px' }}>
                                <div className="stats-grid" style={{ marginBottom: '0.9rem' }}>
                                    <div className="stat-card">
                                        <div className="stat-value">{expandedResult.profiles.length}</div>
                                        <div className="stat-label">Profiles Tested</div>
                                    </div>
                                    <div className="stat-card">
                                        <div className="stat-value">{profilesWithQuestions}</div>
                                        <div className="stat-label">Profiles Finding Questions</div>
                                    </div>
                                    <div className="stat-card">
                                        <div className="stat-value">{bestQuestionCount}</div>
                                        <div className="stat-label">Best Question Count</div>
                                    </div>
                                </div>
                                <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                                    <Link href="/" className="btn btn-secondary btn-sm">
                                        Back to Upload
                                    </Link>
                                </div>
                            </div>
                        </div>

                        {expandedResult.hints.length > 0 && (
                            <div
                                style={{
                                    marginTop: '1rem',
                                    padding: '0.9rem 1rem',
                                    borderRadius: 'var(--radius-md)',
                                    background: 'var(--bg-input)',
                                }}
                            >
                                <div style={{ fontWeight: 700, marginBottom: '0.4rem' }}>Suggested next steps</div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem', color: 'var(--text-secondary)' }}>
                                    {expandedResult.hints.map((hint) => (
                                        <div key={hint}>• {hint}</div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>

                    {expandedResult.agent_analysis && (
                        <div className="card" style={{ marginTop: '1rem' }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', marginBottom: '0.6rem' }}>
                                <div style={{ fontWeight: 700 }}>Agent Troubleshooting</div>
                                <span className={`status-badge ${
                                    expandedResult.agent_analysis.status === 'error'
                                        ? 'status-error'
                                        : expandedResult.agent_analysis.status === 'completed'
                                            ? 'status-done'
                                            : 'status-pending'
                                }`}>
                                    {expandedResult.agent_analysis.status || 'unknown'}
                                </span>
                            </div>
                            {expandedResult.agent_analysis.summary && (
                                <div style={{ marginBottom: '0.7rem', color: 'var(--text-secondary)' }}>
                                    {expandedResult.agent_analysis.summary}
                                </div>
                            )}
                            {Array.isArray(expandedResult.agent_analysis.root_causes) && expandedResult.agent_analysis.root_causes.length > 0 && (
                                <div style={{ marginBottom: '0.7rem' }}>
                                    <div style={{ fontWeight: 700, marginBottom: '0.35rem' }}>Likely root causes</div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', color: 'var(--text-secondary)' }}>
                                        {expandedResult.agent_analysis.root_causes.map((cause, idx) => (
                                            <div key={`cause-${idx}`}>• {cause}</div>
                                        ))}
                                    </div>
                                </div>
                            )}
                            {Array.isArray(expandedResult.agent_analysis.next_steps) && expandedResult.agent_analysis.next_steps.length > 0 && (
                                <div style={{ marginBottom: '0.7rem' }}>
                                    <div style={{ fontWeight: 700, marginBottom: '0.35rem' }}>Recommended next steps</div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', color: 'var(--text-secondary)' }}>
                                        {expandedResult.agent_analysis.next_steps.map((step, idx) => (
                                            <div key={`step-${idx}`}>• {step}</div>
                                        ))}
                                    </div>
                                </div>
                            )}
                            {aiFixPlan && (
                                <div
                                    style={{
                                        marginTop: '0.9rem',
                                        padding: '0.85rem 0.9rem',
                                        borderRadius: 'var(--radius-md)',
                                        background: 'var(--bg-input)',
                                    }}
                                >
                                    <div style={{ fontWeight: 700, marginBottom: '0.35rem' }}>Recommended Fix</div>
                                    <div style={{ color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
                                        {aiFixPlan.title || 'Model generated a troubleshooting fix plan.'}
                                    </div>
                                    {aiFixPlan.rationale && (
                                        <div style={{ color: 'var(--text-muted)', marginBottom: '0.55rem', fontSize: '0.88rem' }}>
                                            {aiFixPlan.rationale}
                                        </div>
                                    )}
                                    {Array.isArray(aiFixPlan.steps) && aiFixPlan.steps.length > 0 && (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', marginBottom: '0.65rem', color: 'var(--text-secondary)' }}>
                                            {aiFixPlan.steps.map((step, idx) => (
                                                <div key={`fix-step-${idx}`}>• {step}</div>
                                            ))}
                                        </div>
                                    )}
                                    {aiFixPlan.can_auto_apply && aiFixPlan.parser_profile && (
                                        <div>
                                            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.65rem', marginBottom: '0.5rem' }}>
                                                {aiFixPlan.auto_applied ? (
                                                    <span className="status-badge status-done">Auto-applied</span>
                                                ) : (
                                                    <button
                                                        className="btn btn-primary btn-sm"
                                                        onClick={handleApplyFix}
                                                        disabled={applyingFix}
                                                    >
                                                        {applyingFix ? 'Applying...' : 'Apply fix in system'}
                                                    </button>
                                                )}
                                                <span style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>
                                                    {aiFixPlan.auto_applied
                                                        ? `Parser set to '${aiFixPlan.parser_profile}' automatically.`
                                                        : defaultParserProfile === aiFixPlan.parser_profile
                                                            ? `Default parser is already '${aiFixPlan.parser_profile}'.`
                                                            : `Will set default parser to '${aiFixPlan.parser_profile}'.`}
                                                </span>
                                            </div>
                                            {aiFixPlan.parser_hints && Object.keys(aiFixPlan.parser_hints).length > 0 && (
                                                <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                                                    {aiFixPlan.auto_applied ? 'Applied hints' : 'Also applies'}: {Object.entries(aiFixPlan.parser_hints).map(([k, v]) =>
                                                        `${k.replaceAll('_', ' ')}=${String(v)}`
                                                    ).join(', ')}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    )}

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1.5rem' }}>
                        {expandedResult.profiles.map((profile) => {
                            const isRecommended = profile.profile_name === expandedResult.recommended_profile;
                            const hasQuestions = profile.question_count > 0;
                            const toneClass = profile.error_message
                                ? 'status-error'
                                : isRecommended
                                    ? 'status-done'
                                    : hasQuestions
                                        ? 'status-processing'
                                        : 'status-pending';

                            return (
                                <div
                                    key={profile.profile_name}
                                    className="card"
                                    style={{
                                        borderColor: isRecommended ? 'rgba(16, 185, 129, 0.45)' : undefined,
                                        boxShadow: isRecommended ? '0 0 0 1px rgba(16, 185, 129, 0.2)' : undefined,
                                    }}
                                >
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.9rem' }}>
                                        <div>
                                            <div style={{ fontWeight: 700, marginBottom: '0.15rem' }}>{profile.profile_label}</div>
                                            <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                                                Profile id: {profile.profile_name}
                                            </div>
                                        </div>
                                        <span className={`status-badge ${toneClass}`}>
                                            {profile.error_message
                                                ? 'Error'
                                                : isRecommended
                                                    ? 'Recommended'
                                                    : hasQuestions
                                                        ? 'Questions Found'
                                                        : 'No Questions'}
                                        </span>
                                    </div>

                                    <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: '0.9rem', color: 'var(--text-secondary)', fontSize: '0.92rem' }}>
                                        <div><strong style={{ color: 'var(--text-primary)' }}>{profile.question_count}</strong> questions</div>
                                        <div><strong style={{ color: 'var(--text-primary)' }}>{formatPercent(profile.confidence)}</strong> confidence</div>
                                        <div>
                                            <strong style={{ color: 'var(--text-primary)' }}>
                                                {profile.stats.table_rows_scanned || profile.stats.pdf_table_rows_scanned || 0}
                                            </strong>{' '}
                                            table rows scanned
                                        </div>
                                    </div>

                                    {profile.error_message ? (
                                        <div
                                            style={{
                                                padding: '0.8rem 0.9rem',
                                                borderRadius: 'var(--radius-md)',
                                                background: 'var(--error-bg)',
                                                color: 'var(--error)',
                                            }}
                                        >
                                            {profile.error_message}
                                        </div>
                                    ) : (
                                        <>
                                            {profile.fallback_reason && (
                                                <div
                                                    style={{
                                                        marginBottom: '0.9rem',
                                                        padding: '0.75rem 0.9rem',
                                                        borderRadius: 'var(--radius-md)',
                                                        background: profile.fallback_recommended ? 'var(--warning-bg)' : 'var(--bg-input)',
                                                        color: profile.fallback_recommended ? 'var(--warning)' : 'var(--text-secondary)',
                                                    }}
                                                >
                                                    {profile.fallback_recommended ? 'Fallback suggested' : 'Parser note'}: {humanizeFallbackReason(profile.fallback_reason)}
                                                </div>
                                            )}

                                            {profile.sample_questions.length > 0 ? (
                                                <div>
                                                    <div style={{ fontWeight: 700, marginBottom: '0.5rem' }}>Extracted question preview</div>
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                                        {profile.sample_questions.map((question) => (
                                                            <div
                                                                key={`${profile.profile_name}-${question}`}
                                                                style={{
                                                                    padding: '0.75rem 0.9rem',
                                                                    borderRadius: 'var(--radius-md)',
                                                                    background: 'var(--bg-input)',
                                                                    color: 'var(--text-secondary)',
                                                                }}
                                                            >
                                                                {question}
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            ) : (
                                                <div style={{ color: 'var(--text-muted)' }}>
                                                    No question preview available for this profile.
                                                </div>
                                            )}
                                        </>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </>
            )}

            <div className="card card-accent-left" style={{ marginTop: '2rem' }}>
                <div className="section-header" style={{ marginBottom: '0.75rem', paddingBottom: '0.6rem' }}>
                    <div className="section-header-icon">💭</div>
                    <h2>Processing Log</h2>
                </div>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.84rem', marginBottom: '0.6rem' }}>
                    Live analysis log while troubleshooting runs.
                </div>
                <textarea
                    className="form-textarea"
                    readOnly
                    value={thinkingText}
                    rows={12}
                    style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: '0.78rem',
                        lineHeight: 1.45,
                        whiteSpace: 'pre',
                    }}
                />
            </div>
        </div>
    );
}
