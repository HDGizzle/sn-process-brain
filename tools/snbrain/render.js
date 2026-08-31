#!/usr/bin/env node
/**
 * render.js — the parts of wiki rendering that must not vary between engagements.
 *
 * WHY THIS FILE EXISTS. Until now the render stage told the agent to produce pages and the agent
 * wrote its own renderer, per run, into the engagement repo. Run 6ef14f5562 wrote a 2,219-line one.
 * It worked, it self-validated, and it carried three defects that cost more than everything else in
 * the deliverable put together — none of which was fixable in this framework, because the code did
 * not live here:
 *
 *   1. It resolved an artifact's display name from `collection` / `table` / `table_name` — the
 *      record's TARGET — ahead of the name the harvest actually captured. `locus.key` holds the
 *      real name on 8,252 of 8,299 claims, so `ACME - QRT Selection State Validation` rendered as
 *      `sn_ohs_im_incident`, and one page listed 33 business rules under 14 repetitions of their
 *      target table. (PRODUCT-81)
 *   2. It printed claim LOCI and dropped claim ASSERTIONS. `rg ' = true'` over 160 rendered pages
 *      returned zero hits. 8,239 claims the run paid for reached a reader in two places.
 *      (PRODUCT-79)
 *   3. It rendered `active = false` artifacts indistinguishably from live ones — four retired UI
 *      actions and a business rule that has never executed, one of them marked `verified`.
 *      (PRODUCT-80)
 *
 * So the mechanical spine ships from the framework and the engagement may not re-implement it.
 * What stays per-engagement is which pages exist and what prose goes on them; what is fixed here is
 * how an artifact is named, that its value is shown, that a dead one is marked dead, and how page
 * status is computed. A defect in any of those is a defect in every future engagement at once,
 * which is exactly the class of thing that belongs in the framework and nowhere else.
 *
 * Usable four ways:
 *   require('./render.js')                        — the primitives, for a stage or an engagement renderer
 *   node render.js --root <repo> --check          — audit an already-rendered wiki against the contract
 *   node render.js --root <repo> --appendix       — generate the evidence appendix from the ledger
 *   node render.js --root <repo> --deliverable-check  — is the deliverable actually in a commit?
 */

'use strict';

const fs = require('fs');
const path = require('path');
// One implementation of the tier vocabulary, shared with state (supersession) and stages
// (render.validate). Two copies of one rule drift apart silently — METHOD-4's missed-mutation
// table is five examples of exactly that.
const { DECISION_TIERS, decisionTier, decisionAnchors } = require('./lib/state.js');

// ---------------------------------------------------------------------------
// naming
// ---------------------------------------------------------------------------

/**
 * Columns that hold what a record IS CALLED. Ordered by how reliably they carry a human name.
 * `element` is deliberately absent: on sys_dictionary it is the field name, which is the
 * artifact's subject rather than its name, and it reads as a name convincingly enough to hide
 * the problem.
 */
const DISPLAY_NAME_FIELDS = Object.freeze([
  'sys_name', 'name', 'label', 'title', 'short_description', 'subject',
  'question_text', 'api_name', 'script_name', 'action_name', 'internal_name',
]);

/**
 * Columns that hold what a record ACTS ON. These are never a name. They were the first three
 * entries of the previous renderer's lookup and that single ordering error is PRODUCT-81.
 * They are rendered, but in their own column, under their own heading.
 */
const TARGET_FIELDS = Object.freeze([
  'collection', 'table', 'table_name', 'model_table', 'cat_item',
  'decision_table', 'ui_policy', 'source_table', 'target_table',
]);

/** Assertions that mean "this artifact is switched off". Kept in step with render.validate. */
const DEAD_ASSERTION = /\b(active|enabled|published)\s*=\s*(false|0|no)\b/i;

/** Strip the `field = ` prefix harvest puts on an assertion, leaving the value. */
function assertionValue(assertion) {
  return String(assertion == null ? '' : assertion).replace(/^\s*[a-z0-9_]+\s*=\s*/i, '').trim();
}

/**
 * The display name for one artifact.
 *
 * `locus.key` first: it is what the harvest recorded as this record's key, it is present on
 * essentially every claim, and it needs no inference. Then the name columns. A target column is
 * NEVER used — an artifact with no claimed name says so, because "unnamed" is a true statement a
 * reader can act on and "sn_ohs_im_incident" repeated fourteen times is not.
 */
function displayName(artifact) {
  if (artifact.key) { return String(artifact.key).trim(); }
  for (const f of DISPLAY_NAME_FIELDS) {
    if (artifact.fields && artifact.fields[f]) {
      const v = assertionValue(artifact.fields[f]);
      if (v) { return v; }
    }
  }
  return '(no name claimed — see sys_id)';
}

/** What this artifact acts on, for its own column. Null when nothing was claimed. */
function targetOf(artifact) {
  for (const f of TARGET_FIELDS) {
    if (artifact.fields && artifact.fields[f]) {
      const v = assertionValue(artifact.fields[f]);
      if (v) { return v; }
    }
  }
  return null;
}

/** True when the ledger says this artifact is switched off. */
function isRetired(artifact) {
  return Object.values((artifact && artifact.fields) || {}).some((a) => DEAD_ASSERTION.test(String(a)));
}

// ---------------------------------------------------------------------------
// ledger -> artifacts
// ---------------------------------------------------------------------------

function readJsonl(file) {
  if (!fs.existsSync(file)) { return []; }
  const out = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) { continue; }
    try { out.push(JSON.parse(line)); } catch (err) { /* a torn tail line is not a reason to fail */ }
  }
  return out;
}

/**
 * The same thing, for a ledger too large to hold twice.
 *
 * `claims.jsonl` on run 93838afe87 is 106MB across 39,099 lines, and readJsonl() holds the whole
 * file as one string AND every parsed row AND every `capturedResponse` at once. The appendix
 * generator needs the loci and the assertions and nothing else, so it streams in fixed chunks and
 * keeps a projection. `pick` runs on each row and returns what to keep, or null to drop it.
 */
function streamJsonl(file, pick) {
  if (!fs.existsSync(file)) { return []; }
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(1 << 22);
  const out = [];
  let tail = '';
  // A fixed-size read splits multi-byte characters at the boundary. The ledger is full of Dutch
  // prose and arrows, so decoding per chunk would corrupt roughly one character per 4MB and the
  // corruption would land in an assertion. StringDecoder holds the partial sequence instead.
  const decoder = new (require('string_decoder').StringDecoder)('utf8');
  try {
    for (;;) {
      const n = fs.readSync(fd, buf, 0, buf.length, null);
      if (n <= 0) { break; }
      const chunk = tail + decoder.write(buf.slice(0, n));
      const lines = chunk.split('\n');
      tail = lines.pop();
      for (const line of lines) {
        if (!line.trim()) { continue; }
        let row; try { row = JSON.parse(line); } catch (err) { continue; }
        const kept = pick ? pick(row) : row;
        if (kept) { out.push(kept); }
      }
    }
    tail += decoder.end();
    if (tail.trim()) {
      let row; try { row = JSON.parse(tail); } catch (err) { row = null; }
      if (row) { const kept = pick ? pick(row) : row; if (kept) { out.push(kept); } }
    }
  } finally { fs.closeSync(fd); }
  return out;
}

/** claims.jsonl is append-only with one row per claim per stage: last write wins. */
function latestById(rows) {
  const byId = new Map();
  for (const r of rows) { if (r && r.id) { byId.set(r.id, Object.assign(byId.get(r.id) || {}, r)); } }
  return [...byId.values()];
}

/**
 * Fold a claim ledger into one entry per (table, sysId), carrying every claimed field so the
 * renderer can show values rather than only identity.
 */
function indexArtifacts(claims) {
  const byKey = new Map();
  for (const c of claims) {
    if (!c || !c.locus || !c.locus.table || !c.locus.sysId) { continue; }
    const k = `${c.locus.table}|${c.locus.sysId}`;
    let a = byKey.get(k);
    if (!a) {
      a = {
        table: c.locus.table, sysId: c.locus.sysId, key: c.locus.key || null,
        fields: {}, claimIds: [], band: c.band || null, verified: 0, total: 0,
      };
      byKey.set(k, a);
    }
    if (!a.key && c.locus.key) { a.key = c.locus.key; }
    if (c.locus.field) { a.fields[c.locus.field] = c.assertion; }
    if (c.id) { a.claimIds.push(c.id); }
    a.total += 1;
    if (c.status === 'verified') { a.verified += 1; }
  }
  for (const a of byKey.values()) {
    a.display = displayName(a);
    a.target = targetOf(a);
    a.retired = isRetired(a);
  }
  return [...byKey.values()];
}

// ---------------------------------------------------------------------------
// rendering primitives
// ---------------------------------------------------------------------------

function esc(s) { return String(s == null ? '' : s).replace(/\|/g, '\\|').replace(/\r?\n/g, ' '); }
function code(s) { return '`' + String(s).replace(/`/g, "'") + '`'; }
function trunc(s, n) { const v = String(s == null ? '' : s); return v.length > n ? `${v.slice(0, n - 1)}…` : v; }

/**
 * The artifact table every page uses. The `Asserts` column is not decoration — it is the entire
 * difference between a brain and an inventory with citations, and the values in it were already
 * read and paid for. RETIRED is a marker, not a cell value, because `active = false` in a column
 * a reader skims is not a warning.
 */
function artifactTable(artifacts, opts) {
  const o = opts || {};
  const maxAsserts = o.maxAsserts || 4;
  const head = ['Artifact', 'Acts on', 'Asserts', 'sys_id', 'Verify'];
  const lines = [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`];
  for (const a of artifacts) {
    const asserts = Object.keys(a.fields)
      .filter((f) => !TARGET_FIELDS.includes(f))
      .sort()
      .slice(0, maxAsserts)
      .map((f) => esc(trunc(a.fields[f], 90)))
      .join('<br>') || '_no value claimed_';
    const name = `${a.retired ? '**RETIRED** · ' : ''}${esc(trunc(a.display, 90))}`;
    const verify = a.total ? `${a.verified}/${a.total}` : '—';
    lines.push(`| ${name} | ${a.target ? code(a.target) : '—'} | ${asserts} | ${code(a.sysId)} | ${verify} |`);
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// claim accounting — what a page SAYS it renders against what it prints
// ---------------------------------------------------------------------------

/**
 * The shape of a claim id as the ledger mints it and as a page cites it.
 * Global, so callers must reset `lastIndex` or use `claimIdsIn()`.
 */
const CLAIM_ID_RE = /C-[0-9a-f]{12}/g;

/** Every distinct claim id a rendered page actually prints. */
function claimIdsIn(text) {
  return new Set(String(text == null ? '' : text).match(CLAIM_ID_RE) || []);
}

/** A quoted or bare frontmatter string value, or null. */
function frontmatterValue(text, key) {
  const m = String(text == null ? '' : text)
    .match(new RegExp(`^${String(key).replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}:\\s*"?([^"\\n]*?)"?\\s*$`, 'm'));
  return m ? m[1] : null;
}

/** A numeric frontmatter key — `claims-rendered: 582` — or null when the page does not declare one. */
function frontmatterNumber(text, key) {
  const m = String(text == null ? '' : text)
    .match(new RegExp(`^${String(key).replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}:\\s*(\\d+)\\s*$`, 'm'));
  return m ? Number(m[1]) : null;
}

/**
 * THE THREE NUMBERS THAT MUST AGREE, per page.
 *
 * `PRODUCT-95`. A page's citation count exists in three places — the `claims-rendered` frontmatter
 * key a reader sees, the `rendersClaims` array `render.json` declares, and the claim ids actually
 * printed in the file — and until now nothing compared any of them. Measured on run 93838afe87:
 * 21 of the 33 pages declaring `claims-rendered` declare a number that is not the number of
 * distinct claim ids they print, widest `582` against `69`; `render --check` called all of it
 * clean, so the one validator the product had did not examine its own headline number.
 *
 * The invariant is SET EQUALITY between the manifest and the page, and the frontmatter is the size
 * of that set. It is deliberately equality rather than containment in one direction: containment
 * "manifest ⊆ page" alone is satisfiable by deleting the manifest, which is `PRODUCT-79`'s
 * cheapest-legal-escape defect exactly, and containment "page ⊆ manifest" alone is satisfiable by
 * deleting the citations from the page. Together, the only way to satisfy them is to derive all
 * three from one computation — which is what a renderer should have been doing.
 */
function pageClaimAccounting(repoRoot, renderArtifact) {
  const rows = [];
  for (const p of ((renderArtifact || {}).pages || [])) {
    const abs = path.resolve(repoRoot, p.path);
    const exists = fs.existsSync(abs);
    const body = exists ? fs.readFileSync(abs, 'utf8') : '';
    const printed = claimIdsIn(body);
    const manifest = new Set(p.rendersClaims || []);
    rows.push({
      path: p.path, exists, status: p.status,
      declared: frontmatterNumber(body, 'claims-rendered'),
      printed: printed.size,
      manifest: manifest.size,
      manifestNotPrinted: [...manifest].filter((id) => !printed.has(id)),
      printedNotInManifest: [...printed].filter((id) => !manifest.has(id)),
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// the evidence appendix — the claims that were paid for and never rendered
// ---------------------------------------------------------------------------

/**
 * `PRODUCT-95`, the half that recovers facts rather than merely reporting honestly on them.
 *
 * Run 93838afe87 banked 19,360 claims and cited 374 of them anywhere in the wiki. 221 of the 993
 * ground-truth facts it recovered were readable ONLY from `.brain/`, and 107 of those were
 * present-and-complete: established, verified, paid for, and reachable by nothing a reader will do.
 * Their concentration is diagnostic — Workspace 49, VendorX-Import 37, QRT 31, Data-model 23 — and it
 * is the four categories whose evidence spans the most tables per page, which is precisely where a
 * hand-curated table drops rows.
 *
 * So the appendix is GENERATED and it is COMPLETE. It is not a substitute for a curated page and
 * must not be read as one: a curated page says what the customer's process IS, and the appendix
 * says what the instance HOLDS, with the claim id behind every line. The two failure modes it
 * exists between are a curated page that silently drops a class of evidence, and a data dump
 * nobody can navigate — hence one page per table, an index that counts everything including what
 * it excluded, and the same 20KB cap every other page obeys.
 *
 * NO SILENT CAPS. Every table with claims gets a page; tables below `minClaims` are collected on
 * one page rather than dropped; a truncated assertion is counted and the count is printed.
 */
function appendixSlug(table) {
  return String(table).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'unnamed';
}

const APPENDIX_MAX_ASSERT = 1200;

/** One artifact's rows, as markdown table lines (no header). Split-safe: rows are independent. */
function appendixRows(a, counters) {
  const lines = [];
  const cell = (raw) => {
    const v = String(raw === undefined || raw === null ? '' : raw);
    if (v.length > APPENDIX_MAX_ASSERT) {
      if (counters) { counters.truncated += 1; }
      return `${v.slice(0, APPENDIX_MAX_ASSERT - 1)}…`;
    }
    return v;
  };
  for (const f of Object.keys(a.fields).sort()) {
    lines.push(`| ${code(f)} | ${esc(cell(a.fields[f])) || '_empty_'} | ${code(a.claimByField[f] || '—')} |`);
  }
  /*
   * A claim on a RECORD rather than a column — harvest emits a few — has no field to key a row
   * on, and the first version of this function simply did not render them: 8 of run 93838afe87's
   * 19,360. Eight silently-absent claims in an appendix whose entire purpose is that nothing is
   * silently absent is the defect in miniature, so they render under `(record)`.
   */
  const keyed = new Set(Object.values(a.claimByField));
  for (const id of (a.claimIds || [])) {
    if (keyed.has(id)) { continue; }
    lines.push(`| _(record)_ | ${esc(cell((a.assertionById || {})[id])) || '_no value claimed_'} | ${code(id)} |`);
  }
  /*
   * FETCHED AND NEVER CLAIMED — rendered in the SAME table, marked, rather than in a section of
   * their own. The contrast is the point: a reader sees which columns have a claim behind them
   * and which the run merely received, on one screen. `allow_update = "false"` was in this
   * position and cost a task verdict.
   *
   * Platform audit columns are compressed onto one row instead of dropped. Compressing is a
   * judgement about NOISE; dropping would be a judgement about IMPORTANCE, and the column that
   * decided the VendorX diagnosis looked unimportant right up until it did not.
   */
  const claimed = new Set(Object.keys(a.fields));
  const audit = [];
  for (const f of Object.keys(a.fetched || {}).sort()) {
    if (claimed.has(f)) { continue; }
    if (counters) { counters.unclaimed += 1; }
    if (/^sys_/.test(f)) { audit.push(`${f}=${a.fetched[f] || '(empty)'}`); continue; }
    lines.push(`| ${code(f)} | ${esc(cell(a.fetched[f])) || '_empty_'} | _fetched, never claimed_ |`);
  }
  if (audit.length) {
    lines.push(`| _(platform audit columns)_ | ${esc(cell(audit.join(' · ')))} | _fetched, never claimed_ |`);
  }
  return lines;
}

/**
 * Build the appendix page bodies for one table. Returns one or more `{ path, body, claimIds }`,
 * each under the byte cap, split at a row boundary with a stated continuation.
 */
function appendixPagesForTable(table, artifacts, opts) {
  const o = opts || {};
  const cap = o.byteCap || PAGE_BYTE_CAP;
  const dir = o.dir || 'docs/wiki/evidence';
  const counters = o.counters || { truncated: 0, unclaimed: 0 };
  const head = ['Column', 'Asserts', 'Claim'];
  const tableHead = [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`];

  const pages = [];
  let part = 1, body = null, ids = null, bytes = 0;
  const open = () => {
    body = [];
    ids = new Set();
    bytes = 0;
  };
  const close = () => {
    if (!body || !body.length) { return; }
    const rel = `${dir}/${appendixSlug(table)}${part > 1 ? `-${part}` : ''}.md`;
    /*
     * `status` is COMPUTED, exactly as it is for a curated page — the contract is that no page
     * anywhere writes that banner by hand, and a generated page inventing a sixth value
     * ("generated") would be the first exception to a rule whose whole worth is having none.
     * What kind of page it is goes in its own key.
     */
    const front = [
      '---',
      `title: "Evidence — ${table}${part > 1 ? ` (part ${part})` : ''}"`,
      'generated-by: "tools/snbrain/render.js --appendix"',
      'page-kind: "generated-evidence"',
      `table: "${table}"`,
      `claims-rendered: ${ids.size}`,
      `status: "${pageStatus([...ids], o.claimsById || new Map())}"`,
      '---',
      '',
      `# Evidence — \`${table}\`${part > 1 ? ` (part ${part})` : ''}`,
      '',
      'Generated from `.brain/claims.jsonl`. Every row is one claim: the column that was read, the',
      'value that was read, and the claim id that carries its evidence query. This page is the',
      'floor under curation, not a replacement for it — it says what the instance HOLDS, and the',
      'process pages say what the work IS.',
      '',
    ].join('\n');
    pages.push({ path: rel, table, part, body: `${front}${body.join('\n')}\n`, claimIds: [...ids] });
    part += 1;
    open();
  };
  open();

  for (const a of artifacts) {
    const heading = [
      '',
      `## ${a.retired ? '**RETIRED** · ' : ''}${esc(trunc(a.display, 120))}`,
      '',
      `\`${a.sysId}\`${a.target ? ` · acts on ${code(a.target)}` : ''} · ${a.verified}/${a.total} verified`,
      '',
    ];
    const rows = appendixRows(a, counters);
    let cursor = 0;
    while (cursor < rows.length) {
      const isContinuation = cursor > 0;
      const block = heading.slice();
      if (isContinuation) { block[1] += ' (continued)'; }
      block.push(...tableHead);
      let used = Buffer.byteLength(block.join('\n'), 'utf8');
      const taken = [];
      while (cursor < rows.length) {
        const rowBytes = Buffer.byteLength(rows[cursor], 'utf8') + 1;
        // 2KB of headroom for the frontmatter and preamble close() will prepend.
        if (bytes + used + rowBytes > cap - 2048 && (taken.length || bytes)) { break; }
        taken.push(rows[cursor]);
        used += rowBytes;
        cursor += 1;
      }
      if (!taken.length) { close(); continue; }
      body.push(...block, ...taken);
      bytes += used;
      for (const id of taken) {
        const m = id.match(/C-[0-9a-f]{12}/);
        if (m) { ids.add(m[0]); }
      }
      if (cursor < rows.length) { close(); }
    }
  }
  close();
  return pages.filter((p) => p.claimIds.length || /## /.test(p.body));
}

/**
 * Generate the whole appendix from a repo's ledger. Returns what it would write; the caller
 * decides whether to write it, so this is testable without a filesystem side effect.
 */
function buildEvidenceAppendix(repoRoot, opts) {
  const o = opts || {};
  const dir = o.dir || 'docs/wiki/evidence';
  const minClaims = o.minClaims === undefined ? 5 : o.minClaims;
  const claims = streamJsonl(path.join(repoRoot, '.brain', 'claims.jsonl'), (c) => {
    if (!c || !c.id || !c.locus || !c.locus.table || !c.locus.sysId) { return null; }
    /*
     * THE CAPTURED RESPONSE, NOT ONLY THE CLAIM. A blind tester working PLAN 6.1's own appendix
     * was stopped by `allow_update = "false"` on the VendorX intake config: fetched, returned,
     * sitting in this very file inside `evidence.capturedResponse` — and invisible, because
     * harvest minted no claim from it. That is PRODUCT-95's defect one layer down, and it decided
     * a head-to-head task verdict. Values are bounded here rather than at render time so the
     * whole ledger never sits in memory twice.
     */
    let fetched = null;
    const resp = c.evidence && c.evidence.capturedResponse;
    if (resp && typeof resp === 'object' && !Array.isArray(resp)) {
      fetched = {};
      for (const k of Object.keys(resp)) {
        const v = resp[k];
        if (v && typeof v === 'object') { continue; }   // a reference object is not a scalar column
        const str = String(v === undefined || v === null ? '' : v);
        fetched[k] = str.length > APPENDIX_MAX_ASSERT ? `${str.slice(0, APPENDIX_MAX_ASSERT - 1)}…` : str;
      }
    }
    return { id: c.id, locus: c.locus, assertion: c.assertion, status: c.status, band: c.band, fetched };
  });
  const byId = new Map();
  for (const c of claims) { byId.set(c.id, c); }

  const artifacts = indexArtifacts([...byId.values()]);
  // indexArtifacts() records the assertion per field but not which claim said it; the appendix
  // needs the id on every row, because the id is the reader's route back to the evidence query.
  const byKey = new Map(artifacts.map((a) => [`${a.table}|${a.sysId}`, a]));
  for (const a of artifacts) { a.claimByField = {}; a.assertionById = {}; a.fetched = {}; }
  for (const c of byId.values()) {
    const a = byKey.get(`${c.locus.table}|${c.locus.sysId}`);
    if (!a) { continue; }
    a.assertionById[c.id] = c.assertion;
    if (c.locus.field) { a.claimByField[c.locus.field] = c.id; }
    // Every read of this record contributes what it returned; later reads win, as elsewhere.
    if (c.fetched) { Object.assign(a.fetched, c.fetched); }
  }

  const byTable = new Map();
  for (const a of artifacts) {
    if (!byTable.has(a.table)) { byTable.set(a.table, []); }
    byTable.get(a.table).push(a);
  }
  for (const list of byTable.values()) { list.sort((x, y) => String(x.display).localeCompare(String(y.display)) || x.sysId.localeCompare(y.sysId)); }

  const counters = { truncated: 0, unclaimed: 0 };
  const tableCounts = [...byTable.entries()]
    .map(([t, list]) => ({ table: t, artifacts: list.length, claims: list.reduce((n, a) => n + a.total, 0) }))
    .sort((x, y) => y.claims - x.claims || x.table.localeCompare(y.table));

  const pages = [];
  const small = [];
  for (const row of tableCounts) {
    if (row.claims < minClaims) { small.push(row); continue; }
    pages.push(...appendixPagesForTable(row.table, byTable.get(row.table), { dir, byteCap: o.byteCap, counters, claimsById: byId }));
  }
  for (const row of small) {
    // Collected, never dropped: a table with three claims is still a class of evidence, and the
    // whole defect this appendix answers is a class of evidence disappearing without a decision.
    pages.push(...appendixPagesForTable(row.table, byTable.get(row.table), { dir: `${dir}/minor`, byteCap: o.byteCap, counters, claimsById: byId }));
  }

  const idsRendered = new Set();
  for (const p of pages) { for (const id of p.claimIds) { idsRendered.add(id); } }

  const indexLines = [
    '---',
    'title: "Evidence appendix — index"',
    'generated-by: "tools/snbrain/render.js --appendix"',
    'page-kind: "generated-evidence"',
    'status: "draft"',
    'claims-rendered: 0',
    '---',
    '',
    '# Evidence appendix',
    '',
    `Every claim in \`.brain/claims.jsonl\`, one page per table, generated. **${idsRendered.size}** of `,
    `**${byId.size}** claims across **${byTable.size}** tables and **${artifacts.length}** artifacts are`,
    `rendered here across ${pages.length} page(s), plus this index.`,
    '',
    'This is the floor under curation. A curated page selects; this one does not, so when a process page',
    'leaves a record out you can still find it here, with the claim id that carries its evidence query.',
    'Start from a curated page when you want to know how something works, and come here when you want to',
    'know what exists.',
    '',
    counters.truncated ? `${counters.truncated} assertion(s) exceeded ${APPENDIX_MAX_ASSERT} characters and are shown truncated with an ellipsis; the full value is in the claim.` : 'No assertion needed truncating.',
    '',
    `**${counters.unclaimed} column(s) are marked \`fetched, never claimed\`.** The run requested them,`,
    'the instance returned them, and no claim was minted from them — so no page states what they mean and',
    'nothing has verified them. Treat them as raw readings: the value is what came back on the date in the',
    'run stamp, and the interpretation is yours. A column here is not less true than a claimed one; it is',
    'less examined, which is a different thing and worth knowing before you act on it.',
    '',
    '| Table | Artifacts | Claims | Page |',
    '|---|---|---|---|',
  ];
  for (const row of tableCounts) {
    const mine = pages.filter((p) => p.table === row.table);
    indexLines.push(`| \`${row.table}\` | ${row.artifacts} | ${row.claims} | ${mine.map((p) => `[${path.basename(p.path)}](${path.basename(path.dirname(p.path)) === 'minor' ? 'minor/' : ''}${path.basename(p.path)})`).join(' ') || '—'} |`);
  }
  pages.push({ path: `${dir}/index.md`, table: null, part: 1, body: `${indexLines.join('\n')}\n`, claimIds: [] });

  return {
    pages,
    totals: {
      claims: byId.size, artifacts: artifacts.length, tables: byTable.size,
      claimsRendered: idsRendered.size, pagesGenerated: pages.length,
      truncatedAssertions: counters.truncated, unclaimedColumns: counters.unclaimed, minClaims,
    },
  };
}

/** Write what buildEvidenceAppendix() produced. Returns the paths written. */
function writeEvidenceAppendix(repoRoot, opts) {
  const built = buildEvidenceAppendix(repoRoot, opts);
  for (const p of built.pages) {
    const abs = path.resolve(repoRoot, p.path);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, p.body, 'utf8');
  }
  return built;
}

/** Computed from the claims a page renders. Never written by hand — that is the whole rule. */
function pageStatus(claimIds, claimsById) {
  const rows = (claimIds || []).map((id) => claimsById.get(id)).filter(Boolean);
  if (!rows.length) { return 'draft'; }
  const verified = rows.filter((c) => c.status === 'verified').length;
  if (verified === rows.length) { return 'verified'; }
  if (verified === 0) { return 'draft'; }
  return 'mixed';
}

// ---------------------------------------------------------------------------
// --decisions : the DEC ledger, engagement-shaped, generated from .brain/decisions.jsonl
// ---------------------------------------------------------------------------

/*
 * PLAN 7.2 (folds 6.8 / PRODUCT-75). The deliverable is a DEC-style ledger — rationale, impact,
 * the forward-acting principle, a visible confidence tier, and the anchor links that let an L1
 * drift verdict reach the decision. Generated, like the appendix, because the last hand-written
 * decisions ledger was an agent table whose links nothing computed: run 5's 36 decisions carry
 * 13 with any anchor, and `explainsClaims` is empty on all 51 of run 4's.
 *
 * THE REFUSAL. A decision with zero anchors and no `linkage: 'unbound'` disclosure is REFUSED —
 * not rendered, and reported in one aggregate rejection. The cheapest legal satisfaction is the
 * honest one: the mint paths now set `linkage` themselves (CLI-computed, never agent-supplied),
 * so a new run can only produce a refusable row by smuggling a decision past the mint paths.
 * Legacy rows predating the field re-enter the ledger through a run that re-mints them.
 *
 * THE ID COLLISION, inherited from run 5's own workaround: `DEC-` + 12 hex CONTAINS a match for
 * CLAIM_ID_RE (`C-` + 12 hex), so printing raw decision ids would corrupt every page's
 * claims-rendered accounting. Wiki ids are DEC-001.. in ledger append order, never renumbered —
 * a refused row keeps its number reserved — and the ledger hash prints bare.
 */
function buildDecisionLedger(repoRoot, opts) {
  const o = opts || {};
  const dir = (o.wiki || 'docs/wiki').replace(/\/+$/, '');
  const decisions = latestById(readJsonl(path.join(repoRoot, '.brain', 'decisions.jsonl')));
  const claims = latestById(readJsonl(path.join(repoRoot, '.brain', 'claims.jsonl')));
  const claimsById = new Map(claims.map((c) => [c.id, c]));

  const rejections = [];
  const refused = [];
  const danglingAnchors = [];
  const entries = [];
  const unknowns = [];
  let retiredInduced = 0;
  let unbound = 0;

  decisions.forEach((dec, i) => {
    const num = `DEC-${String(i + 1).padStart(3, '0')}`;
    const tier = decisionTier(dec);
    const anchors = decisionAnchors(dec);
    const missing = anchors.filter((id) => !claimsById.has(id));
    if (missing.length) { danglingAnchors.push({ num, id: dec.id, missing }); }
    if (tier === 'unknown') { unknowns.push({ num, dec, anchors }); return; }
    if (dec.confirmationStatus === 'retired') { retiredInduced += 1; return; }
    if (!anchors.length && dec.linkage !== 'unbound') { refused.push({ num, id: dec.id }); return; }
    if (!anchors.length) { unbound += 1; }
    entries.push({ num, dec, tier, anchors });
  });

  if (refused.length) {
    rejections.push(
      `${refused.length} of ${decisions.length} decision(s) carry zero anchors and no linkage: 'unbound' disclosure, and are ` +
      `REFUSED from the DEC ledger (population: every decision in .brain/decisions.jsonl, deduplicated by id): ` +
      `${refused.slice(0, 8).map((r) => `${r.num} (${r.id})`).join(', ')}${refused.length > 8 ? `, and ${refused.length - 8} more` : ''}. ` +
      `An unanchored, undisclosed decision is L5 memory no L1 verdict can reach — supersession cannot flag it when the ` +
      `instance moves, which is the single capability that distinguishes this ledger from a markdown template. The mint ` +
      `paths set linkage themselves; a legacy row re-enters through a run that re-mints it with the current schema.`);
  }
  if (danglingAnchors.length) {
    rejections.push(
      `${danglingAnchors.length} decision(s) cite anchor claim ids that are not in the ledger ` +
      `(e.g. ${danglingAnchors.slice(0, 3).map((d) => `${d.num} -> ${d.missing[0]}`).join('; ')}). ` +
      `An anchor is the CLI's own link; one that resolves to nothing is either a hand-edited ledger or a minting defect, ` +
      `and rendering it would print a citation a reader cannot follow.`);
  }

  const claimIds = new Set();
  const lines = [];
  const TIER_CAVEAT = {
    confirmed: 'a human said it — the entry names who and when',
    induced: 'an evidence-backed hypothesis no human has confirmed — use it WITH this caveat; the anchors are its whole argument',
  };
  for (const e of entries) {
    const d = e.dec;
    lines.push(`### ${e.num} — ${trunc(String(d.statement || '(no statement)'), 90)}`);
    lines.push('');
    lines.push(`\`${e.tier}\` · ${d.answeredBy || '(unattributed)'} · ${d.answeredAt || '?'} · ledger \`${String(d.id || '').replace(/^DEC-/, '')}\``);
    lines.push('');
    lines.push(`**Decision:** ${d.statement || '(no statement)'}`);
    lines.push(`**Rationale:** ${d.rationale || `— none recorded (rationaleStrength: ${d.rationaleStrength || 'absent'})`}`);
    if (d.impact) { lines.push(`**Impact:** ${d.impact}`); }
    if (d.principle) { lines.push(`**Principle:** ${d.principle}`); }
    if (e.tier === 'induced') { lines.push(`**Caveat:** ${TIER_CAVEAT.induced}.${d.anchorSource ? ` Induced from: ${d.anchorSource}.` : ''}`); }
    if (e.anchors.length) {
      lines.push(`**Anchors:** ${e.anchors.map((id) => `\`${id}\``).join(', ')}${d.anchorSource && e.tier !== 'induced' ? ` (${d.anchorSource})` : ''}`);
      for (const id of e.anchors) { claimIds.add(id); }
    } else {
      lines.push('**Anchors:** none — `linkage: unbound`. This decision rests on no claim; an L1 drift verdict cannot reach it. Do not build on it beyond what it states; it is confirmed or retired at the next interview, never extended.');
    }
    const recon = (d.reconfirmation || []).filter((r) => r && r.claim);
    if (d.confirmationStatus === 'needs-reconfirmation' && recon.length) {
      const last = recon[recon.length - 1];
      lines.push(`**⚠ NEEDS RECONFIRMATION** — witnessing claim \`${last.claim}\` went ${last.to || 'drifted'} on ${String(last.at || '').slice(0, 10)}. Treat the decision as open until a human reconfirms it.`);
      claimIds.add(last.claim);
    }
    lines.push('');
  }

  const status = pageStatus([...claimIds], claimsById);
  const header = [
    '---',
    'title: "Decision Ledger"',
    `status: "${claimIds.size ? status : 'draft'}"`,
    `claims-rendered: ${claimIds.size}`,
    '---',
    '',
    '# Architectural Decision Ledger',
    '',
    '> Verify sys_ids and instance state against the live instance before use.',
    '',
    'Generated from `.brain/decisions.jsonl` — never edited by hand. Wiki ids are `DEC-001`.. in ledger',
    'append order and are NEVER renumbered; a missing number is a decision the generator refused (zero',
    'anchors, no disclosure) and said so at generation time. The ledger id in `.brain/decisions.jsonl`',
    'is `DEC-` followed by the bare hash printed on each entry — the prefixed form collides with the',
    'claim-id pattern and would corrupt the citation accounting of every page that printed it.',
    '',
    'Every entry carries a **tier**:',
    '',
    `- \`confirmed\` — ${TIER_CAVEAT.confirmed}.`,
    `- \`induced\` — ${TIER_CAVEAT.induced}.`,
    '- `unknown` — not in this ledger at all: it renders into [tbd.md](tbd.md), and the rule is fixed: **the agent must not improvise over it**.',
    '',
    'An entry\'s **anchors** are the claim ids that witness it. When one of them drifts or dies, the CLI',
    'flags the decision here (`confirmed`) or retires it outright (`induced` — a hypothesis that lost its',
    `evidence is not a caveat, it is gone${retiredInduced ? `; ${retiredInduced} such entr${retiredInduced === 1 ? 'y is' : 'ies are'} retired and not shown` : ''}).`,
    '',
  ];

  const body = `${header.concat(lines).join('\n')}\n`;
  const tbdBlock = unknowns.length ? [
    UNKNOWN_DECISIONS_START,
    '## Unknowns minted by the loop — the agent must not improvise over these',
    '',
    'Generated from `.brain/decisions.jsonl` (tier `unknown`). Each is a question the evidence raised and',
    'no human has answered. An agent that meets one designs AROUND it and says so, or stops and asks —',
    'never fills it in from general knowledge. (The standing rule, and the reason this block exists.)',
    '',
    '| # | Statement | Anchors |',
    '|---|---|---|',
  ].concat(unknowns.map((u) => `| ${u.num} | ${esc(trunc(String(u.dec.statement || ''), 160))} | ${u.anchors.map((id) => code(id)).join(' ') || '—'} |`))
    .concat(['', UNKNOWN_DECISIONS_END]).join('\n') : null;

  return {
    page: { path: `${dir}/decisions.md`, body, claimIds: [...claimIds], status: claimIds.size ? status : 'draft' },
    tbdBlock,
    rejections,
    totals: {
      decisions: decisions.length, rendered: entries.length, refused: refused.length,
      unbound, unknowns: unknowns.length, retiredInduced,
      anchorsResolved: claimIds.size, danglingAnchors: danglingAnchors.length,
      byTier: entries.reduce((m, e) => { m[e.tier] = (m[e.tier] || 0) + 1; return m; }, {}),
    },
  };
}

const UNKNOWN_DECISIONS_START = '<!-- snbrain:unknown-decisions:start -->';
const UNKNOWN_DECISIONS_END = '<!-- snbrain:unknown-decisions:end -->';

// ---------------------------------------------------------------------------
// --source-appendix : full captured bodies for the explain-selected artifacts
// ---------------------------------------------------------------------------

/*
 * PLAN 7.7(a), closing PRODUCT-100's remainder. Bounded egress (LOOP.md §9) and the
 * .brain/raw exclusion (PRODUCT-97) combined to answer "where does a developer read a script
 * body?" with NOWHERE: all three blind testers leaned on .brain/raw/verify.ndjson — the one
 * file that does not ship — and one wrote "I found it by accident". This is PRODUCT-100's
 * option 2, the shape that satisfies both prior decisions instead of reversing either: a
 * tracked digest of the bodies, for the EXPLAIN-SELECTED artifacts only (bounded by the
 * explain cap), generated like the appendix, shipping inside the wiki.
 *
 * THE BODY IS THE LONGEST THE BRAIN HOLDS, AND SAYS WHERE IT CAME FROM. Run 4's behaviour
 * claims carry ~1.4KB-capped windows while its raw verify rows hold full source — the
 * truncated view beside the full one, the fixture-coincidence trap's natural habitat. The
 * generator takes the claim's captured body AND any raw row's same-field value for the same
 * sys_id, keeps the longer, and prints which won with both lengths, so a reader can see when
 * they are reading a window.
 *
 * NO REDACTION PASS RUNS, and every page says so rather than implying one: explain's cap
 * curates the set, the text ships verbatim, and clearing it for a customer audience is the
 * operator's judgement, not this generator's.
 */
/** A tilde fence longer than any tilde run inside the body, minimum the markdown standard three. */
function fenceFor(body) {
  const longest = (String(body).match(/~+/g) || []).reduce((n, run) => Math.max(n, run.length), 0);
  return '~'.repeat(Math.max(3, longest + 1));
}

function buildSourceAppendix(repoRoot, opts) {
  const o = opts || {};
  const wiki = (o.wiki || 'docs/wiki').replace(/\/+$/, '');
  const dir = o.dir || `${wiki}/evidence/source`;
  const claims = latestById(readJsonl(path.join(repoRoot, '.brain', 'claims.jsonl')));
  const claimsById = new Map(claims.map((c) => [c.id, c]));
  const behaviour = claims.filter((c) => c.behaviour && c.behaviour.bodyField && c.locus && c.locus.sysId);

  // Raw rows for the selected sys_ids: one streaming pass per raw file, longest value wins.
  const wanted = new Map();
  for (const b of behaviour) {
    wanted.set(b.locus.sysId, { bodyField: b.behaviour.bodyField, raw: '' });
  }
  const rawDir = path.join(repoRoot, '.brain', 'raw');
  if (fs.existsSync(rawDir) && wanted.size) {
    for (const f of fs.readdirSync(rawDir).filter((n) => n.endsWith('.ndjson'))) {
      streamJsonl(path.join(rawDir, f), (row) => {
        /*
         * Two raw shapes exist in the field and both carry bodies: run 5 writes
         * {table, rows: [{sys_id, script, …}]}, run 4 writes {kind: 'row', sysId,
         * response: {script, …}}. Handling one and not the other reads as "0 bodies from
         * raw" on the exact run PRODUCT-100 was filed against — measured, then fixed.
         */
        const rows = (row && Array.isArray(row.rows)) ? row.rows : (row && row.sys_id ? [row] : []);
        if (row && row.sysId && row.response && typeof row.response === 'object') {
          rows.push(Object.assign({ sys_id: row.sysId }, row.response));
        }
        for (const r of rows) {
          const w = r && r.sys_id && wanted.get(r.sys_id);
          if (w && typeof r[w.bodyField] === 'string' && r[w.bodyField].length > w.raw.length) { w.raw = r[w.bodyField]; }
        }
        return null;
      });
    }
  }

  const pages = [];
  const counters = { fromRaw: 0, fromClaim: 0, bodiless: 0, truncated: 0 };
  const indexRows = [];
  for (const b of behaviour) {
    const resp = (b.evidence && b.evidence.capturedResponse) || {};
    const claimBody = typeof resp[b.behaviour.bodyField] === 'string' ? resp[b.behaviour.bodyField] : '';
    const rawBody = wanted.get(b.locus.sysId).raw;
    const fromRaw = rawBody.length > claimBody.length;
    const body = fromRaw ? rawBody : claimBody;
    let name = b.locus.key || null;
    if (!name) { for (const f of DISPLAY_NAME_FIELDS) { if (typeof resp[f] === 'string' && resp[f]) { name = resp[f]; break; } } }
    name = name || `${b.locus.table}/${b.locus.sysId.slice(0, 12)}`;
    if (!body) {
      counters.bodiless += 1;
      indexRows.push({ name, table: b.locus.table, sysId: b.locus.sysId, page: null, len: 0 });
      continue;
    }
    counters[fromRaw ? 'fromRaw' : 'fromClaim'] += 1;
    const cap = PAGE_BYTE_CAP - 2048;
    const shown = body.length > cap ? body.slice(0, cap) : body;
    if (shown.length < body.length) { counters.truncated += 1; }
    const rel = `${dir}/${appendixSlug(b.locus.table)}-${b.locus.sysId.slice(0, 12)}.md`;
    const lines = [
      '---',
      `title: "source: ${String(name).replace(/"/g, "'").slice(0, 80)}"`,
      `status: "${pageStatus([b.id], claimsById)}"`,
      'claims-rendered: 1',
      '---',
      '',
      `# Source — ${name}`,
      '',
      `\`${b.locus.table}\` / \`${b.locus.sysId}\` · field \`${b.behaviour.bodyField}\` · behaviour claim \`${b.id}\``,
      '',
      `> ${b.assertion}`,
      '',
      `${body.length} chars, from ${fromRaw
        ? `the raw capture — the claim's stored window holds ${claimBody.length}, and a window is not the script`
        : 'the behaviour claim\'s captured response'}. No redaction pass has run on this text.`,
      ...(shown.length < body.length
        ? [`**TRUNCATED at ${shown.length} of ${body.length} chars for the page cap — the remainder is in .brain, and this line is the declaration.**`] : []),
      '',
      // The fence outruns any tilde run in the body itself — never rewrite the body to fit
      // the fence: a mangled script quoted as source is worse than no source page.
      `${fenceFor(shown)}javascript`,
      shown,
      fenceFor(shown),
      '',
    ];
    pages.push({ path: rel, body: `${lines.join('\n')}\n`, claimIds: [b.id] });
    indexRows.push({ name, table: b.locus.table, sysId: b.locus.sysId, page: rel, len: body.length, fromRaw });
  }

  const indexLines = [
    '---',
    'title: "Source appendix — the explain-read bodies, quotable"',
    'status: "mixed"',
    'claims-rendered: 0',
    '---',
    '',
    '# Source appendix',
    '',
    `The full captured body of every artifact the explain stage selected and read — ${pages.length} of ` +
    `${behaviour.length} (${counters.bodiless} carried no body anywhere in .brain and are listed without a page). ` +
    'The architect quotes the script from the deliverable; on the last scored round all three blind testers had to ' +
    'find `.brain/raw/verify.ndjson` by accident instead. No redaction pass has run on these bodies.',
    '',
    '| Artifact | Table | Body | Page |',
    '|---|---|---|---|',
    ...indexRows.map((r) => `| ${esc(trunc(r.name, 60))} | \`${r.table}\` | ${r.len ? `${r.len} chars${r.fromRaw ? ' (raw)' : ''}` : '— none captured'} | ${r.page ? `[${path.basename(r.page)}](${path.basename(r.page)})` : '—'} |`),
    '',
  ];
  pages.push({ path: `${dir}/index.md`, body: `${indexLines.join('\n')}\n`, claimIds: [] });

  return {
    pages,
    totals: {
      selected: behaviour.length, pagesGenerated: pages.length,
      fromRaw: counters.fromRaw, fromClaim: counters.fromClaim,
      bodiless: counters.bodiless, truncated: counters.truncated,
    },
  };
}

/** Write what buildSourceAppendix() produced. */
function writeSourceAppendix(repoRoot, opts) {
  const built = buildSourceAppendix(repoRoot, opts);
  for (const p of built.pages) {
    const abs = path.resolve(repoRoot, p.path);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, p.body, 'utf8');
  }
  built.written = true;
  return built;
}

// ---------------------------------------------------------------------------
// instance mentions (PLAN 7.6 / PRODUCT-92) — shared by the kernel-facts
// generator and render.validate, one implementation on purpose
// ---------------------------------------------------------------------------

/** An instance hostname must reach this many claims before the kernel asserts it as landscape. */
const INSTANCE_CLAIM_FLOOR = 10;

/** service-now.com subdomains that are the PLATFORM's, never a customer instance. Measured: run 5's
 * ledger carries 28 `www.service-now.com` doc links, which is not a fifth environment. */
const PLATFORM_HOSTS = Object.freeze(new Set(['www', 'developer', 'docs', 'partner', 'support', 'community', 'store', 'hi', 'instance']));

function instanceMentions(claims) {
  const counts = new Map();
  const bump = (host) => { if (!PLATFORM_HOSTS.has(host)) { counts.set(host, (counts.get(host) || 0) + 1); } };
  for (const c of claims) {
    const s = JSON.stringify(c);
    for (const m of s.matchAll(/\b([a-z][a-z0-9-]*)\.service-now\.com/g)) { bump(m[1]); }
    /*
     * PRODUCT-92's decisive rows carry the BARE name, not the URL: run 4's ledger holds
     * `x_lsmcb_sca_environment.instance = devinst02` on an active row, and counting URLs alone
     * missed the acceptance and test instances entirely. An `instance = <name>` assertion is
     * an instance mention by construction. Measured with both legs on run 5's ledger: prodinst01
     * 71, devinst02 65, accinst01 63, testinst01 27 — the four-environment topology the kernel must name.
     */
    const bare = /^(?:instance|instance_name) = ([a-z][a-z0-9-]{2,40})$/.exec(String(c.assertion || ''));
    if (bare) { bump(bare[1]); }
  }
  return [...counts.entries()].map(([host, n]) => ({ host, claims: n })).sort((a, b) => b.claims - a.claims);
}

// ---------------------------------------------------------------------------
// --gates : enforcement minted from conventions (PLAN 7.5)
// ---------------------------------------------------------------------------

/*
 * Verified conventions become CHECKS THAT REFUSE VIOLATING WORK — the reference engagement's gate.js +
 * verify:capture is the shape: a hook entry in .claude/settings.json plus a small gate
 * script, each citing the convention claim id it enforces. An unenforceable convention
 * renders as prose with an explicit `enforcement: none — <why>` line, so the gap is visible
 * instead of silent.
 *
 * THE CHEAPEST-LEGAL QUESTION APPLIES WITH FORCE (METHOD-4): a minted check must be one the
 * mapped work can actually satisfy, or agents will delete the hook. So every naming check is
 * MEASURED against the run's own ledger per artifact class first, and a class the existing
 * work itself violates is EXCLUDED and reported — a naming rule 40% of the customer's own
 * artifacts break is a finding about the convention, not a hook. Measured on pilot-run-4's
 * ledger this is exactly the class-conditional picture the interview confirmed (DEC-036):
 * catalog_ui_policy 100%, sys_ui_policy 92%, sysevent_email_action 93% … sys_ui_action 4%,
 * the deliberate exemption, visible in the data with no prose parsing.
 */
const CONVENTION_COMPLIANCE_FLOOR = 0.8;
const CONVENTION_MIN_CLASS = 5;
/** The classes a naming convention about "artifacts we build" is measured over: logic, not rows. */
const CONVENTION_LOGIC_TABLES = Object.freeze([
  'sys_script', 'sys_script_include', 'sys_script_client', 'sys_ui_policy', 'sys_ui_action',
  'catalog_ui_policy', 'catalog_script_client', 'sysevent_email_action', 'sysauto_script',
]);

function conventionPatternRegex(pattern) {
  const esc = String(pattern || '').replace(/[.*+?^${}()|[\]\\]/g, (ch) => (ch === '*' ? '.*' : `\\${ch}`));
  return new RegExp(`^${esc}`, 'i');
}

/** Display name for (table, sysId) from the claims on it: locus.key first, then captured name columns. */
function conventionArtifactNames(claims, tables) {
  const wanted = new Set(tables);
  const byKey = new Map();
  for (const c of claims) {
    const t = c.locus && c.locus.table;
    if (!wanted.has(t)) { continue; }
    const k = `${t}|${c.locus.sysId}`;
    const cur = byKey.get(k) || { table: t, name: null };
    if (!cur.name && c.locus.key) { cur.name = String(c.locus.key); }
    if (!cur.name) {
      const resp = c.evidence && c.evidence.capturedResponse;
      if (resp && typeof resp === 'object') {
        for (const f of DISPLAY_NAME_FIELDS) {
          if (resp[f] && typeof resp[f] === 'string') { cur.name = resp[f]; break; }
        }
      }
    }
    byKey.set(k, cur);
  }
  return [...byKey.values()].filter((a) => a.name);
}

function gateScriptBody(opts) {
  const { kind, claimId, statement, headerLines, checkJs, message } = opts;
  return [
    '#!/usr/bin/env node',
    '/*',
    ` * convention gate: ${kind}`,
    ` * @enforces ${claimId} — "${statement}"`,
    ' *',
    ...headerLines.map((l) => ` * ${l}`),
    ' *',
    ' * Claude Code PreToolUse hook: reads the tool-use JSON from stdin; exit 2 refuses the',
    ' * call with the message below; exit 0 lets it pass. Deleting this file is a recorded',
    ' * decision, not a workaround — it cites the claim above, and the claim does not go away.',
    ' */',
    "'use strict';",
    "let raw = '';",
    "process.stdin.on('data', (d) => { raw += d; });",
    "process.stdin.on('end', () => {",
    '  let input = {};',
    "  try { input = JSON.parse(raw); } catch (e) { process.exit(0); }",
    "  const text = JSON.stringify(input.tool_input || input || {});",
    '  // An update to an existing record carries its sys_id; this gate constrains NEW work only.',
    '  if (/"sys_id"\\s*:\\s*"[0-9a-f]{32}"/.test(text)) { process.exit(0); }',
    checkJs,
    '  process.exit(0);',
    '});',
    '',
    `const MESSAGE = ${JSON.stringify(message)};`,
    '',
  ].join('\n');
}

function buildConventionGates(repoRoot) {
  const state = JSON.parse(fs.readFileSync(path.join(repoRoot, '.brain', 'state.json'), 'utf8'));
  const conventions = ((state.queue || {}).statedConventions || []);
  const claims = latestById(readJsonl(path.join(repoRoot, '.brain', 'claims.jsonl')));
  const claimsById = new Map(claims.map((c) => [c.id, c]));
  const decisions = latestById(readJsonl(path.join(repoRoot, '.brain', 'decisions.jsonl')));

  const gates = [];
  const prose = [];
  const rejections = [];

  for (const conv of conventions) {
    const claim = claimsById.get(conv.claimId);
    if (!claim) {
      rejections.push(`convention "${conv.kind}" cites claim ${conv.claimId}, which is not in the ledger: a check citing nothing enforces nothing.`);
      continue;
    }
    // Refinements: interview decisions that witness this convention's claim. DEC-036 (the
    // sys_ui_action exemption) and DEC-032 (the PER carve-out) arrive here mechanically.
    const refinements = decisions.filter((d) => (d.witnessClaims || []).includes(conv.claimId) && d.derivedFrom === 'interview')
      .map((d) => d.statement);

    if (conv.kind === 'artifact-naming' && conv.pattern) {
      const re = conventionPatternRegex(conv.pattern);
      const arts = conventionArtifactNames(claims, CONVENTION_LOGIC_TABLES);
      const per = new Map();
      for (const a of arts) {
        const t = per.get(a.table) || { n: 0, ok: 0 };
        t.n += 1; if (re.test(a.name)) { t.ok += 1; }
        per.set(a.table, t);
      }
      const measured = [...per.entries()].map(([table, v]) => ({ table, n: v.n, ok: v.ok, ratio: v.ok / v.n }));
      const enforced = measured.filter((m) => m.n >= CONVENTION_MIN_CLASS && m.ratio >= CONVENTION_COMPLIANCE_FLOOR).map((m) => m.table).sort();
      const excluded = measured.filter((m) => !enforced.includes(m.table));
      if (!enforced.length) {
        prose.push({
          kind: conv.kind, claimId: conv.claimId,
          enforcement: `none — measured against this run's own ledger, no artifact class of ${CONVENTION_MIN_CLASS}+ named ` +
            `logic artifacts satisfies "${conv.pattern}" at ${Math.round(CONVENTION_COMPLIANCE_FLOOR * 100)}% ` +
            `(${measured.map((m) => `${m.table} ${m.ok}/${m.n}`).join(', ') || 'no named logic artifacts in the ledger'}); ` +
            'a hook the mapped work itself violates is a hook agents delete, so the gap ships as this FINDING instead',
        });
        continue;
      }
      const message = `convention ${conv.kind} (claim ${conv.claimId}): a new artifact on ` +
        `${enforced.join('/')} must carry a name matching ${conv.pattern} — measured on this engagement's own ledger ` +
        `(${measured.filter((m) => enforced.includes(m.table)).map((m) => `${m.table} ${m.ok}/${m.n}`).join(', ')}). ` +
        'Rename it, or record the exception as a decision instead of skipping the check.';
      gates.push({
        path: `.claude/hooks/convention-${conv.kind}-${conv.claimId.slice(2, 8)}.js`,
        claimId: conv.claimId,
        kind: conv.kind,
        measured, enforcedTables: enforced,
        hookEntry: { matcher: 'Bash|PowerShell|Write|Edit|MultiEdit', command: `node .claude/hooks/convention-${conv.kind}-${conv.claimId.slice(2, 8)}.js` },
        body: gateScriptBody({
          kind: conv.kind, claimId: conv.claimId, statement: conv.statement,
          headerLines: [
            `enforced classes (measured >= ${Math.round(CONVENTION_COMPLIANCE_FLOOR * 100)}% on ${CONVENTION_MIN_CLASS}+ artifacts): ` +
              measured.filter((m) => enforced.includes(m.table)).map((m) => `${m.table} ${m.ok}/${m.n}`).join(', '),
            `excluded classes (the convention is class-conditional; enforcing them would refuse the customer's own work): ` +
              (excluded.map((m) => `${m.table} ${m.ok}/${m.n}`).join(', ') || 'none'),
            ...refinements.map((r) => `interview refinement: ${r}`),
          ],
          checkJs: [
            `  const TABLES = ${JSON.stringify(enforced)};`,
            '  const hitsTable = TABLES.some((t) => text.includes(\'"table":"\' + t + \'"\') || text.includes(\'"table": "\' + t + \'"\'));',
            '  const nm = /"name"\\s*:\\s*"([^"]+)"/.exec(text);',
            `  if (hitsTable && nm && !${re.toString()}.test(nm[1])) { console.error(MESSAGE + ' (got: "' + nm[1] + '")'); process.exit(2); }`,
          ].join('\n'),
          message,
        }),
      });
    } else if (conv.kind === 'update-set-naming' && conv.pattern) {
      const re = conventionPatternRegex(conv.pattern);
      const message = `convention ${conv.kind} (claim ${conv.claimId}): a new update set must be named ` +
        `${conv.pattern} plus a story-shaped suffix — "${conv.statement}". Name it after its story, or record the exception as a decision.`;
      gates.push({
        path: `.claude/hooks/convention-${conv.kind}-${conv.claimId.slice(2, 8)}.js`,
        claimId: conv.claimId,
        kind: conv.kind,
        measured: [], enforcedTables: ['sys_update_set'],
        hookEntry: { matcher: 'Bash|PowerShell|Write|Edit|MultiEdit', command: `node .claude/hooks/convention-${conv.kind}-${conv.claimId.slice(2, 8)}.js` },
        body: gateScriptBody({
          kind: conv.kind, claimId: conv.claimId, statement: conv.statement,
          headerLines: [
            'constrains only names this repo\'s agents compose for NEW update sets — the cheapest legal',
            'satisfaction is compliance, which costs nothing and degrades nothing.',
            ...refinements.map((r) => `interview refinement: ${r}`),
          ],
          checkJs: [
            '  const isSet = /"table"\\s*:\\s*"sys_update_set"/.test(text);',
            '  const nm = /"name"\\s*:\\s*"([^"]+)"/.exec(text);',
            `  if (isSet && nm && !${re.toString()}.test(nm[1])) { console.error(MESSAGE + ' (got: "' + nm[1] + '")'); process.exit(2); }`,
          ].join('\n'),
          message,
        }),
      });
    } else {
      prose.push({
        kind: conv.kind, claimId: conv.claimId,
        enforcement: `none — ${conv.testable === false || !conv.pattern
          ? 'the convention states no measurable pattern, and a check needs a predicate; it holds as recorded guidance'
          : 'no enforceable shape (naming pattern, bilingual rule, scope/update-set rule) fits it'}`,
      });
    }
  }

  return {
    gates, prose, rejections,
    totals: {
      conventions: conventions.length, minted: gates.length, unenforceable: prose.length,
      enforcedClasses: gates.reduce((n, g) => n + g.enforcedTables.length, 0),
    },
  };
}

const CONVENTION_ENFORCEMENT_START = '<!-- snbrain:convention-enforcement:start -->';
const CONVENTION_ENFORCEMENT_END = '<!-- snbrain:convention-enforcement:end -->';

/** Write gate scripts, merge their hook entries into .claude/settings.json, splice the enforcement block into conventions.md. */
function writeConventionGates(repoRoot, opts) {
  const built = buildConventionGates(repoRoot);
  if (built.rejections.length) { return built; }
  for (const g of built.gates) {
    const abs = path.resolve(repoRoot, g.path);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, g.body, 'utf8');
  }
  // settings.json: idempotent merge, keyed on the command string.
  const settingsAbs = path.resolve(repoRoot, '.claude', 'settings.json');
  let settings = {};
  if (fs.existsSync(settingsAbs)) {
    try { settings = JSON.parse(fs.readFileSync(settingsAbs, 'utf8')); } catch (e) { settings = {}; }
  }
  settings.hooks = settings.hooks || {};
  settings.hooks.PreToolUse = settings.hooks.PreToolUse || [];
  for (const g of built.gates) {
    const present = JSON.stringify(settings.hooks.PreToolUse).includes(g.hookEntry.command);
    if (!present) {
      settings.hooks.PreToolUse.push({ matcher: g.hookEntry.matcher, hooks: [{ type: 'command', command: g.hookEntry.command }] });
    }
  }
  fs.mkdirSync(path.dirname(settingsAbs), { recursive: true });
  fs.writeFileSync(settingsAbs, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
  // conventions.md: the enforcement block, spliced between markers so the gap is visible.
  const wiki = (opts && opts.wiki) || 'docs/wiki';
  const convAbs = path.resolve(repoRoot, wiki, 'conventions.md');
  const block = [
    CONVENTION_ENFORCEMENT_START,
    '## Enforcement — generated, one line per stated convention',
    '',
    ...built.gates.map((g) => `- **${g.kind}** — enforced by \`${g.path}\` (claim \`${g.claimId}\`${g.enforcedTables.length ? `; classes: ${g.enforcedTables.join(', ')}` : ''})`),
    ...built.prose.map((p) => `- **${p.kind}** — enforcement: ${p.enforcement} (claim \`${p.claimId}\`)`),
    '',
    CONVENTION_ENFORCEMENT_END,
  ].join('\n');
  let text = fs.existsSync(convAbs) ? fs.readFileSync(convAbs, 'utf8')
    : '---\ntitle: "Conventions"\nstatus: "draft"\nclaims-rendered: 0\n---\n\n# Conventions\n';
  const s = text.indexOf(CONVENTION_ENFORCEMENT_START);
  const e = text.indexOf(CONVENTION_ENFORCEMENT_END);
  if (s >= 0 && e > s) { text = text.slice(0, s) + block + text.slice(e + CONVENTION_ENFORCEMENT_END.length); }
  else { text = `${text.replace(/\s*$/, '')}\n\n${block}\n`; }
  fs.mkdirSync(path.dirname(convAbs), { recursive: true });
  fs.writeFileSync(convAbs, text, 'utf8');
  built.written = true;
  return built;
}

/** Write decisions.md, and splice the unknowns block into tbd.md between its markers. */
function writeDecisionLedger(repoRoot, opts) {
  const built = buildDecisionLedger(repoRoot, opts);
  // A rejected ledger is not written at all: partial output would ship the refusal as a silent
  // gap, and the loop's contract everywhere else is fix-and-re-ingest, never ship-what-passed.
  if (built.rejections.length) { return built; }
  const abs = path.resolve(repoRoot, built.page.path);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, built.page.body, 'utf8');
  if (built.tbdBlock) {
    const tbdAbs = path.resolve(repoRoot, path.posix.join(path.posix.dirname(built.page.path), 'tbd.md'));
    let text = fs.existsSync(tbdAbs) ? fs.readFileSync(tbdAbs, 'utf8')
      : '---\ntitle: "TBD Register"\nstatus: "draft"\nclaims-rendered: 0\n---\n\n# TBD Register — the open debt\n';
    const start = text.indexOf(UNKNOWN_DECISIONS_START);
    const end = text.indexOf(UNKNOWN_DECISIONS_END);
    if (start >= 0 && end > start) {
      text = text.slice(0, start) + built.tbdBlock + text.slice(end + UNKNOWN_DECISIONS_END.length);
    } else {
      text = `${text.replace(/\s*$/, '')}\n\n${built.tbdBlock}\n`;
    }
    fs.writeFileSync(tbdAbs, text, 'utf8');
    built.tbdPath = path.posix.join(path.posix.dirname(built.page.path), 'tbd.md');
  }
  built.written = true;
  return built;
}

// ---------------------------------------------------------------------------
// --check : audit a rendered wiki against the contract
// ---------------------------------------------------------------------------

/** CONTRACT.md §Size & splitting. Prose until now, and 78 of 160 pages broke it. */
const PAGE_BYTE_CAP = 20 * 1024;

/**
 * Files the installer ships as governance. The agent overwrote all thirteen on the last run, and
 * the only CONTRACT.md clause that survived verbatim was the one clause hardcoded in a validator.
 * Ledger pages are meant to be written; these are not. (PRODUCT-69)
 */
const GOVERNANCE_FILES = Object.freeze(['CONTRACT.md', 'processes/_TEMPLATE.md', 'stories/_TEMPLATE.md']);

function checkWiki(repoRoot, wikiRel) {
  const problems = [];
  const wikiRoot = path.resolve(repoRoot, wikiRel || 'docs/wiki');
  if (!fs.existsSync(wikiRoot)) { return [`wiki root does not exist: ${wikiRoot}`]; }

  const claims = latestById(readJsonl(path.join(repoRoot, '.brain', 'claims.jsonl')));
  const claimsById = new Map(claims.map((c) => [c.id, c]));

  const pageText = [];
  const declaredMismatch = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) { walk(abs); continue; }
      if (!/\.md$/i.test(e.name)) { continue; }
      const rel = path.relative(wikiRoot, abs).split(path.sep).join('/');
      const body = fs.readFileSync(abs, 'utf8');
      pageText.push(body);

      if (Buffer.byteLength(body, 'utf8') > PAGE_BYTE_CAP) {
        problems.push(
          `${rel}: ${(Buffer.byteLength(body, 'utf8') / 1024).toFixed(1)}KB exceeds the ~20KB page cap ` +
          `CONTRACT.md sets. Split on an axis declared at census, not by overflow at render time — ` +
          `reactive sharding is what produced data-model-and-labels-2 … -20.`);
      }
      if (/^\s*\|\s*Table\s*\|/im.test(body) && !/\bAsserts\b|\bValue\b/i.test(body)) {
        problems.push(
          `${rel}: renders an artifact table with no Asserts column. The values are already in ` +
          `.brain/claims.jsonl; a page that names a record and will not say what it says is an ` +
          `inventory with citations.`);
      }
      if (DEAD_ASSERTION.test(body) && !/\b(RETIRED|INACTIVE|DEACTIVATED|SUPERSEDED)\b/.test(body)) {
        problems.push(
          `${rel}: shows an inactive artifact with no retirement marker. A dead artifact listed ` +
          `beside live ones reads as live, which is worse than omitting it.`);
      }

      /*
       * PRODUCT-95. THE HEADLINE NUMBER, CHECKED AGAINST THE PAGE THAT PRINTS IT.
       *
       * `claims-rendered` is what a reader takes as this page's evidential weight, and on run
       * 93838afe87 it was a number nothing computed: 21 of 33 declaring pages declared a count
       * that is not the count of distinct claim ids they print, the widest 582 against 69, and
       * `--check` reported clean over all of it. Derive it from the ids in the file — never
       * write it by hand — and this can only ever fail when the page and its own summary of
       * itself have come apart.
       */
      const declared = frontmatterNumber(body, 'claims-rendered');
      const printedHere = claimIdsIn(body).size;
      if (declared !== null && declared !== printedHere) {
        declaredMismatch.push({ rel, declared, printed: printedHere });
      }
    }
  };
  walk(wikiRoot);
  if (declaredMismatch.length) {
    const worst = declaredMismatch.slice().sort((a, b) => Math.abs(b.declared - b.printed) - Math.abs(a.declared - a.printed));
    problems.push(
      `${declaredMismatch.length} page(s) declare a \`claims-rendered\` count that is not the number of distinct ` +
      `claim ids they print (population: every page under the wiki root carrying the key): ` +
      `${worst.slice(0, 6).map((m) => `${m.rel} declares ${m.declared}, prints ${m.printed}`).join('; ')}` +
      `${worst.length > 6 ? `, and ${worst.length - 6} more` : ''}. ` +
      `Compute the number from the ids the page prints — it is the reader's only measure of what a page rests on, ` +
      `and a hand-written one is an unvalidated self-report, which is what this key was on the last run.`);
  }

  for (const g of GOVERNANCE_FILES) {
    const abs = path.join(wikiRoot, g);
    if (!fs.existsSync(abs)) {
      problems.push(`${g}: missing from the wiki root. The installer ships it; render into the scaffold, not beside it.`);
    }
  }

  /*
   * PRODUCT-81, audited against the PAGES.
   *
   * The first version of this check was `artifacts.filter(a => a.target && a.display === a.target)`
   * — it asked whether THIS FILE's own displayName() had returned a target column, which it cannot
   * do by construction. It reported 0 problems on a wiki holding 147 artifacts rendered under the
   * table they act on. A check named after a defect, that reads as coverage, and that can never
   * fire, is worse than no check: it is the silence this whole iteration is about.
   *
   * So: read the pages. An artifact whose sys_id a page cites but whose NAME appears nowhere in the
   * wiki was rendered as something else — in the measured case, as its target table.
   */
  const artifacts = indexArtifacts(claims);
  const corpus = pageText.join('\n').toLowerCase();
  const anonymous = artifacts.filter((a) => {
    if (!a.display || /no name claimed/.test(a.display)) { return false; }
    if (!corpus.includes(String(a.sysId).toLowerCase())) { return false; }   // never rendered at all
    return !corpus.includes(a.display.toLowerCase().slice(0, 60));
  });
  if (anonymous.length) {
    problems.push(
      `${anonymous.length} artifact(s) are cited by sys_id on some page while the name the ledger holds for them ` +
      `appears nowhere in the wiki (e.g. ${anonymous.slice(0, 3).map((a) => `${a.table}/${a.sysId} — "${trunc(a.display, 60)}"`).join('; ')}). ` +
      `A reader cannot act on a sys_id. Resolve the display name with displayName() from this file: ` +
      `locus.key first, then the name columns, and never a target column — the previous renderer put ` +
      `collection/table/table_name ahead of the name and rendered 147 artifacts under the table they act on.`);
  }

  /*
   * PRODUCT-95, the SELECTION half. A class of evidence dropped in full.
   *
   * The naming check above asks whether a rendered artifact was rendered under its own name. This
   * one asks the prior question: was the table rendered at all? Measured on run 93838afe87, over
   * the population *every table carrying five or more claims in the finished ledger*: 99 of 146
   * are named nowhere in the wiki — `question_choice` (1,192 claims), `sys_metadata_delete` (805),
   * `sys_ux_form_action_layout_item` (231), `sys_decision_question` (151), `pa_indicators` (127).
   *
   * It does not demand a page per table. Not every one of those deserves one. It demands that
   * dropping a whole class is a decision someone took — visible, attributable — rather than a
   * side effect of curating a table by hand. `--appendix` satisfies it by construction.
   */
  const unmentioned = unmentionedTables(claims, pageText.join('\n'));
  if (unmentioned.tables.length) {
    problems.push(
      `${unmentioned.tables.length} of ${unmentioned.eligible} table(s) carrying ${unmentioned.minClaims} or more claims in the ledger ` +
      `are named nowhere in the wiki (population: DISTINCT locus.table over the finished ledger, counted at ` +
      `>= ${unmentioned.minClaims} claims): ` +
      `${unmentioned.tables.slice(0, 8).map((t) => `${t.table} (${t.claims})`).join(', ')}` +
      `${unmentioned.tables.length > 8 ? `, and ${unmentioned.tables.length - 8} more` : ''}. ` +
      `Generate the evidence appendix — \`node tools/snbrain/render.js --root . --appendix\` — or state on a page ` +
      `why this class of evidence is not worth rendering. Silence is the one answer that is not available: ` +
      `these claims were read, banked and paid for.`);
  }
  return problems;
}

/**
 * Tables with real weight in the ledger that no rendered page names. Exported because
 * `render.validate` raises it as a FINDING (diffuse signals are findings, not rejections —
 * METHOD-4) while `--check` reports it as a problem, and both must count the same population.
 */
function unmentionedTables(claims, corpusText, opts) {
  const minClaims = (opts && opts.minClaims) || 5;
  const perTable = new Map();
  for (const c of claims) {
    const t = c && c.locus && c.locus.table;
    if (!t) { continue; }
    perTable.set(t, (perTable.get(t) || 0) + 1);
  }
  const eligible = [...perTable.entries()].filter(([, n]) => n >= minClaims);
  const text = String(corpusText || '');
  const tables = eligible
    .filter(([t]) => !text.includes(t))
    .map(([table, claimCount]) => ({ table, claims: claimCount }))
    .sort((a, b) => b.claims - a.claims);
  return { minClaims, total: perTable.size, eligible: eligible.length, tables };
}

// ---------------------------------------------------------------------------

module.exports = {
  DISPLAY_NAME_FIELDS, TARGET_FIELDS, DEAD_ASSERTION, PAGE_BYTE_CAP, GOVERNANCE_FILES,
  CLAIM_ID_RE, APPENDIX_MAX_ASSERT,
  assertionValue, displayName, targetOf, isRetired,
  readJsonl, streamJsonl, latestById, indexArtifacts,
  claimIdsIn, frontmatterNumber, frontmatterValue, pageClaimAccounting, unmentionedTables,
  appendixSlug, appendixPagesForTable, buildEvidenceAppendix, writeEvidenceAppendix,
  buildDecisionLedger, writeDecisionLedger, UNKNOWN_DECISIONS_START, UNKNOWN_DECISIONS_END,
  buildConventionGates, writeConventionGates, CONVENTION_ENFORCEMENT_START, CONVENTION_ENFORCEMENT_END,
  CONVENTION_LOGIC_TABLES, CONVENTION_COMPLIANCE_FLOOR, CONVENTION_MIN_CLASS, conventionPatternRegex,
  instanceMentions, INSTANCE_CLAIM_FLOOR, PLATFORM_HOSTS,
  buildSourceAppendix, writeSourceAppendix, fenceFor,
  DECISION_TIERS, decisionTier, decisionAnchors,
  esc, code, trunc, artifactTable, pageStatus, checkWiki,
};

if (require.main === module) {
  const argv = process.argv.slice(2);
  const arg = (name, dflt) => {
    const i = argv.indexOf(name);
    return i >= 0 && argv[i + 1] && !/^--/.test(argv[i + 1]) ? argv[i + 1] : dflt;
  };
  const root = path.resolve(arg('--root', process.cwd()));
  /*
   * The engagement decides where its wiki lives, and `product.config.json` is where it says so —
   * the stage table reads exactly this key. Defaulting to `docs/wiki` from the command line while
   * the stage honours the config would put the appendix somewhere `--check` never walks.
   */
  const configuredWiki = (() => {
    try {
      const cfg = JSON.parse(fs.readFileSync(path.join(root, 'product.config.json'), 'utf8').replace(/^\uFEFF/, ''));
      const w = cfg && cfg.paths && cfg.paths.wikiRoot;
      return w && typeof w === 'string' ? w.replace(/\/+$/, '') : 'docs/wiki';
    } catch (noConfig) { return 'docs/wiki'; }
  })();
  const USAGE = [
    'usage: node render.js --root <engagement repo> <one of>',
    '  --check                audit the rendered wiki against the contract',
    '  --appendix             generate <wiki>/evidence/** from .brain/claims.jsonl',
    '                         [--wiki <rel>] [--appendix-dir <rel>] [--min-claims <n>] [--dry-run]',
    '                         [--emit-manifest <rel>]  the pages[] entries, ready to splice into render.json',
    '  --decisions            generate <wiki>/decisions.md (DEC ledger: tier, rationale, impact,',
    '                         principle, anchors) from .brain/decisions.jsonl, and splice tier-unknown',
    '                         entries into <wiki>/tbd.md. Refuses an undisclosed unanchored decision.',
    '                         [--wiki <rel>] [--dry-run] [--emit-manifest <rel>]',
    '  --gates                mint enforcement from the stated conventions: one hook script per',
    '                         enforceable convention (measured against this ledger first), merged',
    '                         into .claude/settings.json, and the enforcement block in',
    '                         <wiki>/conventions.md — enforcement: none lines included.',
    '                         [--wiki <rel>] [--dry-run]',
    '  --kernel-facts         fill the kernel\'s ledger-fact slots in product.config.json from',
    '                         the claim ledger: {{ledger.instanceLine}} (the instance landscape,',
    '                         evidence-counted), {{vocabulary.section}} and {{orgMap.section}}',
    '                         (honestly empty, with the gap named, until group claims exist).',
    '                         [--dry-run]',
    '  --source-appendix      generate <wiki>/evidence/source/** — the FULL captured body of',
    '                         every explain-selected artifact, quotable from the deliverable',
    '                         (PRODUCT-100 option 2). Longest body wins between the claim\'s',
    '                         window and the raw capture, and each page says which it prints.',
    '                         [--wiki <rel>] [--dry-run] [--emit-manifest <rel>]',
    '  --deliverable-check    assert every path render.json declares, plus the kernel and the',
    '                         ledgers, is tracked AND clean in this repo (PRODUCT-97)',
    '',
  ].join('\n');

  if (argv.includes('--appendix')) {
    const dir = arg('--appendix-dir', `${arg('--wiki', configuredWiki)}/evidence`);
    const minClaims = Number(arg('--min-claims', '5'));
    const opts = { dir, minClaims: Number.isFinite(minClaims) ? minClaims : 5 };
    const built = argv.includes('--dry-run') ? buildEvidenceAppendix(root, opts) : writeEvidenceAppendix(root, opts);
    const t = built.totals;
    process.stdout.write(
      `render --appendix: ${argv.includes('--dry-run') ? 'would write' : 'wrote'} ${t.pagesGenerated} page(s) under ${dir}\n` +
      `  ${t.claimsRendered} of ${t.claims} claim(s) rendered · ${t.artifacts} artifact(s) · ${t.tables} table(s)\n` +
      `  ${t.truncatedAssertions} assertion(s) truncated at ${APPENDIX_MAX_ASSERT} chars · tables under ${t.minClaims} claim(s) collected under ${dir}/minor\n` +
      `  ${t.unclaimedColumns} column(s) fetched and never claimed, now rendered\n`);
    /*
     * THE MANIFEST FRAGMENT, because a guard nobody can satisfy cheaply is a guard that gets
     * satisfied dishonestly. `render.validate` demands that `rendersClaims` equal the ids a page
     * prints, and these 231 pages print 19,360 of them — retyping that into `render.json` is not a
     * thing anyone will do correctly, and the cheapest wrong answer would be to declare the
     * appendix pages with empty arrays. So the generator emits the exact `pages[]` entries it just
     * earned, ready to splice.
     */
    const emitTo = arg('--emit-manifest', null);
    if (emitTo) {
      const entries = built.pages.map((p) => ({
        path: p.path,
        status: frontmatterValue(p.body, 'status') || 'draft',
        rendersClaims: p.claimIds,
        tier: 'evidence',
      }));
      const abs = path.resolve(root, emitTo);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, `${JSON.stringify({ pages: entries }, null, 1)}\n`, 'utf8');
      process.stdout.write(`  manifest fragment for render.json pages[]: ${emitTo} (${entries.length} entries)\n`);
    }
    process.exit(0);
  }

  if (argv.includes('--decisions')) {
    const opts = { wiki: arg('--wiki', configuredWiki) };
    const built = argv.includes('--dry-run') ? buildDecisionLedger(root, opts) : writeDecisionLedger(root, opts);
    const t = built.totals;
    const verb = built.written ? 'wrote' : argv.includes('--dry-run') ? 'would write' : 'REFUSED to write';
    process.stdout.write(
      `render --decisions: ${verb} ${built.page.path}\n` +
      `  ${t.decisions} decision(s): ${t.rendered} rendered (${Object.entries(t.byTier).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}), ` +
      `${t.refused} refused, ${t.unknowns} unknown -> tbd.md, ${t.retiredInduced} retired\n` +
      `  ${t.unbound} rendered as linkage: unbound · ${t.anchorsResolved} distinct anchor claim(s) cited · ${t.danglingAnchors} dangling anchor row(s)\n`);
    for (const r of built.rejections) { process.stdout.write(`  - ${r}\n`); }
    const emitTo = arg('--emit-manifest', null);
    if (emitTo && !built.rejections.length) {
      const entry = { path: built.page.path, status: built.page.status, rendersClaims: built.page.claimIds, tier: 'decisions' };
      const abs = path.resolve(root, emitTo);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, `${JSON.stringify({ pages: [entry] }, null, 1)}\n`, 'utf8');
      process.stdout.write(`  manifest fragment for render.json pages[]: ${emitTo} (1 entry)\n`);
    }
    process.exit(built.rejections.length ? 1 : 0);
  }

  if (argv.includes('--gates')) {
    const opts = { wiki: arg('--wiki', configuredWiki) };
    const built = argv.includes('--dry-run') ? buildConventionGates(root) : writeConventionGates(root, opts);
    const t = built.totals;
    process.stdout.write(
      `render --gates: ${built.written ? 'wrote' : argv.includes('--dry-run') ? 'would write' : 'REFUSED to write'} ` +
      `${t.minted} gate(s) from ${t.conventions} stated convention(s), ${t.unenforceable} rendered as enforcement: none\n`);
    for (const g of built.gates) {
      process.stdout.write(`  GATE ${g.path} (claim ${g.claimId}${g.enforcedTables.length ? `; classes ${g.enforcedTables.join(', ')}` : ''})\n`);
    }
    for (const p of built.prose) { process.stdout.write(`  none ${p.kind}: ${p.enforcement.slice(0, 120)}\n`); }
    for (const r of built.rejections) { process.stdout.write(`  - ${r}\n`); }
    process.exit(built.rejections.length ? 1 : 0);
  }

  if (argv.includes('--source-appendix')) {
    const opts = { wiki: arg('--wiki', configuredWiki) };
    const built = argv.includes('--dry-run') ? buildSourceAppendix(root, opts) : writeSourceAppendix(root, opts);
    const t = built.totals;
    process.stdout.write(
      `render --source-appendix: ${built.written ? 'wrote' : 'would write'} ${t.pagesGenerated} page(s)\n` +
      `  ${t.selected} explain-selected artifact(s): ${t.fromClaim} bodies from the claim, ${t.fromRaw} from raw ` +
      `(the claim held a shorter window), ${t.bodiless} with no body anywhere, ${t.truncated} truncated at the page cap and declared\n`);
    const emitTo = arg('--emit-manifest', null);
    if (emitTo) {
      const entries = built.pages.map((p) => ({
        path: p.path,
        status: frontmatterValue(p.body, 'status') || 'draft',
        rendersClaims: p.claimIds,
        tier: 'source',
      }));
      const abs = path.resolve(root, emitTo);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, `${JSON.stringify({ pages: entries }, null, 1)}\n`, 'utf8');
      process.stdout.write(`  manifest fragment for render.json pages[]: ${emitTo} (${entries.length} entries)\n`);
    }
    process.exit(0);
  }

  if (argv.includes('--kernel-facts')) {
    // Lazy on purpose: kernelfacts requires lib/stages.js, which requires this file back.
    // At CLI time this module is fully loaded, so the cycle never bites.
    const kernelfacts = require('./lib/kernelfacts.js');
    const built = argv.includes('--dry-run') ? kernelfacts.buildKernelFacts(root) : kernelfacts.writeKernelFacts(root);
    const t = built.totals;
    process.stdout.write(
      `render --kernel-facts: ${built.written ? 'wrote' : 'would write'} 3 slot(s) into product.config.json\n` +
      `  instances: ${t.instancesAsserted} asserted at >=${INSTANCE_CLAIM_FLOOR} claims, ${t.instancesBelowFloor} below the floor\n` +
      `  vocabulary: ${t.vocabularyTokens} token(s), ${t.vocabularyExpanded} expanded by a recorded human answer\n` +
      `  org map: ${t.orgClaims} group/membership claim(s)${t.orgClaims ? '' : ' — rendered as the declared gap, not silently absent'}\n` +
      `  instanceLine: ${built.facts.ledger.instanceLine}\n`);
    process.exit(0);
  }

  if (argv.includes('--deliverable-check')) {
    const { deliverablePaths, declaredPaths, deliverableGitStatus, describeDeliverableStatus } = require('./lib/deliverable.js');
    const manifestPath = path.join(root, '.brain', 'in', 'render.json');
    if (!fs.existsSync(manifestPath)) {
      process.stdout.write(`render --deliverable-check: no ${manifestPath}. Nothing has declared what this run wrote, so there is nothing to hold to a commit.\n`);
      process.exit(2);
    }
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const status = deliverableGitStatus(root, deliverablePaths(manifest), { required: declaredPaths(manifest) });
    const lines = describeDeliverableStatus(status);
    process.stdout.write(`render --deliverable-check: population is ${status.population}\n`);
    process.stdout.write(`  ${status.total} path(s) · ${status.missing.length} missing · ${status.untracked.length} untracked · ${status.dirty.length} tracked-but-modified\n`);
    if (!lines.length) { process.stdout.write('  clean: the deliverable is in a commit.\n'); process.exit(0); }
    process.stdout.write('\n');
    for (const l of lines) { process.stdout.write(`  - ${l}\n`); }
    process.exit(1);
  }

  if (!argv.includes('--check')) {
    process.stdout.write(USAGE);
    process.exit(2);
  }
  const problems = checkWiki(root, arg('--wiki', configuredWiki));
  if (!problems.length) {
    process.stdout.write('render --check: clean\n');
    process.exit(0);
  }
  process.stdout.write(`render --check: ${problems.length} problem(s)\n\n`);
  for (const p of problems) { process.stdout.write(`  - ${p}\n`); }
  process.exit(1);
}
