// POK-349 — Single source of truth for issue-card section sets.
//
// Two consumers used to drift apart:
//   - the doctor (scripts/pokit-doctor.mjs) held its own SPEC_CODE_SECTIONS /
//     GENERAL_SECTIONS constants for active-issue section-presence checks, and
//   - the issue-create generator (scripts/pokit-issue-create.mjs) emitted a
//     single `## Brief` skeleton by hand.
// They are now both fed from this one module, so the required-section list and
// the generator skeleton can never disagree (drift 0).
//
// One axis, not two: "header exists (transition time)" vs "content is real
// (ready/gate time)". We do NOT introduce a separate 준비-조건/실행-산출 section
// taxonomy. The readiness content check below joins the existing readiness-stage
// escalation pattern (checkBacklogIssueContract) — it only asks whether the
// grooming-thinking sections actually hold content once a card claims
// definition_readiness: pass.

export const GENERAL_SECTIONS = [
  'Brief',
  'Evidence',
  'Acceptance Criteria',
  'QA',
  'Gate',
  'Memory',
];

export const SPEC_CODE_SECTIONS = [
  'Brief',
  'Evidence',
  'Acceptance Criteria',
  'Development Plan',
  'Test Plan',
  'Subagent Plan',
  'QA',
  'Gate',
  'Memory',
];

// spec/code issues carry the implementation-planning sections; everything else
// uses the general set. Mirrors the doctor's historical issue_type branch.
export function requiredSectionsFor(issueType) {
  return ['spec', 'code'].includes(issueType) ? SPEC_CODE_SECTIONS : GENERAL_SECTIONS;
}

// Grooming-thinking sections whose CONTENT (not just header) must be real when a
// card claims definition_readiness: pass. Execution-filled sections — Development
// Plan, Test Plan, Subagent Plan, QA, Evidence (verification) — legitimately hold
// `(실행 시 채움)` placeholders at ready time, so they are intentionally absent
// here. Moving the execution-output sections to a gate-time content check is
// POK-350's scope, on this same single-source axis.
export const READINESS_CONTENT_SECTIONS = [
  'Brief',
  'Evidence',
  'Acceptance Criteria',
  'Gate',
];

// Checkbox sections: "satisfied" = at least one list item carrying real text
// after the marker. Checked vs unchecked state is NOT required at ready time
// (defining the ACs is the readiness signal; meeting them is a gate concern).
export const CHECKBOX_SECTIONS = ['Acceptance Criteria', 'QA'];

// POK-350 — Execution-output sections whose CONTENT must be real at GATE (합격)
// time, never at transition time. These legitimately hold (실행 시 채움)/(실행 후
// 박제) placeholders or unchecked boxes while gate_state is pending (the work that
// produces them has not happened yet); once a card claims gate_state: gate_passed
// the execution HAS happened, so the receipts must be real. This is the gate-time
// mirror of READINESS_CONTENT_SECTIONS, on the same single source-of-truth axis.
//   - QA  → a CHECKBOX_SECTIONS member; at gate it needs >=1 *checked* item, not
//           merely a defined item (the readiness check only required definition;
//           "checking them off is a gate concern" — see CHECKBOX_SECTIONS note).
//   - Gate → real content (the pass record / 통과 도장). Note this overlaps the
//           readiness Gate-content requirement; kept here so the enumerated
//           execution-output set matches the issue's AC1 wording, and harmless
//           because a ready card already satisfies it.
//   - Evidence (verification) → real content, but OPTIONAL: it is not in either
//           required-section list, so a card that never adds the header is not
//           failed for its absence (presence is checkActiveIssue's concern).
export const GATE_CONTENT_SECTIONS = [
  'QA',
  'Gate',
  'Evidence (verification)',
];

// Gate-content sections that are skipped when absent rather than counted as a gap
// (absence = "not applicable to this card", not "empty receipt").
export const OPTIONAL_GATE_CONTENT_SECTIONS = ['Evidence (verification)'];

// Placeholder bodies that count as "not real content" — the fake fills the
// generator must never emit and the readiness check must reject. A bare header
// followed by one of these reads as "filled" to a header-only check but is in
// fact an empty thinking slot wearing a ready stamp.
export const PLACEHOLDER_PATTERNS = [
  /^_no\b.*\._$/i,            // _No brief provided._
  /^\(\s*실행\s*시\s*채움/,    // (실행 시 채움 ...)
  /^\(\s*실행\s*시\s*확정/,    // (실행 시 확정 ...)
  /^\(\s*실행\s*후\s*박제/,    // (실행 후 박제)
  /^\(\s*미정\s*\)?$/,         // (미정)
  /^todo\b/i,
  /^tbd\b/i,
];

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Raw body of a `## <section>` block: everything between this header and the next
// `## ` header (or EOF). Returns null when the header is absent.
export function sectionBody(text, section) {
  const header = new RegExp(`^## ${escapeRegex(section)}\\s*$`, 'm');
  const m = header.exec(text);
  if (!m) return null;
  const rest = text.slice(m.index + m[0].length);
  const next = /^## /m.exec(rest);
  return next ? rest.slice(0, next.index) : rest;
}

export function isPlaceholderLine(line) {
  const trimmed = line.trim();
  if (trimmed === '') return true;
  return PLACEHOLDER_PATTERNS.some((re) => re.test(trimmed));
}

// A line carries real content when — after stripping any leading list/checkbox/
// numbered marker — non-placeholder text remains. This rejects three flavours of
// empty thinking slot in one predicate: a blank line, a bare marker with no text
// (`-`, `*`, `1.`, or empty checkbox `- [ ]`), and a placeholder string
// (`(실행 시 채움)`, `_No brief provided._`, etc.).
function lineHasRealText(line) {
  const trimmed = line.trim();
  if (trimmed === '') return false;
  const afterMarker = trimmed.replace(/^([-*]\s*\[[ xX]\]|[-*]|\d+[.)])\s*/, '');
  if (afterMarker === '') return false; // bare marker, nothing after it
  return !isPlaceholderLine(afterMarker);
}

// Checkbox-section "채워짐" (satisfied) rule (POK-349 decision): the section has
// >=1 list item carrying real text — a checkbox item (`- [ ] text` / `- [x] text`),
// a plain bullet (`- text` / `* text`), or a numbered item (`1. text`). Acceptance
// Criteria are authored in all three styles across the repo's history, so the rule
// is list-style-agnostic. A BARE marker with no text (`- [ ]`, `-`, `1.`) does NOT
// count — it is an empty thinking slot. Checked vs unchecked is irrelevant at ready
// time (defining the items is the readiness signal; checking them off is a gate
// concern, POK-350).
function checkboxSectionSatisfied(body) {
  return body.split('\n').some(lineHasRealText);
}

// True when the `## <section>` block holds real (non-placeholder) content. Both the
// checkbox and prose paths share lineHasRealText, so a bare marker or placeholder
// never masquerades as content regardless of section style.
export function sectionContentSatisfied(text, section) {
  const body = sectionBody(text, section);
  if (body === null) return false;
  if (CHECKBOX_SECTIONS.includes(section)) {
    return checkboxSectionSatisfied(body);
  }
  return body.split('\n').some(lineHasRealText);
}

// Readiness content gaps for a card text: the READINESS_CONTENT_SECTIONS that are
// missing or empty/placeholder. Empty array = the card honestly satisfies its
// ready stamp's content conditions.
export function readinessContentGaps(text) {
  return READINESS_CONTENT_SECTIONS.filter((section) => !sectionContentSatisfied(text, section));
}

// Gate-time "checked" rule (POK-350) for a checkbox section: at least one item is
// actually checked off (`- [x] text`) with real text after the box. Unchecked-only
// or bare-checkbox bodies do NOT pass — at gate, the work must be marked done, not
// merely listed.
function checkboxSectionHasChecked(body) {
  return body.split('\n').some((line) => {
    const m = line.trim().match(/^[-*]\s*\[[xX]\]\s*(.+)$/);
    return m !== null && !isPlaceholderLine(m[1]);
  });
}

// True when the `## <section>` block satisfies its GATE-time content rule. Checkbox
// sections (QA) require a checked item; prose sections require real content. Shares
// isPlaceholderLine/lineHasRealText with the readiness path so placeholders never
// masquerade as receipts.
export function gateContentSatisfied(text, section) {
  const body = sectionBody(text, section);
  if (body === null) return false;
  if (CHECKBOX_SECTIONS.includes(section)) {
    return checkboxSectionHasChecked(body);
  }
  return body.split('\n').some(lineHasRealText);
}

// The GATE_CONTENT_SECTIONS actually evaluated for a card: every required gate
// section, plus optional ones only when their header is present. An optional
// section with no header is "not applicable" and is neither evaluated nor reported,
// so audit messages name only what was really checked.
export function evaluatedGateContentSections(text) {
  return GATE_CONTENT_SECTIONS.filter((section) =>
    !(OPTIONAL_GATE_CONTENT_SECTIONS.includes(section) && sectionBody(text, section) === null)
  );
}

// Gate content gaps for a card text: the evaluated GATE_CONTENT_SECTIONS that are
// empty, placeholder, or (for QA) have no checked item. OPTIONAL_GATE_CONTENT_SECTIONS
// are skipped when their header is absent. Empty array = the gate_passed claim is
// backed by real execution-output content.
export function gateContentGaps(text) {
  return evaluatedGateContentSections(text).filter((section) => !gateContentSatisfied(text, section));
}

// The empty skeleton body a freshly-created card receives: every required header
// with a blank body underneath. No fake fill — the doctor's header-presence check
// does not read content, so a placeholder fill would let an unfilled section pass
// as "present" while masking that nobody has thought it through yet.
export function emptySkeletonBody(issueType) {
  const sections = requiredSectionsFor(issueType);
  return '\n' + sections.map((section) => `## ${section}\n`).join('\n');
}
