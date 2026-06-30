// parse.mjs — turns the Google Doc plain-text export into structured, copy-ready
// script sections. Runs server-side (in the GitHub Action and locally), so the
// raw doc — including the PASSWORDS section — never reaches the public website.
// Only sections whose title contains "SCRIPT" are kept.

const ME_LABELS = new Set([
  'setter', 'bdr', 'company', 'closer', 'me', 'coordinator', 'rep', 'you',
]);
const THEM_LABELS = new Set([
  'prospect', 'customer', 'client', 'lead', 'them',
]);

// Soft labels: not a speaker, but a meaningful prefix we want to badge.
const SOFT_LABELS = [
  { re: /^follow[\s-]?up\s*:/i, badge: 'Follow-up', role: 'me' },
  { re: /^ultimate goal\s*:/i, badge: 'Goal', role: 'link' },
];

const slug = (s) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// A heading in the txt export is a standalone, fully-uppercase line with no
// trailing colon (e.g. "DM SCRIPT (TT,FB,IG)", "OFFER", "PASSWORDS"). Leading
// list markers ("* ", "- ", "1. ") are stripped first.
function headingText(rawLine) {
  const stripped = rawLine
    .replace(/^[\s>*•\-]+/, '')
    .replace(/^\d+[.)]\s*/, '')
    .trim();
  if (stripped.length < 4 || stripped.length > 60) return null;
  if (stripped.endsWith(':')) return null;
  if (/[a-z]/.test(stripped)) return null;       // must be all-caps
  if (!/[A-Z]/.test(stripped)) return null;      // must contain a letter
  if (/^https?:/i.test(stripped)) return null;
  if (/^[\[(]/.test(stripped)) return null;      // skip "[NAME]" etc.
  return stripped;
}

// Join physically-wrapped lines back into one paragraph. The export breaks long
// lines mid-sentence, often right at an apostrophe ("I'" + "ve", "don" + "'t"),
// so we join without a space around apostrophes and with a space otherwise.
function joinLines(lines) {
  let out = '';
  for (let i = 0; i < lines.length; i++) {
    const cur = lines[i].trim();
    if (!cur) continue;
    if (!out) { out = cur; continue; }
    const apostropheJoin =
      /['’]$/.test(out) || /^['’]/.test(cur);
    out += apostropheJoin ? cur : ' ' + cur;
  }
  return out.replace(/[ \t]{2,}/g, ' ').trim();
}

function matchSpeaker(line) {
  const m = line.match(/^([A-Za-z][A-Za-z ]{0,14}):\s?(.*)$/);
  if (!m) return null;
  const label = m[1].trim().toLowerCase();
  if (ME_LABELS.has(label)) return { role: 'me', speaker: m[1].trim(), rest: m[2] };
  if (THEM_LABELS.has(label)) return { role: 'them', speaker: m[1].trim(), rest: m[2] };
  return null;
}

function isSubLabel(text) {
  // Short header lines that group what follows, e.g. "EMAILS:", "HIRE:",
  // "SYSTEM:", "If they commented:".
  return text.endsWith(':') && text.length <= 40 && !/[.?!]/.test(text);
}

function isNote(text) {
  const t = text.trim();
  if (/^\(.*\)$/.test(t)) return true;                       // "(Not a question…)"
  if (/^[*•]\s/.test(t)) return true;                        // list bullet
  if (/^(IF\s|Ex\.|Ex:|Note|Notes|Question-Based)/i.test(t)) return true;
  return false;
}

const isUrl = (s) => /^https?:\/\/\S+$/.test(s.trim());

// Turn one finished block into a rendered, copy-ready entry. A block holds every
// message a setter sends in one turn (its paragraphs), joined with blank lines so
// the whole turn — text and links together — copies in a single tap.
function emit(block, out) {
  const text = block.paragraphs.join('\n\n').trim();
  if (!text) return;
  const variant = block.variant;
  const first = block.paragraphs[0] || '';

  // Explicit speaker label (Setter:/BDR:/Company:/Prospect:/…).
  if (block.role === 'them') {
    out.push({ role: 'them', badge: 'They say', text, copy: text, variant });
    return;
  }
  if (block.role === 'me') {
    out.push({ role: 'me', badge: variant ? 'Alt' : 'Send', speaker: block.speaker, text, copy: text, variant });
    return;
  }

  // A numbered list of branches (e.g. Dominic's script lists the prospect's
  // possible replies as "1. … 2. …") = what they might say, not what you send.
  if (/^\d+[.)]\s/.test(first)) {
    out.push({ role: 'them', badge: 'They might say', text, copy: text, variant });
    return;
  }

  // Soft label (Follow-up:, Ultimate goal:).
  for (const s of SOFT_LABELS) {
    if (s.re.test(first)) {
      const rest = text.replace(s.re, '').trim();
      const role = isUrl(rest) ? 'link' : variant ? 'me' : s.role;
      out.push({ role, badge: s.badge, text: rest || text, copy: rest || text, variant });
      return;
    }
  }

  // A turn that is nothing but a link.
  if (block.paragraphs.length === 1 && isUrl(first)) {
    out.push({ role: 'link', badge: 'Link', text, copy: text, variant });
    return;
  }

  // Instructional note.
  if (isNote(first)) {
    out.push({ role: 'note', text, copy: text, variant });
    return;
  }

  // Otherwise: a message (or messages) the setter sends.
  out.push({ role: 'me', badge: variant ? 'Alt' : 'Send', text, copy: text, variant });
}

// Build copy-ready blocks from the body lines of one section.
// Grouping rules (mirrors how the doc is written — one chat message = one box):
//  • any blank line ends the current box (each message you send is its own box);
//  • a speaker label or a "/" alternative also starts a new box;
//  • adjacent lines (with NO blank between) stay together — this fixes wrapped
//    sentences and keeps a message glued to a link sitting right beneath it;
//  • sub-headers like "EMAILS:" render as dividers between boxes.
function blocksFromLines(lines) {
  const blocks = [];
  let block = null;   // { role, speaker, variant, paragraphs: [] }
  let para = [];      // physical lines making up the current paragraph

  const ensureBlock = () => (block ??= { role: null, speaker: null, variant: false, paragraphs: [] });
  const flushPara = () => {
    if (para.length) {
      const joined = joinLines(para);
      if (joined) ensureBlock().paragraphs.push(joined);
    }
    para = [];
  };
  const flushBlock = () => {
    flushPara();
    if (block && block.paragraphs.length) emit(block, blocks);
    block = null;
  };

  for (const raw of lines) {
    const t = raw.trim();

    if (t === '') {                       // any blank line ends the box
      flushBlock();
      continue;
    }

    const sp = matchSpeaker(t);
    if (sp) {                             // speaker label = new turn
      flushBlock();
      block = { role: sp.role, speaker: sp.speaker, variant: false, paragraphs: [] };
      if (sp.rest.trim()) para.push(sp.rest.trim());
      continue;
    }
    if (isSubLabel(t)) {                  // "EMAILS:" header = divider
      flushBlock();
      blocks.push({ role: 'label', text: t, copy: t });
      continue;
    }
    if (t.startsWith('/')) {              // "/" = mutually-exclusive alternative
      flushBlock();
      block = { role: null, speaker: null, variant: true, paragraphs: [] };
      const rest = t.replace(/^\/\s*/, '');
      if (rest) para.push(rest);
      continue;
    }
    if (isUrl(t)) {                       // link stays inside the current turn
      flushPara();
      ensureBlock().paragraphs.push(t);
      continue;
    }
    para.push(t);                         // normal / wrapped continuation line
  }
  flushBlock();
  return blocks;
}

export function parseDoc(text) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');

  // 1) Split the doc into sections by heading lines.
  const sections = [];
  let cur = null;
  for (const line of lines) {
    const h = headingText(line);
    if (h) {
      // De-dupe consecutive identical headings (the doc repeats some titles).
      if (cur && cur.title === h && cur.lines.every((l) => l.trim() === '')) {
        continue;
      }
      cur = { title: h, lines: [] };
      sections.push(cur);
      continue;
    }
    if (cur) cur.lines.push(line);
  }

  // 2) Keep only the script sections, parse each into blocks.
  const scripts = sections
    .filter((s) => /\bSCRIPT\b/.test(s.title))
    .map((s) => ({
      id: slug(s.title),
      title: s.title,
      blocks: blocksFromLines(s.lines),
    }))
    .filter((s) => s.blocks.length > 0);

  // De-dupe sections that share an id (repeated headings), keeping the richer one.
  const byId = new Map();
  for (const s of scripts) {
    const prev = byId.get(s.id);
    if (!prev || s.blocks.length > prev.blocks.length) byId.set(s.id, s);
  }
  return { sections: [...byId.values()] };
}
