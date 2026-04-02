'use client';

export default function Toast({ toast }) {
  if (!toast) return null;
  return (
    <div className="toast-container" role="status" aria-live="polite">
      <div className={`toast toast-${toast.type}`}>{toast.message}</div>
    </div>
  );
}
