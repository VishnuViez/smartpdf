"use client";

/** Shows what the selected run actually IS, and lets you change it. */
export default function Inspector({ run, edit, font, fit, onChange, onReset }) {
  if (!run) {
    return (
      <aside className="ed-inspector">
        <div className="ed-inspector-empty">
          <p>Nothing selected</p>
          <span>Click any text on the page to inspect its font, size and colour.</span>
        </div>
      </aside>
    );
  }

  const text = edit?.text ?? run.text;
  const fontSize = edit?.fontSize ?? run.fontSize;
  const colorHex = edit?.colorHex ?? run.colorHex;

  return (
    <aside className="ed-inspector">
      <div className="ed-insp-section">
        <label className="ed-insp-label">Detected font</label>
        <div className="ed-insp-font">{font ? font.label() : "Unknown"}</div>
        <div className="ed-insp-meta">
          {font?.baseFont || "—"}
          {font?.isSubset && <span className="ed-badge" title="Embedded as a partial subset">subset</span>}
        </div>
      </div>

      <div className="ed-insp-section">
        <label className="ed-insp-label" htmlFor="insp-text">Text</label>
        <textarea
          id="insp-text"
          className="ed-insp-input"
          rows={3}
          value={text}
          onChange={e => onChange({ text: e.target.value })}
        />
      </div>

      <div className="ed-insp-row">
        <div className="ed-insp-section">
          <label className="ed-insp-label" htmlFor="insp-size">Size (pt)</label>
          <input
            id="insp-size" type="number" step="0.5" min="1" max="400"
            className="ed-insp-input"
            value={Number(fontSize.toFixed(2))}
            onChange={e => onChange({ fontSize: Number(e.target.value) || fontSize })}
          />
        </div>
        <div className="ed-insp-section">
          <label className="ed-insp-label" htmlFor="insp-color">Colour</label>
          <div className="ed-insp-colorwrap">
            <input
              id="insp-color" type="color" className="ed-insp-color"
              value={colorHex}
              onChange={e => onChange({ colorHex: e.target.value })}
            />
            <code>{colorHex}</code>
          </div>
        </div>
      </div>

      {fit && fit.strategy !== "none" && (
        <div className="ed-insp-section">
          <label className="ed-insp-label">Fitting</label>
          <div className={`ed-fit ed-fit-${fit.fits ? fit.strategy : "overflow"}`}>
            {fit.strategy === "tracked" && "Letter spacing tightened to fit"}
            {fit.strategy === "condensed" && `Condensed to ${Math.round(fit.hScale * 100)}% to fit`}
            {fit.strategy === "shrunk" && `Reduced to ${fit.fontSize.toFixed(1)}pt to fit`}
            {fit.strategy === "overflow" && `Too long by ${fit.overflow.toFixed(0)}pt — will overlap`}
            {fit.strategy === "unbounded" && "No space measured on this line"}
          </div>
          <div className="ed-insp-meta">
            needs {fit.width.toFixed(0)}pt after fitting · {fit.available.toFixed(0)}pt available
          </div>
        </div>
      )}

      <div className="ed-insp-section">
        <label className="ed-insp-label">Position (PDF units)</label>
        <div className="ed-insp-coords">
          <span>x {run.x.toFixed(1)}</span>
          <span>y {run.baseline.toFixed(1)}</span>
          <span>w {run.w.toFixed(1)}</span>
        </div>
      </div>

      {edit && (
        <button className="ed-insp-reset" onClick={onReset}>Revert this element</button>
      )}
    </aside>
  );
}
