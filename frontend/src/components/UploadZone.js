'use client';

import { useState } from 'react';

export default function UploadZone({ selectedFiles, maxBulkFiles, onFilesSelected }) {
  const [dragover, setDragover] = useState(false);

  const handleDragOver = (e) => {
    e.preventDefault();
    setDragover(true);
  };

  const handleDragLeave = () => setDragover(false);

  const handleDrop = (e) => {
    e.preventDefault();
    setDragover(false);
    onFilesSelected(e.dataTransfer.files);
  };

  const handleFileChange = (e) => {
    onFilesSelected(e.target.files);
    e.target.value = '';
  };

  return (
    <>
      <div
        className={`upload-zone ${dragover ? 'dragover' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <input
          type="file"
          accept=".docx,.pdf,.xlsx,.xls,.csv"
          multiple
          onChange={handleFileChange}
          id="file-upload"
          aria-label="Upload questionnaire files"
        />
        <span className="upload-zone-icon">📁</span>
        <div className="upload-zone-title">
          {selectedFiles.length === 0
            ? 'Drop your questionnaire files here'
            : selectedFiles.length === 1
              ? selectedFiles[0].name
              : `${selectedFiles.length} files selected`}
        </div>
        <div className="upload-zone-subtitle">
          {selectedFiles.length === 0
            ? `Supports .docx, .pdf, .xlsx, and .csv files. You can drop multiple files at once, up to ${maxBulkFiles} per batch.`
            : `${(selectedFiles.reduce((total, file) => total + file.size, 0) / 1024).toFixed(1)} KB total`}
        </div>
      </div>

      {selectedFiles.length > 0 && (
        <div className="card" style={{ marginTop: '1rem' }}>
          <div style={{ fontWeight: 700, marginBottom: '0.75rem' }}>
            Ready to upload {selectedFiles.length} {selectedFiles.length === 1 ? 'document' : 'documents'}
          </div>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '0.75rem' }}>
            Site limit: up to {maxBulkFiles} files per batch.
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
            {selectedFiles.slice(0, 6).map((selectedFile) => (
              <div key={`${selectedFile.name}-${selectedFile.size}`}>{selectedFile.name}</div>
            ))}
            {selectedFiles.length > 6 && (
              <div style={{ color: 'var(--text-muted)' }}>
                And {selectedFiles.length - 6} more files...
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
