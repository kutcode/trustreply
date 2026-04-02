'use client';

export default function LoadingSkeleton({ lines = 5, showHeader = false }) {
  return (
    <div className="card" style={{ padding: '1.5rem' }}>
      {showHeader && <div className="skeleton-line skeleton-header" />}
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className="skeleton-line" />
      ))}
    </div>
  );
}
