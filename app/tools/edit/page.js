"use client";
import { useState, useRef, useEffect, useCallback } from "react";
import Link from "next/link";
import { ArrowLeft, Edit3, CheckCircle, Download, Type, Square, Minus, ChevronLeft, ChevronRight, Trash2, MousePointer } from "lucide-react";
import Header from "../../components/Header";
import Dropzone from "../../components/Dropzone";
import { editPDF, formatFileSize, downloadBlob } from "../../lib/pdf-utils";

const RENDER_SCALE = 1.5;

export default function EditPage() {
  const [file, setFile] = useState(null);
  const [result, setResult] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [loading, setLoading] = useState(false);

  // PDF data
  const [pageImages, setPageImages] = useState([]);
  const [pdfPageSizes, setPdfPageSizes] = useState([]); // actual PDF units (72dpi)
  const [currentPage, setCurrentPage] = useState(0);
  const [totalPages, setTotalPages] = useState(0);

  // Detected text fields from the PDF
  const [detectedFields, setDetectedFields] = useState([]); // [{text, x, y, w, h, pageIndex, fontSize}]

  // User annotations (new text, shapes)
  const [annotations, setAnnotations] = useState([]);
  const [tool, setTool] = useState("select");
  const [selectedId, setSelectedId] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [dragging, setDragging] = useState(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

  const [fontSize, setFontSize] = useState(14);
  const [color, setColor] = useState("#000000");

  const overlayRef = useRef(null);
  const editInputRef = useRef(null);

  // ---- Load PDF, render pages, extract text positions ----
  const handleFiles = useCallback(async (files) => {
    const f = files[0];
    if (!f) return;
    setFile(f);
    setResult(null);
    setAnnotations([]);
    setDetectedFields([]);
    setLoading(true);

    try {
      const pdfjsLib = await import("pdfjs-dist");
      pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

      const arrayBuffer = await f.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

      const images = [];
      const sizes = [];
      const fields = [];

      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: RENDER_SCALE });
        const pdfViewport = page.getViewport({ scale: 1 }); // actual PDF units

        // Render image
        const canvas = document.createElement("canvas");
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
        images.push(canvas.toDataURL("image/jpeg", 0.85));
        sizes.push({ width: pdfViewport.width, height: pdfViewport.height });

        // Extract text items with positions (safe — won't break if it fails)
        try {
          const textContent = await page.getTextContent();
          // Filter to only real text items with transform arrays
          const textItems = (textContent.items || []).filter(
            item => item.str && item.str.trim() && item.transform && Array.isArray(item.transform) && item.transform.length >= 6
          );
          const groupedLines = groupTextItems(textItems, viewport, pdfViewport, i - 1);
          fields.push(...groupedLines);
        } catch (textErr) {
          console.warn('Text extraction failed for page', i, textErr);
        }
      }

      setPageImages(images);
      setPdfPageSizes(sizes);
      setDetectedFields(fields);
      setTotalPages(pdf.numPages);
      setCurrentPage(0);
    } catch (err) {
      alert("Failed to load PDF: " + err.message);
    }
    setLoading(false);
  }, []);

  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });

  // Update container size dynamically when the overlay changes size (resizes, mounts, etc.)
  useEffect(() => {
    if (!overlayRef.current) return;
    const resizeObserver = new ResizeObserver(() => {
      if (overlayRef.current) {
        setContainerSize({
          width: overlayRef.current.clientWidth,
          height: overlayRef.current.clientHeight,
        });
      }
    });
    resizeObserver.observe(overlayRef.current);
    return () => resizeObserver.disconnect();
  }, [pageImages.length, currentPage]);

  // Focus input when editing
  useEffect(() => {
    if (editingId && editInputRef.current) {
      const el = editInputRef.current;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
  }, [editingId]);

  // ---- Coordinate helpers ----
  // Convert screen px position to PDF points (for saving)
  const screenToPdf = (screenX, screenY, pageIndex) => {
    const containerW = containerSize.width || 500;
    const containerH = containerSize.height || 700;
    const pdfSize = pdfPageSizes[pageIndex] || { width: 612, height: 792 };
    const pdfX = (screenX / containerW) * pdfSize.width;
    const pdfY = pdfSize.height - (screenY / containerH) * pdfSize.height;
    return { x: pdfX, y: pdfY };
  };

  // Convert PDF points to screen px (for display)
  const pdfToScreen = (pdfX, pdfY, pdfW, pdfH, pageIndex) => {
    const containerW = containerSize.width || 500;
    const containerH = containerSize.height || 700;
    const pdfSize = pdfPageSizes[pageIndex] || { width: 612, height: 792 };
    return {
      x: (pdfX / pdfSize.width) * containerW,
      y: ((pdfSize.height - pdfY) / pdfSize.height) * containerH,
      w: (pdfW / pdfSize.width) * containerW,
      h: (pdfH / pdfSize.height) * containerH,
    };
  };

  const getPos = (e) => {
    if (!overlayRef.current) return { x: 0, y: 0 };
    const rect = overlayRef.current.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  // ---- Click on canvas ----
  const handleCanvasClick = (e) => {
    if (dragging) return;
    if (editingId) { setEditingId(null); return; }

    const pos = getPos(e);
    const id = Date.now();

    if (tool === "text") {
      setAnnotations((prev) => [...prev, {
        id, type: "text", text: "Type here", x: pos.x, y: pos.y,
        fontSize, color, pageIndex: currentPage, isNew: true,
      }]);
      setSelectedId(id);
      setEditingId(id);
      setTool("select");
    } else if (tool === "rectangle") {
      setAnnotations((prev) => [...prev, {
        id, type: "rect", x: pos.x, y: pos.y, w: 150, h: 80,
        color, borderWidth: 2, pageIndex: currentPage,
      }]);
      setSelectedId(id);
      setTool("select");
    } else if (tool === "line") {
      setAnnotations((prev) => [...prev, {
        id, type: "rect", x: pos.x, y: pos.y, w: 200, h: 3,
        color, borderWidth: 3, pageIndex: currentPage,
      }]);
      setSelectedId(id);
      setTool("select");
    } else {
      setSelectedId(null);
    }
  };

  // ---- Click on detected text field to make it editable ----
  const handleFieldClick = (e, field) => {
    e.stopPropagation();
    // Convert this detected field into an editable annotation
    const existing = annotations.find(a => a.fieldId === field.id);
    if (existing) {
      setSelectedId(existing.id);
      setEditingId(existing.id);
      return;
    }
    // Create an annotation from this field
    const id = Date.now();
    const screenPos = pdfToScreen(field.pdfX, field.pdfY, field.pdfW, field.pdfH, field.pageIndex);
    setAnnotations((prev) => [...prev, {
      id, fieldId: field.id, type: "text", text: field.text,
      x: screenPos.x, y: screenPos.y - screenPos.h,
      fontSize: Math.round(field.fontSize * (containerSize.width || 500) / (pdfPageSizes[field.pageIndex]?.width || 612)),
      color: "#000000", pageIndex: field.pageIndex, isFieldEdit: true,
      origFieldId: field.id,
    }]);
    setSelectedId(id);
    setEditingId(id);
  };

  // ---- Update annotation text ----
  const updateText = (id, newText) => {
    setAnnotations((prev) => prev.map((a) => a.id === id ? { ...a, text: newText } : a));
  };

  const updateSelectedStyle = (key, value) => {
    if (!selectedId) return;
    setAnnotations((prev) => prev.map((a) => a.id === selectedId ? { ...a, [key]: value } : a));
  };

  const handleDoubleClick = (e, ann) => {
    e.stopPropagation();
    if (ann.type === "text") { setSelectedId(ann.id); setEditingId(ann.id); }
  };

  // ---- Drag ----
  const onAnnDown = (e, ann) => {
    e.stopPropagation();
    if (editingId === ann.id) return;
    setSelectedId(ann.id);
    setEditingId(null);
    const pos = getPos(e);
    setDragOffset({ x: pos.x - ann.x, y: pos.y - ann.y });
    setDragging(ann.id);
  };

  const onMouseMove = useCallback((e) => {
    if (!dragging || !overlayRef.current) return;
    const rect = overlayRef.current.getBoundingClientRect();
    setAnnotations((prev) => prev.map((a) =>
      a.id === dragging ? { ...a, x: e.clientX - rect.left - dragOffset.x, y: e.clientY - rect.top - dragOffset.y } : a
    ));
  }, [dragging, dragOffset]);

  const onMouseUp = useCallback(() => setDragging(null), []);

  useEffect(() => {
    if (!dragging) return;
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => { window.removeEventListener("mousemove", onMouseMove); window.removeEventListener("mouseup", onMouseUp); };
  }, [dragging, onMouseMove, onMouseUp]);

  // Keyboard
  useEffect(() => {
    const handleKey = (e) => {
      if (editingId) return;
      if ((e.key === "Delete" || e.key === "Backspace") && selectedId) {
        setAnnotations((prev) => prev.filter((a) => a.id !== selectedId));
        setSelectedId(null);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [selectedId, editingId]);

  const deleteSelected = () => {
    setAnnotations((prev) => prev.filter((a) => a.id !== selectedId));
    setSelectedId(null);
    setEditingId(null);
  };

  const currentAnns = annotations.filter((a) => a.pageIndex === currentPage);
  const currentFields = detectedFields.filter((f) => f.pageIndex === currentPage);
  const editedFieldIds = new Set(annotations.filter(a => a.origFieldId).map(a => a.origFieldId));
  const selectedAnn = annotations.find((a) => a.id === selectedId);

  // ---- SAVE: Convert screen coords back to PDF coords ----
  const handleSave = async () => {
    if (!file || annotations.length === 0) return;
    setProcessing(true);
    setEditingId(null);
    try {
      const containerW = containerSize.width || 500;
      const containerH = containerSize.height || 700;

      const hex2rgb = (hex) => ({
        r: parseInt(hex.slice(1, 3), 16) / 255,
        g: parseInt(hex.slice(3, 5), 16) / 255,
        b: parseInt(hex.slice(5, 7), 16) / 255,
      });

      const pdfAnns = annotations.map((a) => {
        const pdfSize = pdfPageSizes[a.pageIndex] || { width: 612, height: 792 };
        const scaleX = pdfSize.width / containerW;
        const scaleY = pdfSize.height / containerH;

        if (a.type === "text") {
          const pdfX = a.x * scaleX;
          const pdfY = pdfSize.height - (a.y * scaleY);
          const pdfFontSize = a.fontSize * scaleX;
          return {
            type: "text", text: a.text,
            x: pdfX, y: pdfY,
            fontSize: pdfFontSize,
            color: hex2rgb(a.color),
            pageIndex: a.pageIndex,
          };
        } else {
          const pdfX = a.x * scaleX;
          const pdfY = pdfSize.height - (a.y * scaleY) - (a.h * scaleY);
          return {
            type: "rectangle",
            x: pdfX, y: pdfY,
            width: a.w * scaleX, height: a.h * scaleY,
            color: hex2rgb(a.color),
            borderWidth: a.borderWidth,
            pageIndex: a.pageIndex,
          };
        }
      });

      // For field edits, we overlay a white rect to cover original text, then draw new text
      const finalAnns = [];
      for (const a of pdfAnns) {
        const srcAnn = annotations.find(x => {
          const ps = pdfPageSizes[x.pageIndex] || { width: 612, height: 792 };
          const sx = ps.width / containerW;
          return Math.abs(x.x * sx - a.x) < 1 && x.origFieldId;
        });
        if (srcAnn) {
          // Add white cover rectangle behind edited field
          const field = detectedFields.find(f => f.id === srcAnn.origFieldId);
          if (field) {
            finalAnns.push({
              type: "rectangle",
              x: field.pdfX - 2,
              y: field.pdfY - field.pdfH - 2,
              width: field.pdfW + 4,
              height: field.pdfH + 6,
              color: { r: 1, g: 1, b: 1 },
              borderWidth: 0,
              fill: true,
              pageIndex: a.pageIndex,
            });
          }
        }
        finalAnns.push(a);
      }

      const res = await editPDF(file, finalAnns);
      setResult(res);
    } catch (e) { alert("Error: " + e.message); }
    setProcessing(false);
  };

  // ---- Result ----
  if (result) {
    return (
      <>
        <Header />
        <div className="tool-page">
          <Link href="/" className="back-link"><ArrowLeft size={14} /> Back to all tools</Link>
          <div className="result-card">
            <CheckCircle size={40} color="var(--success)" />
            <h3>PDF Edited!</h3>
            <p>{result.pageCount} pages • {formatFileSize(result.blob.size)}</p>
            <button className="btn-primary" onClick={() => downloadBlob(result.blob, file.name.replace(".pdf", "_edited.pdf"))}>
              <Download size={16} /> Download PDF
            </button>
            <button className="btn-secondary" onClick={() => { setFile(null); setResult(null); setAnnotations([]); setPageImages([]); setDetectedFields([]); }}>Edit Another</button>
          </div>
        </div>
      </>
    );
  }

  // ---- Editor ----
  return (
    <>
      <Header />
      <div className="tool-page" style={{ maxWidth: 1100 }}>
        <Link href="/" className="back-link"><ArrowLeft size={14} /> Back to all tools</Link>
        <div className="tool-page-header">
          <h1><Edit3 size={28} strokeWidth={2} /> Edit PDF</h1>
          <p>Click on existing text to edit it • Use toolbar to add new elements</p>
        </div>

        {!pageImages.length ? (
          loading
            ? <div className="result-card" style={{ textAlign: "center" }}><span className="spinner" style={{ marginRight: 8 }}></span> Loading PDF &amp; detecting text fields...</div>
            : <Dropzone onFiles={handleFiles} accept=".pdf" multiple={false} label="Drop your PDF file here" sublabel="Text fields will be auto-detected for editing" />
        ) : (
          <div className="pdf-editor-container">
            {/* Toolbar */}
            <div className="editor-toolbar">
              <div className="toolbar-group">
                <button className={`toolbar-btn ${tool === "select" ? "active" : ""}`} onClick={() => setTool("select")} title="Select & Move"><MousePointer size={16} /></button>
                <button className={`toolbar-btn ${tool === "text" ? "active" : ""}`} onClick={() => setTool("text")} title="Add Text"><Type size={16} /></button>
                <button className={`toolbar-btn ${tool === "rectangle" ? "active" : ""}`} onClick={() => setTool("rectangle")} title="Rectangle"><Square size={16} /></button>
                <button className={`toolbar-btn ${tool === "line" ? "active" : ""}`} onClick={() => setTool("line")} title="Line"><Minus size={16} /></button>
              </div>
              <div className="toolbar-divider" />
              <div className="toolbar-group">
                <label className="toolbar-label">Size</label>
                <select value={selectedAnn?.fontSize || fontSize} onChange={(e) => { const v = Number(e.target.value); setFontSize(v); if (selectedAnn?.type === "text") updateSelectedStyle("fontSize", v); }} className="toolbar-select">
                  {[8,10,12,14,16,18,20,24,28,32,40,48].map(s => <option key={s} value={s}>{s}px</option>)}
                </select>
                <label className="toolbar-label">Color</label>
                <input type="color" value={selectedAnn?.color || color} onChange={(e) => { setColor(e.target.value); if (selectedId) updateSelectedStyle("color", e.target.value); }} className="toolbar-color" />
              </div>
              <div style={{ flex: 1 }} />
              {selectedId && <button className="toolbar-btn danger" onClick={deleteSelected} title="Delete"><Trash2 size={16} /></button>}
              <div className="toolbar-divider" />
              <div className="toolbar-group">
                <button className="toolbar-btn" onClick={() => { setCurrentPage(Math.max(0, currentPage - 1)); setSelectedId(null); setEditingId(null); }} disabled={currentPage <= 0}><ChevronLeft size={16} /></button>
                <span className="toolbar-label" style={{ minWidth: 60, textAlign: "center" }}>{currentPage + 1} / {totalPages}</span>
                <button className="toolbar-btn" onClick={() => { setCurrentPage(Math.min(totalPages - 1, currentPage + 1)); setSelectedId(null); setEditingId(null); }} disabled={currentPage >= totalPages - 1}><ChevronRight size={16} /></button>
              </div>
            </div>

            {/* Canvas */}
            <div className="editor-canvas-wrapper">
              <div
                ref={overlayRef}
                className="editor-canvas"
                onClick={handleCanvasClick}
                style={{
                  backgroundImage: `url(${pageImages[currentPage]})`,
                  aspectRatio: pdfPageSizes[currentPage] ? `${pdfPageSizes[currentPage].width} / ${pdfPageSizes[currentPage].height}` : "auto",
                  cursor: tool === "text" ? "text" : tool !== "select" ? "crosshair" : "default",
                }}
              >
                {/* Detected text fields — clickable highlights */}
                {containerSize.width > 0 && currentFields
                  .filter(f => !editedFieldIds.has(f.id))
                  .map((field) => {
                    const cW = containerSize.width;
                    const cH = containerSize.height;
                    const ps = pdfPageSizes[field.pageIndex] || { width: 612, height: 792 };
                    const sx = cW / ps.width;
                    const sy = cH / ps.height;
                    return (
                      <div
                        key={field.id}
                        className="detected-field"
                        onClick={(e) => handleFieldClick(e, field)}
                        title="Click to edit this text"
                        style={{
                          left: field.pdfX * sx,
                          top: (ps.height - field.pdfY) * sy,
                          width: field.pdfW * sx,
                          height: field.pdfH * sy + 4,
                        }}
                      />
                    );
                  })
                }

                {/* User annotations */}
                {currentAnns.map((ann) => {
                  const isEditing = editingId === ann.id;
                  const isSelected = selectedId === ann.id;

                  if (ann.type === "text") {
                    return (
                      <div key={ann.id} className={`editor-annotation ${isSelected ? "selected" : ""}`}
                        style={{ left: ann.x, top: ann.y, cursor: isEditing ? "text" : "move", userSelect: isEditing ? "text" : "none" }}
                        onMouseDown={(e) => onAnnDown(e, ann)}
                        onDoubleClick={(e) => handleDoubleClick(e, ann)}
                      >
                        {isEditing ? (
                          <input ref={editInputRef} type="text" value={ann.text}
                            onChange={(e) => updateText(ann.id, e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter") setEditingId(null); if (e.key === "Escape") { setEditingId(null); setSelectedId(null); } e.stopPropagation(); }}
                            onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}
                            className="inline-edit-input"
                            style={{ fontSize: ann.fontSize, color: ann.color, width: Math.max(80, ann.text.length * ann.fontSize * 0.65 + 24) }}
                          />
                        ) : (
                          <span style={{ fontSize: ann.fontSize, color: ann.color, fontFamily: "Helvetica, Arial, sans-serif", whiteSpace: "nowrap", padding: "1px 3px", borderRadius: 2, background: isSelected ? "rgba(108,92,231,0.12)" : "transparent" }}>
                            {ann.text}
                          </span>
                        )}
                      </div>
                    );
                  }
                  return (
                    <div key={ann.id} className={`editor-annotation ${isSelected ? "selected" : ""}`}
                      onMouseDown={(e) => onAnnDown(e, ann)}
                      style={{ left: ann.x, top: ann.y, width: ann.w, height: ann.h, border: `${ann.borderWidth}px solid ${ann.color}`, cursor: "move" }}
                    />
                  );
                })}
              </div>
            </div>

            {/* Status bar */}
            <div className="editor-statusbar">
              <span>{currentFields.length} text fields detected • {annotations.length} edit{annotations.length !== 1 ? "s" : ""}</span>
              <span className="editor-hint">
                {editingId ? "Editing — Enter to finish" : ""}
                {!editingId && tool === "select" && !selectedId && "Click highlighted text to edit • Or use toolbar to add"}
                {!editingId && tool === "select" && selectedId && "Double-click to edit • Drag to move • Del to delete"}
                {!editingId && tool === "text" && "Click to place new text"}
                {!editingId && (tool === "rectangle" || tool === "line") && "Click to place"}
              </span>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn-secondary" onClick={() => { setFile(null); setPageImages([]); setAnnotations([]); setDetectedFields([]); setEditingId(null); }} style={{ padding: "6px 14px", fontSize: "0.82rem" }}>Cancel</button>
                <button className="btn-primary" onClick={handleSave} disabled={processing || annotations.length === 0} style={{ padding: "6px 14px", fontSize: "0.82rem" }}>
                  {processing ? "Saving..." : `Save PDF (${annotations.length})`}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

// ---- Group text items from pdf.js into logical text lines ----
function groupTextItems(items, renderViewport, pdfViewport, pageIndex) {
  if (!items || items.length === 0) return [];

  const fields = [];
  let lineBuffer = [];

  // Sort by Y descending (top to bottom), then X ascending
  const sorted = [...items].sort((a, b) => {
    const ay = (a.transform && a.transform[5]) || 0;
    const by = (b.transform && b.transform[5]) || 0;
    if (Math.abs(ay - by) > 3) return by - ay;
    return ((a.transform && a.transform[4]) || 0) - ((b.transform && b.transform[4]) || 0);
  });

  for (const item of sorted) {
    if (!item.transform || !item.str) continue;
    const x = item.transform[4] || 0;
    const y = item.transform[5] || 0;
    const fs = Math.abs(item.transform[0]) || 12;
    const w = item.width || (item.str.length * fs * 0.55);
    const h = fs;

    if (lineBuffer.length > 0) {
      const last = lineBuffer[lineBuffer.length - 1];
      const sameLineY = Math.abs(last.y - y) < fs * 0.6;
      const closeX = (x - (last.x + last.w)) < fs * 3;
      if (sameLineY && closeX) {
        lineBuffer.push({ text: item.str, x, y, w, h, fs });
        continue;
      } else {
        flushLine(lineBuffer, fields, pageIndex);
        lineBuffer = [];
      }
    }
    lineBuffer.push({ text: item.str, x, y, w, h, fs });
  }
  if (lineBuffer.length > 0) flushLine(lineBuffer, fields, pageIndex);

  return fields;
}

function flushLine(buffer, fields, pageIndex) {
  const text = buffer.map(b => b.text).join(" ");
  if (!text.trim() || text.trim().length < 2) return;
  const minX = Math.min(...buffer.map(b => b.x));
  const maxX = Math.max(...buffer.map(b => b.x + b.w));
  const minY = Math.min(...buffer.map(b => b.y));
  const avgFs = buffer.reduce((s, b) => s + b.fs, 0) / buffer.length;
  const h = avgFs;

  fields.push({
    id: `field-${pageIndex}-${minX.toFixed(0)}-${minY.toFixed(0)}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    text: text.trim(),
    pdfX: minX,
    pdfY: minY + h, // pdf.js gives baseline Y
    pdfW: maxX - minX,
    pdfH: h,
    fontSize: avgFs,
    pageIndex,
  });
}
