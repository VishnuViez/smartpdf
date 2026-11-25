"use client";

/**
 * Detected input fields — AcroForm widgets, comb cells, boxes and rules.
 *
 * Text is placed using the field's own baseline and padding, so it lands
 * optically centred in a box and just above an underline, rather than jammed
 * against an edge. Comb fields place one character per cell, each centred.
 */
export default function FieldLayer({
  fields, viewport, values, activeId, onActivate, onChange, onCommit,
}) {
  if (!fields?.length || !viewport) return null;

  return (
    <div className="ed-fields">
      {fields.map(field => {
        const box = viewport.rectToScreen(field.rect);
        const value = values.get(field.id) ?? field.value ?? "";
        const isActive = activeId === field.id;
        const sizePx = viewport.fontSizeToScreen(field.fontSize);

        // Distance from the field's top edge down to the text baseline.
        const baselineTopPx = viewport.fontSizeToScreen(
          field.rect.y + field.rect.h - field.baseline
        );

        if (field.comb && field.cells?.length) {
          return (
            <div
              key={field.id}
              className={`ed-field is-comb${isActive ? " is-active" : ""}`}
              style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
              onClick={e => { e.stopPropagation(); onActivate(field.id); }}
            >
              {field.cells.map((cell, i) => {
                const c = viewport.rectToScreen(cell);
                return (
                  <span
                    key={i}
                    className="ed-comb-cell"
                    style={{
                      left: c.x - box.x, top: c.y - box.y, width: c.w, height: c.h,
                      fontSize: sizePx, lineHeight: `${c.h}px`,
                    }}
                  >
                    {[...value][i] ?? ""}
                  </span>
                );
              })}
              {isActive && (
                <input
                  className="ed-comb-input"
                  autoFocus
                  value={value}
                  maxLength={field.maxLen || field.cells.length}
                  onChange={e => onChange(field.id, e.target.value)}
                  onBlur={() => onCommit(field.id)}
                  onKeyDown={e => { if (e.key === "Enter" || e.key === "Escape") e.currentTarget.blur(); }}
                />
              )}
            </div>
          );
        }

        const Tag = field.multiline ? "textarea" : "input";
        return (
          <div
            key={field.id}
            className={`ed-field is-${field.kind}${isActive ? " is-active" : ""}${value ? " has-value" : ""}`}
            style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
            onClick={e => { e.stopPropagation(); onActivate(field.id); }}
            title={field.name || `${field.kind} field`}
          >
            <Tag
              className="ed-field-input"
              value={value}
              readOnly={field.readOnly}
              onChange={e => onChange(field.id, e.target.value)}
              onFocus={() => onActivate(field.id)}
              onBlur={() => onCommit(field.id)}
              onKeyDown={e => {
                if (e.key === "Escape") e.currentTarget.blur();
                if (e.key === "Enter" && !field.multiline) e.currentTarget.blur();
              }}
              style={{
                fontSize: sizePx,
                paddingLeft: viewport.fontSizeToScreen(field.padding.left),
                paddingRight: viewport.fontSizeToScreen(field.padding.right),
                // place the first baseline exactly where the model says
                paddingTop: field.multiline
                  ? viewport.fontSizeToScreen(field.padding.top)
                  : Math.max(0, baselineTopPx - sizePx * 0.75),
                lineHeight: field.multiline ? 1.35 : 1,
              }}
            />
          </div>
        );
      })}
    </div>
  );
}
