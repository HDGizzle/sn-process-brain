'use strict';
/*
 * vocabulary.js — ONE normalised term→definition model, feeding BOTH the wiki glossary and
 * the kernel's domain-vocabulary section.
 *
 * WHY THIS FILE EXISTS. Two findings from the second engagement's run (2026-08-31), one from
 * each side of the same gap:
 *
 *   - The interview confirmed three definitions; the kernel carried them and docs/wiki/
 *     glossary.md shipped as the empty scaffold with blank table rows. Nothing generated the
 *     glossary — kernelfacts.js wrote the vocabulary into product.config.json and stopped.
 *   - The kernel ALSO attached the eVault definition to "Onboarding" and the I-Comply one to
 *     "Tasks" and "Comply": `expansionFor(token)` matched any register-gap QUESTION whose
 *     text mentioned the token, so every word that co-occurred in a question's sentence
 *     inherited the answer. The first run shows the same defect: APIM and Process both carry
 *     the VendorX definition in pilot-run-8's kernel, because the VendorX question named them.
 *
 * THE RULE: a definition attaches to the term the human defined, or to an alias the human
 * declared, and to nothing else. Co-occurrence is not identity. Frequent tokens the ledger
 * surfaces and nobody defined are rendered UNEXPANDED, by name, so the gap is a question
 * rather than a borrowed answer.
 *
 * THE KEY. Every vocabulary decision carries `canonicalTerm` (set by the interview from the
 * answer, else from the question's `term`, which the questions stage stamps from the quoted
 * token in its own text) and optional `aliases[]`. The join is on the normalised exact
 * string. A vocabulary decision the CLI cannot key is reported as `unresolvable` and refuses
 * the render — a definition with no term is a paragraph, not a glossary row.
 */

const fs = require('fs');
const path = require('path');
const { latestById, readJsonl } = require('../render.js');

function normTerm(s) {
  return String(s === undefined || s === null ? '' : s).toLowerCase().replace(/\s+/g, ' ').trim().replace(/[.,;:!?]+$/, '');
}

/**
 * The term a register-gap question is about, from its own text: the first quoted token
 * ('QRT', "eVault", ‘I-Comply’), else the first acronym-shaped word (2–8 capitals). Null
 * when neither exists, which the questions validator turns into a rejection — the agent
 * must quote the word it is asking about.
 */
function extractTerm(question) {
  const text = String(question || '');
  const quoted = /['‘"“]([^'’"”\n]{2,40})['’"”]/.exec(text);
  if (quoted) { return quoted[1].trim(); }
  const caps = /\b([A-Z][A-Z0-9]{1,7})\b/.exec(text);
  return caps ? caps[1] : null;
}

/** Wiki numbers are DEC-001.. in ledger append order, never renumbered — the same rule render.js applies. */
function decisionWikiNumbers(decisions) {
  const out = new Map();
  decisions.forEach((d, i) => { out.set(d.id, `DEC-${String(i + 1).padStart(3, '0')}`); });
  return out;
}

function buildVocabularyModel(repoRoot) {
  const brainDir = path.join(repoRoot, '.brain');
  const decisions = latestById(readJsonl(path.join(brainDir, 'decisions.jsonl')));
  const questions = latestById(readJsonl(path.join(brainDir, 'questions.jsonl')));
  const questionById = new Map(questions.map((q) => [q.id, q]));
  const numbers = decisionWikiNumbers(decisions);

  const byKey = new Map();
  const unresolvable = [];
  const superseded = [];
  decisions.forEach((d) => {
    const q = d.answerProvenance && d.answerProvenance.fromQuestion ? questionById.get(d.answerProvenance.fromQuestion) : null;
    const isVocab = !!(d.canonicalTerm) || !!(q && q.gate === 'register-gap');
    if (!isVocab) { return; }
    if (d.confirmationStatus === 'retired') { return; }
    const canonical = d.canonicalTerm || (q && q.term) || (q && extractTerm(q.question)) || null;
    if (!canonical) { unresolvable.push({ num: numbers.get(d.id), id: d.id, statement: String(d.statement || '').slice(0, 80) }); return; }
    const aliases = [...new Set((Array.isArray(d.aliases) ? d.aliases : []).map((a) => String(a).trim()).filter(Boolean))];
    const term = {
      canonicalTerm: String(canonical).trim(),
      key: normTerm(canonical),
      aliases,
      aliasKeys: aliases.map(normTerm),
      definition: String(d.statement || ''),
      rationale: d.rationale || null,
      decisionId: d.id,
      hash: String(d.id || '').replace(/^DEC-/, ''),
      decisionNum: numbers.get(d.id),
      witnessClaims: (d.witnessClaims || []).slice(),
      explainsClaims: (d.explainsClaims || []).slice(),
      answeredBy: d.answeredBy || null,
      answeredAt: d.answeredAt || null,
      fromQuestion: q ? q.id : null,
      verbatim: (d.answerProvenance && d.answerProvenance.verbatim) || null,
      needsReconfirmation: d.confirmationStatus === 'needs-reconfirmation',
    };
    // A later decision on the same term supersedes the earlier row; the earlier is listed, not lost.
    if (byKey.has(term.key)) { superseded.push(byKey.get(term.key)); }
    byKey.set(term.key, term);
  });
  const terms = [...byKey.values()].sort((a, b) => a.canonicalTerm.localeCompare(b.canonicalTerm));

  const lookup = (token) => {
    const k = normTerm(token);
    if (!k) { return null; }
    return terms.find((t) => t.key === k || t.aliasKeys.includes(k)) || null;
  };

  // The recurring tokens of the customer-authored surface, joined on identity ONLY.
  const claims = latestById(readJsonl(path.join(brainDir, 'claims.jsonl')));
  const claimsById = new Map(claims.map((c) => [c.id, c]));
  const { vocabularyCandidates } = require('./stages.js');   // lazy: stages.js requires this file
  const candidates = vocabularyCandidates({ brain: { claims: () => claimsById } });
  const unmatched = candidates.filter((v) => !lookup(v.token) && !lookup(v.display));
  const matched = candidates.filter((v) => lookup(v.token) || lookup(v.display));

  return { terms, unresolvable, superseded, lookup, candidates, matched, unmatched, decisionNumbers: numbers, claimsById };
}

module.exports = { normTerm, extractTerm, decisionWikiNumbers, buildVocabularyModel };
