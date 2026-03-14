'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { troubleshootDocument } from '@/lib/api';

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

export default function TroubleshootPage() {
    const [file, setFile] = useState(null);
    const [dragover, setDragover] = useState(false);
    const [analyzing, setAnalyzing] = useState(false);
    const [result, setResult] = useState(null);
    const [toast, setToast] = useState(null);

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

    const validateAndSetFile = (candidate) => {
        if (!candidate) return;
        const ext = candidate.name.split('.').pop().toLowerCase();
        if (!['docx', 'pdf'].includes(ext)) {
            showToast('Only .docx and .pdf files are supported for troubleshooting.', 'error');
            return;
        }
        setFile(candidate);
        setResult(null);
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
        setAnalyzing(true);
        try {
            const data = await troubleshootDocument(file);
            setResult(data);
            showToast('Diagnostics complete. Review the recommended parser below.', 'success');
        } catch (err) {
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
                    was extracted, and recommend the best retry path. This tool is deterministic and uses the same
                    parser stack as normal uploads.
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
                    accept=".docx,.pdf"
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
                        : 'Supports .docx and .pdf files'}
                </div>
            </div>

            {file && !analyzing && (
                <div style={{ textAlign: 'center', marginTop: '1.5rem' }}>
                    <button className="btn btn-primary btn-lg" onClick={handleAnalyze}>
                        Analyze Document
                    </button>
                </div>
            )}

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
        </div>
    );
}
