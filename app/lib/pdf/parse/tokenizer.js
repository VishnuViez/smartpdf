'use strict';
// Content-stream tokenizer. Emits SPANS, never values.
// Invariant: token spans + whitespace/comment spans tile the buffer exactly.

const NUL=0,TAB=9,LF=10,FF=12,CR=13,SP=32;
const isWS = c => c===SP||c===LF||c===CR||c===TAB||c===NUL||c===FF;
const isDelim = c => c===0x28||c===0x29||c===0x3C||c===0x3E||c===0x5B||c===0x5D||c===0x7B||c===0x7D||c===0x2F||c===0x25;
const isReg = c => !isWS(c) && !isDelim(c);

export const T = { NUM:'num', NAME:'name', STR:'str', HEX:'hex', ARR_O:'[', ARR_C:']',
            DICT_O:'<<', DICT_C:'>>', BRACE_O:'{', BRACE_C:'}', OP:'op',
            WS:'ws', COMMENT:'comment', INLINE_IMG:'inline_img', JUNK:'junk' };

export function tokenize(buf) {
  const toks = [];
  const n = buf.length;
  let i = 0;

  while (i < n) {
    const start = i;
    const c = buf[i];

    // --- whitespace run ---
    if (isWS(c)) { while (i<n && isWS(buf[i])) i++; toks.push({t:T.WS,start,end:i}); continue; }

    // --- comment ---
    if (c === 0x25) { while (i<n && buf[i]!==LF && buf[i]!==CR) i++; toks.push({t:T.COMMENT,start,end:i}); continue; }

    // --- literal string, with nesting + escapes ---
    if (c === 0x28) {
      i++; let depth=1;
      while (i<n && depth>0) {
        const b = buf[i];
        if (b === 0x5C) { i+=2; continue; }         // backslash escape consumes next byte
        if (b === 0x28) depth++;
        else if (b === 0x29) depth--;
        i++;
      }
      toks.push({t:T.STR,start,end:i}); continue;
    }

    // --- dict open / hex string ---
    if (c === 0x3C) {
      if (i+1<n && buf[i+1]===0x3C) { i+=2; toks.push({t:T.DICT_O,start,end:i}); continue; }
      i++; while (i<n && buf[i]!==0x3E) i++; i++;   // consume '>'
      toks.push({t:T.HEX,start,end:Math.min(i,n)}); continue;
    }
    if (c === 0x3E) {
      if (i+1<n && buf[i+1]===0x3E) { i+=2; toks.push({t:T.DICT_C,start,end:i}); continue; }
      i++; toks.push({t:T.JUNK,start,end:i}); continue;   // stray '>'
    }

    if (c === 0x5B) { i++; toks.push({t:T.ARR_O,start,end:i}); continue; }
    if (c === 0x5D) { i++; toks.push({t:T.ARR_C,start,end:i}); continue; }
    if (c === 0x7B) { i++; toks.push({t:T.BRACE_O,start,end:i}); continue; }
    if (c === 0x7D) { i++; toks.push({t:T.BRACE_C,start,end:i}); continue; }

    // --- name ---
    if (c === 0x2F) { i++; while (i<n && isReg(buf[i])) i++; toks.push({t:T.NAME,start,end:i}); continue; }

    // --- number ---
    if ((c>=0x30&&c<=0x39)||c===0x2B||c===0x2D||c===0x2E) {
      i++; while (i<n && ((buf[i]>=0x30&&buf[i]<=0x39)||buf[i]===0x2E||buf[i]===0x2D||buf[i]===0x2B||buf[i]===0x45||buf[i]===0x65)) i++;
      toks.push({t:T.NUM,start,end:i}); continue;
    }

    // --- operator / keyword ---
    if (isReg(c)) {
      i++; while (i<n && isReg(buf[i])) i++;
      const word = buf.toString('latin1', start, i);
      if (word === 'BI') { i = scanInlineImage(buf, i, toks, start); continue; }
      toks.push({t:T.OP,start,end:i,op:word}); continue;
    }

    i++; toks.push({t:T.JUNK,start,end:i});
  }
  return toks;
}

// BI <dict pairs> ID <binary> EI
// The binary payload may contain the bytes "EI". We never guess when we can compute:
//   1. /L or /Length declared        -> authoritative
//   2. no /F filter                  -> length is exactly derivable from W*H*BPC*components
//   3. filtered                      -> scan, but VALIDATE the candidate terminator
function scanInlineImage(buf, i, toks, start) {
  const n = buf.length;
  const dict = {};
  let lastKey = null;

  while (i < n) {
    while (i < n && isWS(buf[i])) i++;
    if (i >= n) break;
    if (buf[i] === 0x2F) {                                   // /Name
      const s = ++i; while (i < n && isReg(buf[i])) i++;
      const nm = buf.toString('latin1', s, i);
      if (lastKey === null) lastKey = nm; else { dict[lastKey] = '/' + nm; lastKey = null; }
      continue;
    }
    if (isReg(buf[i])) {
      const s = i; while (i < n && isReg(buf[i])) i++;
      const w = buf.toString('latin1', s, i);
      if (w === 'ID') break;
      if (lastKey !== null) { dict[lastKey] = w; lastKey = null; }
      continue;
    }
    if (buf[i] === 0x5B) {                                   // [ ... ]  (e.g. /F [/AHx /Fl])
      const s = i; let d = 0;
      do { if (buf[i] === 0x5B) d++; else if (buf[i] === 0x5D) d--; i++; } while (i < n && d > 0);
      if (lastKey !== null) { dict[lastKey] = buf.toString('latin1', s, i); lastKey = null; }
      continue;
    }
    if (buf[i] === 0x28) { i++; let d=1; while(i<n&&d>0){ if(buf[i]===0x5C){i+=2;continue;} if(buf[i]===0x28)d++; else if(buf[i]===0x29)d--; i++; } lastKey=null; continue; }
    if (buf[i] === 0x3C) { i++; while (i<n && buf[i]!==0x3E) i++; i++; lastKey=null; continue; }
    i++;
  }

  i++;                                                       // exactly one whitespace byte after ID
  const dataStart = i;
  const get = (a, b) => dict[a] !== undefined ? dict[a] : dict[b];

  const declared = parseInt(get('L','Length'), 10);
  const filter = get('F','Filter');

  let dataLen = null;
  if (Number.isFinite(declared)) {
    dataLen = declared;
  } else if (!filter) {
    const w = parseInt(get('W','Width'), 10);
    const h = parseInt(get('H','Height'), 10);
    const mask = get('IM','ImageMask') === 'true';
    const bpc = mask ? 1 : parseInt(get('BPC','BitsPerComponent'), 10);
    const comps = mask ? 1 : componentsFor(get('CS','ColorSpace'));
    if (Number.isFinite(w) && Number.isFinite(h) && Number.isFinite(bpc) && comps) {
      dataLen = Math.ceil((w * comps * bpc) / 8) * h;        // rows are byte-aligned
    }
  }

  if (dataLen != null && dataStart + dataLen <= n) {
    i = dataStart + dataLen;
    while (i < n && isWS(buf[i])) i++;
    if (buf.toString('latin1', i, i + 2) === 'EI') i += 2;
    else i = scanForEI(buf, dataStart);                      // declared length was a lie; fall back
  } else {
    i = scanForEI(buf, dataStart);
  }

  toks.push({ t: T.INLINE_IMG, start, end: i, dict, dataStart });
  return i;
}

function componentsFor(cs) {
  switch (cs) {
    case '/G': case '/DeviceGray': case '/CalGray': case '/I': case '/Indexed': return 1;
    case '/RGB': case '/DeviceRGB': case '/CalRGB': return 3;
    case '/CMYK': case '/DeviceCMYK': return 4;
    default: return null;                                    // named/ICC colorspace -> not derivable
  }
}

// Candidate EI must be whitespace-delimited AND followed by bytes that look like
// content-stream syntax rather than more binary. Cheap, and rules out payload hits.
function scanForEI(buf, from) {
  const n = buf.length;
  let i = from;
  while (i < n - 1) {
    if (buf[i] === 0x45 && buf[i+1] === 0x49 && (i === 0 || isWS(buf[i-1]))) {
      const after = i + 2;
      if (after >= n || isWS(buf[after]) || isDelim(buf[after])) {
        if (looksLikeContent(buf, after)) return after;
      }
    }
    i++;
  }
  return n;
}

function looksLikeContent(buf, from) {
  const n = Math.min(buf.length, from + 24);
  for (let i = from; i < n; i++) {
    const c = buf[i];
    if (isWS(c) || isDelim(c)) continue;
    if (c < 0x20 || c > 0x7E) return false;                  // control/high byte => still image data
  }
  return true;
}


