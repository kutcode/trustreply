'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { getSettings, troubleshootDocument } from '@/lib/api';

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

export default function TroubleshootPage() {
    const [file, setFile] = useState(null);
    const [dragover, setDragover] = useState(false);
    const [analyzing, setAnalyzing] = useState(false);
    const [result, setResult] = useState(null);
    const [agentAvailable, setAgentAvailable] = useState(false);
    const [analyzeWithAgent, setAnalyzeWithAgent] = useState(false);
    const [agentInstructions, setAgentInstructions] = useState('');
    const [thinkingLines, setThinkingLines] = useState([]);
    const [toast, setToast] = useState(null);
    const thinkingTickerRef = useRef(null);

    const recommendedProfile = useMemo(() => {
        if (!result?.recommended_profile) return null;
        return result.profiles.find((profile) => profile.profile_name === result.recommended_profile) || null;
    }, [result]);

    const profilesWithQuestions = result?.profiles.filter((profile) => profile.question_count > 0).length || 0;
    const bestQuestionCount = recommendedProfile?.question_count || 0;

    const showToast = (message, type = 'info') => {
        setToast({ message, type });
        setTimeout(() => setToast(null), 4000);
    };

    useEffect(() => {
        getSettings()
            .then((data) => {
                setAgentAvailable(Boolean(data.agent_available));
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
        if (result?.agent_analysis?.status === 'skipped') {
            return 'Agent diagnostics skipped. Configure AI provider in Settings to run model-level troubleshooting.';
        }
        return 'No AI troubleshooting logs yet. Analyze a file to view model thinking.';
    }, [thinkingLines, result]);

    const validateAndSetFile = (candidate) => {
        if (!candidate) return;
        const ext = candidate.name.split('.').pop().toLowerCase();
        if (!['docx', 'pdf', 'csv'].includes(ext)) {
            showToast('Only .docx, .pdf, and .csv files are supported for troubleshooting.', 'error');
            return;
        }
        setFile(candidate);
        setResult(null);
        setThinkingLines([]);
    };

    const handleFileChange = (e) => {
        validateAndSetFile(e.target.files?.[0]);
    };

    const handleDragOver = (e) => {
        e.preventDefault();
        setDragover(true);
    };

    const handleDragLeave = () => setDragover(false);

    const handleDrop = (e) => {
        e.preventDefault();
        setDragover(false);
        validateAndSetFile(e.dataTransfer.files?.[0]);
    };

    const handleAnalyze = async () => {
        if (!file) return;
        if (thinkingTickerRef.current) {
            clearInterval(thinkingTickerRef.current);
            thinkingTickerRef.current = null;
        }
        setAnalyzing(true);
        const startedAt = new Date().toISOString();
        setThinkingLines([
            formatThinkingLine({ timestamp: startedAt, step: 'analysis', status: 'running', message: `Queued diagnostics for ${file.name}` }),
            formatThinkingLine({ timestamp: startedAt, step: 'analysis', status: 'running', message: 'Loading document and parser profiles.' }),
        ]);

        const pulseMessages = analyzeWithAgent
            ? [
                'Comparing parser profile extraction quality.',
                'Running agent diagnostics for likely root causes.',
                'Compiling remediation guidance.',
            ]
            : [
                'Comparing parser profile extraction quality.',
                'Scoring profile confidence and coverage.',
            ];
        let pulseIndex = 0;
        thinkingTickerRef.current = setInterval(() => {
            const now = new Date().toISOString();
            const message = pulseMessages[pulseIndex % pulseMessages.length];
            pulseIndex += 1;
            setThinkingLines((prev) => [
                ...prev.slice(-140),
                formatThinkingLine({ timestamp: now, step: 'analysis', status: 'running', message }),
            ]);
        }, 1300);

        try {
            const data = await troubleshootDocument(file, {
                analyzeWithAgent,
                agentInstructions,
            });
            if (thinkingTickerRef.current) {
                clearInterval(thinkingTickerRef.current);
                thinkingTickerRef.current = null;
            }
            setResult(data);
            setThinkingLines((prev) => {
                const lines = [...prev];
                const now = new Date().toISOString();
                lines.push(formatThinkingLine({ timestamp: now, step: 'analysis', status: 'completed', message: 'Parser diagnostics completed.' }));
                if (data.agent_analysis && Array.isArray(data.agent_analysis.trace) && data.agent_analysis.trace.length > 0) {
                    for (const event of data.agent_analysis.trace) {
                        lines.push(formatThinkingLine(event));
                    }
                } else if (data.agent_analysis?.summary) {
                    lines.push(formatThinkingLine({ timestamp: now, step: 'agent', status: data.agent_analysis.status || 'info', message: data.agent_analysis.summary }));
                }
                return lines.slice(-200);
            });
            showToast('Diagnostics complete. Review the recommended parser below.', 'success');
        } catch (err) {
            if (thinkingTickerRef.current) {
                clearInterval(thinkingTickerRef.current);
                thinkingTickerRef.current = null;
            }
            const now = new Date().toISOString();
            setThinkingLines((prev) => [
                ...prev.slice(-140),
                formatThinkingLine({ timestamp: now, step: 'analysis', status: 'error', message: err.message || 'Troubleshooting failed.' }),
            ]);
            showToast(err.message || 'Troubleshooting failed', 'error');
        } finally {
            setAnalyzing(false);
        }
    };

    return (
        <div className="page-container">
            {toast && (
                <div className="toast-container">
                    <div className={`toast toast-${toast.type}`}>{toast.message}</div>
                </div>
            )}

            <div className="page-header">
                <h1>Troubleshooting</h1>
                <p>
                    Drop in a problematic questionnaire and we&apos;ll run it through each parser profile, show what
                    was extracted, and recommend the best retry path. Base diagnostics are deterministic and use the
                    same parser stack as normal uploads, and you can optionally run AI troubleshooting for deeper analysis.
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
                    onChange={handleFileChange}
                    id="troubleshoot-file-upload"
                />
                <span className="upload-zone-icon">🛠️</span>
                <div className="upload-zone-title">
                    {file ? file.name : 'Drop a document that is parsing incorrectly'}
                </div>
                <div className="upload-zone-subtitle">
                    {file
                        ? `${(file.size / 1024).toFixed(1)} KB — Ready for diagnostics`
                        : 'Supports .docx, .pdf, and .csv files'}
                </div>
            </div>

            {file && !analyzing && (
                <div style={{ textAlign: 'center', marginTop: '1.5rem' }}>
                    <button className="btn btn-primary btn-lg" onClick={handleAnalyze}>
                        Analyze Document
                    </button>
                </div>
            )}

            <div className="card" style={{ marginTop: '1rem' }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.8rem', alignItems: 'center', justifyContent: 'space-between' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                        <input
                            type="checkbox"
                            checked={analyzeWithAgent}
                            onChange={(e) => setAnalyzeWithAgent(e.target.checked)}
                        />
                        Run agent diagnostics
                    </label>
                    {!agentAvailable && analyzeWithAgent && (
                        <span style={{ color: 'var(--warning)', fontSize: '0.82rem' }}>
                            Agent not configured.{' '}
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
                            to set up your AI provider.
                        </span>
                    )}
                </div>
                {analyzeWithAgent && (
                    <div style={{ marginTop: '0.9rem' }}>
                        <label className="form-label">Agent Troubleshooting Notes (Optional)</label>
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
                    <div style={{ fontWeight: 700, marginBottom: '0.4rem' }}>Running parser diagnostics</div>
                    <div style={{ color: 'var(--text-secondary)' }}>
                        Comparing this file against all parser profiles and building an extraction preview.
                    </div>
                </div>
            )}

            {result && (
                <>
                    <div className="card" style={{ marginTop: '2rem' }}>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                            <div style={{ flex: '1 1 340px' }}>
                                <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '0.35rem' }}>
                                    Diagnostic Summary
                                </div>
                                <h3 style={{ fontSize: '1.15rem', marginBottom: '0.5rem' }}>{result.filename}</h3>
                                <div style={{ color: 'var(--text-secondary)', marginBottom: '0.85rem' }}>
                                    {result.recommendation_reason}
                                </div>
                                {result.recommended_profile && (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                                        <span className="status-badge status-done">Recommended</span>
                                        <span style={{ fontWeight: 600 }}>
                                            {result.recommended_profile_label} <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>({result.recommended_profile})</span>
                                        </span>
                                    </div>
                                )}
                            </div>
                            <div style={{ flex: '1 1 260px' }}>
                                <div className="stats-grid" style={{ marginBottom: '0.9rem' }}>
                                    <div className="stat-card">
                                        <div className="stat-value">{result.profiles.length}</div>
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

                        {result.hints.length > 0 && (
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
                                    {result.hints.map((hint) => (
                                        <div key={hint}>• {hint}</div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>

                    {result.agent_analysis && (
                        <div className="card" style={{ marginTop: '1rem' }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', marginBottom: '0.6rem' }}>
                                <div style={{ fontWeight: 700 }}>Agent Troubleshooting</div>
                                <span className={`status-badge ${
                                    result.agent_analysis.status === 'error'
                                        ? 'status-error'
                                        : result.agent_analysis.status === 'completed'
                                            ? 'status-done'
                                            : 'status-pending'
                                }`}>
                                    {result.agent_analysis.status || 'unknown'}
                                </span>
                            </div>
                            {result.agent_analysis.summary && (
                                <div style={{ marginBottom: '0.7rem', color: 'var(--text-secondary)' }}>
                                    {result.agent_analysis.summary}
                                </div>
                            )}
                            {Array.isArray(result.agent_analysis.root_causes) && result.agent_analysis.root_causes.length > 0 && (
                                <div style={{ marginBottom: '0.7rem' }}>
                                    <div style={{ fontWeight: 700, marginBottom: '0.35rem' }}>Likely root causes</div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', color: 'var(--text-secondary)' }}>
                                        {result.agent_analysis.root_causes.map((cause, idx) => (
                                            <div key={`cause-${idx}`}>• {cause}</div>
                                        ))}
                                    </div>
                                </div>
                            )}
                            {Array.isArray(result.agent_analysis.next_steps) && result.agent_analysis.next_steps.length > 0 && (
                                <div style={{ marginBottom: '0.7rem' }}>
                                    <div style={{ fontWeight: 700, marginBottom: '0.35rem' }}>Recommended next steps</div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', color: 'var(--text-secondary)' }}>
                                        {result.agent_analysis.next_steps.map((step, idx) => (
                                            <div key={`step-${idx}`}>• {step}</div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1.5rem' }}>
                        {result.profiles.map((profile) => {
                            const isRecommended = profile.profile_name === result.recommended_profile;
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

            <div className="card" style={{ marginTop: '2rem' }}>
                <div style={{ fontWeight: 700, marginBottom: '0.5rem' }}>AI Model Thinking</div>
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
