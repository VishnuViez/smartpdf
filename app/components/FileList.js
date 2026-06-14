"use client";

import { formatFileSize } from "../lib/pdf-utils";
import { FileText, ChevronUp, ChevronDown, X } from "lucide-react";

export default function FileList({ files, onRemove, onReorder }) {
  if (!files || files.length === 0) return null;

  const moveUp = (index) => {
    if (index === 0 || !onReorder) return;
    const newFiles = [...files];
    [newFiles[index - 1], newFiles[index]] = [newFiles[index], newFiles[index - 1]];
    onReorder(newFiles);
  };

  const moveDown = (index) => {
    if (index === files.length - 1 || !onReorder) return;
    const newFiles = [...files];
    [newFiles[index], newFiles[index + 1]] = [newFiles[index + 1], newFiles[index]];
    onReorder(newFiles);
  };

  return (
    <div className="file-list">
      {files.map((file, index) => (
        <div className="file-item" key={`${file.name}-${index}`}>
          <div className="file-item-icon"><FileText size={18} /></div>
          <div className="file-item-info">
            <div className="file-item-name">{file.name}</div>
            <div className="file-item-size">{formatFileSize(file.size)}</div>
          </div>
          {onReorder && files.length > 1 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <button
                className="file-item-remove"
                onClick={() => moveUp(index)}
                disabled={index === 0}
                style={{ fontSize: "0.7rem", opacity: index === 0 ? 0.3 : 1 }}
                title="Move up"
              >
                <ChevronUp size={14} />
              </button>
              <button
                className="file-item-remove"
                onClick={() => moveDown(index)}
                disabled={index === files.length - 1}
                style={{
                  fontSize: "0.7rem",
                  opacity: index === files.length - 1 ? 0.3 : 1,
                }}
                title="Move down"
              >
                <ChevronDown size={14} />
              </button>
            </div>
          )}
          {onRemove && (
            <button
              className="file-item-remove"
              onClick={() => onRemove(index)}
              title="Remove file"
            >
              <X size={16} />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
