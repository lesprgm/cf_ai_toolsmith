import React, { useState, useCallback } from 'react';

interface DropZoneProps {
  onFileSelect: (file: File) => void;
  isUploading?: boolean;
}

export default function DropZone({ onFileSelect, isUploading = false }: DropZoneProps) {
  const [isDragging, setIsDragging] = useState(false);

  const handleDrag = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDragIn = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    // Type assertion needed due to TypeScript DOM lib configuration
    const dt = e.dataTransfer as any;
    if (dt.items && dt.items.length > 0) {
      setIsDragging(true);
    }
  }, []);

  const handleDragOut = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);

      // Type assertion needed due to TypeScript DOM lib configuration
      const dt = e.dataTransfer as any;
      if (dt.files && dt.files.length > 0) {
        const file = dt.files[0];
        onFileSelect(file);
      }
    },
    [onFileSelect]
  );

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      // Type assertion needed due to TypeScript DOM lib configuration
      const target = e.target as any;
      if (target.files && target.files.length > 0) {
        const file = target.files[0];
        onFileSelect(file);
      }
    },
    [onFileSelect]
  );

  return (
    <div
      className={`relative border-2 border-dashed rounded-lg p-12 text-center transition-all duration-200 ${
        isDragging
          ? 'border-cloudflare-orange bg-orange-100'
          : 'border-slate-300 hover:border-slate-400 bg-white'
      } ${isUploading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
      onDragEnter={handleDragIn}
      onDragLeave={handleDragOut}
      onDragOver={handleDrag}
      onDrop={handleDrop}
    >
      <input
        type="file"
        id="file-upload"
        className="hidden"
        onChange={handleFileInput}
        accept=".yaml,.yml,.json,.xml,.txt,.md"
        disabled={isUploading}
      />

      <label htmlFor="file-upload" className="cursor-pointer">
        <div className="space-y-4">
          {isUploading ? (
            <>
              <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-cloudflare-orange mx-auto"></div>
              <p className="text-lg font-medium text-slate-600">Uploading and parsing...</p>
            </>
          ) : (
            <>
              <svg
                className="mx-auto h-16 w-16 text-slate-400"
                stroke="currentColor"
                fill="none"
                viewBox="0 0 48 48"
                aria-hidden="true"
              >
                <path
                  d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28m0 0l4 4m4-24h8m-4-4v8m-12 4h.02"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <div className="space-y-2">
                <p className="text-xl font-semibold text-slate-900">
                  Drop your specification file here
                </p>
                <p className="text-sm text-slate-600">
                  or click to browse
                </p>
              </div>
              <div className="text-xs text-slate-500">
                Supported formats: OpenAPI, GraphQL, JSON Schema, XML, Markdown, TXT
                <br />
                (YAML, JSON, XML, TXT, MD files · Max 10MB)
              </div>
            </>
          )}
        </div>
      </label>
    </div>
  );
}
