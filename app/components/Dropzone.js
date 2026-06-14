"use client";

import { useState, useRef, useCallback } from "react";
import { UploadCloud } from "lucide-react";

export default function Dropzone({
  onFilesAdded,
  onFiles,
  accept = ".pdf",
  multiple = true,
  label = "Drop your PDF files here",
  sublabel = "or click to browse",
}) {
  const handleFiles = onFilesAdded || onFiles;
  const [isDragOver, setIsDragOver] = useState(false);
  const inputRef = useRef(null);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e) => {
      e.preventDefault();
      setIsDragOver(false);
      const files = Array.from(e.dataTransfer.files);
      if (files.length > 0) handleFiles(files);
    },
    [handleFiles]
  );

  const handleChange = useCallback(
    (e) => {
      const files = Array.from(e.target.files);
      if (files.length > 0) handleFiles(files);
      e.target.value = "";
    },
    [handleFiles]
  );

  return (
    <div
      className={`dropzone ${isDragOver ? "drag-over" : ""}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
      id="file-dropzone"
    >
      <div className="dropzone-icon">
        <UploadCloud size={48} strokeWidth={1.5} />
      </div>
      <h3>{label}</h3>
      <p>{sublabel}</p>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        onChange={handleChange}
        style={{ display: "none" }}
      />
    </div>
  );
}
