'use strict';
/*
 * tools/snbrain/lib/stages.js — THE STAGE TABLE. Data, not a switch statement.
 *
 * Adding a stage means adding an entry to STAGES. The engine (snbrain.js) and the state
 * machine (lib/state.js) never name a stage, never branch on one, and never know what a
 * census is. Everything stage-specific — the brief, the input schema, the acceptance
 * conditions, the arithmetic the CLI re-derives, and where to go next — lives in the
 * entry. That is what "addable without surgery" has to mean to be true.
 *
 * WHY THE BRIEF IS COMPOSED AT RUNTIME RATHER THAN WRITTEN DOWN. The worst structural
 * flaw in the design this replaces is four literal harvest AREAS hardcoded for a
 * genuinely unknown instance. Here the harvest areas come from the census the CLI just
 * ingested, so the frontier is dynamic while the CONTROL is static. Moving that branching
 * into compiled logic would make it harder to fix, not easier; moving it into a prompt
 * string would put it back under the model's control. The stage table is the seam.
 *
 * EVERY BRIEF MUST BE SELF-CONTAINED. A fresh subagent with an empty context window has
 * to be able to execute it from the brief alone: that is the context-rot defence, and it
 * is why every brief re-states the hard rules rather than assuming they survived
 * compaction, why every brief carries the PREVIOUS attempt's rejection reasons, and why
 * briefs name the skill file to read instead of inlining a procedure that will drift.
 *
 * WHAT THE MODEL IS NEVER ALLOWED TO SUPPLY, enforced by `forbidden` keys in the schemas
 * below: any id, any score, any severity change, any status promotion it did not earn,
 * and — for the question engine — the question's own rank. The model writes wording and
 * observations. The CLI keeps the arithmetic, the ids and the links.
 */

const fs = require('fs');
const path = require('path');
/** PRODUCT-79. The renderer owns which columns are shown WHERE; the validator must agree with it. */
const renderLib = require('../render.js');
const { TARGET_FIELDS } = renderLib;
/** PRODUCT-97. Whether the deliverable is actually in a commit is a fact about git, not about JSON. */
const deliverable = require('./deliverable.js');
/** F6/F10 (2026-09-02). A definition joins its term by identity, never by co-occurrence; the key is minted here. */
const { extractTerm, normTerm: normVocabTerm } = require('./vocabulary.js');
/** F8/F11 (2026-09-02). Placeholders and kernel routes are checked at render with the same code export and finalize use. */
const handoff = require('./handoff.js');
const {
  UNVERIFIABLE_REASONS, AGENT_UNVERIFIABLE_REASONS, NOT_SAMPLED, UNRESOLVED_STATUSES,
  claimReadCost, SEVERITIES, RUNGS, OUTCOME_RESULTS, normText,
  compileDomain, describeDomain, DOMAIN_LEGS, DOC_RUNG, DOCUMENTED, AGENT_IDENTITY_RE, digest, claimId,
  decisionTier, decisionAnchors,
} = require('./state');

/**
 * The wiki root as the ENGAGEMENT REPO has it, not as the framework repo has it. The
 * installer copies wiki-scaffold/ to product.config.json paths.wikiRoot, so a brief that
 * says "read wiki-scaffold/" names a directory that does not exist where the loop runs.
 * Fail-safe to the installer's own default.
 */
function wikiRootOf(ctx) {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(ctx.brain.root, 'product.config.json'), 'utf8').replace(/^\uFEFF/, ''));
    const root = cfg && cfg.paths && cfg.paths.wikiRoot;
    if (root && typeof root === 'string') { return root.replace(/\/+$/, ''); }
  } catch (noConfig) { /* fall through */ }
  return 'docs/wiki';
}

// ---------------------------------------------------------------------------
// standing constraints, repeated into every single brief
// ---------------------------------------------------------------------------

const HARD_RULES = Object.freeze([
  'READ-ONLY. Every instance read goes through tools/snbrain/lib/api.js. Never issue a write ' +
  'command, never call sync_now or switch_context, never widen the endpoint allowlist. If you ' +
  'find yourself wanting another command, stop and report it as a finding instead.',

  'VALIDATE EVERY FIELD BEFORE EVERY FILTERED QUERY. This instance REPRODUCED the silent ' +
  'clause-drop: an unknown field in an encoded query returns UNFILTERED rows, which looks ' +
  'exactly like a successful broad read. Call session.dictionaryFields(table) first and record ' +
  'guards.fields = "validated" on the evidence. An unvalidated filtered query is a rejected artifact.',

  'AN EMPTY READ IS NOT AN ABSENCE CLAIM. On this platform a broken session, a dead helper tab ' +
  'and an empty table are indistinguishable. Zero rows may only be reported when the batch canary ' +
  'returned rows in the same session. Otherwise the correct status is unverifiable/blocked-by-access.',

  'YOU DO NOT ALLOCATE IDS. Claim, question, finding and decision ids are content hashes computed ' +
  'by the CLI. If you put an "id" key in your artifact it will be rejected. Reference existing ' +
  'records by the ids the CLI already gave you (snbrain claims --json).',

  'RECORD, DO NOT NARRATE. Every claim carries the captured response verbatim, not your summary of ' +
  'it. A model-written evidence line is a post-hoc rationalization; a captured response is an audit ' +
  'trail. Same for counts: report the number the query returned, never an estimate.',

  'WHAT, NEVER WHY. Observation stages record what they read. You may not invent a question, a ' +
  'rationale or an intent. The question engine computes questions from the ledger; the human ' +
  'supplies the why.',

  'PARTIAL IS A RESULT. If the budget runs out, the payload ceiling truncates a page, or an ACL ' +
  'blocks a read, say so in coverage/guards and ingest what you have. A silently truncated harvest ' +
  'presented as complete is the single most expensive failure available to you.',

  'YOU CANNOT DECIDE YOU ARE FINISHED. The CLI decides what runs next from the artifact you ' +
  'produce. Write the file, run the ingest command, and read what it tells you.',

  'WHEN THE LOOP ITSELF GETS IN YOUR WAY, RECORD IT: node tools/snbrain/snbrain.js quirk --note ' +
  '"<what happened>" [--severity blocker|friction|confusing|idea]. A brief that contradicts the CLI, ' +
  'a rejection you cannot satisfy from what the brief told you, a command that does not exist, a ' +
  'capability this machine lacks. It gates NOTHING and costs one line — it is feedback about the ' +
  'PRODUCT, not a finding about the instance, and it goes to the people who maintain this loop. An ' +
  'unrecorded quirk is one the next run repeats. Do not use it to argue with a rejection you should ' +
  'simply fix.',
]);

// ---------------------------------------------------------------------------
// the envelope every stage artifact carries. Validated by the engine, not per stage.
// ---------------------------------------------------------------------------

const ENVELOPE_SCHEMA = {
  type: 'object',
  required: ['stage', 'instance', 'usage', 'acceptance'],
  props: {
    stage: { type: 'string', minLength: 3 },
    instance: { type: 'string', minLength: 1 },
    usage: {
      type: 'object',
      required: ['apiCalls'],
      props: {
        apiCalls: { type: 'number', min: 0 },
        requestLog: { type: 'string', optional: true },
        wallClockSeconds: { type: 'number', min: 0, optional: true },
        notes: { type: 'string', optional: true },
      },
    },
    acceptance: {
      type: 'array', min: 1,
      items: {
        type: 'object',
        required: ['id', 'result'],
        props: {
          id: { type: 'string', minLength: 3 },
          result: { type: 'string', enum: OUTCOME_RESULTS.slice() },
          evidence: { type: 'string', optional: true, minLength: 3 },
        },
      },
    },
  },
};

// shared sub-schemas -------------------------------------------------------

const LOCUS_SCHEMA = {
  type: 'object',
  required: ['table', 'sysId'],
  props: {
    table: { type: 'string', minLength: 2 },
    sysId: { type: 'string', minLength: 4 },
    field: { type: 'string', optional: true },
    key: { type: 'string', optional: true },
  },
};

const EVIDENCE_SCHEMA = {
  type: 'object',
  required: ['query', 'fields', 'capturedAt', 'capturedResponse', 'guards'],
  props: {
    query: { type: 'string', minLength: 1 },
    fields: { type: 'string', minLength: 1 },
    capturedAt: { type: 'string', minLength: 10 },
    capturedResponse: { type: 'any' },
    transport: { type: 'string', optional: true },
    // PRODUCT-4: `budget-capped` is the harvest skill's own acceptance vocabulary
    // (SKILL.md:89,134; LOOP.md:344). It was absent here, so the one verdict the skill
    // tells an agent to reach was rejected by the validator that reads its output.
    completeness: { type: 'string', optional: true, enum: ['complete', 'truncated', 'budget-capped', 'unfiltered-risk', 'blocked'] },
    guards: {
      type: 'object',
      required: ['fields', 'identityCanary'],
      props: {
        fields: { type: 'string', enum: ['validated', 'not-validated'] },
        identityCanary: { type: 'string', enum: ['pass', 'fail', 'not-run'] },
      },
    },
  },
};

/**
 * PRODUCT-64. A finding's disposition is NOT an artifact field.
 *
 * It used to be three optional props here, `upsertFindings` merged whatever arrived, and the
 * `--by`/`--reason` guard lived only on the `disposition` CLI verb — so a stage could close its
 * own findings by writing a key into its own JSON. Run 6ef14f5562 did exactly that: four findings
 * carry `disposition: 'accepted'`, `dispositionBy: 'snbrain-verify (checker)'`, NO reason at all,
 * and no `disposition` event anywhere in history.ndjson. The checker closed its own findings.
 *
 * That is not a bookkeeping nit. Nine of the fixes planned for this pipeline mechanise entirely
 * by minting a blocking finding, and every one of them was defeated by one key in a JSON file.
 * A finding you can close from the artifact that raised it is a suggestion, not a mechanism.
 *
 * Closure now has exactly one door: `snbrain disposition --finding --as --by --reason`, which
 * demands attribution and writes a history event.
 */
const FINDING_SCHEMA = {
  type: 'object',
  required: ['check', 'severity', 'message', 'rung'],
  forbidden: ['id', 'disposition', 'dispositionBy', 'dispositionRung', 'dispositionReason'],
  props: {
    check: { type: 'string', minLength: 3 },
    severity: { type: 'string', enum: SEVERITIES.slice() },
    message: { type: 'string', minLength: 10 },
    rung: { type: 'string', enum: RUNGS.slice() },
    locus: Object.assign({ optional: true }, LOCUS_SCHEMA),
  },
};

// ---------------------------------------------------------------------------
// helpers used by more than one stage
// ---------------------------------------------------------------------------

/*
 * THE TWO POPULATIONS — PRODUCT-29, and PRODUCT-12's amendment.
 *
 * A run bounded by `--domain` counts two different things and the census has to carry both:
 * the INSTANCE-WIDE population, which is the denominator every downstream ratio is quoted
 * against and which LOOP.md §6.5.2 requires, and the IN-DOMAIN population, which is the unit
 * the harvest queue is handed out in. Until run 6ef14f5562 there was one field for both, so
 * the residual validator reconciled a domain-scoped queue against an instance-wide total and
 * COMPELLED a 431-area queue needing ~86,200 calls against a budget of 800.
 *
 * `runDomain()` is the single predicate that decides which world we are in. Everything that
 * asks "is this a domain-scoped run" asks it here, so there is one answer and not four.
 */
function runDomain(ctx) {
  const cfg = (ctx && ctx.state && ctx.state.config) || {};
  const d = cfg.domain;
  if (!d) { return null; }
  return DOMAIN_LEGS.some((l) => (d[l] || []).length) ? d : null;
}

/*
 * A predicate is TRIVIAL when every value it carries is a bare wildcard: `name:*` admits the
 * whole instance, and `bands.A === bands.AInDomain` under it is arithmetic rather than
 * circularity. Under anything narrower, equality means the agent measured the numerator twice
 * and called one of them the denominator.
 */
function domainIsNonTrivial(domain) {
  if (!domain) { return false; }
  for (const leg of DOMAIN_LEGS) {
    for (const v of domain[leg] || []) {
      if (String(v).replace(/\*/g, '').trim()) { return true; }
    }
  }
  return false;
}

/** `bandARowsInDomain` is OPTIONAL on the wire and UNMEASURED when absent — never zero. */
function inDomainSize(area) {
  return typeof (area || {}).bandARowsInDomain === 'number' ? area.bandARowsInDomain : null;
}

/**
 * Worked examples carry both populations and shed the in-domain one when the run has no
 * boundary, so ONE example stays correct in both worlds rather than two drifting apart.
 */
function dropInDomain(ctx, obj, keys) {
  if (runDomain(ctx)) { return obj; }
  const out = Object.assign({}, obj);
  for (const k of [].concat(keys)) { delete out[k]; }
  return out;
}

/*
 * PRODUCT-28 IS A HARD PREREQUISITE OF THE TWO-POPULATION CENSUS. The in-domain count has to
 * come from a query the CLI compiled, not one the agent composed from the English rendering of
 * the boundary: `sys_scope=<name>` matches zero rows because sys_scope is a REFERENCE (the
 * dot-walk `sys_scope.scope=<name>` is the clause that works, PLATFORM-28) and a trailing `*`
 * is STARTSWITH, not LIKE. An agent that hand-encodes either one reads 0 in-domain rows for
 * every area, and the run then reports "nothing in this domain" as a clean, well-formed,
 * terminal result. Today's defect strands a run visibly; that one finishes it wrongly.
 *
 * If compileDomain() is absent this returns the REASON rather than a fabricated query, because
 * a brief that hands out a clause nobody compiled is the defect this exists to prevent.
 */
function compiledDomainBrief(ctx, table) {
  const d = runDomain(ctx);
  if (!d) { return ''; }
  if (typeof compileDomain !== 'function') {
    return 'THE CLI COULD NOT COMPILE THIS BOUNDARY (compileDomain is unavailable in this build), so no fragment is quoted here. ' +
      'Do NOT hand-encode one: raise a BLOCKING finding naming the missing compiler and stop.';
  }
  let c = null;
  try { c = compileDomain(d, table); } catch (err) { c = null; }
  if (!c) {
    return 'compileDomain() returned nothing for this boundary. Do NOT hand-encode one: raise a BLOCKING finding and stop.';
  }
  if (typeof c === 'string') { return `Compiled against ${table}: ${c}`; }
  const legs = c.legs || c.fragments || c;
  const lines = DOMAIN_LEGS
    .filter((l) => legs && (typeof legs[l] === 'string' ? legs[l] : (Array.isArray(legs[l]) && legs[l].length)))
    .map((l) => `${l} → ${Array.isArray(legs[l]) ? legs[l].join('^') : legs[l]}`);
  const unavailable = c.unavailableLegs || [];
  return `Compiled against ${table}, one \`^NQ\` leg per clause — COPY THESE, do not compose your own: ${lines.join(' · ') || '(no leg compiled)'}` +
    (unavailable.length ? `. Legs ${table} cannot honour: ${unavailable.join(', ')} — drop them and SAY SO, never substitute a lookalike column.` : '') +
    '. For each AREA compile the same boundary against THAT AREA\'S OWN table: sys_scope does not exist on a non-metadata table and the equivalent of sys_name is `name`, so a leg a table cannot honour is dropped and RECORDED, not silently replaced.';
}

/** WPM. The model supplies OBSERVABLE terms; the CLI does the arithmetic. (4.9.5) */

/** WPM. The model supplies OBSERVABLE terms; the CLI does the arithmetic. (4.9.5) */
function computeRank(terms) {
  const E = num(terms.E, 1), Cg = num(terms.C_guard, 1), Cs = num(terms.C_signal, 0.5);
  const A = num(terms.A, 1), U = clamp(num(terms.U, 1), 1, 3), M = clamp(num(terms.M, 1), 0.5, 8);
  const V = E * Cg * Cs * A * U;
  return Object.assign({}, terms, {
    E, C_guard: Cg, C_signal: Cs, A, U, M,
    V: round(V), wpm: round(V / M), computedBy: 'cli', computedAt: new Date().toISOString(),
  });
}
function num(v, d) { return typeof v === 'number' && !Number.isNaN(v) ? v : d; }
function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
function round(v) { return Math.round(v * 100) / 100; }

/** Deterministic by construction: phase 4's two-runner comparison depends on it. */
function rankOrder(a, b) {
  const wa = (a.rank && a.rank.wpm) || 0, wb = (b.rank && b.rank.wpm) || 0;
  if (wb !== wa) { return wb - wa; }
  const ca = (a.cluster && a.cluster.size) || 0, cb = (b.cluster && b.cluster.size) || 0;
  if (cb !== ca) { return cb - ca; }
  const ta = (a.evidence && a.evidence[0] && a.evidence[0].capturedAt) || '';
  const tb = (b.evidence && b.evidence[0] && b.evidence[0].capturedAt) || '';
  if (tb !== ta) { return tb < ta ? -1 : 1; }
  return String(a.id).localeCompare(String(b.id));
}

function pct(n, d) { return d ? Math.round((n / d) * 10000) / 10000 : 0; }
function fwd(p) { return String(p).replace(/\\/g, '/'); }

// ---------------------------------------------------------------------------
// WHERE BEHAVIOUR LIVES. The map the `explain` stage reads against.
// ---------------------------------------------------------------------------

/*
 * A harvest records that a record EXISTS, its name, its state, when it changed and who
 * touched it. None of that says what it DOES, because what it does lives in a body field
 * the harvest never requested. The reference run inventoried 49 tables and produced zero
 * "what it does" columns; its own deliverable concedes that any question of the form "what
 * does X do" is unanswerable from it.
 *
 * `trigger` fields say WHEN the logic runs, `body` fields say WHAT it does, and `shape`
 * fields are the cheap scalars that qualify the other two. They are separate lists because
 * they are read separately: PLATFORM-10 says a wide field list additively breaks pagination
 * on this transport, so `explain` reads narrow and often rather than wide and once.
 *
 * This map is deliberately conservative. A table absent from it is not "has no behaviour" —
 * it is "we have not established where its behaviour lives", which is a finding rather than
 * a silent zero. Flow Designer is the honest example: its logic lives in snapshot records
 * rather than a script column, so it is listed with no body field and a stated reason, and
 * the stage reports it as unreadable rather than reporting the flow as behaviourless.
 *
 * `must` — PRODUCT-96. THE COLUMN THAT CARRIES THE CLASS'S LOGIC, WHICH ONE DISCRIMINATING
 * COLUMN DOES NOT COVER.
 *
 * `shape` says which columns carry meaning and the guard below accepts ONE of them as evidence
 * that the shape was read at all. That is the right rule for "was this area inventoried or
 * harvested"; it is the wrong rule for a column without which the record's logic is simply
 * absent. Measured on run 93838afe87, per table, against the columns actually claimed:
 *
 *   sysrule_assignment  1 rule does all routing-group routing; `group` and `user` are empty, so the
 *                       SCRIPT is the mechanism — `script` was never requested. `condition` was
 *                       claimed; `script`, `group` and `user` were not.
 *   sys_ui_policy       64 loci, 398 claims: short_description, reverse_if_false, order, active,
 *                       on_load, run_scripts. `script_true`/`script_false` were never requested
 *                       even though this file has declared them since the explain stage landed.
 *   sysevent_email_action  14 loci: `condition` and `advanced_condition` WERE requested and never
 *                       claimed, so the notification conditions are absent from a 216-claim set.
 *   sys_ui_action       25 loci: `form_button_v2` was requested and never claimed;
 *                       `client_script_v2` was never requested. A page then stated of one action
 *                       that "the script column is empty; the only logic on the record is the
 *                       condition" — over a record whose logic lives in `client_script_v2`.
 *
 * THE ENTRY THIS MAP GOT WRONG, AND THE CORRECTION. PRODUCT-96 and PLAN 6.2 both ask for
 * `from_state`, `to_state` and `condition` on `sf_state_flow`. Those three columns DO NOT EXIST on
 * that table. The map has declared `from_state`/`to_state` since the explain stage landed and they
 * have never matched a real column; the run's own dictionary-validated field list for
 * `sf_state_flow` — 41 columns, in its evidence.fields — contains `start_text`, `end_text`,
 * `starting_state`, `ending_state`, `manual_condition` and `automatic_condition`, and none of the
 * three named in the entry. The claim that "34 state flows are inventoried with no transitions at
 * all" is therefore also wrong: `start_text` and `end_text` were claimed on all 34,
 * `ending_state` on 25 and `starting_state` on 22. What is genuinely missing is the pair of
 * CONDITIONS gating each transition — requested, returned, never claimed. Adding the entry's three
 * columns verbatim would have shipped a validator demanding columns no instance can supply, whose
 * only legal satisfaction is the `no-column:` escape on every run forever.
 */
const BODY_FIELDS = Object.freeze({
  sys_script: { body: ['script'], trigger: ['condition', 'filter_condition'], shape: ['when', 'order', 'active', 'action_insert', 'action_update', 'action_delete', 'action_query'] },
  sys_script_client: { body: ['script'], trigger: ['condition'], shape: ['type', 'active', 'order', 'field'] },
  sys_script_include: { body: ['script'], trigger: [], shape: ['active', 'client_callable', 'api_name'] },
  sys_ui_action: { body: ['script', 'client_script_v2'], trigger: ['condition'], shape: ['active', 'order', 'form_button', 'form_button_v2', 'list_button', 'action_name'], must: ['condition', 'script', 'form_button_v2', 'client_script_v2'] },
  /*
   * `ui_type` is REQUIRED, and it was found by a blind head-to-head tester rather than by us.
   * Working the "add a state-conditional mandatory field" task from the brain alone, they ran a
   * column census across all 64 harvested UI policies and got: active 64, on_load 64, order 64,
   * reverse_if_false 64, short_description 64, run_scripts 51, table 12, conditions 10,
   * description 5 — and **ui_type 0, view 0, global 0**. This engagement's own record description
   * states the rule ("ui_type=10 so it runs in the configurable workspace"), so the repo knows the
   * rule and cannot give the value for a single policy. On a build that is configurable-workspace
   * only, a policy with the wrong ui_type saves clean, tests fine in the classic form, and does
   * nothing in the one UI anybody uses. `view` and `global` are declared but NOT required: they
   * qualify the same behaviour and no measurement here shows either of them silently fatal.
   */
  sys_ui_policy: { body: [], trigger: ['conditions'], shape: ['active', 'order', 'on_load', 'reverse_if_false', 'script_true', 'script_false', 'ui_type', 'global', 'view'], must: ['conditions', 'script_true', 'script_false', 'ui_type'] },
  /*
   * PRODUCT-96, third round. `sys_dictionary` was absent from this map entirely — the table that
   * defines every custom column on the instance, unshaped. The same tester needed one thing from
   * it and could not get it: *which update set captures a new column*. The engagement's
   * update-set-scope-strategy lists `sys_documentation` under application scope and
   * `sys_ui_element` under global, and settles everything else with "any table with
   * sys_scope.scope = <the app>" — which is unanswerable when `sys_scope` is the one column the
   * 500 harvested dictionary rows never assert. Getting that wrong puts the column in a set that
   * never ships, and the field then exists in dev and nowhere else.
   */
  sys_dictionary: {
    body: [], trigger: [],
    shape: ['internal_type', 'max_length', 'mandatory', 'read_only', 'display', 'active', 'reference', 'reference_qual', 'default_value', 'choice', 'attributes', 'sys_scope'],
    must: ['internal_type', 'sys_scope'],
  },
  sys_ui_policy_action: { body: [], trigger: [], shape: ['field', 'visible', 'mandatory', 'disabled'] },
  sys_security_acl: { body: ['script'], trigger: ['condition'], shape: ['operation', 'active', 'admin_overrides', 'type'] },
  sysevent_email_action: { body: ['message', 'message_html'], trigger: ['condition', 'advanced_condition'], shape: ['subject', 'active', 'event_name', 'collection'], must: ['condition', 'advanced_condition'] },
  // One rule does all routing-group routing on the reference engagement, `group` and `user` are both
  // empty on it, and therefore the script IS the routing mechanism. `order` and `match_conditions`
  // are in shape because first-match-wins: a rule nobody can order is a rule nobody can predict.
  sysrule_assignment: { body: ['script'], trigger: ['condition'], shape: ['active', 'order', 'table', 'match_conditions', 'group', 'user'], must: ['condition', 'script', 'group', 'user'] },
  /*
   * PRODUCT-88. Declared so the empty-stratum finding can SEE `result_elements`, which is the
   * whole answer an answer row exists to carry — and which returns `""` over this transport on
   * every row, bound or not. Deliberately NO `must`: demanding a claim on a column the API cannot
   * surface has exactly one legal satisfaction, the `no-column:` escape, on every run forever.
   * The route to the value is the defining child (`sys_variable_value`), not a harder ask here.
   */
  sys_decision_multi_result: {
    body: [], trigger: [],
    shape: ['label', 'decision_table', 'result_elements'],
    unreadable: '`result_elements` is a glide_var bucket: the Table REST API returns it empty whether or not a binding exists, so a bound answer row and an unbound one are the same JSON here. Follow sys_variable_value on document_key instead.',
  },
  sysauto_script: { body: ['script'], trigger: ['condition'], shape: ['active', 'run_type', 'run_time'] },
  sysauto: { body: [], trigger: ['condition'], shape: ['active', 'run_type', 'run_time'] },
  sys_processor: { body: ['script'], trigger: [], shape: ['active', 'type', 'path'] },
  sys_ws_operation: { body: ['operation_script'], trigger: [], shape: ['active', 'http_method', 'operation_uri'] },
  sys_ui_script: { body: ['script'], trigger: [], shape: ['active', 'use_scoped_format', 'script_name'] },
  sys_script_fix: { body: ['script'], trigger: [], shape: ['active', 'unloadable'] },
  sys_transform_script: { body: ['script'], trigger: [], shape: ['when', 'order'] },
  sys_transform_entry: { body: ['source_script'], trigger: [], shape: ['use_source_script', 'target_field', 'source_field', 'coalesce'] },
  sp_widget: { body: ['script', 'client_script', 'link'], trigger: [], shape: ['id', 'public', 'roles'] },
  sys_ui_page: { body: ['html', 'client_script', 'processing_script'], trigger: [], shape: ['category'] },
  sc_cat_item_producer: { body: ['script'], trigger: [], shape: ['active', 'table_name'] },
  item_option_new: { body: [], trigger: [], shape: ['type', 'mandatory', 'name', 'default_value'] },
  sys_data_policy2: { body: [], trigger: ['conditions'], shape: ['active', 'enforce_ui', 'model_table'] },
  wf_activity: { body: ['script'], trigger: ['condition'], shape: ['activity_definition', 'order'] },
  // Behaviour is real but does NOT live in a readable column on these. Listed so the stage
  // reports "unreadable by this transport" rather than letting silence read as "no logic".
  sys_hub_flow: { body: [], trigger: [], shape: ['active', 'type'], unreadable: 'Flow Designer logic lives in sys_hub_flow_snapshot / flow-block records, not in a script column on the flow.' },
  sys_hub_action_type_definition: { body: [], trigger: [], shape: ['active'], unreadable: 'Action logic lives in the action snapshot, not in a script column.' },
  /*
   * The column names here are the REAL ones, verified against the run's own dictionary-validated
   * field list and against `.claude/skills/state-flows/SKILL.md`: `start_text`/`end_text` are the
   * from/to state VALUES a human sets, `starting_state`/`ending_state` are the choice references
   * `rebuildFlows()` resolves from them, and the gating conditions are `manual_condition` and
   * `automatic_condition`. `from_state`, `to_state` and a bare `condition` are not columns on this
   * table and never were — see the `must` note above.
   *
   * `unreadable` is retained and its wording narrowed. `manual_script`/`automatic_script` do exist
   * on this table, so "no script column" was too strong; but this run never requested them, so
   * whether they carry logic on a real instance is unestablished, and establishing it costs reads
   * this change does not spend. Filed rather than guessed — PRODUCT-98.
   */
  sf_state_flow: {
    body: [],
    trigger: ['manual_condition', 'automatic_condition'],
    shape: ['active', 'start_text', 'end_text', 'starting_state', 'ending_state', 'roles', 'manual_roles', 'automatic_roles'],
    must: ['start_text', 'end_text', 'manual_condition', 'automatic_condition', 'roles'],
    unreadable: 'The transition is the row, not a script: `start_text`/`end_text` carry the from/to states and `manual_condition`/`automatic_condition` gate them. The scalar shape fields carry the whole meaning, and empty role columns are a load-bearing NEGATIVE fact. (`manual_script`/`automatic_script` exist on the table and have never been read by any run — PRODUCT-98.)',
  },
});

/**
 * PRODUCT-78. The columns that carry a record's meaning, for the tables in a harvest area.
 *
 * `BODY_FIELDS` declares this per table and, until now, ONLY `explainCandidates()` and the explain
 * validators read it. Harvest — the stage that emits 8,000+ of the 8,239 claims — had no per-table
 * field guidance at all, so which columns got claimed was a model whim. On run 6ef14f5562 the whim
 * settled on `table` and `active`, and the consequence is measurable: all 34 `sf_state_flow` rows
 * were claimed with `table` and `active` while this file's own entry for that table declares
 * `from_state, to_state, roles, manual_roles, automatic_roles` under a comment reading "the scalar
 * shape fields carry the whole meaning, and empty role columns are a load-bearing NEGATIVE fact".
 * The state model of the customer's core process was one column away and nobody asked for it.
 *
 * `unreadable` tables matter MOST here, not least: for them the shape IS the body. That is the
 * whole point of the comment on sf_state_flow, and explain skips them by design.
 */
function declaredFieldsFor(tables) {
  const out = [];
  for (const t of tables || []) {
    const d = BODY_FIELDS[t];
    if (!d) { continue; }
    const shape = (d.shape || []).slice();
    const trigger = (d.trigger || []).slice();
    const must = (d.must || []).slice();
    if (!shape.length && !trigger.length && !must.length) { continue; }
    out.push({ table: t, shape, trigger, must, unreadable: d.unreadable || null });
  }
  return out;
}

/*
 * PLAN 5.43 — DEFINING CHILDREN, because the census cannot see these tables at any budget.
 *
 * `areas[]` is MEASURED: run 6ef14f5562's own census artifact records it as
 * /api/now/stats/sys_metadata?sysparm_group_by=sys_class_name over the Band A query (AC-CENSUS-4),
 * 431 classes summing to 97,258 against a Band A of 97,436, plus 178 rows with an empty class.
 * An area is therefore a `sys_metadata` CLASS STRATUM and nothing else can be one. Two
 * consequences, both structural rather than budgetary, and the second is why a supplementary
 * strata list in the census schema is not the fix:
 *   - a table that is not a `sys_metadata` class has no stratum to be counted in, so no spend
 *     produces an area for it;
 *   - and one cannot be bolted on either, because census.validate() rejects an area with
 *     bandARows<=0 AND rejects an area list summing past Band A (PRODUCT-12's residual check).
 *     A stratum whose rows are not IN Band A is unrepresentable in both directions at once, so
 *     option (b) can only exist by breaking the arithmetic PRODUCT-12 was written to enforce.
 * The route therefore runs through the PARENT, which IS a stratum, and which the harvest is
 * already holding at the moment the child is wanted.
 *
 * These children are not incidental rows; they are where the parent's meaning finishes. Measured
 * on run 6ef14f5562: 65 `sys_choice_set` headers claimed and ZERO `sys_choice` values, so every
 * choice on the customer's core tables — including the one saying category='10' means STS — is
 * absent from an 8,299-claim ledger; 41 `sys_translated` and ZERO `sys_translated_text`, on a run
 * whose own update-set descriptions read "Holds sys_translated_text (global-scoped)"; and zero
 * rows on `sys_highlighted_value`, which is not among the 431 areas at all.
 *
 * `on.parent` are columns of the PARENT record and `on.child` the child columns that must equal
 * them, positionally. Both come out of the captured response the harvest already holds, so a
 * follow costs child reads and never a second parent sweep.
 *
 * Conservative on purpose, exactly like BODY_FIELDS above: a table absent from this map means "we
 * have not established that it has defining children", which is a gap a reader can see rather than
 * a silent zero. `sys_ux_audience` is deliberately absent — no read in this repo establishes its
 * join, and inventing one would put an unvalidated column into an encoded query, which PLATFORM-3
 * turns into an unfiltered sweep rather than into an error.
 */
const CHILD_DEPTH_CAP = 2;

const DEFINING_CHILDREN = Object.freeze({
  sys_choice_set: [
    { table: 'sys_choice', on: { parent: ['name', 'element'], child: ['name', 'element'] },
      shape: ['value', 'label', 'sequence', 'inactive', 'language'],
      why: 'a choice set is a header naming a table and a field, and the VALUES are sys_choice rows — a set claimed without them records that a choice list exists without recording what may be chosen.' },
  ],
  sys_dictionary: [
    { table: 'sys_choice', on: { parent: ['name', 'element'], child: ['name', 'element'] },
      shape: ['value', 'label', 'sequence', 'inactive', 'language'],
      why: 'most choice lists carry no sys_choice_set header at all, so the dictionary column is their only parent.' },
    { table: 'sys_highlighted_value', on: { parent: ['name', 'element'], child: ['table', 'field'] },
      shape: ['table', 'field', 'name', 'active'],
      why: 'conditional colour on a field is configuration and not decoration — it is how a form tells an operator that a due date has passed — and it is a census area on no instance, because it is not a sys_metadata class.' },
  ],
  sys_highlighted_value: [
    { table: 'sys_highlighted_value_condition', on: { parent: ['sys_id'], child: ['highlighted_value'] },
      shape: ['condition', 'style', 'variant', 'order', 'active'],
      why: 'the parent names only a table and a field; WHEN the highlight fires and WHICH colour it uses exist only on the condition children.' },
  ],
  sys_ux_form_action: [
    { table: 'sys_ux_form_action_layout_item', on: { parent: ['sys_id'], child: ['action'] },
      shape: ['action', 'item_type', 'label', 'table', 'order'],
      why: 'a declarative action with no layout item is a button that does not render, so the action alone is a claim about something the user cannot see.' },
    { table: 'sys_translated_text', on: { parent: ['sys_id'], child: ['documentkey'] },
      also: { tablename: 'sys_ux_form_action' },
      shape: ['language', 'fieldname', 'label', 'value'],
      why: 'the workspace button labels this run’s own update sets say they carry: "Captures sys_translated_text (NL) translations for the H&S workspace Save buttons".' },
  ],
  sys_ux_form_action_layout_item: [
    { table: 'sys_ux_m2m_action_layout_item', on: { parent: ['sys_id'], child: ['ux_form_action_layout_item'] },
      shape: ['ux_form_action_layout', 'ux_form_action_layout_item', 'variant', 'display_type', 'order', 'active'],
      why: 'this is the record that actually makes a workspace button render, and it carries the only reference to sys_ux_form_action_layout, which nothing else in the loop can reach.' },
  ],
  sys_ux_macroponent: [
    { table: 'sys_translated_text', on: { parent: ['sys_id'], child: ['documentkey'] },
      also: { tablename: 'sys_ux_macroponent' },
      shape: ['language', 'fieldname', 'label', 'value'],
      why: 'workspace UI text is translated here and nowhere else, so a macroponent claimed without it is half a surface on a bilingual engagement.' },
  ],
  sys_ui_action: [
    { table: 'sys_translated_text', on: { parent: ['sys_id'], child: ['documentkey'] },
      also: { tablename: 'sys_ui_action' },
      shape: ['language', 'fieldname', 'label', 'value'],
      why: 'the button label an operator actually reads, which is not the name the action is stored under.' },
  ],
  item_option_new: [
    { table: 'sys_translated_text', on: { parent: ['sys_id'], child: ['documentkey'] },
      also: { tablename: 'item_option_new' },
      shape: ['language', 'fieldname', 'label', 'value'],
      why: 'catalog variable labels and help text are translated here rather than on the variable itself.' },
  ],
  question_choice: [
    { table: 'sys_translated_text', on: { parent: ['sys_id'], child: ['documentkey'] },
      also: { tablename: 'question_choice' },
      shape: ['language', 'fieldname', 'label', 'value'],
      why: 'catalog choice labels are translated here, and this run claimed 298 question_choice loci with no translation behind any of them.' },
  ],
  sc_cat_item_producer: [
    { table: 'sys_translated_text', on: { parent: ['sys_id'], child: ['documentkey'] },
      also: { tablename: 'sc_cat_item_producer' },
      shape: ['language', 'fieldname', 'label', 'value'],
      why: 'the producer title and short description an end user sees in the portal.' },
  ],
  /*
   * PRODUCT-88 — WHERE THE FIELD ACTUALLY LANDS ON THE FORM.
   *
   * A section is harvested as a caption and a view; what is IN it is a different table. Measured
   * on run 93838afe87: five `sys_ui_section` rows for the case, and **zero `sys_ui_element`
   * rows in a 19,360-claim ledger** — so a developer can create a column, label it in Dutch, and
   * build a state-conditioned mandatory UI policy off a verified precedent on that very table, and
   * cannot say where the field appears or what is already beside it. That was the deciding fact on
   * head-to-head task 2, twice.
   *
   * `sys_ui_element` is reachable only this way. It is not a `sys_metadata` class, so no census
   * stratum produces it and no domain leg admits it; the parent section is the one record that
   * names its children. Two warnings ride with it, both already in the engagement's own gotchas:
   * the table is GLOBAL scope, so its rows need a global companion update set, and its DELETEs are
   * not tracked by update sets at all — which is why the shape claims `position` as well as
   * `element`, since a layout is an ordering and not a set.
   */
  sys_ui_section: [
    { table: 'sys_ui_element', on: { parent: ['sys_id'], child: ['sys_ui_section'] },
      shape: ['sys_ui_section', 'element', 'position', 'type'],
      why: 'a section says a form has a block called "Event"; only its elements say which fields are in it, in what order, and in which column — and that is the whole of "where does my new field go".' },
  ],

  /*
   * PRODUCT-88 — THE BINDING, WHICH IS NOT ON THE RECORD THAT APPEARS TO CARRY IT.
   *
   * A decision-table answer row looks like it holds its own answer: `sys_decision_multi_result`
   * has a `result_elements` column and the harvest duly requested it on all 37 routing-group rows.
   * It came back `""` all 37 times — not because the binding is missing, but because
   * `result_elements` is a `glide_var` bucket that does not surface over the Table REST API. The
   * values live in `sys_variable_value`, keyed by `document` + `document_key`.
   *
   * Measured cost of not following it: a head-to-head tester could reconstruct the entire routing
   * chain — rule, resolver, decision table, condition syntax, order banding, the by-design
   * no-match — and could not name a single group to point it at, because the one hop from answer
   * row to `sys_user_group` was never made. Asking the parent harder cannot fix this; only the
   * child read can. It is `also`-qualified on `document` because `sys_variable_value` is shared by
   * every variable-bearing class on the instance, and an unqualified join returns all of them.
   */
  sys_decision_multi_result: [
    { table: 'sys_variable_value', on: { parent: ['sys_id'], child: ['document_key'] },
      also: { document: 'sys_decision_multi_result' },
      shape: ['document', 'document_key', 'variable', 'value'],
      why: 'this is where a decision-table answer keeps the value it answers WITH. The parent\'s own `result_elements` column returns empty over this transport whether or not a binding exists, so the parent read cannot distinguish a bound row from an unbound one — and on the reference engagement that is the difference between a routable routing-group and a case nobody is assigned.' },
  ],

  /*
   * PRODUCT-83. The group's children, which is where a group stops being a name and becomes a
   * routing rule. Reachable only once `sys_user_group` itself is reachable (DATA_AREAS below) —
   * both of these are data too, so neither is a stratum on any instance.
   */
  sys_user_group: [
    { table: 'sys_group_has_role', on: { parent: ['sys_id'], child: ['group'] },
      shape: ['group', 'role', 'granted_by', 'inherits'],
      why: 'a group claimed without its role grants records a container and not what the container confers — and `inherits` is how a role leaks to every member of every child group, which is the single most common surprise on a ServiceNow permissions review.' },
    { table: 'sys_user_grmember', on: { parent: ['sys_id'], child: ['group'] },
      shape: ['group', 'user'],
      why: 'membership is the gate: the recall for run pilot-run-4 describes an adviser "who must be in that routing-group to pick it up", which is a statement about this table and about no other.' },
  ],
});

/*
 * PRODUCT-96, the second half. AN UNREAD COLUMN AND AN EMPTY COLUMN ARE THE SAME JSON.
 *
 * `docs/wiki/processes/onderzoek.md` on run 93838afe87 says of one UI action: *"The script column
 * is empty; the only logic on the record is the condition…"* — an affirmative claim that the record
 * carries no logic, made over `sys_ui_action` where the logic of a workspace action lives in
 * `client_script_v2`, which was never requested. A third case had explain reporting that three
 * `Save and Close` actions "carry neither script nor condition", having read the empty `script`
 * column of a workspace action. The product has this rule for the PLATFORM — PLATFORM-28,
 * PRODUCT-84, both about not treating an unread thing as an absent thing — and did not apply it to
 * itself.
 *
 * So: a claim may not assert that a field is empty or absent unless that field is in its OWN
 * `evidence.fields`. One string comparison, no reads, and it is the difference between "we looked
 * and there is nothing there" and "we did not look".
 *
 * TOKENS, NOT SUBSTRINGS. `String(fields).includes('condition')` is satisfied by
 * `advanced_condition`, `manual_condition` and `filter_condition`, so the substring form of this
 * check passes precisely the claims most worth catching — a state flow asserting `condition is
 * empty` off a field list containing only `manual_condition`. Dot-walked requests
 * (`sys_scope.scope`) count for their leaf as well as their head, because both were returned.
 */
const EMPTY_ASSERTION_RE = /\b([a-z_][a-z_0-9]*)\s+(?:column\s+)?(?:is|was|comes back|came back|returned)\s+(?:empty|blank|unset|null|absent)\b|\bcarries\s+(?:neither|no)\s+([a-z_][a-z_0-9 ]*?)(?=[.,;]|$)|\bno\s+([a-z_][a-z_0-9]*)\s+(?:is\s+)?(?:set|present|defined)\b/gi;

/**
 * Is this token a column OF THE CLAIM'S OWN TABLE?
 *
 * SCOPED TO THE TABLE, and that is the whole difference between a guard and a nuisance. Replayed
 * against `pilot-run-4`, a version of this rule that accepted any snake_case token as a column name
 * raised six findings that were all correct English and none of them the defect: a client script
 * "returns false when location '3' carries no `building_name`", a business rule that "fills
 * `assigned_to` and `work_notes`", a notification keyed on a user's `preferred_language`. Every one
 * of those names a column of the record the artifact ACTS ON, not a column of the artifact — and
 * asserting something about a record you read through a script you did read is not the defect
 * PRODUCT-96 is about.
 *
 * So the two sources are both authoritative about THIS table: the framework's own map of where
 * that class keeps its columns, and a key that came back in this claim's own captured response.
 * A table absent from `BODY_FIELDS` is therefore unprotected by this rule, which is the same
 * conservatism `BODY_FIELDS` is built on — an unestablished column is not a silent zero, it is a
 * gap in a list somebody can see.
 */
function looksLikeColumn(token, claim) {
  if (!token) { return false; }
  const d = BODY_FIELDS[(claim.locus && claim.locus.table) || ''] || {};
  if ([].concat(d.body || [], d.trigger || [], d.shape || [], d.must || []).includes(token)) { return true; }
  const resp = claim.evidence && claim.evidence.capturedResponse;
  return !!(resp && typeof resp === 'object' && Object.prototype.hasOwnProperty.call(resp, token));
}

/** The field names an evidence block actually requested, as exact tokens. */
function requestedFields(evidence) {
  const raw = String((evidence && evidence.fields) || '');
  const out = new Set();
  for (const piece of raw.split(/[,\s]+/)) {
    const f = piece.trim();
    if (!f) { continue; }
    out.add(f.toLowerCase());
    // `sys_scope.scope` returns both a head and a leaf; a claim about either was evidenced.
    for (const part of f.split('.')) { if (part) { out.add(part.toLowerCase()); } }
  }
  return out;
}

/**
 * The claims in an artifact that assert an absence over a column they never requested.
 * Returns `{ id, table, field, assertion }` per violation, so callers can name them.
 */
function emptyAssertionViolations(claims) {
  const bad = [];
  for (const c of claims || []) {
    const assertion = String((c && c.assertion) || '');
    const requested = requestedFields(c.evidence);
    if (!requested.size) { continue; }        // no field list at all is a different defect
    const named = new Set();
    EMPTY_ASSERTION_RE.lastIndex = 0;
    let m;
    while ((m = EMPTY_ASSERTION_RE.exec(assertion)) !== null) {
      // "carries neither script nor condition" names BOTH, and the run shipped that exact
      // sentence about three UI actions — so the list form is split rather than read head-first.
      for (const part of String(m[1] || m[2] || m[3] || '').split(/\s+(?:nor|or|and)\s+|,\s*/)) {
        const tok = part.trim().split(/\s+/)[0].toLowerCase();
        if (tok) { named.add(tok); }
      }
    }
    for (const field of named) {
      if (requested.has(field)) { continue; }
      /*
       * THE CLAIM'S OWN LOCUS FIELD IS NOT AN EXEMPTION, and an earlier version of this function
       * made it one on the reasoning that a claim keyed on `condition` is reporting the value it
       * was minted from. Replay killed that: `C-69a0a63db11e` on `sysauto_script` is keyed on
       * `condition`, asserts "condition is empty — this record carries no condition logic at all",
       * and its evidence.fields is the single token `sys_id`. Being keyed on a column is a claim
       * ABOUT it, not evidence FOR it, and the exemption excused five claims of exactly the shape
       * this guard exists to catch.
       */
      if (!looksLikeColumn(field, c)) { continue; }
      bad.push({
        id: c.id || null,
        table: (c.locus && c.locus.table) || null,
        sysId: (c.locus && c.locus.sysId) || null,
        field,
        assertion: assertion.length > 120 ? `${assertion.slice(0, 119)}…` : assertion,
      });
    }
  }
  return bad;
}

/*
 * PRODUCT-88, leg one. A REQUESTED FIELD THAT IS EMPTY ON 100% OF A STRATUM IS A FINDING.
 *
 * `result_elements` was requested on all 37 `sys_decision_multi_result` rows and returned `""` on
 * all 37. Nothing objected, because each individual empty is a legitimate claim — "this column is
 * empty" is exactly the kind of load-bearing negative fact this framework spends `PRODUCT-78`
 * insisting on. What is NOT legitimate is a whole stratum of them. One empty is a fact; every row
 * empty is either a genuine and highly interesting uniformity, or the column does not surface over
 * this transport — and those two have opposite remedies, so the run must say which.
 *
 * Read from the CAPTURED RESPONSE rather than the assertion, because the assertion is prose and
 * the response is what came back. Threshold is a stated number, not a ratio: below it, "all of
 * them" is not evidence of anything.
 */
const EMPTY_STRATUM_MIN = 5;

/**
 * Every column this framework has declared meaning-bearing, per table — the union of `BODY_FIELDS`
 * and the `shape` of every defining child. It is the population `emptyStrata` counts over, and
 * scoping to it is what turns that guard from noise into a signal: unscoped it reports 400 empty
 * strata on `pilot-run-4`, almost all of them platform decoration (`sys_choice.hint`,
 * `sys_dictionary.defaultsort`, `item_option_new.macro`); scoped it reports seven, every one of
 * which is a statement about the customer's build. The judgement about which columns matter
 * already lives in one place in this file, and this is that place.
 */
function declaredMeaningColumns() {
  const out = new Map();
  const add = (table, fields) => {
    if (!out.has(table)) { out.set(table, new Set()); }
    for (const f of fields || []) { out.get(table).add(f); }
  };
  for (const t of Object.keys(BODY_FIELDS)) {
    const d = BODY_FIELDS[t];
    add(t, [].concat(d.body || [], d.trigger || [], d.shape || [], d.must || []));
  }
  for (const parent of Object.keys(DEFINING_CHILDREN)) {
    for (const c of DEFINING_CHILDREN[parent]) { add(c.table, c.shape); }
  }
  return out;
}

function emptyStrata(claims, opts) {
  const min = (opts && opts.min) || EMPTY_STRATUM_MIN;
  const declared = (opts && opts.declared) || declaredMeaningColumns();
  const byPair = new Map();
  const seenLocus = new Set();
  for (const c of claims || []) {
    const table = c && c.locus && c.locus.table;
    const sysId = c && c.locus && c.locus.sysId;
    if (!table || !sysId) { continue; }
    const resp = c.evidence && c.evidence.capturedResponse;
    if (!resp || typeof resp !== 'object' || Array.isArray(resp)) { continue; }
    /*
     * OVER THE COLUMNS THAT CAME BACK, NOT THE COLUMNS THAT BECAME CLAIMS — and replay is what
     * settled that. The first version of this walked `locus.field`, and therefore could not see
     * `sys_decision_multi_result.result_elements`, the exact column it was written for: harvest
     * requested it, received `""` 37 times, and minted no claim from any of them. A guard that can
     * only see what was claimed is blind to the failure mode where nothing was claimed.
     *
     * One locus contributes once per column however many claims it produced, so a record with
     * twelve claims does not outvote a record with one.
     */
    const meaning = declared.get(table);
    if (!meaning || !meaning.size) { continue; }
    const key = `${table}|${sysId}`;
    if (seenLocus.has(key)) { continue; }
    seenLocus.add(key);
    for (const field of Object.keys(resp)) {
      if (!meaning.has(field)) { continue; }
      const v = resp[field];
      if (v && typeof v === 'object') { continue; }   // a reference object is not a scalar column
      const k = `${table}|${field}`;
      const seen = byPair.get(k) || { table, field, loci: 0, empty: 0 };
      seen.loci += 1;
      if (v === '' || v === null || v === undefined) { seen.empty += 1; }
      byPair.set(k, seen);
    }
  }
  return [...byPair.values()]
    .filter((s) => s.loci >= min && s.loci === s.empty)
    .map((s) => ({ table: s.table, field: s.field, loci: s.loci }))
    .sort((a, b) => b.loci - a.loci || a.table.localeCompare(b.table) || a.field.localeCompare(b.field));
}

/*
 * METHOD-6 / PHASE B — THE EDGE AS AN OBJECT.
 *
 * The ledger's unit is a claim: one record, one field. The PRODUCT's unit is a chain — the
 * assignment rule reaches its resolver, the resolver reaches its decision table, the decision
 * table reaches a group. Until this function existed, nothing in the loop had an object for the
 * edge between two artifacts, so no chain could be reported as broken and the run's own numbers
 * (19,360 claims, 19,353 of them verified) said nothing at all about whether an agent could follow one.
 *
 * An edge is DANGLING when its target sys_id is no claim's locus. Measured on run 93838afe87:
 * 970 of 2,958 mechanism edges dangle, and the per-page intact rate ORDERS the three head-to-head
 * developer tasks correctly — which no fact count has ever done.
 *
 * INLINE EDGES ARE THE POINT. A sys_id inside a script body, a property value or a condition is a
 * reference too, and on this ledger it is where the load-bearing chain lives. The first version of
 * this matched whole-value sys_ids only, found reference COLUMNS, and reported the routing page as
 * having zero edges — a wrong finding for the right reason. Scan every value, not every column.
 */
const REF_SYS_ID = /[0-9a-f]{32}/g;
const REF_WHOLE = /^[0-9a-f]{32}$/;
/* Identity and provenance columns: real sys_ids, never a mechanism the reader would follow. */
const REF_IGNORE_COLUMNS = new Set(['sys_id', 'sys_created_by', 'sys_updated_by', 'sys_mod_count',
  'sys_class_name', 'sys_update_name', 'sys_name', 'sys_package', 'sys_policy',
  'sys_package.name', 'sys_scope.scope', 'sys_domain', 'sys_domain_path']);
const REF_BOOKKEEPING_TABLES = new Set(['sys_metadata_delete', 'sys_audit_delete', 'sys_scope_delete']);
const REF_BOOKKEEPING_COLUMNS = /^(sys_update_version|sys_audit_delete|sys_scope_delete|transaction_id)$/;
/*
 * A class earns its OWN finding at three or more distinct unreachable targets. Below that the
 * aggregate finding still counts it, so nothing goes unreported — the threshold decides how the
 * work list is SHAPED, not what is measured. Replayed against run 93838afe87: 134 broken classes
 * uncapped, which is a wall of noise no reader acts on; 3 targets cuts it to 32 individual findings
 * plus the aggregate, a list a harvest can actually be aimed at, and the aggregate still names all 134.
 *
 * SIZE IS THE ONLY RANKING, AND THAT IS A TESTED CHOICE RATHER THAN A LAZY ONE. Replay put Flow
 * Designer internals near the top (sys_hub_step_ext_output.model, sys_ux_applicability.roles), which
 * looks like an instrument aimed at platform inventory, so the obvious repair was to file only classes
 * whose table is in BODY_FIELDS — the repo's own declaration of what carries meaning. Measured: that
 * cut 134 classes to 19, and the 19 were STILL mostly Flow Designer snapshots, while it discarded
 * sys_metadata_link.documentkey — 44 unreachable sys_decision_question records, the largest broken
 * class in the graph and the decision-table chain a developer task actually needed. BODY_FIELDS says
 * which columns to request, not which tables carry mechanism, and using it as a relevance filter hides
 * the finding that matters most. Rank by unreachable targets and let the number argue.
 */
const DANGLING_CLASS_MIN_TARGETS = 3;

/**
 * Build the reference graph of a claim set. Pure: no filesystem, no instance, no network.
 * @returns {{artifacts:number, withResponse:number, edges:number, mechanism:number, dangling:number,
 *   inline:number, inlineDangling:number, bookkeeping:number, targets:number,
 *   classes:number, broken:Array, known:Set, tableOf:Map, artifactOf:Map, mech:Array}}
 */
function referenceGraph(claims, opts) {
  const respCap = (opts && opts.responseCap) || 8000;
  const rows = new Map();
  const artifactOf = new Map();   // claim id -> "table|sysId", so a page can be scoped to its artifacts
  for (const c of claims || []) {
    const table = c && c.locus && c.locus.table;
    const sysId = c && c.locus && c.locus.sysId;
    if (!table || !sysId) { continue; }
    const key = `${table}|${sysId}`;
    if (c.id) { artifactOf.set(c.id, key); }
    if (!rows.has(key)) { rows.set(key, { table, sysId, resp: null }); }
    const r = rows.get(key);
    const resp = c.evidence && c.evidence.capturedResponse;
    if (r.resp || !resp || typeof resp !== 'object' || Array.isArray(resp)) { continue; }
    const lean = {};
    for (const col of Object.keys(resp)) {
      const v = resp[col];
      if (v === null || v === undefined || typeof v === 'object') { continue; }
      const s = String(v);
      if (s.length) { lean[col] = s.slice(0, respCap); }
    }
    r.resp = lean;
  }

  const known = new Set();
  const tableOf = new Map();
  for (const r of rows.values()) { known.add(r.sysId); tableOf.set(r.sysId, r.table); }

  const edges = [];
  let withResponse = 0;
  for (const r of rows.values()) {
    if (!r.resp) { continue; }
    withResponse += 1;
    for (const col of Object.keys(r.resp)) {
      if (REF_IGNORE_COLUMNS.has(col)) { continue; }
      const raw = r.resp[col];
      const found = raw.match(REF_SYS_ID);
      if (!found) { continue; }
      const inline = !REF_WHOLE.test(raw.trim());
      for (const to of found) {
        if (to === r.sysId) { continue; }   // a self-reference is not a chain
        edges.push({ from: r.sysId, fromTable: r.table, col, to, inline });
      }
    }
  }

  const mech = edges.filter((e) => !REF_BOOKKEEPING_TABLES.has(e.fromTable) && !REF_BOOKKEEPING_COLUMNS.test(e.col));
  const dangling = mech.filter((e) => !known.has(e.to));
  const inline = mech.filter((e) => e.inline);

  const byClass = new Map();
  for (const e of mech) {
    const k = `${e.fromTable}.${e.col}`;
    const s = byClass.get(k) || { table: e.fromTable, column: e.col, edges: 0, dangling: 0, inline: 0, targets: new Set(), resolvesTo: new Set() };
    s.edges += 1;
    if (e.inline) { s.inline += 1; }
    if (known.has(e.to)) { s.resolvesTo.add(tableOf.get(e.to)); } else { s.dangling += 1; s.targets.add(e.to); }
    byClass.set(k, s);
  }
  const broken = [...byClass.values()].filter((s) => s.dangling > 0)
    .map((s) => ({
      table: s.table, column: s.column, edges: s.edges, dangling: s.dangling, inline: s.inline,
      targets: s.targets.size, resolvesTo: [...s.resolvesTo].filter(Boolean).sort(),
      sample: [...s.targets].slice(0, 3),
      // The whole set, not just the sample: chainRepairAreas turns these into an sys_idIN read,
      // and a work list built from a three-id sample would silently repair 3 of 52.
      allTargets: [...s.targets],
    }))
    .sort((a, b) => b.targets - a.targets || b.dangling - a.dangling
      || a.table.localeCompare(b.table) || a.column.localeCompare(b.column));

  return {
    artifacts: rows.size, withResponse,
    edges: edges.length, mechanism: mech.length, bookkeeping: edges.length - mech.length,
    dangling: dangling.length, inline: inline.length,
    inlineDangling: inline.filter((e) => !known.has(e.to)).length,
    targets: new Set(dangling.map((e) => e.to)).size,
    classes: byClass.size, broken,
    known, tableOf, artifactOf, mech,
  };
}

/** The broken classes big enough to carry their own finding. The rest are in the aggregate. */
function danglingClasses(claims, opts) {
  const min = (opts && opts.minTargets) || DANGLING_CLASS_MIN_TARGETS;
  const g = (opts && opts.graph) || referenceGraph(claims, opts);
  return g.broken.filter((s) => s.targets >= min);
}

/**
 * The findings a finished claim set owes about its own chains: one per big broken class, plus one
 * aggregate that names the whole population so a capped list never reads as a complete one.
 *
 * WARNING, NOT BLOCKING, and that is METHOD-4 applied to my own guard. The cheapest legal way to
 * satisfy a blocking version is to stop capturing responses or to narrow scope until nothing
 * points outward — both of which make the deliverable worse. A guard whose cheapest satisfaction
 * degrades the product is the wrong guard.
 */
function danglingFindings(claims, opts) {
  const g = referenceGraph(claims, opts);
  if (!g.dangling) { return []; }
  const min = (opts && opts.minTargets) || DANGLING_CLASS_MIN_TARGETS;
  const big = danglingClasses(claims, Object.assign({}, opts, { graph: g, minTargets: min }));
  const pct = (100 * g.dangling / g.mechanism).toFixed(1);
  const out = big.map((s) => ({
    check: 'reference-target-never-mapped',
    severity: 'warning',
    rung: 'L1',
    locus: { table: s.table, field: s.column },
    message:
      `${s.table}.${s.column} points at ${s.targets} record(s) this brain never mapped ` +
      `(${s.dangling} of ${s.edges} edge(s) from this column dangle${s.inline ? `, ${s.inline} of them inline in text` : ''}; ` +
      `population: every sys_id in a captured response of every claim in the ledger, excluding identity, ` +
      `provenance and deletion-log columns). ` +
      `${s.resolvesTo.length ? `Where it does resolve, it lands in ${s.resolvesTo.slice(0, 3).join('/')}. ` : 'It has never once resolved to a mapped record. '}` +
      `Unreachable: ${s.sample.join(', ')}${s.targets > s.sample.length ? `, and ${s.targets - s.sample.length} more` : ''}. ` +
      `A dangling edge is a chain the reader cannot follow: the page can say the rule calls something, and cannot say ` +
      `what that something does. Either harvest the targets — they are a named, finite, already-priced work list — ` +
      `or say on the page that the chain stops here and why.`,
  }));
  out.push({
    check: 'chain-coherence',
    severity: 'warning',
    rung: 'L1',
    message:
      `${g.dangling} of ${g.mechanism} mechanism reference edge(s) dangle (${pct}%), reaching ${g.targets} distinct ` +
      `record(s) this brain never mapped, across ${g.broken.length} of ${g.classes} (table, column) class(es) ` +
      `(population: every sys_id found in a captured response across all ${g.artifacts} artifact(s) in the ledger, ` +
      `${g.withResponse} of which carry one, excluding identity, provenance and deletion-log columns; ` +
      `${g.bookkeeping} bookkeeping edge(s) excluded). ` +
      `${big.length} class(es) at ${min} or more unreachable targets are filed individually; the remaining ` +
      `${g.broken.length - big.length} are counted here and nowhere else. ` +
      `${g.inline} edge(s) are INLINE — a sys_id inside a script, condition or property value — of which ` +
      `${g.inlineDangling} dangle, and those are the load-bearing ones. ` +
      `This percentage is a FLOOR: the ledger stores a bounded window of a script body, so a sys_id past the window ` +
      `is invisible to this count and is silently counted as no edge at all. ` +
      `Fact counts do not measure this. On run 93838afe87 the run reported 19,360 claims at 99.96% verified while ` +
      `32.8% of its chains were broken, and the per-page intact rate ordered three head-to-head developer tasks ` +
      `correctly where the fact count ordered nothing.`,
  });
  return out;
}

/*
 * METHOD-6, FIX (3) — AIM THE HARVEST BY THE GRAPH RATHER THAN BY TESTER REPORT.
 *
 * Two defining-child hops were added on 2026-08-17 from three blind-tester reports. That is a fine
 * way to find the first two and a hopeless way to find the next hundred: the graph names 134 broken
 * classes with counts, and nobody read a tester report to get them.
 *
 * THE MEASUREMENT THAT DECIDES THE DESIGN. Of the 399 dangling class/target pairs on run 93838afe87
 * (295 distinct records — a record reached from two columns counts once per class), **177 sit in a
 * class whose target table is ALREADY KNOWN**, because the same column resolves somewhere else in
 * the ledger. Those need no dictionary lookup, no hop map and no new capability: the table is named
 * and the sys_ids are in hand, so `sys_idIN<set>` reaches them. By table: 53 sc_cat_item, 44
 * sys_decision_question (the decision-table chain a blind tester needed and could not follow), 17
 * sys_hub_flow_block, 16 sys_hub_action_type_snapshot, 14 sys_decision, 11 sys_ux_form_action.
 *
 * The other 222 pairs, whose column has never once resolved, genuinely need a dictionary read to
 * learn the target table. That is a different and larger job; this function does not attempt it,
 * and `chainRepairAreas` reports the number it is leaving behind rather than implying it covered
 * everything. ONE carve-out (PLAN 6.6's remainder): a never-resolved class whose (parent, column)
 * pair DATA_AREAS declares is aimed by declaration — configuration-in-data can never resolve by
 * observation on a run that holds none of it, which is exactly the run that needs the read.
 *
 * CONVERGENCE IS THE RISK, and it is bounded by counting rounds rather than by hoping. Repairing a
 * chain harvests new artifacts, whose captured responses contain new references, some of which
 * dangle — so an unbounded repair loop is a run that never finishes. `queue.chainRepairRounds`
 * starts at CHAIN_REPAIR_ROUNDS and decrements every time areas are minted; at zero the leg is shut
 * and the run proceeds. One round is the default because the first round is where the measured 177
 * live, and a second round's value is a guess until a real run produces the number.
 */
const CHAIN_REPAIR_ROUNDS = 1;
/*
 * SET FROM THE MEASUREMENT, NOT FROM A ROUND NUMBER. On run 93838afe87 fifteen target tables clear
 * the three-target floor, so a cap of 8 — my first guess — dropped SEVEN eligible tables and half
 * the table list for 13% of the targets. At 16 the measured run truncates nothing and the cap is a
 * backstop against a pathological instance rather than a routine loss. Each area is one harvest
 * ITERATION, which is the binding constraint on this loop (PRODUCT-90: run 4 was bound by
 * iterations four times over and never by money), and 15 iterations against that run's 484 is noise.
 */
const CHAIN_REPAIR_MAX_AREAS = 16;
const CHAIN_REPAIR_MAX_IDS = 200;
/*
 * PLAN 6.12 PART (3). Dictionary areas are capped SEPARATELY from sys_idIN repair areas, because
 * they answer a cheaper question at a different rate: one sys_dictionary read per class decides
 * whether its targets are readable at all, and only reference columns go on to cost sys_idIN
 * reads. Measured on run pilot-run-5: 94 never-resolved classes hold 1,046 targets; a cap of 8
 * queues the 8 largest classes (561 targets, 54%) at 8 iterations, and everything dropped at the
 * cap is REPORTED, not eaten — the same no-silent-caps rule the area cap above learned the hard
 * way. Iterations are the binding axis on a scored run (PRODUCT-90), which is why this is 8 and
 * not 94.
 */
const CHAIN_REPAIR_DICT_MAX_AREAS = 8;
/*
 * A table with one or two unmapped targets is not an area, it is a footnote — but it is still a
 * chain nobody can follow, so `belowThreshold` counts them rather than letting the floor eat them.
 */
const CHAIN_REPAIR_MIN_IDS = 3;

/**
 * Harvest areas that close broken chains, derived from the ledger alone. Zero instance reads.
 * @returns {{areas:Array, aimable:number, unaimable:number, tables:number}}
 */
function chainRepairAreas(claims, opts) {
  const g = (opts && opts.graph) || referenceGraph(claims, opts);
  const maxAreas = (opts && opts.maxAreas) || CHAIN_REPAIR_MAX_AREAS;
  const maxIds = (opts && opts.maxIds) || CHAIN_REPAIR_MAX_IDS;
  const minIds = (opts && opts.minIds) || CHAIN_REPAIR_MIN_IDS;
  const already = new Set((opts && opts.exclude) || []);

  /*
   * A class resolves to one table in the ordinary case and to several where the column is a
   * polymorphic document key. Where it is ambiguous the target is attributed to EVERY table it has
   * been seen to resolve to, because reading one extra table's worth of `sys_idIN` misses is a
   * cheap wrong answer and dropping the target entirely is an expensive one.
   *
   * PLAN 6.6, THE REMAINDER. A second aiming source, unioned with the first: a class whose
   * column has NEVER resolved in this ledger can still be aimed when DATA_AREAS declares the
   * (parent, column) pair — configuration-in-data has no metadata row to resolve against, so a
   * run holding zero sys_user_group rows could never aim a group column by observation, however
   * many group references it held. The union matters for the polymorphic case: a declared column
   * that also resolves somewhere (sys_variable_value.value binding a catalog item in one row and
   * a group in another) is probed against BOTH tables, on the same cheap-wrong-answer doctrine.
   */
  const declaredAims = dataAreaDeclaredAims();
  const byTable = new Map();
  for (const s of g.broken) {
    const aims = new Set(s.resolvesTo.concat(declaredAims.get(`${s.table}.${s.column}`) || []));
    if (!aims.size) { continue; }
    for (const target of aims) {
      const seen = byTable.get(target) || { table: target, ids: new Set(), from: new Set() };
      for (const id of s.allTargets) { seen.ids.add(id); }
      seen.from.add(`${s.table}.${s.column}`);
      byTable.set(target, seen);
    }
  }
  const unaimedClasses = g.broken
    .filter((s) => !s.resolvesTo.length && !(declaredAims.get(`${s.table}.${s.column}`) || []).length);
  const unaimable = unaimedClasses.reduce((n, s) => n + s.targets, 0);

  /*
   * PLAN 6.12 PART (3) — THE CLASSES NOBODY CAN AIM GET A QUESTION, NOT A SHRUG. A class whose
   * column never resolves and is declared nowhere used to be a number in the finding text
   * ("those need a dictionary read this round does not make") and nothing else — measured at
   * 1,046 of run pilot-run-5's 1,249 dangling targets, 84% of the whole problem. The round now
   * MINTS that dictionary read: one area per class, whose brief is (1) one sys_dictionary read
   * for (table, column); (2) if it is a reference, read the targets sys_idIN against the table
   * it names; (3) if it is NOT a reference — a condition, a template body, a string — the
   * sys_ids are inline text no read can follow, and the claim saying so SHUTS the class
   * honestly, which is as much an answer as the read is. The ledger's own dictionary claims
   * cannot substitute: measured on pilot-run-5, its 2,340 dictionary claims cover 0 of the 94
   * never-resolved classes, because the harvest captures customer-authored dictionary rows and
   * these columns are platform ones.
   */
  const dictEligible = unaimedClasses
    .map((s) => ({ table: s.table, column: s.column, ids: s.allTargets.filter((id) => !already.has(id)) }))
    .filter((s) => s.ids.length >= minIds)
    .sort((a, b) => b.ids.length - a.ids.length || `${a.table}.${a.column}`.localeCompare(`${b.table}.${b.column}`));
  const maxDict = (opts && opts.maxDictAreas) || CHAIN_REPAIR_DICT_MAX_AREAS;
  const dictDropped = dictEligible.slice(maxDict).map((s) => ({ class: `${s.table}.${s.column}`, targets: s.ids.length }));
  const dictionaryAreas = dictEligible.slice(0, maxDict).map((s) => ({
    id: `chain-repair-dict-${s.table.replace(/_/g, '-')}-${s.column.replace(/_/g, '-')}`,
    tables: [s.table],
    column: s.column,
    population: 'chain-repair-dictionary',
    targets: s.ids.slice(0, maxIds),
    targetsTotal: s.ids.length,
    rowsInDomain: Math.min(s.ids.length, maxIds),
    from: [`${s.table}.${s.column}`],
    why: `${s.ids.length} sys_id(s) appear in ${s.table}.${s.column} and the column has never resolved anywhere in this ` +
      'ledger, so nothing says what table they live in. One sys_dictionary read answers that — and if the column is not ' +
      'a reference at all, THAT is the answer, and it shuts this class honestly.',
  }));

  const sized = [...byTable.values()]
    .map((s) => ({ table: s.table, ids: [...s.ids].filter((id) => !already.has(id)), from: [...s.from].sort() }));
  const belowThreshold = sized.filter((s) => s.ids.length && s.ids.length < minIds);
  const eligible = sized
    .filter((s) => s.ids.length >= minIds)
    .sort((a, b) => b.ids.length - a.ids.length || a.table.localeCompare(b.table));
  /*
   * NO SILENT CAPS. Measured on run 93838afe87 the eligible set is larger than CHAIN_REPAIR_MAX_AREAS,
   * so the cap is load-bearing on the very first real run and a caller that reported only the areas
   * it minted would read as "the chains are repaired" while leaving a named, priced remainder unread.
   * The dropped set is returned so the caller can say so.
   */
  const dropped = eligible.slice(maxAreas).map((s) => ({ table: s.table, targets: s.ids.length }));
  const areas = eligible
    .slice(0, maxAreas)
    .map((s) => ({
      id: `chain-repair-${s.table.replace(/_/g, '-')}`,
      tables: [s.table],
      population: 'chain-repair',
      targets: s.ids.slice(0, maxIds),
      targetsTotal: s.ids.length,
      rowsInDomain: Math.min(s.ids.length, maxIds),
      from: s.from,
      why: `${s.ids.length} record(s) in ${s.table} are referenced by ${s.from.slice(0, 3).join(', ')}` +
        `${s.from.length > 3 ? ` and ${s.from.length - 3} more column(s)` : ''} and were never mapped, so every page ` +
        `citing those references states that something happens and cannot say what. The sys_ids are already in hand.`,
    }));

  /*
   * TWO NUMBERS, BECAUSE THEY ARE NOT THE SAME NUMBER AND THE DIFFERENCE IS THE DESIGN.
   * `probes` counts (target table, sys_id) pairs; `records` counts distinct sys_ids. They diverge
   * wherever a polymorphic column — sys_documentation.name is the one on this ledger — has been
   * seen to resolve into several tables, because the target is then attributed to all of them.
   * On run 93838afe87: 177 records, 222 probes. The surplus 45 are reads that will come back empty
   * by construction, which is why the brief tells the agent an empty sys_idIN row is a FACT.
   */
  const records = new Set();
  for (const s of byTable.values()) { for (const id of s.ids) { records.add(id); } }
  return {
    areas, dropped,
    dictionaryAreas, dictDropped,
    belowThreshold: belowThreshold.length,
    belowThresholdTargets: belowThreshold.reduce((n, s) => n + s.ids.length, 0),
    probes: [...byTable.values()].reduce((n, s) => n + s.ids.size, 0),
    records: records.size,
    unaimable,
    tables: byTable.size,
  };
}

/*
 * WHAT THE ROUND LEAVES BEHIND, SAID OUT LOUD — shared by BOTH doors into the repair leg (the
 * drain in harvest.apply() and the close in harvest.onClose()), because two hand-maintained
 * copies of this message would drift and the drifted one would be the one nobody replays. A
 * repair round that reported only what it queued would read as "the chains are repaired" — and
 * on the measured run it covers 177 of 399 dangling pairs, hits its own area cap, and cannot
 * touch the classes whose column has never once resolved, because nothing in the ledger says
 * what table those targets live in.
 */
function chainRepairRoundFinding(repair, roundsAfter) {
  if (!(repair.areas.length || repair.dropped.length || repair.unaimable)) { return []; }
  return [{
    check: 'chain-repair-round',
    severity: 'warning',
    rung: 'L1',
    message:
      `Chain repair round minted ${repair.areas.length} area(s) covering ${repair.areas.reduce((n, a) => n + a.targets.length, 0)} ` +
      `of ${repair.probes} reachable (table, sys_id) probe(s) over ${repair.records} distinct unmapped record(s) ` +
      `(population: every dangling reference in the ledger whose target table is known because the same column ` +
      `resolves elsewhere). ` +
      `${repair.dropped.length ? `${repair.dropped.length} further table(s) were ELIGIBLE AND NOT QUEUED at the area cap of ${CHAIN_REPAIR_MAX_AREAS}: ${repair.dropped.slice(0, 5).map((d) => `${d.table} (${d.targets})`).join(', ')}. ` : ''}` +
      `${repair.belowThreshold ? `${repair.belowThreshold} table(s) holding ${repair.belowThresholdTargets} target(s) fell below the ${CHAIN_REPAIR_MIN_IDS}-target floor and were not made areas — they are still chains nobody can follow, and one sys_idIN read would close all of them together if a later round wants them. ` : ''}` +
      `${repair.unaimable} further dangling pair(s) sit in classes whose column has NEVER resolved, so nothing in ` +
      `the ledger says which table their targets live in. ` +
      `${(repair.dictionaryAreas || []).length ? `${repair.dictionaryAreas.length} of those class(es), holding ${repair.dictionaryAreas.reduce((n, a) => n + a.targetsTotal, 0)} target(s), are queued as DICTIONARY areas — one sys_dictionary read each decides what table the targets live in, or that the column is not a reference at all, which shuts the class honestly. ` : ''}` +
      `${(repair.dictDropped || []).length ? `${repair.dictDropped.length} further class(es) were ELIGIBLE AND NOT QUEUED at the dictionary-area cap of ${CHAIN_REPAIR_DICT_MAX_AREAS}: ${repair.dictDropped.slice(0, 5).map((d) => `${d.class} (${d.targets})`).join(', ')}. ` : ''}` +
      `${roundsAfter} repair round(s) remain after this one — the leg is bounded by round count on purpose, ` +
      `because repairing a chain harvests records whose own references dangle, and an unbounded version is a run ` +
      `that never finishes.`,
  }];
}

/** One rejection, naming the population and the worst offenders. Never one per claim. */
function emptyAssertionRejection(bad, what) {
  const byField = {};
  for (const b of bad) { byField[b.field] = (byField[b.field] || 0) + 1; }
  const fields = Object.entries(byField).sort((a, b) => b[1] - a[1]);
  return `${bad.length} ${what} assert(s) that a field is empty or absent while that field is not in the claim's own ` +
    `evidence.fields (population: every claim in this artifact whose assertion states an absence). ` +
    `By field: ${fields.slice(0, 6).map(([f, n]) => `${f} (${n})`).join(', ')}. ` +
    `Worst: ${bad.slice(0, 4).map((b) => `${b.id || '(unminted)'} on ${b.table}/${b.sysId} — "${b.assertion}"`).join(' · ')}. ` +
    `An unread column and an empty column are the same JSON, and the previous run rendered the difference as fact: ` +
    `a wiki page states "the script column is empty; the only logic on the record is the condition" about a UI action ` +
    `whose logic lives in client_script_v2, a column it never requested. Either request the field and re-read it, or ` +
    `say what you DID read — "no condition was requested for this record" is a true sentence and "condition is empty" ` +
    `is not.`;
}

/**
 * PLAN 5.43. The defining-child plan for a harvest area's tables.
 *
 * `depth` is capped at CHILD_DEPTH_CAP rather than left unbounded, and the cap is a stated number
 * rather than an emergent one: two hops is what reaches sys_ux_m2m_action_layout_item (the record
 * that decides whether a workspace button renders) and sys_highlighted_value_condition (the record
 * that carries the colour), and nothing established in this repo needs a third. A cycle in the map
 * cannot loop, because every (parent, child) pair is emitted at most once.
 */
function definingChildrenFor(tables, opts) {
  const cap = Math.max(1, (opts && opts.depth) || CHILD_DEPTH_CAP);
  const out = [];
  const seen = new Set();
  const walk = (parent, level) => {
    if (level >= cap) { return; }
    for (const c of DEFINING_CHILDREN[parent] || []) {
      const key = parent + '|' + c.table;
      if (seen.has(key)) { continue; }
      seen.add(key);
      out.push({
        parent, table: c.table, level,
        on: { parent: (c.on.parent || []).slice(), child: (c.on.child || []).slice() },
        also: c.also || null, shape: (c.shape || []).slice(), why: c.why,
      });
      walk(c.table, level + 1);
    }
  };
  for (const t of tables || []) { walk(t, 0); }
  return out;
}

/*
 * PRODUCT-83 — CONFIGURATION THAT LIVES IN DATA, which no census area can reach at any budget.
 *
 * A census area is a `sys_metadata` `sys_class_name` stratum and nothing else can be one (see
 * DEFINING_CHILDREN above for why a supplementary strata list breaks PRODUCT-12's arithmetic in
 * both directions). DEFINING_CHILDREN reaches past that limit through a PARENT the harvest is
 * already holding. Some configuration has no metadata parent at all, and for that there is no
 * route in the loop whatsoever.
 *
 * Measured on run `pilot-run-4`: `count(sys_metadata, sys_class_name=sys_user_group)` = **0**. Groups
 * are data. The sealed recall for that engagement describes routing that "picks a regional
 * routing-group from the injured person's department chain" and a FrontOffice adviser "who must be in
 * that routing-group to pick it up" — 21 ACME-named groups, the routing target and the membership
 * gate of the process being mapped — and no domain leg, no area and no defining child could reach
 * a single one of them. The A/B against the hand-built brain scored routing and role containment
 * as absent, and this is the mechanism: not budget, not ranking, no stage looks.
 *
 * These areas are a SEPARATE POPULATION and the separation is the whole design. They are not in
 * Band A, they carry no `sys_scope`, and they must never enter the Band A reconciliation — which
 * is why they arrive in `census.dataAreas[]` rather than in `census.areas[]`, are sized in their
 * own unit, and are appended to the work queue only at `apply`.
 *
 * `reach` names the ONLY legs that work here: no `scope` (a data row has no scope to be in) and no
 * `sys_name` (the display column is `name`, and it must be dictionary-validated before it is put in
 * a clause — PLATFORM-1 turns an unknown column into an unfiltered sweep).
 *
 * CONSERVATIVE ON PURPOSE, exactly like BODY_FIELDS and DEFINING_CHILDREN. A table absent here
 * means "this repo has not established that it is configuration", which is a gap a reader can see,
 * rather than a guessed clause that returns a number nobody can check. `cmn_department` is
 * deliberately absent though the recall names the department chain: the chain is org data, the
 * department→routing-group MAPPING is the configuration, and no read in this repo has established
 * where that mapping lives. The test for adding an entry is the same one BODY_FIELDS uses — a
 * measured read on a real instance, not a plausible table name.
 */
const DATA_AREAS = Object.freeze({
  sys_user_group: {
    id: 'data-sys-user-group',
    tables: ['sys_user_group'],
    reach: { name: 'name', author: ['sys_created_by', 'sys_updated_by'], scope: null },
    shape: ['name', 'description', 'manager', 'parent', 'type', 'email', 'active', 'roles'],
    why: 'groups are the routing target and the membership gate of most ServiceNow processes, and they are DATA — sys_metadata holds zero rows of this class, so no census area, no domain scope leg and no defining child can reach one. Run pilot-run-4 could not see 21 ACME-named groups its own sealed recall described as the process\'s routing mechanism.',
    /*
     * PLAN 6.6, THE REMAINDER — SET MEMBERSHIP RESOLVED FROM AN ALREADY-HARVESTED PARENT.
     *
     * The `reach` legs above find groups whose NAME or AUTHOR matches the boundary, and the
     * blocking fact for head-to-head task 1 is precisely a group they cannot find: a routing-group
     * named `MCN Zuidwest` matches no ACME* pattern and was created by nobody in the author leg.
     * What the run DOES hold is references: harvested parents whose columns carry group sys_ids.
     * The chain-repair leg can read a named sys_id set — but it aims a class only where the same
     * column already resolves elsewhere in the ledger, and a run holding ZERO groups can never
     * resolve a group column, so the one table this mechanism exists for was permanently
     * unaimable. `referencedBy` breaks that circle: it DECLARES the (parent, column) pairs this
     * repo has established to hold sys_user_group ids, so the repair round can aim them without
     * an in-ledger resolution and without the dictionary read PLAN 6.12 part (3) still owes.
     *
     * THE LIST IS AN ALLOWLIST, like everything else in this map: an entry is a dictionary fact
     * or a measured read, never a plausible column name. Measured on the two scored ledgers the
     * declared classes dangle small today — sys_report_users_groups.group_id (1 target, run 5),
     * sys_template.group/groups (3 targets, run 4) — because the parent that carries the
     * routing-group bindings, sys_variable_value, has never yet been walked by a run: the hop that
     * reaches it (sys_decision_multi_result -> sys_variable_value) landed 2026-08-17, after
     * run 4. The declaration is what turns that hop's future captures into group reads.
     *
     * sys_variable_value.value is NOT a reference column — it is a string that holds whatever
     * the variable binds, group ids among them (the reference engagement's decision answers bind
     * routing-groupen there; that is PLAN 6.6's worked example). Aiming it is deliberately
     * polymorphic: ids that are not groups come back as empty sys_idIN rows, which the repair
     * brief already declares to be load-bearing facts, and the cost is bounded by the same area
     * cap and id cap as every other repair area.
     */
    referencedBy: [
      { table: 'sysrule_assignment', column: 'group', why: 'assignment rules route TO a group; dictionary reference.' },
      { table: 'sys_template', column: 'group', why: 'template visibility group; dictionary reference.' },
      { table: 'sys_template', column: 'groups', why: 'template visibility glide_list of groups.' },
      { table: 'sys_report_users_groups', column: 'group_id', why: 'report sharing m2m; dictionary reference.' },
      { table: 'sysevent_email_action', column: 'recipient_groups', why: 'notification recipient glide_list of groups.' },
      { table: 'sys_variable_value', column: 'value', why: 'decision-answer bindings hold group sys_ids here (measured on the reference engagement); polymorphic, so misses are expected and are facts.' },
    ],
  },
});

/**
 * PLAN 6.6 remainder: 'parent.column' -> the data tables declared to hold that column's ids.
 * Derived from DATA_AREAS so the declaration lives beside the table it reaches, not in a second
 * list that can drift from the first.
 */
function dataAreaDeclaredAims() {
  const map = new Map();
  for (const [table, entry] of Object.entries(DATA_AREAS)) {
    for (const ref of entry.referencedBy || []) {
      const key = `${ref.table}.${ref.column}`;
      map.set(key, (map.get(key) || []).concat([table]));
    }
  }
  return map;
}

/** The data areas whose reach legs this run's boundary can actually exercise. */
function dataAreasFor(domain) {
  const d = domain || {};
  const usable = ((d.name || []).length > 0) || ((d.author || []).length > 0);
  return Object.keys(DATA_AREAS).map((table) => Object.assign({ table }, DATA_AREAS[table], { usable }));
}

/** Tables whose behaviour this transport can actually read a body for. */
function readableBodyTables() {
  return Object.keys(BODY_FIELDS).filter((t) => (BODY_FIELDS[t].body || []).length && !BODY_FIELDS[t].unreadable);
}

/**
 * Rank the loci that deserve a body read, from the claim ledger the harvest just built.
 *
 * The unit here is the RECORD, not the table: harvest's unit is the area and that is exactly
 * why the reference run's output inherited ServiceNow's object model instead of the
 * customer's work breakdown. Ranking is deliberately dumb and deterministic — band, then how
 * much the harvest already learned about the locus (a proxy for how load-bearing it is),
 * then table order, then sys_id — because a model-supplied score here would be the same
 * unfalsifiable number the ranker refuses everywhere else. The domain predicate (PLAN 2.1)
 * is what will make this ranking *aimed* rather than merely stable.
 */
function explainCandidates(ctx) {
  const cap = (ctx.state.config && ctx.state.config.explainCap) || 150;
  const byLocus = new Map();
  for (const c of ctx.brain.claims().values()) {
    if (c.band !== 'A' && c.band !== 'B') { continue; }
    const table = c.locus && c.locus.table;
    const sysId = c.locus && c.locus.sysId;
    if (!table || !sysId || !BODY_FIELDS[table]) { continue; }
    const key = `${table}|${sysId}`;
    const prev = byLocus.get(key) || { table, sysId, band: c.band, claims: 0, name: null, scope: c.scope || null };
    prev.claims += 1;
    if (prev.band !== 'A' && c.band === 'A') { prev.band = 'A'; }
    const resp = c.evidence && c.evidence.capturedResponse;
    if (!prev.name && resp && typeof resp === 'object') { prev.name = resp.name || resp.sys_name || null; }
    byLocus.set(key, prev);
  }
  const all = [...byLocus.values()].sort((a, b) => {
    if (a.band !== b.band) { return a.band === 'A' ? -1 : 1; }
    if (b.claims !== a.claims) { return b.claims - a.claims; }
    if (a.table !== b.table) { return a.table.localeCompare(b.table); }
    return a.sysId.localeCompare(b.sysId);
  });
  const readable = all.filter((x) => !BODY_FIELDS[x.table].unreadable && (BODY_FIELDS[x.table].body || []).length);
  const unreadable = all.filter((x) => BODY_FIELDS[x.table].unreadable || !(BODY_FIELDS[x.table].body || []).length);
  return { ranked: readable.slice(0, cap), overflow: readable.slice(cap), unreadable, total: all.length, cap };
}

function truncateStr(s, n) { const v = String(s === undefined || s === null ? '' : s); return v.length > n ? v.slice(0, n) + '…' : v; }

/**
 * Claims that were verified and have since gone stale.
 *
 * `staleAfter` was computed on every verified claim and READ BY NOTHING — a horizon written
 * down and never consulted, so a claim verified once was verified forever. That is fine on a
 * single run, where every claim is minutes old, and wrong the moment a brain is updated
 * incrementally: the second run inherits the first run's confidence about records that have had
 * a month to change underneath it.
 *
 * Note what this does NOT do. It does not let verify SAMPLE. Every claim still has to reach a
 * settled status before handoff, because `successBlockers()` says so and that invariant is what
 * makes the ledger worth anything. Verification was already batched — the reference run settled
 * 96,606 claims in roughly 974 calls — so the volume was never the waste. The waste was
 * harvesting 96,606 claims of which 4.53% were in-domain, which is an AIMING problem and is
 * what the domain predicate addresses.
 */
function staleClaims(brain) {
  const today = new Date().toISOString().slice(0, 10);
  return [...brain.claims().values()].filter((c) => c.status === 'verified' && c.staleAfter && c.staleAfter < today);
}

/**
 * PLAN 5.17. Verify's forward route, declared ONCE.
 *
 * `next()` and the unsampled close both take it from here, so the engine still never names a
 * stage (invariant 7) and a close can never route somewhere `next()` would not have gone. The
 * third hand edit on run 6ef14f5562 was exactly this route performed in a text editor:
 * `state.audit[2]`, 09:42:04Z, "state.stage advanced verify -> questions with 8,179 of 8,239
 * claims still draft".
 */
function verifyForward(ctx) {
  // The scope filter's three failure verdicts each forbid raising questions at all.
  const filter = ctx.state.stamps.scopeFilter;
  return filter && filter !== 'pass' ? 'render' : 'questions';   // inventory-only path: pages and kernel, zero questions
}

/** NAMED POPULATION: not-sampled claims with no close in `queue.unsampled.closes` covering them. */
function orphanUnsampledClaims(ctx) {
  const closed = new Set((((ctx.state.queue || {}).unsampled || {}).closes || []).map((c) => c.sampleId));
  return [...ctx.brain.claims().values()].filter(
    (c) => c.status === 'unverifiable' && c.unverifiableReason === NOT_SAMPLED && !closed.has(c.notSampledSampleId));
}

// ---------------------------------------------------------------------------
// CLOSING A STAGE ON A BOUND — the contract, and the one helper that implements it
// ---------------------------------------------------------------------------

/*
 * PRODUCT-35. `budgetRemaining()` had five callers and every one of them was a console.log.
 * The only budget rule in the engine was a TERMINAL — state.js sets `exhausted` once usedCalls
 * exceeds maxCalls — so the budget could END A RUN and could never FINISH A STAGE. `--cap` is a
 * stagnation guard: it bounds iterations WITHOUT progress, so it cannot terminate a stage that
 * is progressing. On run 6ef14f5562 `caps.perStage.harvest = 2` stood against `total: 1,
 * sinceProgress: 0` and fired zero times while 430 of 431 areas went unread.
 *
 * THE CONTRACT, and the first version of it was an infinite loop both critic passes caught:
 *
 *   closeTo: '<the stage this one hands the remainder to>'
 *   closeOn(ctx, opts) -> null | { reason, stamp, to, unreached, population, unit,
 *                                  populationName, detail, measured }
 *   onClose(ctx, close) -> null | { stay, queue, findings, note }   — OPTIONAL salvage hook.
 *     Called by the CLI when a close fires, BEFORE it advances. The close is recorded either
 *     way; `stay: true` holds the cursor so a bounded salvage queue (harvest's chain-repair
 *     tail) is actually read instead of being minted into a stage the cursor just left. The
 *     engine applies `queue` and `findings` blindly — what they are is the table's business.
 *
 * `to` is DECLARED IN THE TABLE ENTRY (`closeTo`) and returned by `closeOn`; the CLI takes it
 * directly and NEVER calls `next()` on a close. The rejected design said "if closeOn fires,
 * take next() anyway" — but `harvest.next()` returns 'harvest' precisely while the queue is
 * non-empty, which is the state a budget close fires in, so it routed back into harvest until
 * the runaway ceiling fired as `exhausted`: today's behaviour with extra bookkeeping. Taking
 * the name from the table also keeps the engine from ever naming a stage (invariant 7).
 *
 * CALL IT ONLY WHERE WORK IS OUTSTANDING. A stage whose queue is empty is routed by next(), not
 * closed; closing there would report unread work on a stage that read everything it was given.
 *
 * `opts.lookahead` (default 0) asks the same question N iterations into the future at the
 * stage's own measured rate, so `snbrain next` can WARN one iteration before the door shuts
 * while `snbrain override --budget <n> --by <name> --reason <text>` can still prevent it. A
 * close is not reversible inside a run — there is no re-entry verb yet (PLAN 5.5) — so the
 * forecast IS the sanctioned exit, and it has to print before the close, not after.
 */
function boundClose(ctx, opts) {
  const o = opts || {};
  const entry = STAGE_BY_ID.get(ctx.stage);
  const to = entry && entry.closeTo;
  if (!to) { return null; }   // a stage that has not declared where the remainder goes cannot close
  const lookahead = num(o.lookahead, 0);
  const st = ((ctx.state.stages || {})[ctx.stage]) || {};
  const cfg = ctx.state.config || {};
  const budget = ctx.state.budget || {};

  const priced = (st.iterations || []).filter((i) => i.accepted && num(i.apiCalls, 0) > 0);
  const rate = priced.length ? Math.ceil(priced.reduce((a, i) => a + i.apiCalls, 0) / priced.length) : null;
  const maxCalls = num(budget.maxCalls, 0);
  const reserve = Math.ceil(maxCalls * clamp(num(cfg.downstreamReserveShare, 0.25), 0, 0.9));
  const remaining = Math.max(0, maxCalls - num(budget.usedCalls, 0)) - (rate || 0) * lookahead;

  const mk = (reason, detail, measured) => Object.assign({
    reason, stamp: reason, to, lookahead,
    unreached: num(o.unreached, null), population: num(o.population, null),
    unit: o.unit || null, populationName: o.populationName || null,
  }, { detail, measured });

  /*
   * MONEY, and the test is not "can we afford one more" — it is "can we afford one more AND
   * still pay for the rest of the run". The reference run left harvest with 319 of 800 calls
   * and 430 areas unread at a measured 269 calls per area; one more would have left 50, and
   * verify's own job was ~255 batched reads (PRODUCT-11). Nothing reserved anything for anyone.
   */
  if (rate !== null && (remaining - rate) < reserve) {
    return mk('budget-capped',
      `${remaining} call(s) remain of ${maxCalls}; this stage has cost ${rate} call(s) per accepted iteration over ` +
      `${priced.length} iteration(s), and ${reserve} are reserved for the stages after it, so one more would leave ` +
      `${remaining - rate}. ` +
      (num(o.unreached, 0) ? `At this rate the ${o.unreached} unread ${o.unit || 'item(s)'} need about ${o.unreached * rate} call(s). ` : '') +
      `Raise the budget BEFORE the close with "snbrain override --budget <n> --by <name> --reason <text>" if this work must be read.`,
      { remaining, rate, reserve, iterationsPriced: priced.length });
  }

  // WALL CLOCK. LOOP.md section 10: "Wall clock is the real constraint, not calls."
  // `o.exemptElapsed` is the one carve-out, declared by the stage's own closeOn: a salvage
  // queue minted AT a close starts past the horizon by construction, so this check would
  // close it before its first iteration. The exemption removes only this bound — the caller
  // asserts the queue is bounded some other way — and money and iterations still apply below.
  const horizonHours = Math.max(1, num(cfg.stageWallClockHours, 4));
  const enteredAt = Date.parse(st.enteredAt || ctx.state.createdAt || '');
  const perIteration = (st.iterations || []).length
    ? Math.round((st.iterations || []).reduce((a, i) => a + num(i.elapsedMs, 0), 0) / st.iterations.length) : 0;
  const elapsedMs = (Number.isFinite(enteredAt) ? Math.max(0, Date.now() - enteredAt) : 0) + perIteration * lookahead;
  if (!o.exemptElapsed && elapsedMs > horizonHours * 3600000) {
    return mk('elapsed-capped',
      `${Math.round(elapsedMs / 60000)} minute(s) in this stage against a horizon of ${horizonHours}h. The reference run ` +
      `spent 7h58m end to end for one harvest area and every rule it had was denominated in API calls.`,
      { elapsedMs, horizonMs: horizonHours * 3600000, perIteration });
  }

  /*
   * ITERATIONS. The ceiling is the queue-and-budget-derived number the table computes. Hitting
   * it used to strand the run `exhausted` at a cursor with no forward path (PRODUCT-14); a
   * close hands the remainder forward instead, and says so. The no-progress cap and the
   * stagnation rule are untouched, so a stage that is failing rather than finishing still
   * terminates rather than closing.
   */
  const ceilingN = typeof entry.ceiling === 'function' ? entry.ceiling(ctx) : null;
  if (ceilingN && num(st.total, 0) + lookahead >= ceilingN) {
    return mk('iteration-capped',
      `${num(st.total, 0)} iteration(s) against a ceiling of ${ceilingN} derived from this stage's own queue and budget.`,
      { total: num(st.total, 0), ceiling: ceilingN });
  }
  return null;
}

/*
 * PRODUCT-101 — ELAPSED TIME IS A THIRD AXIS, AND NOW SOMETHING SIZES IT.
 *
 * Run 5 was bound by WALL CLOCK: 248 minutes against a 4-hour horizon with 78% of the money
 * unspent, harvest closed elapsed-capped at 19 of 29 areas, and the first anyone heard of it
 * was the close itself. boundClose() fires AT the horizon and `next` warns one iteration
 * early — pacing is the missing forecast: measure the stage's own iteration duration, project
 * how many more iterations fit before the elapsed close, and compare against the queue. The
 * projection is briefed (the agent sheds load deliberately), filed (a warning finding the
 * FIRST time the queue stops fitting — PRODUCT-25's say-it-when-it-happens), and actionable
 * (`snbrain override --hours <h> --by <name> --reason <text>` is the clock's own exit, the
 * way --budget is the money's).
 *
 * MEDIAN, NOT MEAN, deliberately: run 5's iteration 2 took 97 minutes against a 7-minute
 * median, and a mean paced by that one outlier under-projects the whole rest of the run.
 * (boundClose keeps its mean — it prices the PAST; pacing prices the FUTURE.)
 */
function stagePacing(ctx, opts) {
  const o = opts || {};
  const stageId = o.stage || ctx.stage;
  const st = ((ctx.state.stages || {})[stageId]) || {};
  const accepted = (st.iterations || []).filter((i) => i.accepted && num(i.elapsedMs, 0) > 0);
  if (accepted.length < 2) { return null; }   // unmeasured: one iteration is an anecdote, not a rate
  const durations = accepted.map((i) => num(i.elapsedMs, 0)).sort((a, b) => a - b);
  const medianMs = durations[Math.floor(durations.length / 2)];
  const cfg = ctx.state.config || {};
  const horizonMs = Math.max(1, num(cfg.stageWallClockHours, 4)) * 3600000;
  const enteredAt = Date.parse(st.enteredAt || '');
  const nowMs = num(o.nowMs, Date.now());
  const elapsedMs = Number.isFinite(enteredAt) ? Math.max(0, nowMs - enteredAt) : 0;
  const fitIterations = Math.max(0, Math.floor((horizonMs - elapsedMs) / medianMs));
  const remaining = Math.max(0, num(o.remaining, 0));
  return {
    stage: stageId, medianMs, elapsedMs, horizonMs, fitIterations, remaining,
    accepted: accepted.length,
    fits: fitIterations >= remaining,
    shortfall: Math.max(0, remaining - fitIterations),
  };
}

/** The one-line pacing sentence, shared by the brief, the finding and `snbrain status`. */
function pacingLine(p, atRisk) {
  const min = (ms) => Math.round(ms / 60000);
  const base = `PACE: ${min(p.elapsedMs)} of ${min(p.horizonMs)} min elapsed; median ${(p.medianMs / 60000).toFixed(1)} min ` +
    `per iteration over ${p.accepted} accepted; ${p.remaining} work item(s) remain and ~${p.fitIterations} more iteration(s) fit ` +
    `before the elapsed close.`;
  if (p.fits) { return `${base} The queue fits.`; }
  return `${base} THE QUEUE DOES NOT FIT: ~${p.shortfall} item(s) will not be read at this pace` +
    `${atRisk && atRisk.length ? ` — at risk: ${atRisk.slice(0, 8).join(', ')}${atRisk.length > 8 ? ` and ${atRisk.length - 8} more` : ''}` : ''}. ` +
    'Either shed load deliberately (smallest areas first is rarely right — the queue is ranked by value), or raise the ' +
    'horizon BEFORE the close: snbrain override --hours <h> --by <name> --reason <text>. The close is not reversible ' +
    'inside a run.';
}

// ---------------------------------------------------------------------------
// DOMAIN VOCABULARY. The cheapest knowledge in the engagement, and the run missed it.
// ---------------------------------------------------------------------------

/*
 * Words that carry no domain signal: ordinary English, and the platform's own nouns. A token
 * surviving this list and recurring across many records is, on the evidence, a word the
 * CUSTOMER brought — which is exactly the thing no read can expand and one interview line can.
 */
const VOCAB_STOPWORDS = new Set(('the a an and or of to in is for on by with from at as if not new get set ' +
  'create update delete insert query read write copy move show hide add remove check validate ' +
  'incident task user group role script rule business client server ui action policy notification ' +
  'email message record table field form list view page widget flow workflow catalog request item ' +
  'change problem knowledge approval assignment state status active inactive true false null ' +
  'before after async display sync default custom global test demo sample example temp tmp old ' +
  'copy1 copy2 date time number string boolean reference journal html json xml api rest soap ' +
  'sys var util utils helper lib base core common main std').split(/\s+/));

/**
 * Tokens that recur across the customer-authored surface and have never been explained.
 *
 * RANKED BY BREADTH, NOT BLAST RADIUS, and that distinction is the whole point. The WPM ranker
 * scores E, C and U from record counts and consequence — so "what does QRT mean?" scores near
 * zero, because a vocabulary gap has no blast radius. It does not break anything. It merely
 * makes every page written in the customer's own words unreadable to the person holding the
 * story. On the reference run QRT, ACME, PER and STS were all recorded as "expansion not
 * stated" and not one of them was asked; the glossary conceded the expansion "was never stated
 * and is deliberately not guessed here." Honest, and one line of an expert's time away.
 */
function vocabularyCandidates(ctx) {
  const byToken = new Map();
  for (const c of ctx.brain.claims().values()) {
    if (c.band !== 'A' && c.band !== 'B') { continue; }
    const resp = c.evidence && c.evidence.capturedResponse;
    const name = resp && typeof resp === 'object' ? (resp.name || resp.sys_name) : null;
    if (!name || typeof name !== 'string') { continue; }
    const sysId = c.locus && c.locus.sysId;
    for (const raw of name.split(/[^A-Za-z0-9]+/)) {
      if (raw.length < 2 || raw.length > 24) { continue; }
      const lower = raw.toLowerCase();
      if (VOCAB_STOPWORDS.has(lower) || /^\d+$/.test(lower)) { continue; }
      const e = byToken.get(lower) || { token: lower, forms: new Set(), loci: new Set(), tables: new Set() };
      e.forms.add(raw);
      if (sysId) { e.loci.add(sysId); }
      if (c.locus && c.locus.table) { e.tables.add(c.locus.table); }
      byToken.set(lower, e);
    }
  }
  return [...byToken.values()]
    .map((e) => {
      // An all-caps short form recurring across records is the classic shape of a domain
      // acronym — the class this stage most often has no way to expand.
      const acronymForm = [...e.forms].find((f) => f.length >= 2 && f.length <= 6 && f === f.toUpperCase() && /[A-Z]/.test(f));
      return {
        token: e.token, forms: [...e.forms].sort(), loci: e.loci.size, tables: [...e.tables].sort(),
        looksLikeAcronym: !!acronymForm, display: acronymForm || [...e.forms].sort()[0],
      };
    })
    .filter((e) => e.loci >= 2)
    .sort((a, b) => {
      if (b.loci !== a.loci) { return b.loci - a.loci; }
      if (a.looksLikeAcronym !== b.looksLikeAcronym) { return a.looksLikeAcronym ? -1 : 1; }
      return a.token.localeCompare(b.token);
    });
}

// ---------------------------------------------------------------------------
// PLAN 7.3 — DECISION INDUCTION, INCLUDING THE NEGATIVE SPACE.
// ---------------------------------------------------------------------------

/*
 * The CLI mints candidate WHYs from claim patterns; an agent NEVER invents one — it only words
 * the question (7.4) and, if the human confirms, the decision. Same division as everywhere else:
 * the CLI keeps the arithmetic and the links.
 *
 * Sources, in measured order of value:
 *
 * (a) DELETION MINING. Run 5 banked 3,952 `sys_metadata_delete` claims nobody induced reasoning
 *     from. A deleted record is reconstructed from its delete-log claims (sys_db_object,
 *     sys_name, sys_update_name), clustered by (target table, name), and its identifier tokens
 *     are tested for DEATH against the live claims on the same surface. A dead token whose
 *     surface carries a sibling token (>= 2 shared underscore segments — the name-prefix signal:
 *     u_external_id -> u_external_reference), or whose "L ➡ R (dir)" name slot is refilled by a
 *     live record, yields the candidate "X was built and deliberately removed; Y is the live
 *     replacement". The KNOWN-ANSWER TEST is PRODUCT-91's dedup-key reversal in pilot-run-4's
 *     ledger, and it is the acceptance: an inducer that cannot find the one case we know is
 *     there does not ship.
 *
 * (b) CONFIG-PATTERN INDUCTION — an allowlist of exactly three shapes, extended by measurement,
 *     never by plausibility:
 *     1. feature-off-not-removed: a shipped vendor capability switched off by property
 *        ("OSHA hidden, not removed" — measured on run 5: sn_ohs_im.hide_generate_osha_forms).
 *     2. group-disjointness: the domain's group structure grants no role from a sibling module
 *        ("independent from HRSD" — the pilot customer DEC-001's shape). Needs group/role claims; both scored
 *        ledgers hold zero, so this shape fires only once the group legs land on a live run.
 *     3. single-source: every integration endpoint on the surface points at one external host.
 *        Both scored ledgers hold zero sys_rest_message claims (never-read areas), same story.
 *
 * (c) DOC-VS-INSTANCE CONTRADICTIONS — already minted as contradiction questions; ROUTED through
 *     the candidate shape, never re-detected.
 *
 * Every witness id is a ledger claim id BY CONSTRUCTION, and the final pass re-checks anyway:
 * a witness that does not resolve is dropped AND reported (`counts.hallucinatedWitnesses`) —
 * zero on both scored ledgers is part of 7.3's done-when.
 */

/** Ranked candidates beyond this many are dropped AND REPORTED — a silent cap reads as coverage. */
const DECISION_CANDIDATES_MAX = 24;
const IDENT_TOKEN_RE = /[A-Za-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)+/g;
/** Sibling-module role prefixes for the group-disjointness shape. Extended by measurement only. */
const SIBLING_MODULE_PREFIXES = Object.freeze(['sn_hr_core', 'sn_hr_le', 'sn_hr_ef', 'sn_hr_pa', 'hr_']);

function identTokensOf(text) {
  const out = new Set();
  for (const m of String(text || '').match(IDENT_TOKEN_RE) || []) {
    const t = m.toLowerCase();
    if (t.length > 60 || /[0-9a-f]{16,}/.test(t)) { continue; }
    out.add(t);
  }
  return out;
}

/** >= 2 shared leading underscore segments, and not the same token: u_external_id ~ u_external_reference. */
function tokenPrefixKin(a, b) {
  if (a === b) { return false; }
  const sa = a.split('_'); const sb = b.split('_');
  let shared = 0;
  while (shared < sa.length && shared < sb.length && sa[shared] === sb[shared]) { shared += 1; }
  return shared >= 2;
}

const NAME_SLOT_RE = /^(.+?)\s*➡\s*(.+?)\s*\((\w+)\)$/u;

function decisionCandidatesFromLedger(claims, questions, opts) {
  const byId = new Map();
  for (const c of claims) { if (c && c.id) { byId.set(c.id, c); } }
  const rows = [...byId.values()];
  const candidates = [];
  const counts = { deletedRecords: 0, deletionClusters: 0, tablesWithoutLiveSurface: 0, hallucinatedWitnesses: 0 };

  // --- (a) deletion mining --------------------------------------------------
  const deleted = new Map();
  const liveByTable = new Map();
  for (const c of rows) {
    const t = c.locus && c.locus.table;
    if (!t) { continue; }
    if (t === 'sys_metadata_delete') {
      const r = deleted.get(c.locus.sysId) || { fields: {}, claimIds: [] };
      const m = /^([a-z0-9_]+) = ([\s\S]*)$/.exec(String(c.assertion || ''));
      if (m) { r.fields[m[1]] = m[2]; }
      /*
       * Run 5 asserts only four columns per delete row and keeps `sys_db_object` — the column
       * that names the deleted record's table — in the captured response alone. Fetched and
       * paid for is fetched and paid for (PRODUCT-95's lesson one layer down): the response
       * fills what no assertion claimed, and an assertion always wins where both exist.
       */
      const resp = c.evidence && c.evidence.capturedResponse;
      if (resp && typeof resp === 'object') {
        for (const k of ['sys_db_object', 'sys_name', 'sys_update_name', 'sys_created_by']) {
          if (r.fields[k] === undefined && resp[k]) { r.fields[k] = String(resp[k]); }
        }
      }
      r.claimIds.push(c.id);
      deleted.set(c.locus.sysId, r);
    } else if (c.status !== 'gone') {
      if (!liveByTable.has(t)) { liveByTable.set(t, []); }
      liveByTable.get(t).push(c);
    }
  }
  counts.deletedRecords = deleted.size;

  const clusters = new Map();
  for (const r of deleted.values()) {
    const table = r.fields.sys_db_object;
    const name = r.fields.sys_name || r.fields.sys_update_name || '';
    if (!table) { continue; }
    const key = `${table}|${normText(name).toLowerCase()}`;
    const cl = clusters.get(key) || { table, name, records: 0, claimIds: [], deleters: new Map() };
    cl.records += 1;
    cl.claimIds.push(...r.claimIds);
    // 7.4: the persona who can answer. Whoever deleted the record is who knows why it went —
    // the interview batches why-questions by this name.
    if (r.fields.sys_created_by) { cl.deleters.set(r.fields.sys_created_by, (cl.deleters.get(r.fields.sys_created_by) || 0) + 1); }
    clusters.set(key, cl);
  }
  counts.deletionClusters = clusters.size;

  // Live-surface text and name-bearing tokens, cached per table actually needed.
  const surfaceText = new Map();
  const surfaceTokens = new Map();
  const surface = (table) => {
    if (!surfaceText.has(table)) {
      const live = liveByTable.get(table) || [];
      surfaceText.set(table, live.map((c) => JSON.stringify(c)).join('\n').toLowerCase());
      const toks = new Map();   // token -> claim ids carrying it in assertion/key
      for (const c of live) {
        for (const t of identTokensOf(`${c.assertion || ''} ${(c.locus && c.locus.key) || ''}`)) {
          if (!toks.has(t)) { toks.set(t, []); }
          if (toks.get(t).length < 8) { toks.get(t).push(c.id); }
        }
      }
      surfaceTokens.set(table, toks);
    }
    return { text: surfaceText.get(table), tokens: surfaceTokens.get(table) };
  };

  for (const cl of clusters.values()) {
    const live = liveByTable.get(cl.table) || [];
    if (!live.length) { counts.tablesWithoutLiveSurface += 1; continue; }
    const s = surface(cl.table);
    const ownPrefix = `${cl.table}_`;
    const dead = [...identTokensOf(cl.name)]
      .filter((t) => t !== cl.table && !t.startsWith(ownPrefix) && !s.text.includes(t));
    if (!dead.length) { continue; }

    const replacements = [];
    for (const deadTok of dead) {
      // Longest shared prefix first, at most four kin per dead token: a scope prefix like
      // sn_ohs_im_ makes every sibling table "kin", and an unbounded list buries the one that
      // matters (measured on pilot-run-4: seven kin on an ACL-role cluster vs one on the
      // dedup-key reversal).
      const kin = [];
      for (const [liveTok, ids] of s.tokens) {
        if (!tokenPrefixKin(deadTok, liveTok)) { continue; }
        const sa = deadTok.split('_'); const sb = liveTok.split('_');
        let shared = 0;
        while (shared < sa.length && shared < sb.length && sa[shared] === sb[shared]) { shared += 1; }
        kin.push({ removed: deadTok, token: liveTok, via: 'name-prefix', claims: ids, shared });
      }
      kin.sort((a, b) => b.shared - a.shared || a.token.localeCompare(b.token));
      replacements.push(...kin.slice(0, 4).map(({ shared, ...r }) => r));
    }
    const slot = NAME_SLOT_RE.exec(cl.name);
    if (slot) {
      for (const c of live) {
        const nm = /^(?:sys_)?name = ([\s\S]*)$/.exec(String(c.assertion || ''));
        const liveSlot = nm && NAME_SLOT_RE.exec(nm[1]);
        if (liveSlot && liveSlot[1] === slot[1] && liveSlot[3] === slot[3] && liveSlot[2] !== slot[2]) {
          replacements.push({ removed: slot[2], token: liveSlot[2], via: 'template-slot', claims: [c.id] });
        }
      }
    }

    const replTokens = [...new Set(replacements.map((r) => r.token))];
    const witnesses = [...new Set(cl.claimIds.concat(replacements.flatMap((r) => r.claims)))];
    const askTo = [...cl.deleters.entries()].sort((a, b) => b[1] - a[1]).map(([who]) => who)[0] || null;
    candidates.push({
      key: `del|${cl.table}|${dead.join('+')}`,
      source: 'deletion',
      askTo,
      patternShape: replacements.length ? 'removed-with-replacement' : 'removed-no-replacement',
      table: cl.table,
      statement: replacements.length
        ? `\`${dead.join('`, `')}\` was built and deliberately removed from \`${cl.table}\` ("${trunc2(cl.name, 70)}"); ` +
          `\`${replTokens.join('`, `')}\` is the live replacement on the same surface.`
        : `\`${dead.join('`, `')}\` was built and deliberately removed from \`${cl.table}\` ("${trunc2(cl.name, 70)}"); no live replacement was found on that surface.`,
      rationaleDraft: `${cl.records} deletion-log record(s) witness the removal; the live surface (${live.length} claim(s) on ` +
        `\`${cl.table}\`) carries ${replacements.length ? replTokens.map((t) => `\`${t}\``).join(', ') : 'no kin token'} and never \`${dead.join('`/`')}\`.`,
      principleDraft: replacements.length
        ? `New work on \`${cl.table}\` uses \`${replTokens[0]}\`; \`${dead[0]}\` is not to be reintroduced.`
        : `\`${dead[0]}\` was deliberately retired on \`${cl.table}\`; do not rebuild it without asking why it went.`,
      replacements,
      witnesses,
      score: cl.records + replacements.length * 10,
    });
  }

  // --- (b) config-pattern induction: the three-shape allowlist ---------------
  // b1: feature-off-not-removed.
  {
    const props = new Map();
    for (const c of rows) {
      if (!c.locus || c.locus.table !== 'sys_properties') { continue; }
      const r = props.get(c.locus.sysId) || { fields: {}, claimIds: {} };
      const m = /^([a-z0-9_.]+) = ([\s\S]*)$/i.exec(String(c.assertion || ''));
      if (m) { r.fields[m[1]] = m[2]; r.claimIds[m[1]] = c.id; }
      props.set(c.locus.sysId, r);
    }
    for (const r of props.values()) {
      const name = r.fields.name;
      const value = String(r.fields.value === undefined ? '' : r.fields.value).toLowerCase();
      if (!name) { continue; }
      const hides = /(^|[._])(hide|disable|suppress)/.test(name) && ['true', 'yes', '1'].includes(value);
      const disables = /(^|[._])(enable|show)/.test(name) && ['false', 'no', '0'].includes(value);
      if (!hides && !disables) { continue; }
      const witnesses = [r.claimIds.name, r.claimIds.value].filter(Boolean);
      candidates.push({
        key: `cfg|feature-off|${name}`,
        source: 'config-pattern',
        patternShape: 'feature-off-not-removed',
        table: 'sys_properties',
        statement: `The shipped capability behind \`${name}\` is switched off by property (${name} = ${r.fields.value}), not removed.`,
        rationaleDraft: 'Hiding by configuration preserves reactivation and avoids upgrade conflicts; deleting does neither.',
        principleDraft: 'Hide, don\'t delete: vendor features are disabled by property so upgrades and later reactivation stay possible.',
        replacements: [],
        witnesses,
        score: 5,
      });
    }
  }
  // b2: group-disjointness. Fires only when the ledger actually holds group-role structure.
  {
    const grants = rows.filter((c) => c.locus && c.locus.table === 'sys_group_has_role');
    if (grants.length >= 3) {
      const roleText = grants.map((c) => `${c.assertion || ''} ${JSON.stringify(c.evidence && c.evidence.capturedResponse) || ''}`).join('\n').toLowerCase();
      const crossers = SIBLING_MODULE_PREFIXES.filter((p) => roleText.includes(p));
      if (!crossers.length) {
        candidates.push({
          key: 'cfg|group-disjoint|hr',
          source: 'config-pattern',
          patternShape: 'group-disjointness',
          table: 'sys_group_has_role',
          statement: `The domain's group structure grants no role from a sibling HR module (${grants.length} grant row(s), zero matching prefixes ${SIBLING_MODULE_PREFIXES.join('/')}).`,
          rationaleDraft: 'A disjoint group structure prevents conflicts in role assignment, routing and authorization with the sibling module.',
          principleDraft: 'The module runs on its own group structure; do not bind its work to sibling-module roles or groups.',
          replacements: [],
          witnesses: [...new Set(grants.map((c) => c.id))].slice(0, 24),
          score: 4,
        });
      }
    }
  }
  // b3: single-source integration.
  {
    const msgs = rows.filter((c) => c.locus && c.locus.table === 'sys_rest_message');
    const hosts = new Map();
    for (const c of msgs) {
      for (const m of String(c.assertion || '').matchAll(/https?:\/\/([a-z0-9.-]+)/gi)) {
        const h = m[1].toLowerCase();
        if (!hosts.has(h)) { hosts.set(h, []); }
        hosts.get(h).push(c.id);
      }
    }
    if (hosts.size === 1 && [...hosts.values()][0].length >= 2) {
      const [host, ids] = [...hosts.entries()][0];
      candidates.push({
        key: `cfg|single-source|${host}`,
        source: 'config-pattern',
        patternShape: 'single-source',
        table: 'sys_rest_message',
        statement: `Every REST message endpoint on this surface points at one external host: \`${host}\`.`,
        rationaleDraft: `${ids.length} endpoint claim(s), one host. A single source of truth is a design decision, not an accident.`,
        principleDraft: `\`${host}\` is the single integration source; a second source is an architecture change, not a config change.`,
        replacements: [],
        witnesses: [...new Set(ids)],
        score: 3,
      });
    }
  }

  // --- (c) doc-vs-instance contradictions, ROUTED, never re-detected ---------
  for (const q of questions || []) {
    if (!q || q.gate !== 'contradiction') { continue; }
    const refs = [q.sources && q.sources.A, q.sources && q.sources.B]
      .map((s) => s && s.ref).filter((ref) => ref && byId.has(ref));
    const docSide = refs.find((ref) => byId.get(ref).status === 'documented');
    if (!docSide) { continue; }
    candidates.push({
      key: `doc|${q.id || digest(q.question || '', 8)}`,
      source: 'doc-contradiction',
      patternShape: 'doc-vs-instance',
      table: (q.locus && q.locus[0] && q.locus[0].table) || null,
      statement: `A governing document and the instance disagree: ${trunc2(String(q.question || ''), 160)}`,
      rationaleDraft: 'Where a document contradicts the instance, the instance is the as-built and the contradiction is the question — never resolved in the document\'s favour by this loop.',
      principleDraft: 'The instance outranks the document; a page resting on the document alone says so.',
      replacements: [],
      witnesses: refs,
      fromQuestion: q.id || null,
      score: 6,
    });
  }

  // --- the zero-hallucination pass and the reported cap ----------------------
  counts.hallucinatedWitnesses = validateCandidateWitnesses(candidates, byId);
  /*
   * 7.4: a candidate a human already DENIED is refuted, and a refuted candidate is never
   * re-asked — the refutation is kept in the queue precisely so the next run's induction
   * pass, which re-mints from the same evidence, does not put the same hypothesis to the
   * same human twice.
   */
  const refuted = new Set((opts && opts.refutedKeys) || []);
  const viable = candidates.filter((c) => c.witnesses.length && !refuted.has(c.key));
  counts.refutedSkipped = candidates.length - candidates.filter((c) => !refuted.has(c.key)).length;
  viable.sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
  const kept = viable.slice(0, DECISION_CANDIDATES_MAX);
  const dropped = viable.slice(DECISION_CANDIDATES_MAX).map((c) => ({ key: c.key, source: c.source, score: c.score }));
  return { candidates: kept, dropped, counts };
}

/** trunc() lives in render.js; the two files may not require each other's page helpers. */
function trunc2(s, n) { const v = String(s == null ? '' : s); return v.length > n ? `${v.slice(0, n - 1)}…` : v; }

/**
 * ZERO HALLUCINATED ANCHORS, checked by the CLI (7.3's done-when). Every witness is a ledger
 * claim id by construction, and this pass re-checks anyway — a hand-edited ledger or a future
 * mint path defect drops the id AND reports it, never renders it. Returns the drop count;
 * mutates each candidate's witnesses in place to the resolved set.
 */
function validateCandidateWitnesses(candidates, byId) {
  let dropped = 0;
  for (const cand of candidates) {
    const resolved = cand.witnesses.filter((id) => byId.has(id));
    dropped += cand.witnesses.length - resolved.length;
    cand.witnesses = resolved;
  }
  return dropped;
}

function decisionCandidates(ctx) {
  return decisionCandidatesFromLedger(
    [...ctx.brain.claims().values()],
    [...ctx.brain.questionsLedger().values()],
    { refutedKeys: (((ctx.state || {}).queue || {}).refutedCandidates || []).map((r) => r.key) });
}

/*
 * PLAN 7.4 — one why-decision question per candidate, MINTED BY THE CLI. The agent may not
 * author a question of this gate at all (the payload schema has no such enum value): a
 * why-question an agent invents is a candidate an agent invented, which is the one thing the
 * induction leg exists to prevent. These rows go straight into the ledger from questions.apply,
 * status `queued`, on their OWN budget — one per candidate, bounded by the candidate cap, never
 * competing with the general question cap. Rank-and-kill keeps its jurisdiction over
 * instance-answerable questions; a WHY is L5-only by the ladder, so there is nothing for the
 * instance-answerable kill rule to kill here.
 *
 * The answer form stays one line: confirm / deny / correct-with-a-sentence (branch map on the
 * question, whyVerdict on the answer), so depth costs the SME minutes, not hours.
 */
function whyQuestionsFromCandidates(candidates) {
  return (candidates || []).filter((c) => !c.disposed).map((cand) => ({
    signal: 'WHY-DEC', signalState: 'admitted', gate: 'why-decision',
    sources: { A: { kind: 'decision-candidate', ref: cand.key, says: cand.statement } },
    locus: cand.witnesses.slice(0, 12).map((id) => ({ table: null, sysId: id, claim: id })),
    cluster: { key: cand.key, size: cand.witnesses.length, members: cand.witnesses.slice(0, 24) },
    form: 'closed',
    branchMap: { a: 'confirm — that is why', b: 'deny — not so (recorded as refuted, never re-asked)' },
    question: `As the standing architect: ${cand.statement} ` +
      `Drafted rationale: ${cand.rationaleDraft} ` +
      'Confirm, deny, or correct in one sentence.',
    candidateKey: cand.key,
    askTo: cand.askTo || null,
    rank: { E: Math.max(1, cand.witnesses.length), C_guard: 1.0, C_signal: 0.8, A: 1.0, U: 1.5, M: 0.5, priorSource: 'induced-candidate' },
    status: 'queued',
  }));
}

// ---------------------------------------------------------------------------
// ENCODED-QUERY LINT. Two platform traps, promoted out of prose into a validator.
// ---------------------------------------------------------------------------

/*
 * Both of these produce a plausible-looking number from a query that does not mean what it
 * says, and neither errors. That is the whole reason they are worth a validator rather than a
 * warning in a document: a trap that announces itself gets fixed the first time, and these two
 * were each measured costing a stage's worth of work on the reference run before anyone noticed.
 *
 * Kept deliberately HIGH-PRECISION. A lint that fires on correct queries gets switched off, and
 * then the trap is back with a note in the changelog saying it was handled.
 */
/**
 * PLATFORM-28. The reference columns whose operand must be a sys_id, mapped to the field to
 * dot-walk to when it is a name instead. This is the FALLBACK list and it ships FIRST on purpose:
 * `snbrain.js` never loads `api.js`, and a validator that needs dictionary types it cannot get is
 * a validator that gets bypassed. A caller holding a live `Map<name,{type,refTable}>` may pass it
 * as `columns` — it can only ADD reference columns, never subtract one from this list, because an
 * empty or partial column map is exactly PLATFORM-12 and empty-means-permissive turns a guard into
 * an amplifier.
 */
const REFERENCE_COLUMNS = Object.freeze({
  sys_scope: 'scope', sys_package: 'source', sys_domain: 'name', application: 'scope',
  update_set: 'name', cat_item: 'name', question: 'name', variable_set: 'name',
});

/** The field to dot-walk to on `col`, or null if `col` is not a reference column. */
function referenceDotWalk(col, columns) {
  if (REFERENCE_COLUMNS[col]) { return REFERENCE_COLUMNS[col]; }
  if (!columns) { return null; }
  const meta = typeof columns.get === 'function' ? columns.get(col) : columns[col];
  if (!meta) { return null; }
  return String(meta.type || meta.internal_type || '') === 'reference' ? 'name' : null;
}

/** A legitimate reference operand: a 32-hex sys_id, the `global` sentinel, empty, or a dynamic filter. */
function looksLikeReferenceOperand(v) {
  const s = String(v || '').trim();
  return !s || s === 'global' || /^[0-9a-f]{32}$/i.test(s) || /^javascript:/i.test(s);
}

function lintEncodedQuery(query, columns) {
  const out = [];
  const q = String(query || '');
  if (!q) { return out; }

  /*
   * PLATFORM-3. `sys_updated_on>sys_created_on` parses the right operand as a STRING LITERAL,
   * not a field reference. Measured on the reference instance: it returned 2,557,188 rows —
   * the table total minus the rows with an empty left operand — with no error and no warning.
   * Two of the four briefed change-detection signals were unusable and had to be dropped.
   *
   * The rule is narrow on purpose: only a right operand that LOOKS like a column name
   * (`sys_`-prefixed with an underscore body). A real literal in that shape is vanishingly
   * rare, and a sys_id is 32 hex characters with no underscore.
   */
  const cmp = /(\w+)\s*(!=|>=|<=|>|<|=)\s*(sys_[a-z0-9_]*_[a-z0-9_]+)/gi;
  let m;
  while ((m = cmp.exec(q))) {
    out.push(`the clause "${m[0]}" compares a field to what looks like ANOTHER FIELD NAME. ` +
      `ServiceNow parses the right operand as a string literal, so this silently returns the rows where ` +
      `"${m[1]}" literally equals the text "${m[3]}" — which is usually none of them, or by negation almost all of them. ` +
      `It does not error and the count looks plausible. Use a scalar predicate (sys_mod_count>0, a date floor) instead.`);
  }

  /*
   * PLATFORM-11. A trailing clause binds only to the LAST `^OR` leg, so
   * `name=a^ORname=b^elementISNOTEMPTY` filters the second leg and not the first. Our own
   * dictionaryFields() shipped this exact bug in the one query that guards against the silent
   * clause-drop.
   */
  const lastOr = q.lastIndexOf('^OR');
  if (lastOr >= 0) {
    const tail = q.slice(lastOr + 3);
    if (tail.indexOf('^') > 0 && !/^NQ/.test(tail.slice(tail.indexOf('^') + 1))) {
      out.push(`this query has a clause AFTER the last "^OR" ("${truncateStr(tail, 60)}"). A trailing clause binds to the LAST ^OR leg alone, ` +
        `not to every leg — so the earlier legs are unfiltered and the result is wider than it reads. ` +
        `Repeat the clause on every leg, or split the legs with "^NQ" so each carries its own.`);
    }
  }
/*
   * PLATFORM-28. A REFERENCE column filtered by a DISPLAY NAME returns zero rows, silently.
   * Measured on the reference instance: count(sys_metadata, sys_scope=<scope>) = 0 against
   * count(sys_metadata, sys_scope.scope=<scope>) = 12,382. It is PLATFORM-1's INVERSE — the field
   * IS valid, so field validation passes it cleanly — and HARD_RULES' empty-read rule licenses the
   * zero because the session is perfectly healthy. Nothing else in this product catches it, and
   * the product's own CLI help and census brief taught the broken form.
   *
   * Narrow on purpose, because a lint that fires on correct queries gets switched off and then the
   * trap is back with a note in the changelog saying it was handled: the left operand must be a
   * BARE reference column (the dot-walk is the FIX, not the defect), the operator must be one that
   * compares to a value, and a sys_id, the `global` sentinel or a dynamic filter is exempt.
   */
  for (const clause of q.split(/\^NQ|\^OR(?!DERBY)|\^/)) {
    const ref = /^([A-Za-z0-9_]+?)(NOT IN|IN(?!STANCEOF)|!=|=)(.*)$/.exec(clause.trim());
    if (!ref) { continue; }
    const col = ref[1], op = ref[2], operand = ref[3];
    const dotWalk = referenceDotWalk(col, columns);
    if (!dotWalk) { continue; }
    const bad = operand.split(',').map((v) => v.trim()).filter((v) => !looksLikeReferenceOperand(v));
    if (!bad.length) { continue; }
    out.push(`the clause "${truncateStr(clause.trim(), 60)}" filters the REFERENCE column "${col}" by ` +
      `${bad.length === 1 ? 'a display name' : 'display names'} (${bad.slice(0, 3).map((v) => `"${v}"`).join(', ')}). ` +
      `A reference column stores a sys_id, so this returns ZERO rows with no error and no warning — measured on the reference instance, ` +
      `sys_scope=<a scope name> returned 0 against 12,382 for the dot-walk, and two different subagents paid full price to rediscover it. ` +
      `Dot-walk instead: "${col}.${dotWalk}${op}${operand}". A zero on a population the census counted as non-empty is a suspect operand, not an absence.`);
  }
  return out;
}

/**
 * THE CENSUS STRINGS THAT ARE ENCODED QUERIES — a closed, NAMED population, because a check over an
 * unnamed population is true only while one population exists. Query-bearing fields that do not
 * exist yet are listed now so landing them cannot silently skip the lint; fields that carry PROSE
 * (`bandMethod`, `*Method`, `why`) are deliberately NOT listed, because a lint that fires on prose
 * gets switched off. Adding a query-bearing field means adding it here, on purpose.
 */
function censusQueryStrings(art) {
  const found = [];
  const push = (at, v) => { if (typeof v === 'string' && v.trim()) { found.push({ at, query: v }); } };
  push('boundaryQuery', art.boundaryQuery);
  const bq = (art.bands && art.bands.queries) || {};
  for (const k of ['A', 'B', 'C', 'AInDomain']) { push(`bands.queries.${k}`, bq[k]); }
  (art.scopes || []).forEach((s, i) => push(`scopes[${i}] (${s.scope || s.name || i}).bandAQuery`, s.bandAQuery));
  (art.packages || []).forEach((p, i) => push(`packages[${i}] (${p.name || i}).bandAQuery`, p.bandAQuery));
  (art.areas || []).forEach((a, i) => {
    push(`areas[${i}] (${a.id}).bandAQuery`, a.bandAQuery);
    push(`areas[${i}] (${a.id}).bandAInDomainQuery`, a.bandAInDomainQuery);
  });
  (art.processCandidates || []).forEach((c, i) => push(`processCandidates[${i}] (${c.key}).query`, c.query));
  return found;
}

// ---------------------------------------------------------------------------
// ORIENTATION VOCABULARIES, and they are CLOSED on purpose.
// ---------------------------------------------------------------------------

/*
 * `--vocab-reserve` exists because somebody noticed domain vocabulary is uninducible. A
 * naming convention and a coding standard have exactly that property and got nothing: the
 * word "convention" appears in this framework in three places and all three are OUTPUT
 * contracts. A closed enum is what makes "the loop knows coding standards are a category"
 * true in code rather than in prose — an open string field is a place to write anything,
 * which is the same as not asking.
 */
const CONVENTION_KINDS = Object.freeze([
  'artifact-naming', 'update-set-naming', 'story-naming', 'code-style', 'logging',
  'error-handling', 'language-policy', 'definition-of-done', 'tracker', 'doc-location',
  'prior-decisions', 'escalation-owner',
]);

const DOCUMENT_KINDS = Object.freeze([
  'way-of-working', 'design', 'runbook', 'glossary', 'decision-record', 'standard',
  'onboarding', 'api-contract', 'other',
]);

/*
 * `rm_story` is a ServiceNow TABLE, and it may hold shadow records while the real work items
 * live somewhere else entirely. The reference engagement pairs them explicitly
 * (`STRY0185200 / AzDO 1243263`), so the mapping exists and has to be discovered rather than
 * assumed. `kind` and `storiesLiveIn` are separate questions for exactly that reason.
 */
const TRACKER_KINDS = Object.freeze([
  'azure-devops', 'jira', 'servicenow-rm_story', 'github', 'gitlab', 'none', 'unknown',
]);

/** What `boundaryAsStated` must carry when the run declared no domain predicate at init. */
const INSTANCE_WIDE_BOUNDARY = '(instance-wide — no domain predicate was declared at init)';

/*
 * BLIND MODE FORCE-SKIPS ORIENTATION. A stage whose entire content is asking a human what is
 * already written down is the largest knowledge-bearing input in the loop; running it on a
 * blind run destroys the control the blind run exists to be. `applyBlind()` in snbrain.js
 * drops knowledge-bearing READS from a brief, which is not enough here — the knowledge does
 * not arrive through a file. The route itself has to change, and the skip has to leave a
 * stamp, or a blind run and a knowledge-assisted one are indistinguishable afterwards.
 */
function blindSkipsOrientation(ctx) { return !!(ctx.state.config && ctx.state.config.blind); }

/*
 * AW-2a asks whether there is a structured corpus to check a candidate question against.
 *
 * The old computation was `fs.existsSync(path.join(ctx.brain.root, 'wiki'))` — pointed at a
 * directory the installer never writes, since the scaffold goes to `paths.wikiRoot` (default
 * `docs/wiki`). So it stamped `no-structured-corpus` on essentially every run, and the gate
 * reported zero kills forever while looking like it had been evaluated.
 *
 * Now it is answered by the human who was asked. Every return value names a distinct
 * population, because "nobody was asked" and "we asked and there is nothing" are different
 * facts and the old value collapsed them.
 */
function corpusGateStamp(ctx) {
  const declared = ((ctx.state.queue || {}).statedDocuments || []);
  if (declared.some((d) => d && d.currency === 'current')) { return 'available'; }
  if (declared.length) { return 'declared-all-stale'; }
  const conventions = ctx.state.stamps && ctx.state.stamps.conventions;
  if (conventions === 'skipped-blind') { return 'not-asked-blind'; }
  if (conventions === 'not-available') { return 'not-asked-no-respondent'; }
  // Last resort: this repo's OWN installed scaffold, at the path the installer actually used.
  // An empty scaffold is not a corpus, so it does not open the gate — it is reported as what
  // it is.
  return fs.existsSync(path.join(ctx.brain.root, wikiRootOf(ctx))) ? 'local-wiki-only' : 'no-structured-corpus';
}

/*
 * AW-3.governed asks whether the decision ledger can suppress a question as already settled.
 * PRODUCT-73's second critic correction: do NOT claim orientation lights this up for free.
 * Its own legal `available:false` path mints no decisions at all, so an unattended run has an
 * empty ledger here whatever orientation did — and the value says WHICH empty it is.
 */
function governedGateStamp(ctx) {
  if (ctx.brain.decisions().size) { return 'available'; }
  const conventions = ctx.state.stamps && ctx.state.stamps.conventions;
  if (conventions === 'skipped-blind') { return 'empty-ledger-blind'; }
  if (conventions === 'not-available') { return 'empty-ledger-no-respondent'; }
  return 'empty-ledger';
}

/** Tokens shared between two strings, as a fraction of the shorter one. Spec check 18. */
function tokenOverlap(a, b) {
  const norm = (s) => String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2);
  const ta = new Set(norm(a)), tb = new Set(norm(b));
  if (!ta.size || !tb.size) { return 0; }
  let shared = 0;
  for (const t of ta) { if (tb.has(t)) { shared += 1; } }
  return shared / Math.min(ta.size, tb.size);
}

// ---------------------------------------------------------------------------
// THE STAGE TABLE
// ---------------------------------------------------------------------------

const STAGES = [

  // =========================================================================
  {
    id: 'preflight',
    title: 'Preflight — connection verified, WP-A probes run, transport facts recorded',
    stagnation: 'none',
    goal: () =>
      'Settle what this transport can actually do against THIS instance, before any adapter code or ' +
      'census query is written against an assumption. The artifact is mostly a POINTER: the CLI reads ' +
      'probe results.json itself and derives the transport facts, because a model summary of a probe ' +
      'run is exactly the narration this stage exists to eliminate.',
    reads: (ctx) => [
      { path: 'tools/snbrain/probe.js', why: 'The eleven WP-A probes. This IS the preflight stage; do not reimplement it.', required: true },
      { path: 'tools/snbrain/lib/api.js', why: 'The only permitted instance client. Read its header for what read-only means structurally.', required: true },
      { path: '.claude/skills/snbrain-preflight/SKILL.md', why: 'Engagement procedure, if the repo has one.', required: false },
      { path: ctx.state.syncRoot ? fwd(path.join(ctx.state.syncRoot, '.vscode', 'sn-agent-port.json')) : '(no --sync-root recorded)', why: 'Proves sn-scriptsync is live and which port/token to use.', required: true },
    ],
    procedure: (ctx) => [
      `Run: node tools/snbrain/probe.js --instance ${ctx.state.instance} --root "${fwd(ctx.state.syncRoot || '<sync root>')}"`,
      'If preflight fails (exit 2) do NOT retry blindly: the port file is stale, the helper tab is not authenticated, or the extension is not running. Fix the cause, then re-run.',
      'Read the written results.json. Do not summarise it; you are going to hand the CLI its path.',
      'Write the artifact naming that path plus the transport facts you can read off it directly.',
      'For every acceptance id below, declare pass / fail / not-demonstrated. If a probe came back `unavailable`, the honest value is not-demonstrated. Do not launder it into a pass.',
    ],
    schema: {
      type: 'object',
      required: ['transport'],
      props: {
        // Presence is enforced in validate(), not here, so the old `probeResults` key gets a
        // rejection that names its replacement rather than a bare "required, but missing".
        probeResultsPath: { type: 'string', optional: true, minLength: 4 },
        transport: {
          type: 'object',
          required: ['restGet', 'paging', 'aggregates', 'clauseDropReproduced'],
          props: {
            restGet: { type: 'string', enum: ['ok', 'blocked', 'unknown'] },
            paging: { type: 'string', enum: ['ok', 'broken', 'unknown'] },
            aggregates: { type: 'string', enum: ['ok', 'unreachable', 'unknown'] },
            clauseDropReproduced: { type: 'boolean' },
            payloadCeilingRows: { type: 'number', optional: true, min: 0 },
            sessionIsAdmin: { type: 'boolean', optional: true },
            customerUpdateAvailable: { type: 'boolean', optional: true },
          },
        },
        instanceIdentity: {
          type: 'object', optional: true,
          props: {
            name: { type: 'string' },
            tier: { type: 'string', optional: true },
            extensionVersion: { type: 'string', optional: true },
            apiVersion: { type: 'string', optional: true },
          },
        },
        findings: { type: 'array', optional: true, items: FINDING_SCHEMA },
      },
    },
    example: (ctx) => ({
      stage: 'preflight',
      instance: ctx.state.instance,
      usage: { apiCalls: 120, requestLog: fwd(path.join(ctx.state.syncRoot || '<sync-root>', 'spikes', 'scriptsync-read', 'snbrain-requests.ndjson')) },
      probeResultsPath: fwd(path.join(ctx.state.syncRoot || '<sync-root>', 'spikes', 'scriptsync-read', 'results.json')),
      transport: {
        restGet: 'ok', paging: 'ok', aggregates: 'ok', clauseDropReproduced: true,
        payloadCeilingRows: 25, sessionIsAdmin: true, customerUpdateAvailable: false,
      },
      instanceIdentity: { name: ctx.state.instance, tier: 'vendor-dev', extensionVersion: '4.7.6' },
      acceptance: [
        { id: 'AC-PRE-1', result: 'pass', evidence: 'connect() canary returned 1 sys_user row; probes ran in the same session.' },
        { id: 'AC-PRE-2', result: 'pass', evidence: 'probes 1,2,3 conclusive in results.json' },
        { id: 'AC-PRE-3', result: 'pass', evidence: 'probe 6 reproduced the clause drop; probe 7 recorded' },
        { id: 'AC-PRE-4', result: 'pass', evidence: 'no kill criterion fired' },
      ],
    }),
    acceptance: [
      { id: 'AC-PRE-1', statement: 'A positive canary read succeeded in the same session as the probes, so an empty result later can be distinguished from a broken session.', howToEvidence: 'connect() canary row count, from the probe run.' },
      { id: 'AC-PRE-2', statement: 'The REST read surface is settled: GET reachable, paging works or does not, aggregate counts work or do not.', howToEvidence: 'probes 1, 2 and 3 statuses in results.json.' },
      { id: 'AC-PRE-3', statement: 'Both negative controls RAN, and their outcome is recorded whichever way it went.', howToEvidence: 'probes 6 and 7. A negative control that "passed" because nothing went wrong has failed.' },
      { id: 'AC-PRE-4', statement: 'Every kill criterion that fired is recorded, and the run is not continuing past one silently.', howToEvidence: 'killFired flags in results.json.' },
    ],
    // The CLI reads the probe file itself. This is the difference between a recorded fact
    // and a narrated one, and it costs nothing because probe.js already wrote the file.
    validate: (ctx, art) => {
      const rej = [];
      /*
       * PRODUCT-21. This key was named `probeResults` and holds a PATH, so generic artifact
       * walkers iterated the string character by character looking for results. Presence is
       * checked here rather than in the schema's `required` list, so anyone still writing the
       * old name gets told what it became instead of a bare "required, but missing".
       */
      if (art.probeResultsPath === undefined) {
        rej.push(art.probeResults !== undefined
          ? 'probeResults has been renamed to probeResultsPath, because it holds a PATH to results.json rather than the results themselves — the old name made generic artifact walkers iterate the string character by character. Rename the key and re-ingest.'
          : 'probeResultsPath: required. It is the path to the results.json that probe.js wrote; the CLI reads that file itself rather than accepting a summary of it.');
        return rej;   // everything below reads that path; resolving `undefined` throws instead of explaining
      }
      const p = path.resolve(ctx.brain.root, art.probeResultsPath);
      if (!fs.existsSync(p)) {
        rej.push(`probeResultsPath: no file at ${fwd(p)}. Run probe.js first; the CLI reads its results.json directly and will not accept a summary.`);
        return rej;
      }
      let doc;
      try { doc = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (err) {
        rej.push(`probeResultsPath: ${fwd(p)} is not valid JSON (${err.message}).`); return rej;
      }
      if (!doc.meta || !Array.isArray(doc.results)) { rej.push('probeResultsPath: file has no {meta, results} shape — that is not a probe.js output.'); return rej; }
      if (doc.meta.instance && ctx.state.instance && doc.meta.instance !== ctx.state.instance) {
        rej.push(`probeResultsPath: results.json was produced against instance "${doc.meta.instance}" but this brain is for "${ctx.state.instance}".`);
      }
      const byId = new Map(doc.results.map((r) => [r.id, r]));
      for (const id of [1, 2, 3]) {
        if (!byId.has(id)) { rej.push(`probeResultsPath: probe ${id} was not run. The transport read surface is not settled and no census query may be issued.`); }
      }
      for (const id of [6, 7]) {
        if (!byId.has(id)) { rej.push(`probeResultsPath: negative control ${id} was not run. Without it the guard layer defends against a documented failure rather than an observed one.`); }
      }
      const p6 = byId.get(6);
      if (p6 && p6.status === 'conclusive' && art.transport.clauseDropReproduced === false && /reproduc/i.test(JSON.stringify(p6.data || {}))) {
        rej.push('transport.clauseDropReproduced=false contradicts probe 6. Read the probe result rather than asserting.');
      }
      ctx.__probeDoc = doc;
      return rej;
    },
    apply: (ctx, art) => {
      const doc = ctx.__probeDoc;
      const fired = doc.results.filter((r) => r.killFired);
      const unavailable = doc.results.filter((r) => r.status === 'unavailable');
      /*
       * D5(a) (2026-09-02) — A KILL THAT ONLY KILLS A BLIND RUN IS DEFERRED, NOT FATAL, HERE.
       *
       * The membership-discrimination probe asks whether update-set membership separates
       * customer-authored records from base content INSTANCE-WIDE — the census's authorship
       * rung (A3). A seeded run never takes the census: its surface is the developer's named
       * sets, and its gate is the anchor's resolution (no seeded set resolves non-empty →
       * blocked). On the second engagement that probe fired on a seeded run and the route went
       * `terminal: blocked` before orientation could even collect the sets; on the first run it
       * did not fire (98% vs 36%). The criterion is identified by WHAT IT MEASURES (its data
       * carries the A3 verdict), never by number — probe numbering is not stable (PRODUCT-5).
       *
       * Routing, not softening: the fired criterion is recorded as a warning here with a stamp;
       * a run that turns out unseeded (seed available:false) or is --blind re-raises it as
       * blocking at the seed door, where the route to the census is decided.
       */
      const deferrable = (r) => !!(r.data && Object.prototype.hasOwnProperty.call(r.data, 'a3Dead')) || /update-set membership/i.test(String(r.title || ''));
      const deferred = fired.filter(deferrable);
      const fatal = fired.filter((r) => !deferrable(r));
      return {
        facts: {
          transport: art.transport,
          instanceIdentity: art.instanceIdentity || { name: ctx.state.instance },
          probe: {
            path: fwd(path.resolve(ctx.brain.root, art.probeResultsPath)),
            ranAt: doc.meta.date, callsUsed: doc.meta.callsUsed,
            extensionVersion: doc.meta.extensionVersion, apiVersion: doc.meta.apiVersion,
            killsFired: fired.map((r) => r.id), unavailable: unavailable.map((r) => r.id),
            killsFatal: fatal.map((r) => r.id),
            killsDeferred: deferred.map((r) => ({ id: r.id, criterion: r.killCriterion || null })),
          },
        },
        stamps: {
          // These stamps travel with every downstream question and page. They are the
          // honest ceiling of everything this run can conclude.
          sessionIsAdmin: art.transport.sessionIsAdmin === true,
          aclBlindnessTestable: art.transport.sessionIsAdmin !== true,
          customerUpdateAvailable: art.transport.customerUpdateAvailable === true,
          /*
           * PRODUCT-73, third critic correction. A blind run never enters `orientation`, so
           * the stamp that says so has to be laid down by the stage that routes past it. It
           * rides on every downstream brief and every rendered page from here on, which is
           * the only thing that stops a blind run being read afterwards as a run that asked
           * a human and got nothing. Run 6ef14f5562 was a blind run.
           */
          conventions: blindSkipsOrientation(ctx) ? 'skipped-blind' : 'pending',
          /*
           * A blind run skips SEED for the same reason it skips orientation: the developer's
           * pointers are the largest knowledge-bearing input a seeded run has. The envelope
           * stamp is what routes provenance past the anchor, so a blind run takes the census
           * path mechanically rather than by convention.
           */
          seed: blindSkipsOrientation(ctx) ? 'skipped-blind' : 'pending',
          inputEnvelope: blindSkipsOrientation(ctx) ? 'none' : 'pending',
          // D5(a): the authorship rung this transport can offer a CENSUS. A seeded run reads it
          // for its render stamp; an unseeded run reads it as the reason it is blocked.
          authorshipRung: deferred.length ? 'package-level-only' : 'record-level',
        },
        findings: (art.findings || []).concat(fatal.map((r) => ({
          check: `wp-a-kill-${r.id}`, severity: 'blocking', rung: 'L1',
          message: `WP-A probe ${r.id} fired its kill criterion: ${r.killCriterion}`,
        })), deferred.map((r) => ({
          check: `wp-a-kill-${r.id}-deferred`, severity: 'warning', rung: 'L1',
          message: `WP-A probe ${r.id} fired its kill criterion: ${r.killCriterion} — DEFERRED, not fatal, because it kills only a blind census: ` +
            'a seeded run\'s surface is the developer\'s named sets and its gate is the anchor\'s resolution. The stamp authorshipRung=package-level-only ' +
            'travels into the render; if the seed turns out unavailable (or the run is --blind) the seed door re-raises this as blocking.',
        }))),
        raw: doc.results.map((r) => ({ kind: 'probe', id: r.id, status: r.status, killFired: r.killFired, note: r.note, reason: r.reason })),
        progress: true,
      };
    },
    next: (ctx) => {
      const probe = ctx.state.facts.probe || {};
      // Older state (no killsFatal) treats every fired kill as fatal, exactly as before.
      const kills = Array.isArray(probe.killsFatal) ? probe.killsFatal : (probe.killsFired || []);
      const deferred = (probe.killsDeferred || []).map((d) => d.id);
      if (kills.length) {
        return { terminal: 'blocked', note: `WP-A kill criteria fired: ${kills.join(', ')}. A kill criterion written before the run is not advisory. Take the probe RESULTS.md to the operator before any census query is issued.` };
      }
      if (deferred.length && blindSkipsOrientation(ctx)) {
        return { terminal: 'blocked', note: `WP-A kill criteria fired: ${deferred.join(', ')} — deferrable on a seeded run, but this run is --blind and takes the census path, which needs the record-level authorship rung the probe says this instance lacks. A blind census on package-level authorship measures the wrong thing.` };
      }
      /*
       * ORIENTATION IS SKIPPED UNDER --blind, and the CLI's route is the only place that can
       * do it: the stage cannot decline itself, and a brief-level filter cannot withhold a
       * question a human answers out loud. The engine still names no stage — this table does.
       */
      return blindSkipsOrientation(ctx) ? 'census' : 'orientation';
    },
  },

  // =========================================================================
  /*
   * ORIENTATION — the human door, moved to the front of the corridor.
   *
   * MEASURED, on run 6ef14f5562: STAGE_ORDER had exactly one stage with `humanGate: true` and
   * it sat EIGHTH OF NINE — after the boundary was frozen, after the budget was spent, after
   * 8,239 claims were minted, and after the ranker had decided what the operator's ten minutes
   * would be spent on. Nothing in the loop asked for a document; the only notion of an
   * existing corpus was one `fs.existsSync` aimed at a path the installer never writes. The
   * run then spent ~40 calls, a dedicated scout pass and one of ten gate slots INDUCING a name
   * convention — 99.8% precision, ~19.6% recall, and class-conditional, which no sampling can
   * distinguish from drift because only the author knows — while the respondent had already
   * stated it, unprompted, in half a sentence, ten minutes earlier.
   *
   * THE OPERATOR'S RULE, which is this stage's entire shape:
   *
   *   The human supplies the CORPUS and the JUDGEMENT.
   *   The agent supplies the LOOKUPS the evidence already keys.
   *
   * So a human decides which of five wiki pages is the live one — no lookup replaces that.
   * But the same run derived `storyPattern: ^(STRY\d{7})(\.\d{2})?` and carried 62 exact
   * story identifiers in its own domain predicate, then spent the budget reconstructing 64
   * story pages by update-set archaeology while the real work items sat in an external
   * tracker. Asking a human to paste 64 links is waste. Asking WHERE stories live is not, and
   * it is asked here, once — `tracker` is what the external transport is configured from.
   *
   * ZERO INSTANCE READS, enforced: `usage.apiCalls` must be 0. This stage precedes the census
   * because everything it collects is a PRIOR over where the budget goes, and a prior that
   * arrives after the budget is spent is a footnote.
   *
   * WHAT IT DOES NOT DO: it does not reconcile. Reconciliation belongs to `questions`, which
   * is the only stage with a ledger to measure a stated convention against.
   */
  {
    id: 'orientation',
    title: 'Orientation — what is already written down, and who judges it current',
    stagnation: 'none',
    humanGate: true,
    goal: (ctx) => {
      const boundary = ctx.state.stamps.domainBoundary || INSTANCE_WIDE_BOUNDARY;
      return 'Collect what is ALREADY WRITTEN DOWN, from a human, before one row of this instance is read. ' +
        'Six one-line questions: which documents govern this work and where they live; which of them are ' +
        'CURRENT and which are STALE; how artifacts, update sets and stories are named; the code ' +
        'conventions (JSDoc, ES5/ES12, logging, error handling); where stories actually live; and who to ' +
        'ask about what. ' +
        `The boundary you are asking inside is: ${boundary} — put it in front of the respondent and paste ` +
        'it back verbatim in `boundaryAsStated`, or you will collect the documents of whichever project ' +
        'they thought of first. ' +
        'You record no fact about the instance here and you spend no API call: usage.apiCalls must be 0.';
    },
    reads: (ctx) => [
      { path: 'product.config.json', why: 'The engagement slots. If `tracker` is already filled in, read it rather than asking for it twice.', required: false },
      { path: `${wikiRootOf(ctx)}/`, why: 'What this repo already carries. A page that exists is not a question; ask which of them the human still considers current.', required: false },
      { path: '.claude/skills/snbrain-orientation/SKILL.md', why: 'Engagement procedure, if the repo has one.', required: false },
    ],
    procedure: (ctx) => [
      'THIS STAGE HAS A HUMAN IN IT AND YOU MAY NOT SIMULATE ONE. If nobody was reachable, ingest available:false with a reason. That is a legal, recorded outcome; inventing an answer is not, and the CLI refuses a respondent whose name is a job title this loop gives itself.',
      'TAKE THE SEALED RECALL FIRST, before any of our wording reaches the respondent. Ask the open prompts, record what comes back UNPARAPHRASED in recall.prompts[].verbatim, and do not react to, interpret or feed back an answer before the remaining prompts are put.',
      'Then lift topics out of the recall. Every topic carries a `span` that is a VERBATIM SUBSTRING of what was said. The CLI checks this character for character and will not take your word for it — it is the only thing standing between a sealed recall and a paraphrase of one entering the decision ledger.',
      `Read the boundary out and paste it back verbatim: ${ctx.state.stamps.domainBoundary || INSTANCE_WIDE_BOUNDARY}`,
      'CONVENTIONS. Ask for the naming rules and the code rules as separate one-liners, each against the closed `kind` list in the schema below. The closed list is the point: it is what makes "this loop knows coding standards are a category" true in code rather than in prose.',
      'Mark a convention `testable` ONLY if you can supply the glob the claim ledger will measure it with. A testable convention becomes a reconciliation at the questions stage — "you say every artifact carries the prefix; 0 of 29 rows on this table do; deliberate class-conditional, or drift?" — which is a better question than any this loop can generate from evidence alone, and it costs one string comparison.',
      'DOCUMENTS. Ask which documents govern the work inside that boundary, where they live, and — the part no lookup replaces — which are CURRENT and which are STALE. A link list is cheap; deciding which of five pages is the live one is the judgement you are here for. Record who judged it, by name.',
      'WHERE STORIES LIVE. `rm_story` is a ServiceNow table and may hold SHADOW records while the real work items live in an external tracker. Ask for the tracker, the org and the project, and for one PAIRING EXAMPLE of a ServiceNow story id beside its external work item id.',
      'You do not ask a human to paste links to individual records. Where this pipeline has derived an identifier it looks the record up itself; a human pasting 64 story links is the waste this stage exists to remove.',
    ],
    schema: {
      type: 'object',
      required: ['available', 'respondent', 'recordedAt', 'boundaryAsStated', 'conventions', 'documents', 'tracker'],
      forbidden: ['id', 'claims', 'decisions'],
      props: {
        available: { type: 'boolean' },
        unavailableReason: { type: 'string', optional: true, minLength: 10 },
        respondent: { type: 'string', minLength: 2 },
        recordedAt: { type: 'string', minLength: 8 },
        boundaryAsStated: { type: 'string', minLength: 4 },
        conventions: {
          type: 'array', min: 0,
          items: {
            type: 'object',
            required: ['kind', 'statement', 'testable'],
            forbidden: ['id', 'claimId'],
            props: {
              kind: { type: 'string', enum: CONVENTION_KINDS.slice() },
              statement: { type: 'string', minLength: 10 },
              appliesTo: { type: 'string', optional: true },
              testable: { type: 'boolean' },
              pattern: { type: 'string', optional: true, minLength: 1 },
              source: { type: 'string', optional: true },
            },
          },
        },
        documents: {
          type: 'array', min: 0,
          items: {
            type: 'object',
            required: ['title', 'kind', 'currency', 'judgedBy'],
            forbidden: ['id'],
            props: {
              title: { type: 'string', minLength: 3 },
              url: { type: 'string', optional: true, minLength: 4 },
              kind: { type: 'string', enum: DOCUMENT_KINDS.slice() },
              currency: { type: 'string', enum: ['current', 'stale', 'superseded', 'unknown'] },
              judgedBy: { type: 'string', minLength: 2 },
              covers: { type: 'string', optional: true },
            },
          },
        },
        tracker: {
          type: 'object',
          required: ['kind', 'storiesLiveIn'],
          props: {
            kind: { type: 'string', enum: TRACKER_KINDS.slice() },
            org: { type: 'string', optional: true },
            project: { type: 'string', optional: true },
            storiesLiveIn: { type: 'string', enum: ['external', 'rm_story', 'both', 'unknown'] },
            shadowRecords: { type: 'boolean', optional: true },
            pairingExample: { type: 'string', optional: true },
          },
        },
        recall: {
          type: 'object', optional: true,
          required: ['recordedAt', 'respondent', 'blind', 'prompts', 'topics'],
          props: {
            recordedAt: { type: 'string', minLength: 8 },
            respondent: { type: 'string', minLength: 2 },
            blind: { type: 'boolean' },
            contamination: { type: 'string', optional: true, enum: ['none', 'post-gate', 'unknown'] },
            prompts: { type: 'array', min: 1, items: { type: 'object', required: ['prompt', 'verbatim'], props: { prompt: { type: 'string', minLength: 4 }, verbatim: { type: 'string', minLength: 4 } } } },
            topics: { type: 'array', min: 0, items: { type: 'object', required: ['term', 'statement', 'span'], props: { term: { type: 'string', minLength: 2 }, statement: { type: 'string', minLength: 10 }, span: { type: 'string', minLength: 4 } } } },
          },
        },
        owners: { type: 'array', optional: true, items: { type: 'object', required: ['topic', 'person'], props: { topic: { type: 'string' }, person: { type: 'string' } } } },
        findings: { type: 'array', optional: true, items: FINDING_SCHEMA },
      },
    },
    example: (ctx) => ({
      stage: 'orientation',
      instance: ctx.state.instance,
      usage: { apiCalls: 0, notes: 'zero instance reads — this stage never opens the transport' },
      available: true,
      respondent: 'a.developer',
      recordedAt: '2026-08-11',
      boundaryAsStated: ctx.state.stamps.domainBoundary || INSTANCE_WIDE_BOUNDARY,
      conventions: [
        { kind: 'artifact-naming', statement: 'Every artifact we build carries the "ACME - " prefix in its name.', appliesTo: 'all customer-authored artifacts', testable: true, pattern: 'ACME*' },
        { kind: 'code-style', statement: 'Server scripts carry JSDoc function headers and stay ES5.', appliesTo: 'sys_script, sys_script_include', testable: false, source: 'the team handbook, page 4' },
        { kind: 'update-set-naming', statement: 'One update set per story, named "<story> - <description>", sub-sets numbered .NN.', testable: true, pattern: 'STRY*' },
      ],
      documents: [
        { title: 'ACME FM — way of working', url: 'https://confluence.example.com/x/AAA', kind: 'way-of-working', currency: 'current', judgedBy: 'a.developer', covers: 'intake and assignment' },
        { title: 'ACME FM — 2023 design note', url: 'https://confluence.example.com/x/BBB', kind: 'design', currency: 'stale', judgedBy: 'a.developer', covers: 'superseded by the way-of-working page' },
      ],
      tracker: { kind: 'azure-devops', org: 'acme', project: 'Facilities', storiesLiveIn: 'both', shadowRecords: true, pairingExample: 'STRY0185200 / AzDO 1243263' },
      recall: {
        recordedAt: '2026-08-11', respondent: 'a.developer', blind: true, contamination: 'none',
        prompts: [{
          prompt: 'Five things a new consultant on this implementation would get wrong.',
          verbatim: 'Almost everything is built in the vendor core app. Our stories are created in azure devops, and we create shadow stories in the platform instance because the platform team requires it.',
        }],
        topics: [
          { term: 'azure devops', statement: 'Stories are authored in Azure DevOps; the ServiceNow story rows are shadow records.', span: 'Our stories are created in azure devops' },
        ],
      },
      acceptance: [
        { id: 'AC-ORI-1', result: 'pass', evidence: 'usage.apiCalls = 0; no transport call was made' },
        { id: 'AC-ORI-2', result: 'pass', evidence: 'a named human judged each document current or stale' },
        { id: 'AC-ORI-3', result: 'pass', evidence: 'tracker.storiesLiveIn = both, with the pairing example the respondent gave' },
        { id: 'AC-ORI-4', result: 'pass', evidence: 'every recall topic span is a verbatim substring of the recorded prompt' },
      ],
    }),
    acceptance: [
      { id: 'AC-ORI-1', statement: 'No instance read was made in this stage.', howToEvidence: 'usage.apiCalls = 0. The CLI refuses anything else: what this stage collects is a prior over where to spend the budget, and a prior that costs budget is not one.' },
      { id: 'AC-ORI-2', statement: 'A named human judged each recorded document current or stale.', howToEvidence: 'documents[].currency and documents[].judgedBy. An unjudged link list is the cheap half of this stage and the half a lookup could have done.' },
      { id: 'AC-ORI-3', statement: 'Where stories actually live is recorded, distinctly from whether rm_story rows exist.', howToEvidence: 'tracker.storiesLiveIn, plus a pairingExample when both exist.' },
      { id: 'AC-ORI-4', statement: 'Every recall topic is quoted, not summarised.', howToEvidence: 'topics[].span is a verbatim substring of prompts[].verbatim; the CLI checks it character for character.' },
    ],
    validate: (ctx, art) => {
      const rej = [];

      // ZERO INSTANCE READS, enforced rather than requested.
      if (art.usage && typeof art.usage.apiCalls === 'number' && art.usage.apiCalls > 0) {
        rej.push(`usage.apiCalls is ${art.usage.apiCalls}. Orientation reads NOTHING from the instance — it runs before the census precisely so that what it collects can AIM the budget rather than annotate it. If you needed a read to answer one of these, the honest answer here is "unknown" and the read belongs to a later stage.`);
      }

      // DO NOT SIMULATE THE HUMAN. PRODUCT-65's list, applied to the door it guards.
      if (AGENT_IDENTITY_RE.test(String(art.respondent || ''))) {
        rej.push(`respondent "${art.respondent}" is a name this loop gives itself, not a person. This stage has a human in it. If no human was reachable, ingest available:false with unavailableReason — that is a legal, recorded outcome and it is the only honest one.`);
      }

      // The legal empty path, and it must not be confusable with a stage that ran.
      if (art.available === false) {
        if (!art.unavailableReason) {
          rej.push('available:false with no unavailableReason. "Nobody was reachable" is a recordable result; an unexplained one is indistinguishable from a stage that was never run.');
        }
        if ((art.conventions || []).length || (art.documents || []).length || (art.recall && (art.recall.topics || []).length)) {
          rej.push('available:false, but conventions, documents or recall topics were recorded. One of the two is untrue.');
        }
        return rej;
      }
      if (!(art.conventions || []).length && !(art.documents || []).length) {
        rej.push('available:true but neither a convention nor a document was recorded. If the human genuinely had nothing written down, say so with available:false and a reason — an empty successful orientation and a skipped one must not look the same in state, because every downstream gate reads that difference.');
      }

      /*
       * THE BOUNDARY WAS PUT IN FRONT OF THE HUMAN. 5.47: a corpus question asked without it
       * collects the documents of whichever project the respondent thought of first, which is
       * what run 6ef14f5562's process candidates turned out to be — other teams' work.
       */
      const want = ctx.state.stamps.domainBoundary || INSTANCE_WIDE_BOUNDARY;
      if (normText(art.boundaryAsStated) !== normText(want)) {
        rej.push(`boundaryAsStated does not match the boundary this run declared. Paste it back verbatim:\n  ${want}\nThis is not bookkeeping: it is the only evidence that the corpus question was asked inside the boundary rather than about the customer's whole estate.`);
      }

      // "testable" is a promise the claim ledger has to be able to keep.
      for (const c of art.conventions || []) {
        if (c.testable && !c.pattern) {
          rej.push(`conventions[${c.kind}] is marked testable with no pattern. Testable means the CLAIM LEDGER can measure it — supply the glob it will be counted with (e.g. "ACME*"), or set testable:false and it becomes a recorded statement rather than a reconciliation.`);
        }
      }

      /*
       * THE RECALL IS QUOTED, CHARACTER FOR CHARACTER — the mechanism `explain` already uses
       * and proves. Run 6ef14f5562 hand-wrote its recall to a markdown file outside every
       * governed ledger, and 45 of its 160 pages then cited that file as an authority.
       */
      if (art.recall) {
        const corpus = normText((art.recall.prompts || []).map((p) => p.verbatim).join('\n'));
        if (!corpus) {
          rej.push('recall carries no prompt verbatim. A recall with no recorded words is a paraphrase with a timestamp on it.');
        }
        for (const t of art.recall.topics || []) {
          if (!normText(t.span) || !corpus.includes(normText(t.span))) {
            rej.push(`recall.topics "${t.term}": span is not a verbatim substring of the recorded prompts. Quote the human, do not summarise them — this check is character for character, and it is the only thing that stops a paraphrase entering the decision ledger under a named person's attribution.`);
          }
        }
        if (art.recall.blind === true && art.recall.contamination === undefined && ctx.brain.questionsLedger().size) {
          rej.push('recall.blind is true, but questions already exist in this ledger — so our wording could have reached the respondent before the recall was taken. Record contamination ("post-gate"), or do not claim the recall was blind. A recall taken after the respondent has seen our questions is a recognition test, not a recall test.');
        }
      }

      /*
       * WHERE STORIES LIVE. 5.48: run 6ef14f5562 derived a story pattern, carried 62 exact
       * story identifiers, and then rebuilt 64 story pages out of update-set archaeology
       * while the real work items sat in an external tracker the respondent had already named.
       */
      if (art.tracker.kind !== 'unknown' && art.tracker.storiesLiveIn === 'unknown') {
        rej.push(`tracker.kind is "${art.tracker.kind}" but storiesLiveIn is "unknown". These are different questions: rm_story is a ServiceNow table and may hold shadow records while the real work items live elsewhere — the reference engagement pairs them explicitly ("STRY0185200 / AzDO 1243263"). Getting this wrong costs a story-page archaeology pass that the identifiers this run already holds made unnecessary.`);
      }
      if (['azure-devops', 'jira', 'github', 'gitlab'].includes(art.tracker.kind) && !art.tracker.project) {
        rej.push(`tracker.kind "${art.tracker.kind}" with no project. The external read transport is configured from org + project; a kind alone configures nothing.`);
      }
      return rej;
    },
    apply: (ctx, art) => {
      const now = new Date().toISOString();
      if (art.available === false) {
        return {
          facts: { orientation: { available: false, reason: art.unavailableReason, recordedAt: now } },
          stamps: { conventions: 'not-available', corpus: 'not-asked-no-respondent', tracker: 'unknown', storiesLiveIn: 'unknown' },
          progress: true,
        };
      }

      const claims = [];
      const decisions = [];
      const statedConventions = [];
      for (const c of art.conventions || []) {
        const locus = { table: 'stated-convention', sysId: digest({ k: c.kind, s: normText(c.statement) }), field: c.kind };
        const assertion = `${c.kind}: ${normText(c.statement)}`;
        const id = claimId(locus, assertion);
        claims.push({
          locus,
          assertion,
          /*
           * NOT band A and NOT band B. A stated convention must never reach
           * explainCandidates() or vocabularyCandidates(), which both select on band: a claim
           * about the instance and a claim about what somebody SAYS about the instance are two
           * populations, and merging them is how a stated convention would come back as an
           * "induced" one on the next run.
           */
          band: null,
          rung: 'DOC',
          status: 'documented',
          scope: null,
          docSource: { kind: 'stated', respondent: art.respondent, recordedAt: art.recordedAt, where: c.source || '(spoken, at orientation)' },
          testable: !!c.testable,
          pattern: c.pattern || null,
          appliesTo: c.appliesTo || null,
        });
        statedConventions.push({
          kind: c.kind, statement: normText(c.statement), pattern: c.pattern || null,
          testable: !!c.testable, appliesTo: c.appliesTo || null, claimId: id,
        });
        decisions.push({
          statement: `Stated convention (${c.kind}): ${normText(c.statement)}`,
          rationale: c.source ? `stated at orientation; recorded source: ${c.source}` : 'stated at orientation, before any measurement',
          rationaleStrength: 'stated',
          alternatives: [],
          scope: { instance: ctx.state.instance, tables: [] },
          answeredBy: art.respondent, answeredAt: art.recordedAt,
          answerProvenance: { fromQuestion: null, channel: 'orientation', verbatim: normText(c.statement), rationaleVolunteered: true, branch: null },
          // Kept DISTINCT from 'interview'. Losing that distinction loses the product's ability
          // to say which human statements were pressure-tested against evidence and which were
          // simply recorded.
          derivedFrom: 'stated',
          witnessClaims: [id], explainsClaims: [],
          // PLAN 7.2: a human said it -> confirmed; the witness is the DOC claim minted above,
          // so linkage is computed, never asserted. anchorSource names the witness kind.
          tier: 'confirmed', anchorSource: 'interview', linkage: 'bound',
          confidence: 'medium',
          supersedes: null, supersededBy: null, confirmationStatus: 'current', reconfirmation: [],
        });
      }

      const recallTopics = [];
      for (const t of ((art.recall && art.recall.topics) || [])) {
        recallTopics.push({
          term: t.term, statement: normText(t.statement), span: normText(t.span),
          recordedAt: art.recall.recordedAt, respondent: art.recall.respondent,
          blind: !!art.recall.blind, contamination: art.recall.contamination || null,
        });
        decisions.push({
          statement: normText(t.statement),
          rationale: null, rationaleStrength: 'stated', alternatives: [],
          scope: { instance: ctx.state.instance, tables: [] },
          answeredBy: art.recall.respondent, answeredAt: art.recall.recordedAt,
          answerProvenance: { fromQuestion: null, channel: 'sealed-recall', verbatim: normText(t.span), rationaleVolunteered: true, branch: null },
          derivedFrom: 'recall',
          witnessClaims: [], explainsClaims: [],
          /*
           * PLAN 7.2 (folds 6.8). A sealed-recall decision is UNBOUND BY CONSTRUCTION — it is
           * recorded before a single instance read, so there is no claim it could cite yet. The
           * emptiness that PRODUCT-75 measured (40 of 51 silent) is legal only when DISCLOSED:
           * linkage: 'unbound' is what lets the DEC renderer show the gap instead of refusing
           * the row, and what tells the induction leg (7.3) these are the decisions worth
           * anchoring when the evidence arrives.
           */
          tier: 'confirmed', anchorSource: 'interview', linkage: 'unbound',
          confidence: 'medium',
          supersedes: null, supersededBy: null, confirmationStatus: 'current', reconfirmation: [],
        });
      }

      const statedDocuments = (art.documents || []).map((d) => ({
        title: d.title, url: d.url || null, kind: d.kind, currency: d.currency,
        judgedBy: d.judgedBy || art.respondent, covers: d.covers || null,
      }));

      /*
       * F5 (2026-09-02) — ONE HUMAN ANSWER MINTS ONE DECISION, OR ITS ATOMS, NEVER BOTH.
       *
       * Measured on the second engagement: the respondent said "flow designer is deliberate,
       * decision tables too" once; it entered as a `prior-decisions` convention AND as two
       * lifted recall topics, and the ledger rendered DEC-001 (the sentence) beside DEC-003 and
       * DEC-004 (its halves) — one answer counted three times, the repetition reading as
       * corroboration. The two mint paths above never shared a source-answer identity.
       *
       * The rule, applied by the CLI over what was minted above:
       *   - every decision carries `answerProvenance.sourceAnswer`, a digest of the verbatim it
       *     came from;
       *   - a recall topic whose verbatim equals a convention's is a DUPLICATE: the convention's
       *     decision stands (it has a witness claim), the topic's is dropped;
       *   - a convention whose verbatim CONTAINS one or more topic spans is an UMBRELLA: the
       *     atoms stand, inherit the convention's witness claim and the umbrella's
       *     sourceAnswer, and record `splitFrom`; the umbrella's decision is suppressed (its
       *     claim and statedConventions entry stay — conventions.md and the gates read those);
       *   - a recall topic whose span contains another topic's span is an umbrella too.
       * Every split is recorded in facts and in the raw ledger, so the original sentence stays
       * auditable from any atom.
       */
      const lc = (s) => normText(s).toLowerCase();
      const promptFor = (span) => ((art.recall && art.recall.prompts) || []).find((p) => lc(p.verbatim).includes(lc(span)));
      const convDecisions = decisions.filter((d) => d.derivedFrom === 'stated');
      const recallDecisions = decisions.filter((d) => d.derivedFrom === 'recall');
      for (const d of convDecisions) { d.answerProvenance.sourceAnswer = digest({ answer: lc(d.answerProvenance.verbatim) }); }
      for (const d of recallDecisions) {
        const p = promptFor(d.answerProvenance.verbatim);
        d.answerProvenance.sourceAnswer = digest({ answer: lc(p ? p.verbatim : d.answerProvenance.verbatim) });
      }
      const dropped = new Set();
      const splits = [];
      for (const cd of convDecisions) {
        const cv = lc(cd.answerProvenance.verbatim);
        const inside = recallDecisions.filter((rd) => { const s = lc(rd.answerProvenance.verbatim); return s && cv.includes(s); });
        const exact = inside.filter((rd) => lc(rd.answerProvenance.verbatim) === cv || lc(rd.statement) === lc(cd.statement));
        for (const rd of exact) { dropped.add(rd); splits.push({ kind: 'duplicate', kept: cd.statement, dropped: rd.statement, sourceAnswer: cd.answerProvenance.sourceAnswer }); }
        const atoms = inside.filter((rd) => !exact.includes(rd));
        if (atoms.length) {
          dropped.add(cd);
          for (const rd of atoms) {
            rd.answerProvenance.sourceAnswer = cd.answerProvenance.sourceAnswer;
            rd.answerProvenance.splitFrom = cd.answerProvenance.verbatim;
            rd.witnessClaims = [...new Set(rd.witnessClaims.concat(cd.witnessClaims))];
            rd.linkage = rd.witnessClaims.length ? 'bound' : rd.linkage;
          }
          splits.push({ kind: 'umbrella-convention', umbrella: cd.statement, atoms: atoms.map((r) => r.statement), sourceAnswer: cd.answerProvenance.sourceAnswer });
        }
      }
      for (const a of recallDecisions) {
        if (dropped.has(a)) { continue; }
        const av = lc(a.answerProvenance.verbatim);
        const inner = recallDecisions.filter((b) => b !== a && !dropped.has(b) && av.length > lc(b.answerProvenance.verbatim).length && av.includes(lc(b.answerProvenance.verbatim)));
        if (inner.length) {
          dropped.add(a);
          for (const b of inner) { b.answerProvenance.splitFrom = a.answerProvenance.verbatim; b.answerProvenance.sourceAnswer = a.answerProvenance.sourceAnswer; }
          splits.push({ kind: 'umbrella-recall', umbrella: a.statement, atoms: inner.map((b) => b.statement), sourceAnswer: a.answerProvenance.sourceAnswer });
        }
      }
      const minted = decisions.filter((d) => !dropped.has(d));

      /*
       * PLAN 7.2 / PRODUCT-75 fix (2): the unbound population is DISCLOSED where it is minted —
       * one aggregate warning, never one per decision. Warning, not blocking: an unbound
       * sealed-recall decision is a real fact worth recording; what was illegal was the silence.
       */
      const unboundDecisions = minted.filter((d) => d.linkage === 'unbound');
      const findings = unboundDecisions.length ? [{
        check: 'decision-unbound', severity: 'warning', rung: 'L5',
        locus: { table: 'decisions', sysId: 'orientation' },
        message: `${unboundDecisions.length} of ${minted.length} decision(s) minted at orientation rest on no claim ` +
          `(all sealed-recall, disclosed as linkage: 'unbound'). Supersession cannot reach them until a later leg anchors ` +
          `them — the induction pass drafts anchors from claim patterns, and the DEC ledger renders the gap on each entry.`,
      }] : [];

      return {
        claims, decisions: minted, findings,
        facts: {
          orientation: {
            available: true, respondent: art.respondent, recordedAt: art.recordedAt,
            conventions: statedConventions.length, documents: statedDocuments.length,
            recallTopics: recallTopics.length, owners: (art.owners || []).length,
            decisionsMinted: minted.length, decisionsCollapsed: dropped.size, decisionSplits: splits,
          },
          // The external transport's whole configuration, established once, by the only party
          // who knows it. 5.49 reads this; it does not re-derive it.
          tracker: art.tracker,
        },
        stamps: {
          conventions: statedConventions.length ? 'stated' : 'none-stated',
          corpus: statedDocuments.some((d) => d.currency === 'current') ? 'declared'
            : (statedDocuments.length ? 'declared-all-stale' : 'none-declared'),
          tracker: art.tracker.kind,
          storiesLiveIn: art.tracker.storiesLiveIn,
        },
        queue: { statedConventions, statedDocuments, recallTopics },
        raw: (art.conventions || []).map((c) => Object.assign({ kind: 'stated-convention' }, c))
          .concat(statedDocuments.map((d) => Object.assign({ kind: 'stated-document' }, d)))
          .concat(recallTopics.map((t) => Object.assign({ kind: 'recall-topic' }, t)))
          .concat(splits.map((s) => Object.assign({ kind: 'decision-split' }, s))),
        progress: true,
      };
    },
    next: () => 'seed',
  },

  // =========================================================================
  /*
   * SEED — the process-brain entry. A developer on the team is NOT blind: they can point
   * at the update sets, the epic and the docs of ONE process, and that gates the surface
   * before a single instance read. This stage captures those pointers VERBATIM, at zero
   * API cost, exactly as orientation captures conventions — a prior that costs budget is
   * not a prior.
   *
   * ONE HARD GATE, and only one: at least one update-set pointer. Everything else — the
   * epic, the docs, table names — is enrichment, stamped into the INPUT ENVELOPE and never
   * gated on, because the version-chain hop at anchor makes a single honest set
   * self-amplifying (see docs/design.md). Whether the pointer RESOLVES is checked by the
   * anchor stage with two reads; this stage never opens the transport.
   *
   * A run with no seed (available:false, or --blind) degrades to the census path — the
   * full archaeology pipeline — and the route says so in state rather than in prose.
   */
  {
    id: 'seed',
    title: 'Seed — the developer names the process surface, before any read',
    stagnation: 'none',
    humanGate: true,
    goal: () =>
      'Capture what the developer can POINT AT for one process, verbatim, before any read. ' +
      'Every pointer is a claim about scope, never ground truth — the anchor stage expands and ' +
      'checks it against co-change evidence, and the diff becomes the interview. ' +
      'ONE hard requirement: at least one update-set pointer. The epic and the documents are ' +
      'enrichment: record them when offered, never demand them, and never gate on their absence — ' +
      'their absence is stamped, not fatal. ' +
      'You record no fact about the instance here and you spend no API call: usage.apiCalls must be 0.',
    reads: () => [
      { path: 'docs/design.md', why: 'The SEED contract: the one hard gate, the input envelope, and why docs/epic are never requirements.', required: true },
      { path: '.claude/skills/snbrain-seed/SKILL.md', why: 'Engagement procedure, if the repo has one.', required: false },
    ],
    procedure: () => [
      'THIS STAGE HAS A HUMAN IN IT AND YOU MAY NOT SIMULATE ONE. If no developer was reachable, ingest available:false with a reason — the run then degrades to the census path (full archaeology) and the route records why. Inventing a pointer is not a legal outcome, and the CLI refuses a provider whose name is a job title this loop gives itself.',
      'ASK FOR THE PROCESS IN THEIR WORDS: its name, what starts it (trigger), and what it ends in (outcome). One line each, verbatim — this is the spine the render stage will hang every artifact on, and no read you can issue produces the customer\'s word for it.',
      'ASK FOR THE UPDATE SETS FIRST — they are the ignition. One resolving, non-empty set is sufficient IN PRINCIPLE: its artifacts\' version chains recover every set they ever shipped in, so the developer does not need to remember all of them, only to point honestly into the cluster.',
      'THEN TAKE EVERYTHING ELSE OFFERED, and demand nothing: an epic or story ids (they chain to sets through the induced naming pattern, IF provenance finds one), documents (they become the CLAIMED process the harvested spine is diffed against), table names, artifact names, and explicit exclusions ("that set is another team\'s").',
      'RECORD THE CONFIDENCE WORD THE HUMAN USED, not yours: certain, probably, vague. A vague pointer is admissible — anchor treats it as a resolution attempt, not a fact.',
      'DO NOT RESOLVE ANYTHING. Resolution costs reads and reads belong to anchor. A set name that turns out not to exist is anchor\'s stop-and-ask, discovered at minute one for two reads — not yours to pre-empt by opening the transport.',
    ],
    schema: {
      type: 'object',
      required: ['available', 'providedBy', 'recordedAt', 'process', 'pointers'],
      forbidden: ['id', 'claims', 'decisions'],
      props: {
        available: { type: 'boolean' },
        unavailableReason: { type: 'string', optional: true, minLength: 10 },
        providedBy: { type: 'string', minLength: 2 },
        recordedAt: { type: 'string', minLength: 8 },
        process: {
          type: 'object',
          required: ['name', 'trigger', 'outcome'],
          props: {
            name: { type: 'string', minLength: 3 },
            trigger: { type: 'string', minLength: 10 },
            outcome: { type: 'string', minLength: 10 },
          },
        },
        pointers: {
          type: 'array', min: 0,
          items: {
            type: 'object',
            required: ['kind', 'value', 'confidence'],
            forbidden: ['id'],
            props: {
              kind: { type: 'string', enum: ['update-set', 'artifact', 'table', 'story', 'epic', 'document'] },
              value: { type: 'string', minLength: 2 },
              confidence: { type: 'string', enum: ['certain', 'probably', 'vague'] },
              url: { type: 'string', optional: true, minLength: 4 },
              note: { type: 'string', optional: true },
            },
          },
        },
        exclusions: {
          type: 'array', optional: true,
          items: { type: 'object', required: ['value'], props: { value: { type: 'string', minLength: 2 }, why: { type: 'string', optional: true } } },
        },
        findings: { type: 'array', optional: true, items: FINDING_SCHEMA },
      },
    },
    example: (ctx) => ({
      stage: 'seed', instance: ctx.state.instance,
      usage: { apiCalls: 0, notes: 'zero instance reads — pointers are claims to verify, and resolution belongs to anchor' },
      available: true,
      providedBy: 'a.developer',
      recordedAt: '2026-08-20',
      process: {
        name: 'Case cancellation',
        trigger: 'an operator cancels a case from the workspace, or the requester withdraws it from the portal',
        outcome: 'the case is closed as cancelled, the assignment group is notified, and open child tasks are closed',
      },
      pointers: [
        { kind: 'update-set', value: 'STRY0185005 ACME cancel flow', confidence: 'certain', note: 'the main build set' },
        { kind: 'update-set', value: 'STRY0185005.02 cancel flow fixes', confidence: 'probably' },
        { kind: 'epic', value: 'AzDO epic 1243200 — Cancellation rework', url: 'https://dev.azure.com/acme/acme/_workitems/edit/1243200', confidence: 'certain' },
        { kind: 'document', value: 'ACME cancellation way-of-working', url: 'https://confluence.example.com/x/CCC', confidence: 'certain' },
        { kind: 'table', value: 'x_acme_case', confidence: 'certain' },
      ],
      exclusions: [{ value: 'ACME Sprint 12 batch', why: 'a migration batch set — it carries three other teams\' work' }],
      acceptance: [
        { id: 'AC-SEED-1', result: 'pass', evidence: 'usage.apiCalls = 0; no transport call was made' },
        { id: 'AC-SEED-2', result: 'pass', evidence: 'every pointer is verbatim from a.developer with their own confidence word' },
        { id: 'AC-SEED-3', result: 'pass', evidence: 'two update-set pointers recorded; resolution deferred to anchor' },
      ],
    }),
    acceptance: [
      { id: 'AC-SEED-1', statement: 'No instance read was made in this stage.', howToEvidence: 'usage.apiCalls = 0. The CLI refuses anything else: a prior that costs budget is not a prior.' },
      { id: 'AC-SEED-2', statement: 'Every pointer is verbatim from a named human, carrying THEIR confidence word, not the agent\'s.', howToEvidence: 'providedBy names a person; pointers[].confidence is the word they used.' },
      { id: 'AC-SEED-3', statement: 'At least one update-set pointer exists, or the run degrades to the census path with available:false and a reason.', howToEvidence: 'pointers[] holds a kind:update-set entry; resolution is anchor\'s first act, two reads, stop-and-ask on failure.' },
    ],
    validate: (ctx, art) => {
      const rej = [];
      if (art.usage && typeof art.usage.apiCalls === 'number' && art.usage.apiCalls > 0) {
        rej.push(`usage.apiCalls is ${art.usage.apiCalls}. Seed reads NOTHING from the instance — resolution costs reads and reads belong to anchor, where a failed resolution is a two-read stop-and-ask instead of a burned prior. If you needed a read to record a pointer, the pointer was yours and not the developer's.`);
      }
      if (AGENT_IDENTITY_RE.test(String(art.providedBy || ''))) {
        rej.push(`providedBy "${art.providedBy}" is a name this loop gives itself, not a person. This stage has a human in it. If no developer was reachable, ingest available:false with unavailableReason — the run then takes the census path, recorded as such.`);
      }
      if (art.available === false) {
        if (!art.unavailableReason) {
          rej.push('available:false with no unavailableReason. "No developer was reachable" is a recordable result; an unexplained one is indistinguishable from a stage that was never run.');
        }
        if ((art.pointers || []).length) {
          rej.push('available:false, but pointers were recorded. One of the two is untrue.');
        }
        return rej;
      }
      if (!(art.pointers || []).some((p) => p.kind === 'update-set')) {
        rej.push('pointers: no update-set pointer. That is THE one hard requirement of a seeded run — one resolving, non-empty set is the ignition, and everything else is enrichment. Ask the developer for the set that shipped this process; if they genuinely cannot name one, ingest available:false with that as the reason and the run degrades to the census path instead of pretending to be seeded.');
      }
      return rej;
    },
    apply: (ctx, art) => {
      if (art.available === false) {
        /*
         * D5(a): the run is unseeded, so it takes the census path — and the kill criteria
         * preflight deferred "in case the run is seeded" are now the census's problem. Re-raised
         * here as BLOCKING with the original criterion, and the route terminates below.
         */
        const deferred = ((ctx.state.facts.probe || {}).killsDeferred || []);
        return {
          facts: { seed: { available: false, reason: art.unavailableReason, recordedAt: art.recordedAt } },
          stamps: { seed: 'unavailable', inputEnvelope: 'none' },
          findings: deferred.map((d) => ({
            check: `wp-a-kill-${d.id}`, severity: 'blocking', rung: 'L1',
            message: `WP-A probe ${d.id} fired its kill criterion at preflight (${d.criterion || 'see the probe results'}); it was deferred while this run could still be seeded. ` +
              'The seed is unavailable, so the run falls to the census path, which rests on the record-level authorship rung this instance lacks. Blocked: re-aim with a seed, or take the probe results to the operator.',
          })),
          progress: true,
        };
      }
      const kinds = new Set((art.pointers || []).map((p) => p.kind));
      const hasStories = kinds.has('story') || kinds.has('epic');
      const hasDocs = kinds.has('document');
      /*
       * THE INPUT ENVELOPE, mirroring the provenance envelope: downstream stages read the
       * stamp instead of assuming inputs exist. sets-only loses the intent axis (no doc to
       * diff against) and the render must say so; it loses NOTHING structural, because the
       * expansion axes never needed the doc or the epic in the first place.
       */
      const envelope = hasStories && hasDocs ? 'full' : hasStories ? 'sets+stories' : hasDocs ? 'sets+docs' : 'sets-only';
      const counts = {};
      for (const p of art.pointers) { counts[p.kind] = (counts[p.kind] || 0) + 1; }
      return {
        facts: {
          seed: {
            available: true, providedBy: art.providedBy, recordedAt: art.recordedAt,
            process: { name: normText(art.process.name), trigger: normText(art.process.trigger), outcome: normText(art.process.outcome) },
            pointerCounts: counts, envelope,
          },
        },
        stamps: { seed: 'provided', inputEnvelope: envelope, processName: normText(art.process.name) },
        queue: { seedPointers: (art.pointers || []).slice(), seedExclusions: (art.exclusions || []).slice() },
        findings: art.findings || [],
        raw: (art.pointers || []).map((p) => Object.assign({ kind: 'seed-pointer' }, p))
          .concat((art.exclusions || []).map((e) => Object.assign({ kind: 'seed-exclusion' }, e))),
        progress: true,
      };
    },
    /*
     * The seeded route SKIPS the census: the anchor's tiered surface is the harvest queue,
     * and the census's job (find the customer surface) was done by a human who could point.
     * The unseeded route takes the census exactly as the department-scope product does —
     * one engine, two entries, and the state records which one ran.
     */
    next: (ctx) => {
      const unseeded = ctx.state.facts.seed && ctx.state.facts.seed.available === false;
      const deferred = ((ctx.state.facts.probe || {}).killsDeferred || []).map((d) => d.id);
      if (unseeded && deferred.length) {
        return { terminal: 'blocked', note: `The seed is unavailable and WP-A kill criteria ${deferred.join(', ')} fired at preflight: the census path this run would fall to needs the record-level authorship rung the probe says this instance lacks. Deferred while a seed was possible; fatal now that it is not.` };
      }
      return unseeded ? 'census' : 'provenance';
    },
  },

  // =========================================================================
  {
    id: 'census',
    title: 'Census — scopes, packages, authorship distribution, customer-authored surface',
    stagnation: 'none',
    /*
     * PRODUCT-82. EVERY NUMBER THIS STAGE PRODUCES IS CAST IN A POPULATION THE BOUNDARY DEFINES,
     * so a boundary that moves after the fact does not make them stale — it makes them numbers
     * about a different run. `bands.AInDomain`, every `areas[].bandARowsInDomain`, the residual
     * reconciliation and the harvest queue itself are all in-domain units; `snbrain refine` reads
     * this field, drops what is listed here and sends the run back. Declared on the stage rather
     * than in `cmdRefine` because the engine may not name a stage (invariant 7).
     */
    boundaryCast: {
      why: 'the harvest queue and both band populations are measured under the boundary; run pilot-run-4 refined from instance-wide to a 13,447-row domain during harvest and kept a 475-area queue cast in a 257,352-row population.',
      queue: ['harvestAreas', 'harvestAreaDetail', 'harvestAreasOutOfBoundary', 'processCandidates', 'namedProcesses'],
      facts: ['census'],
    },
    goal: () =>
      'Separate what the CUSTOMER built from what ServiceNow shipped, and prove the separation ' +
      'discriminates. This is the actual go/no-go of the whole run: a generator without a working ' +
      'authorship filter preferentially asks about platform defaults, which is maximally derivable, ' +
      'maximally worthless, and not even wrong. It also produces the harvest areas — there is no ' +
      'hardcoded area list anywhere in this product.',
    reads: () => [
      /*
       * `docs/rework-plan.md` USED TO BE REQUIRED READING HERE AND MUST NOT BE AGAIN.
       * It is the design of record, and its argument is carried by worked examples from a real
       * engagement. Inside the very line range this pointer named, those examples give that
       * engagement's application scope, one of its custom tables, the observation that customer
       * work lives in a vendor scope there, and four literal OOTB ACL sys_ids. A census agent
       * mapping THAT instance would have been handed the answers and then "discovered" them.
       * (The specifics are deliberately not repeated here: this comment ships into every
       * engagement repo, so naming them would reintroduce the leak it exists to describe.)
       *
       * A stage brief carries the RULE. The design doc carries the ARGUMENT. Keeping them
       * separate is what makes a run on a documented instance measure the loop rather than
       * the briefing — and the rules themselves now live in this procedure and in the
       * census skill, so nothing was lost by cutting the pointer.
       */
      { path: 'tools/snbrain/lib/api.js', why: 'countRows() and groupCount() do the distribution without transferring rows.', required: true },
      { path: '.claude/skills/snbrain-census/SKILL.md', why: 'Engagement procedure, if the repo has one.', required: false },
    ],
    procedure: (ctx) => [
      'I1: sys_package census (sys_id,source,name,version,active,trackable,sys_class_name,sys_created_by,sys_created_on), limit 1000.',
      'I2: install floor = min(sys_created_on) over sys_app, cross-checked against the top 5 sys_upgrade_history rows.',
      'I3: author distribution via groupCount("sys_metadata","sys_created_by"). One call. Do not page 900k rows.',
      'I8: ACTOR TEST, and it is a RULE, not a list of names. One sys_user read over the top authors, then decide each account on: does a sys_user row exist at all; is last_login_time NON-EMPTY (the strongest signal — somebody actually signed in); is the email domain something other than example.com (the OOTB demo set); was the account created at or after the install floor, or has it logged in since; is it active. Record WHICH signal decided each account, not just the boolean. Writing user_nameIN<the two names you expected> is the answer decided in advance and it silently sets the run\'s recall.',
      'THE ADMIN TRAP: on a developer or vendor instance the developer normally works AS admin, so "admin is the shared install account" is an ASSUMPTION, not a finding. Never disqualify it on the age of its sys_user row (on devinst01 that row is dated 2007 with admin@example.com and says nothing about who logged in since). Disqualify or admit it on last_login_time and on what it actually created and modified — see the package split below.',
      'Classify into bands on TWO AXES. Axis 1 CHANGE, the only axis with real signal: sys_mod_count>0, OR more than one sys_update_version row (or one after the install floor), OR an entry in sys_update_xml joined sys_metadata.sys_update_name = sys_update_xml.name, OR sys_updated_on>sys_created_on, OR sys_updated_by!=sys_created_by. Axis 2 ACTOR: the I8 rule, applied to sys_updated_by for a change and sys_created_by for a creation.',
      'Band A = changed AND human actor, WHEREVER IT LIVES (a post-floor creation by a human actor qualifies on creation alone). Band B = changed AND human actor but the record arrived in a vendor package — i.e. AN OOTB RECORD THE CUSTOMER MODIFIED. Band C = everything else, never askable.',
      'PACKAGE IS A CLASSIFIER, NEVER A GATE. A package says where a record LIVES, not who last TOUCHED it — modifying an OOTB business rule leaves it in com.snc.incident forever. On a real customer implementation modified-OOTB is the MAIN EVENT, so any predicate binning "vendor package" as "not customer" reports a fully customised ITSM implementation as having zero customer surface. Measured on devinst01: 66,332 base-package records carry sys_mod_count>0 and 188,949 do across all packages; a human-name list admitted ONE. Use the package split to report which app a finding belongs to and to separate Band A from Band B — never to decide Band C.',
      'Compute the four discrimination gate numbers. Report them as measured; the CLI recomputes the arithmetic and will reject a verdict that does not follow from your own counts.',
      'Derive harvest areas from what you actually found. Skip any table with zero Band A rows entirely — most of the standard forty will be zero and that saving is free budget.',
      'AREAS ARE `sys_metadata` CLASS STRATA, AND THAT IS A CEILING RATHER THAN A BUDGET. areas[] comes from a group-by of sys_class_name over the Band A query, so a table that is not a sys_metadata class has no stratum to be counted in and cannot appear here at any spend — and you must not invent one for it, because this validator rejects bandARows<=0 AND rejects an area list summing past Band A, so a stratum whose rows are not IN Band A is unrepresentable in both directions. Run 6ef14f5562 derived 431 areas and got zero sys_choice, zero sys_translated_text and zero sys_highlighted_value rows out of the entire engagement. Those tables are reached from their PARENTS during harvest (see DEFINING_CHILDREN in this file), which is why their absence from areas[] is correct and is not a coverage gap in this artifact.',
      'ALSO derive PROCESS CANDIDATES, and keep them separate from areas. An area is a HARVEST unit — one artifact class at a time so the budget can be handed out. A process is what the DELIVERABLE is organised by, and grouping the deliverable by sys_class_name mirrors the platform object model, which the reader already knows, instead of the engagement work breakdown, which is the only thing they do not.',
      'The strongest clustering signal is UPDATE-SET CO-MEMBERSHIP: records shipped together in one named update set were almost always built for one purpose. Then shared table, then a shared name prefix, then a shared author-and-time window. Emit each cluster with the signal that produced it, its record count, and up to five sample names so the human can recognise it.',
      'These are CANDIDATES and you must NOT name them. The instance has tables and scripts; a PROCESS is the customer word for a bundle of them, and no read you can issue produces that word. Naming, merging, splitting and discarding all happen at Gate 1. Emitting a cluster called "incident-data-model" is precisely the failure this exists to prevent.',
      (ctx.state.config && ctx.state.config.scopeFilter)
        ? ((ctx.state.config.scopeFilter || []).includes('global')
          ? `SCOPE BOUNDARY INCLUDES \`global\`, AND \`global\` IS NOT A SCOPE — it is everything that was never scoped, which on a mature instance is most of the platform. Measured on the reference run: harvest scoped to a domain plus \`global\` spent roughly half its entire ledger in \`global\` and got 0.5% of that volume back as in-domain material. Do NOT sweep it. Reach into it only where a record ALSO satisfies a domain leg — the customer-authored author set, the domain name prefix, or membership of a domain update set — and say in \`why\` on each area which leg admitted it. An area whose only justification is "it is in global" is the 95% of the reference ledger that nobody could use.\n` +
            `SCOPE BOUNDARY IS SET: harvest is confined to sys_scope IN [${ctx.state.config.scopeFilter.join(', ')}].`
          : `SCOPE BOUNDARY IS SET: harvest is confined to sys_scope IN [${ctx.state.config.scopeFilter.join(', ')}].`) + ` Derive areas ONLY from Band A rows inside those scopes, and declare a "scope" on every area you emit. THE CENSUS ITSELF IS NOT SCOPED and you must not scope it: the instance-wide counts are the denominator that makes a scoped result mean "we mapped this process out of THIS MUCH instance" rather than "we mapped what we chose to look at". Scoping the denominator to the numerator makes every downstream ratio circular. Report the instance-wide numbers AND the in-scope numbers, separately and both.`
        : 'No scope boundary is set: derive areas across the whole instance.',
    ],
    schema: {
      type: 'object',
      required: ['installFloor', 'authorship', 'bands', 'recallExposure', 'discriminationGate', 'areas'],
      props: {
        installFloor: { type: 'string', minLength: 4 },
        /*
         * PRODUCT-28. The boundary AS ISSUED, not as described. The CLI compiles it and prints it
         * in the brief; this is where the artifact says it issued that string rather than a
         * hand-encoding of the prose. Optional in the schema and REQUIRED by validate() whenever
         * the domain compiles to a non-empty query, because "required only under a domain" is not
         * expressible here. A describable boundary is not a replayable one — and the difference is
         * how `sys_scope=<a scope name>` returned 0 rows against 12,382, twice, in one run,
         * without leaving anything behind that could be re-issued.
         */
        boundaryQuery: { type: 'string', optional: true, minLength: 3 },
        packages: {
          type: 'array', optional: true,
          items: { type: 'object', required: ['sysId', 'name', 'class'], props: { sysId: { type: 'string' }, name: { type: 'string' }, class: { type: 'string' }, source: { type: 'string', optional: true }, createdBy: { type: 'string', optional: true }, createdOn: { type: 'string', optional: true } } },
        },
        authorship: {
          type: 'object',
          required: ['totalMetadataRows', 'distribution'],
          props: {
            totalMetadataRows: { type: 'number', min: 1 },
            // `signal` is REQUIRED and enumerated: it is the actor test's deciding reason,
            // and making it a closed vocabulary is what stops "human: false" from being a
            // name the agent did not recognise. `name-list` is deliberately absent.
            distribution: { type: 'array', min: 1, items: { type: 'object', required: ['account', 'count', 'human', 'signal'], props: { account: { type: 'string' }, count: { type: 'number', min: 0 }, human: { type: 'boolean' }, signal: { type: 'string', enum: ['no-sys-user-row', 'never-logged-in', 'demo-email-domain', 'inactive-or-locked', 'logged-in', 'created-after-floor', 'logged-in-after-floor'] }, lastLogin: { type: 'string', optional: true }, evidence: { type: 'string', optional: true } } } },
            method: { type: 'string', optional: true, enum: ['stats-group-by', 'paged-sweep'] },
          },
        },
        /*
         * TWO POPULATIONS, ONE TRIPLE — PRODUCT-29. `A`/`B`/`C` are and stay INSTANCE-WIDE.
         * `AInDomain` is the same Band A predicate intersected with the compiled domain query,
         * and it is the only number the harvest queue may be sized in. It is schema-OPTIONAL
         * because the schema cannot see `ctx`; `validate()` requires it under `--domain` and
         * REJECTS it without one. Optional here is also what makes replay safe: a brain built
         * before this field existed loads as an instance-wide run rather than crashing.
         */
        bands: { type: 'object', required: ['A', 'B', 'C'], props: { A: { type: 'number', min: 0 }, B: { type: 'number', min: 0 }, C: { type: 'number', min: 0 }, AInDomain: { type: 'number', min: 0, optional: true } } },
        /*
         * RECALL EXPOSURE. `changed` is axis 1 alone, over the whole instance; `changedExcludedOnActor`
         * is how many of those the actor test threw away. That ratio is the only recall-shaped number
         * this stage can produce about itself, it is free (two aggregates), and it must be reported
         * even when it is zero. On the reference run it would have read 188,949 changed with 188,948
         * excluded on actor — a ledger of 2 records built by discarding everything, and nothing in the
         * output said so.
         */
        recallExposure: { type: 'object', required: ['changed', 'changedExcludedOnActor'], props: { changed: { type: 'number', min: 0 }, changedExcludedOnActor: { type: 'number', min: 0 }, note: { type: 'string', optional: true } } },
        discriminationGate: {
          type: 'object',
          required: ['topBandAAuthor', 'topBandCAuthor', 'defaultSetShare'],
          forbidden: ['verdict'],
          props: {
            topBandAAuthor: { type: 'object', required: ['account', 'share'], props: { account: { type: 'string' }, share: { type: 'number', min: 0, max: 1 } } },
            topBandCAuthor: { type: 'object', required: ['account', 'share'], props: { account: { type: 'string' }, share: { type: 'number', min: 0, max: 1 } } },
            defaultSetShare: { type: 'number', min: 0, max: 1 },
            defaultSetShareMethod: { type: 'string', optional: true },
          },
        },
        /*
         * `bandARows` sizes the area INSTANCE-WIDE; `bandARowsInDomain` sizes the same area in
         * the units the queue is handed out in, and `apply()` filters on it. Run 6ef14f5562
         * briefed sys_documentation at 32,328 rows for an area holding 1,631 in-domain — a 20x
         * error in the queue's own sizing field, because there was one field for two populations.
         * `bandARowsInDomainMethod` is what PRODUCT-38's reasoned-zero rule keys on: a zero that
         * came from an estimate is a different fact from a zero that came from a count.
         *
         * PRODUCT-85: this key was DUPLICATED — `areas: { type:'array', min:1, areas: { …items… } }`
         * — so the item schema sat nested one level down and was never applied to anything. Valid
         * JS, silent, and it meant every per-area field was unvalidated for the whole of Phase 5.
         */
        areas: {
          type: 'array', min: 1,
          items: { type: 'object', required: ['id', 'tables', 'bandARows'], props: { id: { type: 'string', minLength: 2 }, tables: { type: 'array', min: 1, items: { type: 'string' } }, bandARows: { type: 'number', min: 0 }, bandARowsInDomain: { type: 'number', min: 0, optional: true }, bandARowsInDomainMethod: { type: 'string', optional: true, enum: ['exact', 'estimate'] }, why: { type: 'string', optional: true } } },
        },
        /*
         * PRODUCT-83. A SEPARATE POPULATION, IN ITS OWN FIELD. `rowsInDomain` is counted on this
         * table's own columns (see DATA_AREAS.reach) and is NOT a Band A figure: these rows are not
         * application files, carry no `sys_scope`, and appear in no `sys_class_name` stratum. Keeping
         * them out of `areas[]` is what stops them entering PRODUCT-12's residual reconciliation,
         * where a population that is not a subset of Band A can only ever read as an overlap or a
         * shortfall.
         */
        dataAreas: {
          type: 'array', optional: true,
          items: { type: 'object', required: ['table', 'rowsInDomain', 'query'], props: { table: { type: 'string', minLength: 2 }, rowsInDomain: { type: 'number', min: 0 }, rowsTotal: { type: 'number', min: 0, optional: true }, query: { type: 'string', minLength: 3 }, columnsValidated: { type: 'array', optional: true, items: { type: 'string' } }, why: { type: 'string', optional: true } } },
        },
        /*
         * PROCESS CANDIDATES. Areas are a HARVEST unit — they group by artifact class so the
         * budget can be handed out one class at a time. They are not, and must not become, the
         * unit the deliverable is organised by: grouping by sys_class_name mirrors ServiceNow's
         * object model, which the reader already knows, instead of the engagement's work
         * breakdown, which is the only thing they do not. The reference run rendered ten slugs
         * — incident-data-model, automation-and-scripts, notifications-and-translations — and
         * no page could answer "I have a story about cancelling a case, what does it touch?"
         * because that work is spread across four artifact-class pages and named on none.
         *
         * These are CANDIDATES, never conclusions. The instance has tables and scripts; a
         * process is the customer's word for a bundle of them, and no read produces it. The
         * human names, merges, splits and discards at Gate 1 — see the process-naming gate.
         */
        processCandidates: {
          type: 'array', optional: true,
          items: {
            type: 'object',
            required: ['key', 'signal', 'recordCount'],
            props: {
              key: { type: 'string', minLength: 2 },
              signal: { type: 'string', enum: ['update-set-comembership', 'shared-table', 'name-prefix', 'shared-author-window', 'story-id'] },
              recordCount: { type: 'number', min: 1 },
              updateSets: { type: 'array', optional: true, items: { type: 'string' } },
              tables: { type: 'array', optional: true, items: { type: 'string' } },
              sampleNames: { type: 'array', optional: true, items: { type: 'string' } },
              why: { type: 'string', optional: true },
            },
          },
        },
        findings: { type: 'array', optional: true, items: FINDING_SCHEMA },
      },
    },
    example: (ctx) => ({
      stage: 'census', instance: ctx.state.instance,
      usage: { apiCalls: 70, requestLog: '<sync-root>/spikes/scriptsync-read/snbrain-requests.ndjson' },
      installFloor: '2024-03-11 08:00:00',
      boundaryQuery: 'sys_scope.scopeINsn_ohs_im,global^NQsys_nameSTARTSWITHACME',
      authorship: { totalMetadataRows: 905336, method: 'stats-group-by', distribution: [{ account: 'system', count: 460119, human: false, signal: 'no-sys-user-row' }, { account: 'admin', count: 307442, human: true, signal: 'logged-in-after-floor', lastLogin: '2026-07-30 08:11:02', evidence: 'a developer instance: admin IS the developer here, and 5,069 of its post-floor records sit in no package at all' }, { account: 'tectonic', count: 69210, human: false, signal: 'never-logged-in', evidence: 'sys_user 3f2a… exists but last_login_time empty; ServiceNow content-build account' }] },
      /*
       * The example is what a fresh subagent copies, so it has to carry EXACTLY the shape this
       * run will accept: both populations under `--domain`, neither of them without one. 431 is
       * `bands.AInDomain` and it is also 58 + 44 + 301 + 28 over the areas below.
       */
      bands: dropInDomain(ctx, { A: 2264, B: 4120, C: 898952, AInDomain: 431 }, ['AInDomain']),
      recallExposure: { changed: 188949, changedExcludedOnActor: 77095, note: 'changed = axis 1 alone instance-wide; excluded = changed rows whose actor failed the rule. Report this even when it is zero.' },
      discriminationGate: { topBandAAuthor: { account: 'tectonic', share: 0.64 }, topBandCAuthor: { account: 'system', share: 0.58 }, defaultSetShare: 0.42, defaultSetShareMethod: 'stats sys_update_xml group_by update_set.is_default since install floor' },
      /*
       * THE AREAS ACCOUNT FOR BAND A. 412 + 388 + 1204 + 260 = 2,264, which is `bands.A`.
       * An area list that does not add up is a sample wearing a work queue's clothes: the rows
       * between two areas are harvested by nobody, and afterwards no number the run reports can
       * distinguish "not there" from "never looked". Where a slice IS deliberately deferred,
       * say so in `why` — the validator accepts a declared residual and refuses a silent one.
       */
      areas: [
        { id: 'business-rules', tables: ['sys_script'], bandARows: 412, bandARowsInDomain: 58, bandARowsInDomainMethod: 'exact', why: 'the highest-reach rule-shaped class on this instance' },
        { id: 'client-scripts', tables: ['sys_script_client'], bandARows: 388, bandARowsInDomain: 44, bandARowsInDomainMethod: 'exact', why: 'form-time behaviour; pairs with the UI policies below' },
        { id: 'access-controls', tables: ['sys_security_acl'], bandARows: 1204, bandARowsInDomain: 301, bandARowsInDomainMethod: 'exact', why: 'the access model, and the largest Band A class here' },
        { id: 'ui-actions', tables: ['sys_ui_action'], bandARows: 260, bandARowsInDomain: 28, bandARowsInDomainMethod: 'exact', why: 'every operator-visible entry point into the process' },
      ].map((a) => dropInDomain(ctx, a, ['bandARowsInDomain', 'bandARowsInDomainMethod'])),
      processCandidates: [{ key: 'us-fb060e8e', signal: 'update-set-comembership', recordCount: 34, updateSets: ['STRY0185005 ACME cancel flow'], tables: ['sys_script', 'sys_ui_action', 'sysevent_email_action'], sampleNames: ['ACME Cancel Guard', 'Cancel Case', 'Case cancelled notification'], why: 'shipped together in one named update set; the human names it at Gate 1' }],
      acceptance: [{ id: 'AC-CENSUS-1', result: 'pass', evidence: 'all counts from /api/now/stats, zero row transfers for counting' }],
    }),
    acceptance: [
      { id: 'AC-CENSUS-1', statement: 'Every count came from an aggregate call, not from transferring and tallying rows.', howToEvidence: 'name the stats endpoints used; if aggregates were unreachable say so and record the fallback.' },
      { id: 'AC-CENSUS-2', statement: 'Every filtered query had its fields validated against sys_dictionary before it was issued.', howToEvidence: 'the clause-drop is REPRODUCED on this instance; an unvalidated filter returns unfiltered rows.' },
      { id: 'AC-CENSUS-3', statement: 'Band membership was decided per record on the CHANGE axis and the ACTOR axis, not by sys_scope and not by package. The actor test was a rule with a named deciding signal per account, not a list of expected user names.', howToEvidence: 'scope and package both fail in BOTH directions on real instances. Name which change-signal and which actor-signal carried each band, and state the count of records that are changed-but-excluded-on-actor — that number is this stage\'s recall exposure and it must be reported even when it is zero.' },
      { id: 'AC-CENSUS-4', statement: 'The harvest areas are derived from measured Band A counts, and areas with zero Band A rows were dropped.', howToEvidence: 'the bandARows figure per area.' },
    ],
    validate: (ctx, art) => {
      const rej = [];
      const { A, B, C } = art.bands;
      const total = A + B + C;
      if (!total) { rej.push('bands: A+B+C is zero. That is not a census of a live instance; it is a failed read.'); return rej; }
      /*
       * PLATFORM-28 / PRODUCT-28 — THE THIRD LINT CALL SITE, AND THE ONLY ONE THAT COVERS THE QUERY
       * THAT ACTUALLY FAILED. The other two (harvest stages.js:1223, explain stages.js:1458) lint
       * per-claim `evidence.query` values, which are the `sys_idIN…` replays this rule exempts by
       * construction. The census — where the broken form was issued AND taught — called no lint at
       * all, so the rule as first proposed would have shipped with a passing selftest and a live
       * defect. It goes HERE, immediately after the counts are known to be non-trivial, because a
       * query that silently returns zero makes every one of those counts wrong.
       *
       * POPULATION, NAMED: (a) the fragments THIS CLI compiled for this run's boundary, and (b) the
       * declared query paths of censusQueryStrings(). Not "strings in the artifact".
       */
      {
        const domain = ctx.state.config && ctx.state.config.domain;
        const compiled = domain ? compileDomain(domain, 'sys_metadata') : null;
        if (compiled) {
          // The compiler's own output must survive the compiler's own lint. If this ever fires, the
          // run stops at the CLI rather than four stages later at a count nobody can reproduce.
          for (const frag of compiled.fragments) {
            for (const problem of lintEncodedQuery(frag)) {
              rej.push(`compileDomain emitted a fragment this product refuses to issue ("${frag}"): ${problem} This is a defect in the CLI, not in your artifact — report it as a finding and stop.`);
            }
          }
          if (compiled.query && !art.boundaryQuery) {
            rej.push(`boundaryQuery: this run is bounded by ${describeDomain(domain)} and the artifact records no query for it, so every in-domain number here was produced by a predicate nobody can replay — which is exactly how sys_scope=<a scope name> shipped 0 rows against 12,382 twice on the reference run without leaving a trace. Emit the boundary query VERBATIM as the brief gave it: ${compiled.query}`);
          }
        }
        for (const q of censusQueryStrings(art)) {
          for (const problem of lintEncodedQuery(q.query)) {
            rej.push(`${q.at}: ${problem}`);
          }
        }
      }
      /*
       * RECALL EXPOSURE, enforced rather than requested. A thin Band A is a legitimate
       * result; a thin Band A produced by an actor test that silently discarded a large
       * changed population is a measurement failure wearing the same clothes. These two
       * checks are what tell them apart, and neither can be satisfied by prose.
       */
      const re = art.recallExposure || {};
      if (re.changedExcludedOnActor > re.changed) {
        rej.push(`recallExposure: changedExcludedOnActor (${re.changedExcludedOnActor}) exceeds changed (${re.changed}). The excluded set is a subset of the changed set; these cannot both be measured correctly.`);
      }
      if (re.changed > 0 && (A + B) === 0 && re.changedExcludedOnActor === 0) {
        rej.push(`recallExposure: ${re.changed} records are CHANGED, zero were excluded on actor, and yet Band A and Band B are both empty. Every changed record went somewhere; say where. This is the shape of an actor test that was never actually applied.`);
      }
      // The CLI keeps the arithmetic. A model may report counts; it may not report the verdict.
      const aShare = pct(A, total);
      if (aShare > 0.35 && A > 0) {
        // not a rejection: a *stamped finding*. Section 4.9.2 gate 2.
        ctx.__gateNote = `Band A share ${(aShare * 100).toFixed(1)}% exceeds the 0.35 ceiling.`;
      }
      const declaredAreas = art.areas.filter((a) => a.bandARows <= 0);
      if (declaredAreas.length) {
        rej.push(`areas: ${declaredAreas.map((a) => a.id).join(', ')} declare bandARows<=0. An area with no customer-authored rows is inventory, not a harvest target. Drop it.`);
      }
      /*
       * PRODUCT-29, and PRODUCT-12 AMENDED. EVERY CHECK BELOW NAMES THE POPULATION IT COUNTS.
       *
       *   population 1 — INSTANCE-WIDE Band A: `bands.A`, Σ `areas[].bandARows`. The
       *     DENOMINATOR. It stays instance-wide; LOOP.md §6.5.2 requires it and the doctrine in
       *     `procedure()` says why — scoping it to the numerator makes every ratio circular.
       *   population 2 — IN-DOMAIN Band A: `bands.AInDomain`, Σ `areas[].bandARowsInDomain`.
       *     Exists only under `--domain`. The unit the harvest queue is cast in.
       *
       * The reconciliation used to hard-code population 1 for both roles. That was correct
       * while one population existed and became run-ending the moment `--domain` introduced a
       * second: run 6ef14f5562 was COMPELLED by this very check to enumerate 431 areas summing
       * to 97,258 of an instance-wide 97,436, was handed that list as its work queue — ~86,200
       * calls against a budget of 800, with `ceiling()` returning areas + 3 so the runaway guard
       * scaled WITH the defect — and terminated `blocked` after one area.
       */
      const dom = runDomain(ctx);
      const AInDomain = art.bands.AInDomain;
      const sized = art.areas.filter((a) => inDomainSize(a) !== null);
      if (!dom) {
        if (AInDomain !== undefined) {
          rej.push(`bands.AInDomain: this run has no --domain, so there is no second population to report and nothing that could check this number. One population, one set of numbers — remove the key and re-ingest. (If the run SHOULD be bounded, that is \`snbrain refine --domain … --by … --reason …\`, not a field in the artifact.)`);
        }
        if (sized.length) {
          rej.push(`areas: ${sized.slice(0, 5).map((a) => a.id).join(', ')}${sized.length > 5 ? `, … (${sized.length} in total)` : ''} carry bandARowsInDomain on a run with no --domain. Remove the field: an in-domain figure with no boundary to be in is a number nothing can check.`);
        }
      } else {
        if (typeof AInDomain !== 'number') {
          rej.push(`bands.AInDomain: required, because this run is bounded by ${describeDomain(dom)}. bands.A stays INSTANCE-WIDE — it is the denominator every downstream ratio is quoted against — and bands.AInDomain is the same Band A predicate intersected with the compiled domain query in the brief. Report both, separately, and do not scope bands.A.`);
        }
        const unsized = art.areas.filter((a) => inDomainSize(a) === null);
        if (unsized.length) {
          rej.push(`areas: ${unsized.length} of ${art.areas.length} area(s) carry no bandARowsInDomain (${unsized.slice(0, 5).map((a) => a.id).join(', ')}${unsized.length > 5 ? ', …' : ''}). Under --domain the harvest queue is handed out in IN-DOMAIN units, so an area sized only instance-wide is a work item whose size belongs to a different population. Run 6ef14f5562 briefed sys_documentation at 32,328 rows against 1,631 in-domain — a 20x error in the queue's own sizing field. Report the ZEROES too: an area with no in-domain rows is recorded out-of-boundary, not dropped.`);
        }
      }

      /*
       * PRODUCT-83. THE DATA POPULATION, ASKED FOR ONCE, HERE, AND NOWHERE ELSE IN THE RUN.
       *
       * Population named: the tables in DATA_AREAS whose reach legs this run's boundary carries.
       * A boundary with neither a `name` nor an `author` leg cannot reach a data row at all (there
       * is no scope on one), so on such a run this asks for nothing — the gap is real but it is a
       * boundary decision, not a census failure, and saying so is more useful than a rejection
       * nobody can satisfy.
       *
       * WORST CASE, stated as METHOD-4 requires: DATA_AREAS holds one entry, so this can raise at
       * most one rejection in a single artifact, and the cheapest legal way to satisfy it is one
       * count against `sys_user_group` — which is the behaviour the rule exists to buy. A measured
       * ZERO is an accepted answer and mints nothing.
       */
      {
        const reachable = dom ? dataAreasFor(dom).filter((d) => d.usable) : [];
        const declared = new Set((art.dataAreas || []).map((d) => d.table));
        const missing = reachable.filter((d) => !declared.has(d.table));
        for (const d of missing) {
          rej.push(
            `dataAreas: "${d.table}" is not accounted for. ${d.why} It is not one of this run's areas and cannot ` +
            `become one — areas are sys_metadata sys_class_name strata and count(sys_metadata, sys_class_name=${d.table}) ` +
            `is 0 — so this artifact is the only place in the run that can reach it. Count it on the legs it HAS: ` +
            `\`${d.reach.name}\` (dictionary-validate the column first; there is no sys_name here) and ` +
            `${d.reach.author.join('/')}. There is no scope leg: a data row has no scope to be in. Add ` +
            `{table:"${d.table}", rowsInDomain:<count>, query:"<the encoded query verbatim>"}. A measured ZERO is an ` +
            `accepted answer and costs nothing downstream — an unasked question costs the routing rules of the process.`);
        }
        for (const d of art.dataAreas || []) {
          if (!DATA_AREAS[d.table]) {
            rej.push(`dataAreas: "${d.table}" is not a table this product has established as configuration-in-data. The map is an allowlist on purpose — an unvalidated table name in an encoded query returns UNFILTERED rows here (PLATFORM-1), not an error. If it belongs, it is added to DATA_AREAS with a measured read behind it, not declared in an artifact.`);
            continue;
          }
          for (const problem of lintEncodedQuery(d.query)) { rej.push(`dataAreas[${d.table}].query: ${problem}`); }
          if (d.rowsInDomain > 0 && !(d.columnsValidated || []).length) {
            rej.push(`dataAreas[${d.table}]: ${d.rowsInDomain} row(s) reported and no columnsValidated. The name leg here is the table's OWN column, and an unknown column drops the clause silently and returns the whole table — so an unvalidated non-zero count is indistinguishable from a full-table sweep. Record the dictionary read.`);
          }
        }
      }

      /*
       * PRODUCT-12, over whichever population this run is actually queued in. An area list that
       * does not account for it is not a queue, it is a sample: rows falling between two areas
       * are harvested by neither and nothing downstream can tell "not there" from "never looked".
       * The residual does not have to be zero — a deliberately deferred slice is a legitimate
       * choice — but it has to be STATED, because an unstated residual is indistinguishable from
       * full coverage in every number the run reports afterwards.
       */
      const population = dom ? 'IN-DOMAIN Band A (bands.AInDomain)' : 'INSTANCE-WIDE Band A (bands.A)';
      const reconcileTotal = dom ? AInDomain : A;
      const areaRows = art.areas.reduce((n, a) => n + ((dom ? inDomainSize(a) : a.bandARows) || 0), 0);
      const residual = typeof reconcileTotal === 'number' ? reconcileTotal - areaRows : null;
      if (residual !== null && reconcileTotal > 0 && residual > 0 && residual > reconcileTotal * 0.05) {
        const declared = art.areas.some((a) => /residual|remainder|deferred|not harvested|excluded/i.test(a.why || ''));
        if (!declared) {
          rej.push(`areas: ${population} holds ${reconcileTotal} record(s) and the declared areas account for ${areaRows}, leaving ${residual} (${((residual / reconcileTotal) * 100).toFixed(1)}%) in no area at all. Those rows will be harvested by nobody, and afterwards nothing can distinguish "not there" from "never looked". Either extend the areas to cover them, or declare the remainder explicitly in an area's \`why\` — a deferred slice is a legitimate choice, an unstated one is not.`);
        }
      }
      if (residual !== null && residual < 0 && reconcileTotal > 0) {
        rej.push(`areas: the declared areas claim ${areaRows} ${population} row(s) against a total of ${reconcileTotal}. Areas overlap, or one of the two counts is not measuring what you think it is — and an overlap means the same record is harvested twice and counted twice in every ratio downstream.`);
      }

      if (dom && typeof AInDomain === 'number') {
        /*
         * THE ANTI-CIRCULARITY GUARD, and it is the only one. `bands.A === bands.AInDomain`
         * under a predicate that is not a bare wildcard means the agent attached the domain
         * clauses to the denominator, and every ratio computed from it afterwards — aShare,
         * coverage, per-leg yield — reads 100% by construction. This is what protects the
         * doctrine in `procedure()` from being satisfied in prose and broken in arithmetic.
         */
        if (A > 0 && A === AInDomain && domainIsNonTrivial(dom)) {
          rej.push(`bands: A and AInDomain are both ${A} under the boundary ${describeDomain(dom)}. Two populations a non-trivial predicate separates cannot be the same number: either bands.A was measured WITH the domain clauses attached — scoping the denominator to the numerator, which makes aShare, coverage and every per-leg ratio 100% by construction — or bands.AInDomain was copied from it. Re-measure bands.A with NO domain clause anywhere in the query.`);
        }
        if (AInDomain > A) {
          rej.push(`bands: AInDomain (${AInDomain}) exceeds A (${A}). The in-domain population is a SUBSET of the instance-wide one; these two counts cannot both be measuring what you think they are.`);
        }
        /*
         * THE REFERENCE-OPERAND GUARD — the arithmetic defence against PLATFORM-28 landing
         * after this entry instead of before it. A hand-encoded `sys_scope=<name>` matches zero
         * rows and errors nowhere, so without this the run reports "nothing in this domain" as
         * a clean, well-formed, terminal result. Sanctioned exits, both attributed and neither
         * a hand edit: re-aim the boundary with `snbrain refine`, or — if empty IS the measured
         * truth — say so in a finding, exactly as PRODUCT-9 requires of a zero-row harvest.
         */
        const sumInDomain = art.areas.reduce((n, a) => n + (inDomainSize(a) || 0), 0);
        const declaredEmpty = (art.findings || []).some((f) => f.check === 'census-domain-empty' && f.severity === 'blocking');
        if (A > 0 && sumInDomain === 0 && domainIsNonTrivial(dom) && !declaredEmpty) {
          rej.push(`areas: every area reports bandARowsInDomain = 0 while INSTANCE-WIDE Band A holds ${A} record(s) under the boundary ${describeDomain(dom)}. A boundary that admits nothing is far more often a query that matched nothing and said so quietly than an empty domain. Check the REFERENCE-OPERAND trap first: sys_scope is a reference field, so \`sys_scope=<name>\` matches zero rows and \`sys_scope.scope=<name>\` is the clause that works; a trailing \`*\` compiles to STARTSWITH, never LIKE. Use the compiled fragments in the brief verbatim instead of composing a clause. If the boundary is genuinely wrong, the operator re-aims it with \`snbrain refine --domain … --by … --reason …\`; if empty is the measured truth, raise a BLOCKING finding with check "census-domain-empty" — this run may not report an empty domain as a clean result.`);
        }
      }

      if (art.authorship.distribution.reduce((s, d) => s + d.count, 0) > art.authorship.totalMetadataRows * 1.05) {
        rej.push('authorship: the distribution sums to more than totalMetadataRows. One of the two numbers is not what you think it is.');
      }
      return rej;
    },
    apply: (ctx, art) => {
      const { A, B, C } = art.bands;
      const total = A + B + C;
      const aShare = pct(A, total);
      const g = art.discriminationGate;

      // The four-part gate, decided HERE from the model's own measured numbers.
      const gate = { aShare, checks: {}, verdict: 'pass' };
      gate.checks.bandANonEmpty = A > 0;
      gate.checks.shareUnderCeiling = aShare <= 0.35;
      gate.checks.authorDiscriminates = !(g.topBandAAuthor.account === g.topBandCAuthor.account && g.topBandAAuthor.share > 0.80 && g.topBandCAuthor.share > 0.80);
      gate.checks.deliberate = g.defaultSetShare <= 0.50;

      if (!gate.checks.bandANonEmpty) { gate.verdict = 'inventory-only'; }
      else if (!gate.checks.shareUnderCeiling || !gate.checks.authorDiscriminates) { gate.verdict = 'filter-non-discriminating'; }
      else if (!gate.checks.deliberate) { gate.verdict = 'authored-but-undeliberate'; }

      const findings = (art.findings || []).slice();
      if (gate.verdict !== 'pass') {
        findings.push({
          check: `scope-filter-${gate.verdict}`, severity: 'blocking', rung: 'L1',
          message: gate.verdict === 'inventory-only'
            ? 'No customer-authored surface found. The run may inventory this instance but may not raise a single question about it.'
            : gate.verdict === 'filter-non-discriminating'
              ? `Could not separate customer work from ServiceNow's: Band A share ${(aShare * 100).toFixed(1)}%, top A author "${g.topBandAAuthor.account}" (${g.topBandAAuthor.share}) vs top C author "${g.topBandCAuthor.account}" (${g.topBandCAuthor.share}).`
              : `${(g.defaultSetShare * 100).toFixed(1)}% of authored change shipped through the Default update set. We can see WHAT was built; we cannot see what was DECIDED. Band A membership is not evidence that a decision was taken.`,
        });
      }
      /*
       * THE QUEUE IS CAST IN THE UNITS THE RUN IS BOUNDED BY — PRODUCT-29.
       *
       * `validate()` REJECTS and `apply()` FILTERS, and the first proposal had these the wrong
       * way round. Dropping an out-of-boundary area in `validate()` is a REJECTION, so taken
       * literally it refuses every domain-scoped census artifact; and destroying the per-area
       * detail leaves the coverage number and the reasoned-zero rule with nothing to check.
       * So `harvestAreaDetail` keeps EVERY area the census emitted, at both sizes; only the
       * work list is filtered, and the excluded areas are carried forward as OBJECTS with
       * their instance-wide sizes intact — recorded, counted by coverage, never handed out.
       *
       * REPLAY SAFETY: an area with no `bandARowsInDomain` is UNMEASURED, not empty, and is
       * queued exactly as it was before this fix. A brain written under the old schema replays
       * as an instance-wide run. Only an explicit 0 excludes an area.
       */
      const dom = runDomain(ctx);
      const queued = [];
      const outOfBoundary = [];
      for (const a of art.areas) {
        const size = inDomainSize(a);
        if (dom && size !== null && size <= 0) { outOfBoundary.push(a); } else { queued.push(a); }
      }
      const stamps = {
        scopeFilter: gate.verdict,
        authorship: gate.checks.authorDiscriminates ? (ctx.state.stamps.customerUpdateAvailable ? 'full' : 'package-level-only') : 'time-only',
        // AW gates that need a corpus this instance does not have are stamped, so the
        // per-gate kill distribution can report them as ZERO rather than absent.
        // Both computed above, and both now name the population they describe rather than
        // collapsing "we asked and there is nothing" into "nobody was asked".
        'gates.AW-2a': corpusGateStamp(ctx),
        'gates.AW-3.governed': governedGateStamp(ctx),
      };
      return {
        facts: { census: { installFloor: art.installFloor, bands: art.bands, total, aShare, authorship: art.authorship, discriminationGate: Object.assign({}, g, gate) } },
        stamps,
        findings,
        /*
         * PRODUCT-83. Data areas join the WORK queue and stay out of the ARITHMETIC. They are
         * appended after the Band A areas — not interleaved by size — because their unit is a
         * different population and a queue sorted across two units is sorted by nothing. A data
         * area measured at zero rows is dropped exactly as a Band A area at zero rows is: the
         * measurement is the deliverable, the empty work item is not.
         */
        queue: {
          harvestAreas: queued.map((a) => a.id).concat((art.dataAreas || []).filter((d) => d.rowsInDomain > 0).map((d) => DATA_AREAS[d.table].id)),
          harvestAreaDetail: art.areas.concat((art.dataAreas || []).filter((d) => d.rowsInDomain > 0).map((d) => ({
            id: DATA_AREAS[d.table].id, tables: DATA_AREAS[d.table].tables.slice(), population: 'data',
            rowsInDomain: d.rowsInDomain, query: d.query, why: DATA_AREAS[d.table].why,
          }))),
          harvestAreasOutOfBoundary: outOfBoundary,
          harvestDone: [],
          processCandidates: art.processCandidates || [],
          namedProcesses: [],
        },
        raw: (art.packages || []).map((p) => Object.assign({ kind: 'package' }, p))
          .concat(art.authorship.distribution.map((d) => Object.assign({ kind: 'author' }, d))),
        progress: true,
      };
    },
    next: () => 'provenance',
  },

  // =========================================================================
  {
    id: 'provenance',
    title: 'Provenance — which ladder rungs exist on THIS instance',
    stagnation: 'none',
    goal: () =>
      'Establish which of the ten provenance rungs P1-P10 this instance actually carries, because ' +
      'the envelope decides whether a question can be asked in CLOSED form (two named branches, ' +
      'answerable in twenty seconds) or only in OPEN form ("why does this exist"), which the field ' +
      'evidence says humans do not answer. This is not a phase, it is a precondition.',
    reads: () => [
      { path: 'docs/rework-plan.md#892-947', why: 'The ten rungs, what each yields, which are clone-resilient, and the degradation table that maps rung availability to an envelope stamp.', required: true },
      { path: '.claude/skills/snbrain-provenance/SKILL.md', why: 'Engagement procedure, if the repo has one.', required: false },
    ],
    procedure: (ctx) => [
      'Probe each rung with ONE cheap read and record availability with evidence. Absence must be proven, not assumed — see the empty-read rule.',
      'P1 sys_update_set, P2 sys_update_xml, P3 story ids embedded in live artifact name/description, P4 sys_update_version, P5 sys_metadata columns, P6 RETIRED, P7 sys_metadata_delete, P8 script comments, P9 sys_audit, P10 on-platform tracking records.',
      'P6 IS RETIRED AND YOU RECORD IT available:false WITH THAT REASON. It named `sys_customer_update` as a record-level source independent of update sets. No such table or column exists on any release: that string is the LABEL of `sys_update_xml` ("Customer Update"), so P6 was P2 duplicated under an alias, and its "independent of update sets" claim was inverted. Do not spend a read re-probing it.',
      /*
       * PRODUCT-5. This used to cite "probe 11" by NUMBER, and probe numbering is not stable —
       * on the reference run probe 11 was the F9 publisher-collision check, so the brief sent
       * the agent to read a result about something else entirely. Cite probes by WHAT THEY
       * MEASURE and let the agent find the matching entry; a number is an index into a file
       * that changes, and a description is not.
       */
      'The rung P6 was reaching for is real and lives in P2: update-set membership, joined on `sys_metadata.sys_update_name` = `sys_update_xml.name`. Whether it DISCRIMINATES is measured by the preflight probe that resolves update-set entries back to their targets and compares the covered set customer share against the instance-wide share — find it in results.json by that description, NOT by probe number, because the numbering is not stable across probe-suite revisions. Read its result rather than re-deriving it; if no probe measured that, say so instead of assuming the rung discriminates.',
      'Induce the story-id pattern rather than hardcoding one: cluster update-set names (or artifact names if P1 is gone) and extract the most frequent ^([A-Z]{2,6}\\d{5,8}) shape with support >= 0.7 over >= 8 rows. Use it for PARSING only, never as a question source.',
      'Do not stamp the envelope yourself. Report rung availability; the CLI derives the stamp from the degradation table and will reject a stamp that does not follow.',
    ],
    schema: {
      type: 'object',
      required: ['rungs'],
      forbidden: ['envelope'],
      props: {
        rungs: {
          type: 'array', min: 5,
          items: { type: 'object', required: ['rung', 'available', 'evidence'], props: { rung: { type: 'string', enum: ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8', 'P9', 'P10'] }, available: { type: 'boolean' }, evidence: { type: 'string', minLength: 5 }, rows: { type: 'number', optional: true, min: 0 } } },
        },
        storyPattern: { type: 'object', optional: true, required: ['regex', 'support', 'rows'], props: { regex: { type: 'string' }, support: { type: 'number', min: 0, max: 1 }, rows: { type: 'number', min: 0 } } },
        findings: { type: 'array', optional: true, items: FINDING_SCHEMA },
      },
    },
    example: (ctx) => ({
      stage: 'provenance', instance: ctx.state.instance,
      usage: { apiCalls: 15, requestLog: '<sync-root>/spikes/scriptsync-read/snbrain-requests.ndjson' },
      /*
       * ALL TEN RUNGS, because AC-PROV-1 asks for all ten and the schema demands at least
       * five. An example that its own stage would reject is worse than no example: it is
       * what a fresh subagent copies, so it costs a real iteration against a live instance
       * to discover. tools/snbrain/selftest.js enforces example-satisfies-own-schema now.
       */
      rungs: [
        { rung: 'P1', available: true, evidence: '41 completed named sys_update_set rows since install floor', rows: 41 },
        { rung: 'P2', available: true, evidence: '6,214 sys_update_xml rows carry a non-empty name; probe 11 resolved 290 of 300 sampled entries back to their targets', rows: 6214 },
        { rung: 'P3', available: true, evidence: '33 live artifact names carry a story id matching the induced pattern', rows: 33 },
        { rung: 'P4', available: true, evidence: 'sys_update_version reachable; 12,880 rows, 2,104 of them post-floor', rows: 12880 },
        { rung: 'P5', available: true, evidence: 'sys_metadata carries sys_created_by, sys_updated_by, sys_mod_count and sys_update_name on this release' },
        { rung: 'P6', available: false, evidence: 'RETIRED: sys_customer_update is neither a table nor a column on any release (dictionary read, 0 rows for element=sys_customer_update; sys_db_object, no such table). It is the label of sys_update_xml, so P6 was P2 under an alias. The real rung is P2 update-set membership.' },
        { rung: 'P7', available: true, evidence: 'sys_metadata_delete reachable, 431 rows. NOTE: it keys the deleted table in sys_db_object, not sys_class_name.', rows: 431 },
        { rung: 'P8', available: true, evidence: 'script comments present; sampled 40 sys_script bodies, 11 carry a leading comment block' },
        { rung: 'P9', available: false, evidence: 'sys_audit is present but carries no rows for the metadata tables in scope — a canary read returned rows in the same session, so this is a measured absence and not a broken read.', rows: 0 },
        { rung: 'P10', available: false, evidence: 'no on-platform tracking table found: rm_story, rm_epic and sn_devops_* all absent from sys_db_object.' },
      ],
      storyPattern: { regex: '^(STRY\\d{7})(\\.\\d{2})?', support: 0.82, rows: 33 },
      acceptance: [{ id: 'AC-PROV-1', result: 'pass', evidence: 'all ten rungs probed; each availability carries a citable read' }],
    }),
    acceptance: [
      { id: 'AC-PROV-1', statement: 'Every rung P1-P10 was probed and its availability carries a citable read, including the unavailable ones.', howToEvidence: 'the evidence string per rung.' },
      { id: 'AC-PROV-2', statement: 'No rung was recorded unavailable on the strength of an empty read alone.', howToEvidence: 'a dictionary/metadata check or a canary in the same session.' },
      { id: 'AC-PROV-3', statement: 'The story-id pattern was INDUCED from this instance, not assumed from another engagement.', howToEvidence: 'support and row count, or an explicit "no pattern reaches support".' },
    ],
    validate: (ctx, art) => {
      const rej = [];
      const seen = new Set(art.rungs.map((r) => r.rung));
      const missing = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7'].filter((r) => !seen.has(r));
      if (missing.length) { rej.push(`rungs: ${missing.join(', ')} not reported. Report every rung including the unavailable ones — an unreported rung is indistinguishable from an unprobed one.`); }
      if (art.storyPattern && art.storyPattern.support < 0.7) {
        rej.push(`storyPattern: support ${art.storyPattern.support} is below 0.7. Below that threshold the pattern is not induced, it is guessed. Omit storyPattern instead.`);
      }
      return rej;
    },
    apply: (ctx, art) => {
      const has = {};
      for (const r of art.rungs) { has[r.rung] = !!r.available; }
      // The degradation table (4.11.3), applied by the CLI.
      let envelope = 'full';
      if (!has.P1 && !has.P2 && !has.P4) { envelope = 'columns-only'; }
      else if (!has.P1 && !has.P2) { envelope = 'metadata-only'; }
      else if (!has.P4) { envelope = 'current-state-only'; }
      const signalsLost = [];
      if (!has.P1 || !has.P2) { signalsLost.push('QS-04', 'QS-11'); }
      if (!has.P4) { signalsLost.push('delta-gated signals'); }
      return {
        facts: { provenance: { rungs: art.rungs, storyPattern: art.storyPattern || null, envelope, signalsLost } },
        stamps: { provenance: envelope, storyPattern: (art.storyPattern && art.storyPattern.regex) || null },
        findings: (art.findings || []).concat(
          envelope === 'columns-only' && ctx.state.stamps.scopeFilter === 'authored-but-undeliberate'
            ? [{ check: 'provenance-plus-undeliberate', severity: 'blocking', rung: 'L1', message: 'metadata-only provenance AND authored-but-undeliberate together is a STOP, not a degrade: there is nothing here that evidences a decision was ever taken.' }]
            : []),
        raw: art.rungs.map((r) => Object.assign({ kind: 'rung' }, r)),
        progress: true,
      };
    },
    /*
     * A seeded run routes to the ANCHOR, whose expansion needs the rungs this stage just
     * probed (P2 membership, P4 version chains). An unseeded or blind run has no seed to
     * expand and routes straight to harvest on the census's queue — the anchor is skipped
     * and recorded skipped, exactly as the census is on the seeded path.
     */
    next: (ctx) => (String(ctx.state.stamps.inputEnvelope || '').indexOf('sets') === 0 ? 'anchor' : 'harvest'),
  },

  // =========================================================================
  /*
   * ANCHOR — co-change expansion, the seeded product's replacement for the census.
   *
   * THE INSIGHT THIS STAGE IS BUILT ON: an artifact's version chain (sys_update_version, P4)
   * recovers every update set it ever shipped in, and each set's membership (sys_update_xml,
   * P2) yields sibling artifacts. Artifacts that repeatedly co-ship are co-changed, and
   * co-change is process-membership evidence — git co-change mining, on-platform. This makes
   * a SINGLE honest set self-amplifying: a 3-artifact hotfix set fans out through version
   * chains to the process's whole shipping history, which is why one set is a sufficient
   * hard requirement and the docs and the epic never need to be gated on.
   *
   * TIERS: T1 = the human named it; T2 = co-change admitted it, with the citable edge (which
   * sets, what weight). There is no T3 here BY DESIGN: the referenced-but-never-shipped
   * surface (shared script includes, global BRs) is exactly what the existing chain-repair
   * leg mints from dangling references when the harvest queue drains — the machinery already
   * exists, is bounded, and starts from evidence rather than prediction. Emitting a T3 here
   * would read record bodies at anchor time, which is harvest's job and harvest's budget.
   */
  {
    id: 'anchor',
    title: 'Anchor — co-change expansion from the seed to a tiered process surface',
    stagnation: 'none',
    boundaryCast: {
      why: 'the harvest queue is cast from the seeded surface; a re-aimed seed re-derives the tiers and the queue with it.',
      queue: ['harvestAreas', 'harvestAreaDetail', 'processCandidates'],
      facts: ['anchor'],
    },
    goal: (ctx) => {
      const seed = (ctx.state.facts.seed || {});
      const name = (seed.process && seed.process.name) || ctx.state.stamps.processName || '(unnamed process)';
      const counts = seed.pointerCounts || {};
      return `Expand the seed for "${name}" into a bounded, tiered process surface. ` +
        `The developer provided ${counts['update-set'] || 0} update-set pointer(s) and ${Object.keys(counts).length} pointer kind(s) in total ` +
        `(input envelope: ${ctx.state.stamps.inputEnvelope || 'sets-only'}). ` +
        'FIRST ACT, two reads: resolve each seeded set by name against sys_update_set and count its sys_update_xml members. ' +
        'A pointer that resolves to nothing or to an empty set is a STOP-AND-ASK at minute one — report it and let the human re-aim, ' +
        'do not fall through to a blind sweep. Then expand: version chains (P4) recover every set the seeded artifacts ever shipped in, ' +
        'set membership (P2) yields the siblings, ONE round, weighted, batch sets excluded and listed. ' +
        'Every T2 member carries the edge that admitted it. The surface you emit IS the harvest queue — nothing else gates it.';
    },
    reads: () => [
      { path: 'docs/design.md', why: 'The ANCHOR contract: the two axes, one-round expansion, tier evidence, adequacy verdicts and degradation rules.', required: true },
      { path: 'tools/snbrain/lib/api.js', why: 'restTable() and groupCount() — membership counts are aggregates, not row transfers.', required: true },
      { path: '.claude/skills/snbrain-anchor/SKILL.md', why: 'Engagement procedure, if the repo has one.', required: false },
    ],
    procedure: (ctx) => [
      'RESOLVE FIRST, EXPAND SECOND. For each seeded update-set pointer: one read against sys_update_set (name match, then fuzzy STARTSWITH if exact fails), one aggregate count of its sys_update_xml members. Record every attempt in resolution[], including the failures — an unresolvable pointer is a finding, never a silent drop.',
      'IF NO SEEDED SET RESOLVES TO A NON-EMPTY SET, STOP. Ingest with resolutionFailed:true, the failed resolutions as evidence, and one BLOCKING finding saying what was tried. The CLI terminates the run for a human to re-aim — that is the stop-and-ask, it costs two reads per pointer, and it is the entire reason resolution lives here and not at seed.',
      'AXIS 1 — VERSION CHAINS (P4, if provenance found it): for the artifacts in the seeded sets, read sys_update_version to recover every OTHER set those artifacts ever shipped in. This is what makes one honest set sufficient: the chain fans out to the shipping history. Record each recovered set with via:"version-chain" AND seededOverlap: how many DISTINCT seeded artifacts appear in it. A chain reaches a set through one shared form section as easily as through the whole process; the CLI keeps a recovered set only when overlap/members >= ' + ANCHOR_MIN_OVERLAP_RATIO + ' or its story root (the induced pattern on its name) matches a seeded set, and turns every other set\'s T2-only members into neighbour gaps — so count the overlap honestly, do not pad it, and put the set\'s story id in `story` when you can read one.',
      'AXIS 2 — MEMBERSHIP (P2): for each set (seeded and recovered), resolve sys_update_xml entries back to their target records (the preflight probe that measured this resolution rate tells you whether the name-parse route works on this instance — read its result, do not re-derive it). Each target is a T2 candidate carrying the sets that admitted it.',
      'ONE ROUND, EXACTLY. Iterate axis 1 then axis 2 ONCE and stop — a fixpoint snowballs into the full instance. Record expansion.rounds; the validator holds you to it.',
      'WEIGHT AND EXCLUDE — RECOVERED SETS ONLY. Weight each admission 1/|set| — a 9-artifact story set is signal, a 400-item sprint batch is noise. EXCLUDE the Default set and RECOVERED batch sets outright (a recovered set is a batch when its member count is an order of magnitude above the seeded sets\' median, or the human named it as a batch at seed); list every exclusion with its member count in sets[] role:"excluded" — a silent exclusion reads as coverage. A SEEDED SET IS NEVER SIZE-EXCLUDED: the human pointed at it, so it stays role:"seeded" whatever its size — its 1/|set| weight already says the per-member signal is weak, and the CLI mints a warning for a large one. The validator refuses a seeded pointer\'s set in role "excluded".',
      'THE STORY CHAIN (only when the input envelope carries stories AND provenance induced a naming pattern): epic/story ids -> sets whose names match the pattern -> feed into axis 2. If the pattern was not induced, say so in a finding and move on — the epic degrades to context, which was always its fallback role.',
      'EMIT THE SURFACE with one entry per (table, sysId): tier T1 when the human named the artifact or its set at seed, T2 when co-change admitted it, each with the citable edge (evidence.sets, evidence.weight). Deduplicate — a record admitted twice keeps its strongest evidence.',
      'THE SEED-GAP IS THE QUESTION GENERATOR: T2 members whose set the developer did NOT name, and named pointers that resolved to nothing, go into seedGaps[] — they become the interview\'s sharpest questions ("this shipped with your process and you didn\'t mention it — same process, or a neighbour?").',
      'JUDGE ADEQUACY, and it is a measurement, not a mood: converged (a coherent T2 cluster around the seed), barren (the seed expands to nothing beyond itself — probably a partial slice), exploded (co-change pulled in a surface an order of magnitude beyond the seed even after exclusions — the sets were batches). Barren and exploded are legal results that mint findings and interview questions, never silent retries.',
      'DEGRADATION IS STAMPED, NEVER SILENT: no P4 means axis 1 is lost (expand from seeded sets only); no P2 either means co-change is unavailable and the run\'s answer to "what belongs to this process" is weaker — the CLI stamps it and the render must carry it.',
    ],
    schema: {
      type: 'object',
      required: ['resolution', 'sets', 'expansion', 'surface', 'adequacy'],
      forbidden: ['envelope', 'tiers'],
      props: {
        resolutionFailed: { type: 'boolean', optional: true },
        resolution: {
          type: 'array', min: 1,
          items: {
            type: 'object',
            required: ['pointer', 'kind', 'resolved'],
            props: {
              pointer: { type: 'string', minLength: 2 },
              kind: { type: 'string', enum: ['update-set', 'artifact', 'table', 'story', 'epic', 'document'] },
              resolved: { type: 'boolean' },
              sysId: { type: 'string', optional: true, minLength: 4 },
              evidence: { type: 'string', optional: true, minLength: 5 },
              note: { type: 'string', optional: true },
            },
          },
        },
        sets: {
          type: 'array', min: 0,
          items: {
            type: 'object',
            required: ['sysId', 'name', 'members', 'role'],
            props: {
              sysId: { type: 'string', minLength: 4 },
              name: { type: 'string', minLength: 1 },
              members: { type: 'number', min: 0 },
              role: { type: 'string', enum: ['seeded', 'recovered', 'excluded'] },
              /*
               * RUN pilot-run-6 (2026-08-28): version chains of SHARED artifacts — the H&S incident
               * form sections, UX lists, ACL roles — fanned out into neighbouring processes
               * ("Form + columns design H&S forms", "usability test feedback", "NTA-norm arbo")
               * and 150 T2 records arrived that were the H&S MODEL, not the VendorX INTEGRATION.
               * `seededOverlap` is how many of the SEEDED sets' artifacts also appear in this
               * recovered set; the CLI demotes a recovered set below ANCHOR_MIN_OVERLAP and turns
               * its T2-only members into neighbour gaps instead of harvest work.
               */
              seededOverlap: { type: 'number', optional: true, min: 0 },
              excludedReason: { type: 'string', optional: true, minLength: 5 },
              isDefault: { type: 'boolean', optional: true },
              story: { type: 'string', optional: true },
              via: { type: 'string', optional: true, enum: ['pointer', 'version-chain', 'story-pattern'] },
            },
          },
        },
        expansion: {
          type: 'object',
          required: ['rounds', 'viaP2', 'viaP4'],
          props: {
            rounds: { type: 'number', min: 0, max: 1 },
            viaP2: { type: 'boolean' },
            viaP4: { type: 'boolean' },
            storyChain: { type: 'boolean', optional: true },
          },
        },
        surface: {
          type: 'array', min: 0,
          items: {
            type: 'object',
            required: ['table', 'sysId', 'name', 'tier', 'evidence'],
            forbidden: ['id'],
            props: {
              table: { type: 'string', minLength: 2 },
              sysId: { type: 'string', minLength: 4 },
              name: { type: 'string', minLength: 1 },
              tier: { type: 'string', enum: ['T1', 'T2'] },
              evidence: {
                type: 'object',
                required: ['kind'],
                props: {
                  kind: { type: 'string', enum: ['named', 'co-shipped'] },
                  sets: { type: 'array', optional: true, items: { type: 'string' } },
                  weight: { type: 'number', optional: true, min: 0, max: 1 },
                  query: { type: 'string', optional: true },
                },
              },
            },
          },
        },
        adequacy: {
          type: 'object',
          required: ['verdict', 'why'],
          props: {
            verdict: { type: 'string', enum: ['converged', 'barren', 'exploded'] },
            why: { type: 'string', minLength: 10 },
          },
        },
        seedGaps: {
          type: 'array', optional: true,
          items: {
            type: 'object',
            required: ['table', 'sysId', 'name'],
            props: {
              table: { type: 'string', minLength: 2 },
              sysId: { type: 'string', minLength: 4 },
              name: { type: 'string', minLength: 1 },
              sets: { type: 'array', optional: true, items: { type: 'string' } },
              why: { type: 'string', optional: true },
            },
          },
        },
        findings: { type: 'array', optional: true, items: FINDING_SCHEMA },
      },
    },
    example: (ctx) => ({
      stage: 'anchor', instance: ctx.state.instance,
      usage: { apiCalls: 22, requestLog: '<sync-root>/spikes/scriptsync-read/snbrain-requests.ndjson' },
      resolution: [
        { pointer: 'STRY0185005 ACME cancel flow', kind: 'update-set', resolved: true, sysId: 'fb060e8e1b2a43909e2aa934604bcbaa', evidence: 'exact name match on sys_update_set; 34 sys_update_xml members' },
        { pointer: 'STRY0185005.02 cancel flow fixes', kind: 'update-set', resolved: true, sysId: 'fb060e8e1b2a43909e2aa934604bcbbb', evidence: 'exact name match; 6 members' },
        { pointer: 'AzDO epic 1243200 — Cancellation rework', kind: 'epic', resolved: true, evidence: 'child story STRY0185005 matches the induced pattern; chained to the two sets above' },
        { pointer: 'ACME cancellation way-of-working', kind: 'document', resolved: false, note: 'a document has no sys_id to resolve; it is the claimed process, recorded for the questions stage' },
      ],
      sets: [
        { sysId: 'fb060e8e1b2a43909e2aa934604bcbaa', name: 'STRY0185005 ACME cancel flow', members: 34, role: 'seeded', via: 'pointer', story: 'STRY0185005' },
        { sysId: 'fb060e8e1b2a43909e2aa934604bcbbb', name: 'STRY0185005.02 cancel flow fixes', members: 6, role: 'seeded', via: 'pointer', story: 'STRY0185005' },
        // Strong on RATIO: 7 of its 12 members are seeded artifacts.
        { sysId: 'fb060e8e1b2a43909e2aa934604bcbcc', name: 'STRY0100014 case intake rework', members: 12, role: 'recovered', via: 'version-chain', story: 'STRY0100014', seededOverlap: 7 },
        // Strong on STORY ROOT: the .03 sub-set of the seeded STRY0185005, one member, overlap 1.
        { sysId: 'fb060e8e1b2a43909e2aa934604bcbff', name: 'STRY0185005.03 move cancel util to global', members: 1, role: 'recovered', via: 'version-chain', story: 'STRY0185005', seededOverlap: 1 },
        // Demoted: a neighbour reached through one shared form section (1 of 13).
        { sysId: 'fb060e8e1b2a43909e2aa934604bcbee', name: 'STRY0100003.01 Form + columns design H&S forms', members: 13, role: 'recovered', via: 'version-chain', story: 'STRY0100003', seededOverlap: 1 },
        { sysId: 'fb060e8e1b2a43909e2aa934604bcbdd', name: 'ACME Sprint 12 batch', members: 412, role: 'excluded', excludedReason: 'batch set: 412 members against a seeded median of 20, and the developer excluded it by name at seed' },
      ],
      expansion: { rounds: 1, viaP2: true, viaP4: true, storyChain: true },
      surface: [
        { table: 'sys_script', sysId: '9ec847db1b8a43909e2aa934604bcb42', name: 'ACME Cancel Guard', tier: 'T1', evidence: { kind: 'named', sets: ['fb060e8e1b2a43909e2aa934604bcbaa'] } },
        { table: 'sys_ui_action', sysId: '9ec847db1b8a43909e2aa934604bcb43', name: 'Cancel Case', tier: 'T1', evidence: { kind: 'named', sets: ['fb060e8e1b2a43909e2aa934604bcbaa'] } },
        { table: 'sysevent_email_action', sysId: '9ec847db1b8a43909e2aa934604bcb44', name: 'Case cancelled notification', tier: 'T2', evidence: { kind: 'co-shipped', sets: ['fb060e8e1b2a43909e2aa934604bcbaa', 'fb060e8e1b2a43909e2aa934604bcbbb'], weight: 0.196 } },
        { table: 'sys_script_include', sysId: '9ec847db1b8a43909e2aa934604bcb45', name: 'ACMECancelUtil', tier: 'T2', evidence: { kind: 'co-shipped', sets: ['fb060e8e1b2a43909e2aa934604bcbcc'], weight: 0.083 } },
        // Admitted ONLY through the overlap-1 set above: the CLI demotes it to a neighbour gap.
        { table: 'sys_ui_section', sysId: '9ec847db1b8a43909e2aa934604bcb46', name: 'Health and Safety incident', tier: 'T2', evidence: { kind: 'co-shipped', sets: ['fb060e8e1b2a43909e2aa934604bcbee'], weight: 0.077 } },
      ],
      adequacy: { verdict: 'converged', why: '46 of 52 admitted records cluster on 4 tables around the seeded sets; one recovered set, one excluded batch' },
      seedGaps: [
        { table: 'sys_script_include', sysId: '9ec847db1b8a43909e2aa934604bcb45', name: 'ACMECancelUtil', sets: ['STRY0100014 case intake rework'], why: 'shipped with the process through a set the developer did not name' },
      ],
      acceptance: [
        { id: 'AC-ANC-1', result: 'pass', evidence: 'every T2 entry carries evidence.sets and a weight; every T1 entry carries the naming route' },
        { id: 'AC-ANC-2', result: 'pass', evidence: 'expansion.rounds = 1, recorded' },
        { id: 'AC-ANC-3', result: 'pass', evidence: 'one batch set excluded, listed with its 412-member count and the reason' },
      ],
    }),
    acceptance: [
      { id: 'AC-ANC-1', statement: 'Every surface member carries a citable edge: T2 the sets and weight that admitted it, T1 the naming route. No artifact enters the surface on vibes.', howToEvidence: 'surface[].evidence per entry.' },
      { id: 'AC-ANC-2', statement: 'Expansion ran exactly one round, and the round count is recorded.', howToEvidence: 'expansion.rounds; the validator refuses a second round — a fixpoint snowballs into the full instance.' },
      { id: 'AC-ANC-3', statement: 'Excluded sets are listed with member counts — silent truncation reads as coverage.', howToEvidence: 'sets[] role:"excluded" with excludedReason and members.' },
    ],
    validate: (ctx, art) => {
      const rej = [];
      if (art.usage && typeof art.usage.apiCalls === 'number' && art.usage.apiCalls === 0) {
        rej.push('usage.apiCalls is 0. Anchor resolves and expands against the live instance; an anchor with no reads is a simulation of one, and every edge it emits is unfalsifiable. If the transport was dead, that is a blocking finding, not a zero.');
      }
      const seededOk = (art.sets || []).some((s) => s.role === 'seeded' && s.members > 0);
      if (art.resolutionFailed === true) {
        if (seededOk) { rej.push('resolutionFailed:true, but sets[] carries a seeded set with members > 0. One of the two is untrue.'); }
        if ((art.surface || []).length) { rej.push('resolutionFailed:true with a non-empty surface. A run whose seed did not resolve has nothing to expand; emit the failed resolutions and the blocking finding, nothing else.'); }
        if (!(art.findings || []).some((f) => f.severity === 'blocking')) {
          rej.push('resolutionFailed:true with no blocking finding. The stop-and-ask has to be visible to the human who will re-aim the seed: raise one finding naming every pointer tried and what each read returned.');
        }
        return rej;
      }
      if (!seededOk) {
        rej.push('sets: no seeded set with members > 0. That is the ONE hard gate of the seeded product, checked here where it costs two reads. If every seeded pointer failed to resolve or resolved empty, say so honestly with resolutionFailed:true, the failed resolutions as evidence, and a blocking finding — the run stops for a human to re-aim, it does not fall through to a blind sweep.');
      }
      if (art.expansion.viaP2 && art.expansion.rounds !== 1) {
        rej.push(`expansion.rounds is ${art.expansion.rounds} with viaP2 available. One round exactly: zero is an expansion that never ran, and a second round is the fixpoint that snowballs into the full instance. If P2 is unavailable, viaP2:false and rounds:0 is the degraded truth.`);
      }
      if (!art.expansion.viaP2 && art.expansion.rounds !== 0) {
        rej.push('expansion.rounds > 0 with viaP2:false. Co-change expansion IS the P2 read; rounds without it are rounds of something else.');
      }
      /*
       * D5(b) (2026-09-02) — A SEEDED SET IS NEVER SIZE-EXCLUDED. The second engagement's worker
       * read "an order of magnitude above the seeded median" and applied it to a 95-member set
       * the developer had named; the developer then confirmed the set was required for
       * completeness. Size is a warning for RECOVERED sets, where it stops the chain expanding
       * into unrelated work; a human's pointer is scope by definition. Population: every sets[]
       * entry in role "excluded" that is a seeded pointer — via "pointer", or its sys_id / name
       * matches a resolved update-set pointer. The human's OWN exclusion (seed exclusions[]) is
       * the one legal way a named set leaves the surface, and it is named as such.
       */
      const resolvedSets = (art.resolution || []).filter((r) => r.kind === 'update-set' && r.resolved);
      const seededIds = new Set(resolvedSets.map((r) => r.sysId).filter(Boolean));
      const seededNames = new Set(resolvedSets.map((r) => normText(r.pointer).toLowerCase()));
      const humanExcluded = new Set((((ctx.state.queue || {}).seedExclusions) || []).map((e) => normText(e.value).toLowerCase()));
      for (const s of art.sets || []) {
        if (s.role === 'excluded' && !s.excludedReason) {
          rej.push(`sets["${s.name}"]: excluded with no excludedReason. A silent exclusion reads as coverage — say batch, Default, or the human's own exclusion, with the member count that shows it.`);
        }
        if (s.role === 'excluded' && (s.via === 'pointer' || seededIds.has(s.sysId) || seededNames.has(normText(s.name).toLowerCase()))
            && !humanExcluded.has(normText(s.name).toLowerCase())) {
          rej.push(`sets["${s.name}"] (${s.members} members): a SEEDED set in role "excluded"${s.excludedReason ? ` — "${s.excludedReason}"` : ''}. ` +
            'A set the human named is scope by definition; size is a warning for recovered sets only. Keep it role:"seeded" with its 1/|set| weight — the CLI mints a warning for a large one — ' +
            'or, if the developer excluded it by name, record that at seed (exclusions[]) so the exclusion carries their attribution, not a size rule.');
        }
        if (s.role === 'recovered' && typeof s.seededOverlap !== 'number') {
          rej.push(`sets["${s.name}"]: recovered with no seededOverlap. A version chain reaches a set through ONE shared artifact as easily as through the whole process, and on run pilot-run-6 that admitted the neighbouring H&S form-design work as if it were the integration. Count how many DISTINCT seeded artifacts appear in this set and report it; the CLI keeps a recovered set only when overlap/members >= ${ANCHOR_MIN_OVERLAP_RATIO} or its story root matches a seeded set.`);
        }
      }
      const seen = new Set();
      for (const m of art.surface || []) {
        const key = `${m.table}|${m.sysId}`;
        if (seen.has(key)) { rej.push(`surface: ${key} appears twice. A record admitted by two routes keeps its strongest evidence in ONE entry — a duplicate is harvested twice and counted twice in every ratio downstream.`); }
        seen.add(key);
        if (m.tier === 'T2') {
          if (m.evidence.kind !== 'co-shipped' || !(m.evidence.sets || []).length || typeof m.evidence.weight !== 'number') {
            rej.push(`surface ${m.table}/${m.sysId} ("${m.name}"): tier T2 without a citable co-change edge (evidence.kind "co-shipped", non-empty evidence.sets, a numeric weight). No artifact enters the surface on vibes — that is AC-ANC-1, and it is the entire difference between this stage and a guess.`);
          }
        } else if (m.evidence.kind !== 'named') {
          rej.push(`surface ${m.table}/${m.sysId}: tier T1 with evidence.kind "${m.evidence.kind}". T1 means the human named it; if co-change admitted it, it is T2 with the edge that proves it.`);
        }
        for (const problem of lintEncodedQuery(m.evidence && m.evidence.query)) {
          rej.push(`surface ${m.table}/${m.sysId}: ${problem}`);
        }
      }
      if (!(art.surface || []).length) {
        rej.push('surface is empty on a run whose seed resolved. A resolved non-empty set has members by definition, and each member is at least a T1/T2 candidate — an empty surface means the membership read was never issued or silently returned nothing (dead session and empty table are indistinguishable here; the canary rule applies).');
      }
      return rej;
    },
    apply: (ctx, art) => {
      const findings = (art.findings || []).slice();
      if (art.resolutionFailed === true) {
        return {
          facts: { anchor: { resolutionFailed: true, resolution: art.resolution } },
          stamps: { anchorExpansion: 'resolution-failed' },
          findings,
          raw: art.resolution.map((r) => Object.assign({ kind: 'seed-resolution' }, r)),
          progress: true,
        };
      }
      /*
       * DEGRADATION, STAMPED BY THE CLI from the expansion the artifact reports — never
       * self-stamped, same rule as the provenance envelope. refgraph-only here means the
       * chain-repair leg after harvest is the ONLY admission route beyond the seeded sets.
       */
      const mode = art.expansion.viaP2 ? (art.expansion.viaP4 ? 'co-change' : 'sets-only') : 'refgraph-only';
      if (mode !== 'co-change') {
        findings.push({
          check: 'anchor-degraded-expansion', severity: 'warning', rung: 'L1',
          message: `Anchor expansion ran degraded: ${mode} (viaP2=${art.expansion.viaP2}, viaP4=${art.expansion.viaP4}). ` +
            'A brain built without full co-change evidence answers "what belongs to this process" with weaker confidence, ' +
            'and the render must carry this stamp on the spine page rather than presenting the surface as complete.',
        });
      }
      if (art.adequacy.verdict !== 'converged') {
        findings.push({
          check: `anchor-seed-${art.adequacy.verdict}`, severity: 'warning', rung: 'L1',
          message: art.adequacy.verdict === 'barren'
            ? `The seed is BARREN: ${art.adequacy.why} The named set is probably a partial slice of the process — the interview must ask what else ships it, and the render must stamp low seed confidence.`
            : `The seed EXPLODED: ${art.adequacy.why} The named sets are probably batches — ask the developer for story-level sets; the exclusions list shows what was dropped to keep the surface bounded.`,
        });
      }
      /*
       * D5(b): a large seeded set is a WARNING, never an exclusion — the human pointed at it. The
       * measure is the same order-of-magnitude rule the procedure uses for recovered batches,
       * over the seeded sets' own median, so the warning names what a batch rule would have done.
       */
      const seededSized = (art.sets || []).filter((s) => s.role === 'seeded' && s.members > 0).map((s) => s.members).sort((a, b) => a - b);
      const seededMedian = seededSized.length ? seededSized[Math.floor(seededSized.length / 2)] : 0;
      const largeSeeded = (art.sets || []).filter((s) => s.role === 'seeded' && seededMedian > 0 && s.members >= 10 * seededMedian && s.members >= 50);
      if (largeSeeded.length) {
        findings.push({
          check: 'anchor-seeded-set-large', severity: 'warning', rung: 'L1',
          message: `${largeSeeded.length} seeded set(s) are an order of magnitude above the seeded median of ${seededMedian} members: ` +
            `${largeSeeded.map((s) => `${s.name} (${s.members})`).join('; ')}. They stay in the surface because the developer named them — ` +
            'each member enters at weight 1/|set|, which is the honest per-member signal for a large set. If a set is a sprint batch rather than this process\'s history, the developer excludes it by name at seed; a size rule never does.',
        });
      }
      const gaps = art.seedGaps || [];
      if (gaps.length) {
        findings.push({
          check: 'anchor-seed-gap', severity: 'warning', rung: 'L1',
          message: `${gaps.length} record(s) co-shipped with this process through sets the developer did not name: ` +
            `${gaps.slice(0, 5).map((g) => `${g.name} (${g.table})`).join(', ')}${gaps.length > 5 ? `, and ${gaps.length - 5} more` : ''}. ` +
            'This diff is the interview\'s sharpest material — "this shipped with your process and you didn\'t mention it" is a twenty-second question with a load-bearing answer.',
        });
      }
      /*
       * THE HARVEST QUEUE, cast from the surface. One area per table, T1+T2 together, sized
       * in NAMED SYS_IDS — the same shape the chain-repair leg already taught harvest to read,
       * so "the sys_ids are the query" needs no second mechanism. Largest surface first: the
       * budget's best-aimed reads go to the tables carrying most of the process.
       */
      /*
       * NEIGHBOUR DEMOTION — the CLI keeps this arithmetic. A recovered set with fewer than
       * ANCHOR_MIN_OVERLAP seeded artifacts in it is a neighbouring process the chain wandered
       * into through a shared surface. Its T2-only members leave the harvest queue and become
       * neighbour gaps: recorded, findable, askable at the interview — never read on this budget.
       */
      /*
       * RUN pilot-run-7 recalibrated this. An ABSOLUTE overlap (>= 2) let every large neighbour
       * through: "unsafe-situation catalog" (162 members, overlap 2), form design (190, overlap 6),
       * usability feedback (73, overlap 5) — ratios 0.01-0.07, all of them a different process
       * touching the same incident form. The one genuine recovery was STRY0100001.03, a
       * 1-member migration set sharing the SEEDED STORY ROOT. So: a recovered set is strong when
       * its overlap RATIO clears ANCHOR_MIN_OVERLAP_RATIO, or when its story root is one of the
       * seeded sets' roots (the induced pattern, applied to the set name). Nothing else.
       */
      const storyRe = (() => { try { return ctx.state.stamps.storyPattern ? new RegExp(ctx.state.stamps.storyPattern) : null; } catch (e) { return null; } })();
      const rootOf = (s) => {
        if (s.story) { const m = storyRe && storyRe.exec(String(s.story)); return m ? m[1] : String(s.story); }
        const m = storyRe && storyRe.exec(String(s.name || '')); return m ? m[1] : null;
      };
      const seededRoots = new Set((art.sets || []).filter((s) => s.role === 'seeded').map(rootOf).filter(Boolean));
      const isStrong = (s) => {
        if (s.role === 'seeded') { return true; }
        if (s.role !== 'recovered') { return false; }
        const root = rootOf(s);
        if (root && seededRoots.has(root)) { return true; }
        const ratio = s.members > 0 ? num(s.seededOverlap, 0) / s.members : (num(s.seededOverlap, 0) > 0 ? 1 : 0);
        return ratio >= ANCHOR_MIN_OVERLAP_RATIO;
      };
      const strongSets = new Set((art.sets || []).filter(isStrong).map((s) => s.sysId));
      const demotedSets = (art.sets || []).filter((s) => s.role === 'recovered' && !isStrong(s));
      const admitted = [];
      const neighbourGaps = [];
      for (const m of art.surface) {
        if (m.tier === 'T1' || (m.evidence.sets || []).some((id) => strongSets.has(id))) { admitted.push(m); }
        else { neighbourGaps.push({ table: m.table, sysId: m.sysId, name: m.name, sets: (m.evidence.sets || []).slice(), why: 'admitted only through recovered set(s) below the seeded-overlap threshold' }); }
      }
      if (neighbourGaps.length) {
        findings.push({
          check: 'anchor-neighbour-demoted', severity: 'warning', rung: 'L1',
          message: `${neighbourGaps.length} co-shipped record(s) were DEMOTED from the harvest queue: their only admitting sets ` +
            `(${demotedSets.slice(0, 4).map((s) => `${s.name} [overlap ${num(s.seededOverlap, 0)}/${s.members}]`).join('; ')}${demotedSets.length > 4 ? `; and ${demotedSets.length - 4} more` : ''}) ` +
            `share less than ${Math.round(ANCHOR_MIN_OVERLAP_RATIO * 100)}% of their members with the seeded sets and none of their story roots. Measured on runs pilot-run-6/2: ` +
            'version chains through shared H&S form sections admitted the form-design programme and the Onveilige-situatie catalog as if they were the VendorX integration. ' +
            'They are recorded as neighbour gaps for the interview ("same process, or a neighbour?"), not read.',
        });
      }
      /*
       * THE HARVEST QUEUE, cast from the ADMITTED surface, sized in NAMED SYS_IDS — the same shape
       * the chain-repair leg already taught harvest to read. Large tables get their own area; small
       * tables are PACKED into multi-table areas, because on run pilot-run-6 one-area-per-table cast
       * 51 areas of which 30 held three records or fewer — 51 fresh briefs of ~9k tokens each for a
       * 284-record surface. A brief is the expensive unit here, not a call.
       */
      const byTable = new Map();
      for (const m of admitted) {
        if (!byTable.has(m.table)) { byTable.set(m.table, []); }
        byTable.get(m.table).push(m);
      }
      const area = (id, tables, members) => ({
        id, tables, population: 'anchor',
        targets: members.map((m) => m.sysId),
        targetsByTable: Object.fromEntries(tables.map((t) => [t, members.filter((m) => m.table === t).map((m) => m.sysId)])),
        targetsTotal: members.length,
        t1: members.filter((m) => m.tier === 'T1').length,
        t2: members.filter((m) => m.tier === 'T2').length,
        why: tables.length === 1
          ? `the seeded process surface on ${tables[0]}: every sys_id carries a named or co-shipped edge from the anchor artifact`
          : `${tables.length} small tables of the seeded process surface packed into one area (${tables.join(', ')}): every sys_id carries a named or co-shipped edge from the anchor artifact`,
      });
      const sorted = [...byTable.entries()].sort((a, b) => b[1].length - a[1].length);
      const detail = sorted.filter(([, members]) => members.length >= ANCHOR_AREA_MIN)
        .map(([table, members]) => area(`proc-${table.replace(/_/g, '-')}`, [table], members));
      let pack = [];
      let packN = 0;
      const flushPack = () => {
        if (!pack.length) { return; }
        packN += 1;
        detail.push(area(`proc-pack-${packN}`, pack.map(([t]) => t), pack.flatMap(([, ms]) => ms)));
        pack = [];
      };
      for (const entry of sorted.filter(([, members]) => members.length < ANCHOR_AREA_MIN)) {
        if (pack.reduce((n, [, ms]) => n + ms.length, 0) + entry[1].length > ANCHOR_AREA_PACK) { flushPack(); }
        pack.push(entry);
      }
      flushPack();
      const liveSets = (art.sets || []).filter((s) => s.role !== 'excluded' && strongSets.has(s.sysId));
      return {
        facts: {
          anchor: {
            resolution: art.resolution, expansion: art.expansion, adequacy: art.adequacy,
            // F7: the story renderer pairs seeded work items to these sets by name; keep them in facts.
            sets: (art.sets || []).map((s) => ({ sysId: s.sysId, name: s.name, members: s.members, role: s.role, via: s.via || null, story: s.story || null, seededOverlap: typeof s.seededOverlap === 'number' ? s.seededOverlap : null })),
            surfaceCounts: {
              t1: art.surface.filter((m) => m.tier === 'T1').length,
              t2: art.surface.filter((m) => m.tier === 'T2').length,
              t2Admitted: admitted.filter((m) => m.tier === 'T2').length,
              t2Demoted: neighbourGaps.length,
              tables: byTable.size,
              areas: detail.length,
              setsDemoted: demotedSets.length,
              setsSeeded: (art.sets || []).filter((s) => s.role === 'seeded').length,
              setsRecovered: (art.sets || []).filter((s) => s.role === 'recovered').length,
              setsExcluded: (art.sets || []).filter((s) => s.role === 'excluded').length,
            },
            seedGaps: gaps,
            neighbourGaps,
          },
        },
        stamps: { anchorExpansion: mode, seedAdequacy: art.adequacy.verdict },
        findings,
        queue: {
          harvestAreas: detail.map((d) => d.id),
          harvestAreaDetail: detail,
          harvestDone: [],
          /*
           * The seeded process is the ONE candidate, pre-clustered by the strongest signal the
           * census ever had (update-set co-membership) plus a human's own pointing. The human
           * still names it at Gate 1 — a seed is a claim about scope, and the name on the spine
           * is the customer's word, not the developer's shorthand.
           */
          processCandidates: [{
            key: 'seeded-process',
            signal: 'update-set-comembership',
            recordCount: art.surface.length,
            updateSets: liveSets.map((s) => s.name),
            tables: [...byTable.keys()],
            sampleNames: art.surface.slice(0, 5).map((m) => m.name),
            why: 'the seeded surface: named by the developer and expanded by co-change; the human names it at Gate 1',
          }],
          namedProcesses: [],
        },
        raw: art.resolution.map((r) => Object.assign({ kind: 'seed-resolution' }, r))
          .concat((art.sets || []).map((s) => Object.assign({ kind: 'anchor-set' }, s)))
          .concat(art.surface.map((m) => Object.assign({ kind: 'anchor-surface' }, m))),
        progress: true,
      };
    },
    next: (ctx) => (ctx.state.stamps.anchorExpansion === 'resolution-failed'
      ? { terminal: 'blocked', note: 'The seed did not resolve: no seeded update set matched a non-empty sys_update_set row. Take the resolution evidence back to the developer and re-aim the seed — this run may not fall through to a blind sweep, because a seeded run that quietly widens is a census with extra steps and a misleading name.' }
      : 'harvest'),
  },

  // =========================================================================
  {
    id: 'harvest',
    title: 'Harvest — artifacts per area, emitted as CLAIMS',
    stagnation: 'claims-added',
    /*
     * PRODUCT-82. `harvestDone` names areas from a queue the recast is about to delete, and
     * `facts.coverage.<area>` is the per-area denominator every absence claim downstream is sound
     * against. Claims themselves are NOT dropped: `refine`'s existing doctrine keeps each claim's
     * `admittedBy` so the per-leg yield stays readable, and claim ids are content-hashed, so a
     * re-harvest of the same rows upserts rather than duplicates.
     */
    boundaryCast: {
      why: 'coverage denominators and the done-list are per-area figures belonging to the queue the boundary casts.',
      /*
       * METHOD-6 fix (3). `chainRepairRounds` casts WITH the done-list, and leaving it out was a
       * real leak: a recast drops `harvestAreas` (census casts it) and `harvestDone`, so the
       * re-harvest starts clean — but a spent round counter would survive, and the repair leg would
       * be permanently shut for a run that has just re-read everything under a new boundary. The
       * counter measures rounds against a ledger the recast is discarding.
       */
      /*
       * `harvestAreasClosed` casts with the done-list: it names census areas a close recorded
       * as unreached under the OLD boundary, and a recast re-derives the whole queue — carrying
       * the old names forward would report areas as closed that the new census never minted.
       */
      queue: ['harvestDone', 'chainRepairRounds', 'harvestAreasClosed'],
      facts: ['coverage.'],
    },
    /*
     * One iteration per area, plus headroom for the repairs a rejection costs. The reference
     * run derived nineteen areas against a flat ceiling of twelve and was stranded `exhausted`
     * while converging correctly; it took eight attributed overrides to walk it to the end.
     * A ceiling that cannot count the queue it is bounding is not a control, it is a speed bump.
     */
    ceiling: (ctx) => {
      const areas = ((ctx.state.queue || {}).harvestAreas || []).length;
      if (!areas) { return null; }
      const queueBound = areas + 3;
      /*
       * PRODUCT-35(b). PRODUCT-3's fix turned a too-tight ceiling into no ceiling at all: 431
       * areas + 3 = 434 permitted iterations against a budget of 800 calls at a measured 269
       * calls per area — roughly 108x more iterations than the money can pay for. A ceiling has
       * to be bounded by BOTH the queue and the budget. PRODUCT-3's lesson is kept as the +3
       * headroom, and `closeOn` fires before this does anyway, because the route is computed
       * before the per-stage bounds apply (PRODUCT-14) — so this is a backstop, not the control.
       */
      const st = ((ctx.state.stages || {}).harvest) || {};
      const priced = (st.iterations || []).filter((i) => i.accepted && num(i.apiCalls, 0) > 0);
      if (!priced.length) { return queueBound; }
      const rate = Math.ceil(priced.reduce((a, i) => a + i.apiCalls, 0) / priced.length);
      const b = ctx.state.budget || {};
      const affordable = Math.floor(Math.max(0, num(b.maxCalls, 0) - num(b.usedCalls, 0)) / rate);
      return Math.min(queueBound, num(st.total, 0) + affordable + 3);
    },
    goal: (ctx) => {
      const q = ctx.state.queue || {};
      const remaining = (q.harvestAreas || []).filter((a) => !(q.harvestDone || []).includes(a));
      const area = remaining[0];
      const detail = ((q.harvestAreaDetail || []).find((d) => d.id === area)) || {};
      /*
       * BOTH SIZES, AND THE IN-DOMAIN ONE FIRST — PRODUCT-29. This line briefed run 6ef14f5562
       * at "32328 Band A rows" for an area holding 1,631 in-domain, so the agent budgeted against
       * a number 20x larger than the work it had actually been handed. A missing in-domain size
       * means an instance-wide run and says so, rather than printing `undefined`.
       */
      const size = inDomainSize(detail);
      /*
       * PRODUCT-83. A data area is sized in its OWN unit and briefed in its own terms. Printing
       * "0 in-domain Band A rows" for `sys_user_group` would be true and useless: the rows are
       * not Band A rows, and an agent told an area holds zero of the population it was asked to
       * count reasonably concludes there is nothing there.
       */
      /*
       * METHOD-6 fix (3). A CHAIN-REPAIR AREA IS SIZED IN SYS_IDS, because that is what it is: a
       * list of records the ledger already points at and never mapped. It has no census stratum, no
       * boundary query and no Band A count — briefing it as "0 in-domain Band A rows" would be true
       * and would tell the agent there is nothing there, which is the exact failure PRODUCT-83
       * recorded for data areas.
       */
      /*
       * PLAN 6.12 (3). A DICTIONARY area is sized in unanswered sys_ids and briefed as a
       * QUESTION: what table do these live in — or are they inline text no read can follow.
       */
      const sizes = detail.population === 'chain-repair-dictionary'
        ? `${detail.targetsTotal} sys_id(s) appearing in ${(detail.from || [])[0]} whose TARGET TABLE IS UNKNOWN — the column never resolves in this ledger, no boundary query and no Band A count applies. One sys_dictionary read for (${(detail.tables || [])[0]}, ${detail.column}) decides whether they are readable at all.`
        : detail.population === 'chain-repair'
        ? `${detail.targetsTotal} record(s) this run ALREADY REFERENCES and never mapped${detail.targetsTotal > (detail.targets || []).length ? `, of which the first ${(detail.targets || []).length} are handed to you here` : ''} — no boundary query and no Band A count applies, because these are named sys_ids, not a stratum. Reached from ${(detail.from || []).join(', ')}.`
        : detail.population === 'anchor'
        ? `${detail.targetsTotal} record(s) on the SEEDED PROCESS SURFACE (${detail.t1 || 0} named by the developer, ${detail.t2 || 0} admitted by co-change) — named sys_ids from the anchor expansion, so no boundary query and no Band A count applies. The sys_ids are the query, and the surface is small ON PURPOSE: spend the saved budget on depth.`
        : detail.population === 'data'
          ? `${detail.rowsInDomain} row(s) in the DATA population — NOT Band A: these rows are not application files, carry no sys_scope and appear in no sys_class_name stratum. Use the boundary query the census measured them with, verbatim: ${detail.query}`
          : size !== null
          ? `${size} in-domain Band A rows (${detail.bandARows === undefined ? '?' : detail.bandARows} instance-wide)`
          : `${detail.bandARows || '?'} Band A rows, instance-wide — no in-domain size was measured for this area`;
      const oob = (q.harvestAreasOutOfBoundary || []).length;
      // PRODUCT-101: the clock, sized and briefed. The at-risk tail is the queue's END —
      // the queue is ranked by value, so what falls off at this pace is exactly its tail.
      const pace = stagePacing(ctx, { stage: 'harvest', remaining: remaining.length });
      return `Harvest ONE area — "${area}" (tables: ${(detail.tables || []).join(', ') || 'see census'}, ` +
        `${sizes}) — and emit it as atomic CLAIMS. ` +
        `${remaining.length} area(s) remain after this one: ${remaining.slice(1).join(', ') || '(none)'}` +
        `${oob ? `; ${oob} further area(s) the census measured as OUT OF BOUNDARY are recorded and will not be handed out` : ''}. ` +
        `${pace ? `${pacingLine(pace, pace.fits ? [] : remaining.slice(-pace.shortfall))} ` : ''}` +
        'A claim is one locus plus one assertion plus the captured response that proves it. It is not a ' +
        'paragraph, not a page, and not a summary. Pages are rendered FROM claims later; your only ' +
        'writes are this artifact.';
    },
    reads: () => [
      { path: 'docs/rework-plan.md#264-291', why: 'The claim schema and the four properties that make it work.', required: true },
      { path: 'tools/snbrain/lib/api.js', why: 'restTable() reports `truncated` explicitly — carry it into coverage. dictionaryFields() is the field validation.', required: true },
      { path: '.claude/skills/snbrain-harvest/SKILL.md', why: 'Engagement procedure, if the repo has one.', required: false },
    ],
    procedure: (ctx) => [
      'Read ONLY the area named in the goal. Do not opportunistically widen: another brief covers the rest and the budget is shared.',
      /*
       * THE ANCHOR LEG — the seeded product's area shape. Same mechanism as chain-repair
       * (named sys_ids, not a stratum), different story: these records are not repairs, they
       * ARE the process, and the brief has to carry the depth doctrine because this is where
       * the budget the seed saved gets spent.
       */
      ((ctx) => {
        const q = ctx.state.queue || {};
        const remaining = (q.harvestAreas || []).filter((a) => !(q.harvestDone || []).includes(a));
        const det = ((q.harvestAreaDetail || []).find((d) => d.id === remaining[0])) || {};
        if (det.population !== 'anchor') { return null; }
        const tables = det.tables || [];
        const byT = det.targetsByTable || { [tables[0]]: det.targets || [] };
        const perTable = tables.map((t) => {
          const ids = byT[t] || [];
          const shape = (BODY_FIELDS[t] || {}).shape;
          return `${t}: ${ids.length} id(s) in ${Math.ceil(ids.length / 40)} request(s) — ${ids.slice(0, 40).join(',')}${ids.length > 40 ? ` … and ${ids.length - 40} more in queue.harvestAreaDetail` : ''}` +
            `${shape ? ` [claim: ${shape.join(', ')}]` : ' [no declared shape: claim identity, state and logic-bearing columns and say which in coverage.note]'}`;
        });
        return 'THIS IS A PROCESS-SURFACE AREA AND THE SYS_IDS ARE THE QUERY. Every record here carries a named or ' +
          'co-shipped edge from the anchor stage; your job is DEPTH, not discovery. ' +
          `${tables.length > 1 ? `This area PACKS ${tables.length} small tables so one brief covers them; read each table separately, sys_idIN with at most 40 ids per request` : 'Read them: sys_idIN with at most 40 ids per request'}. ` +
          `Per table — ${perTable.join(' · ')}. ` +
          '(1) dictionaryFields() on EACH table FIRST, as everywhere else. ' +
          '(2) Claim the declared columns per table as listed above — INCLUDING the empty ones; the REQUIRED columns are where the logic lives. ' +
          'The department-scope product reads hundreds of records once; this product reads tens of records DEEPLY — ' +
          'execution order, conditions, and the fields a record writes that a sibling reads are exactly the claims the ' +
          'point-at-a-record test needs, and they are only affordable because the anchor gated the surface. ' +
          '(3) BAND, decided per record without a census: A when the record lives in a customer scope or was authored into a ' +
          'named set (it co-shipped deliberately — that is the anchor\'s admission evidence); B when it is a vendor-package ' +
          'record the customer modified; C only when nothing shows a customer ever touched it, which on this surface is rare ' +
          'by construction. ' +
          '(4) CARRY THE PROVENANCE: claim.provenance.updateSets from the anchor evidence for this sys_id — the render stage ' +
          'hangs the why-chain on it and it is already paid for. ' +
          '(5) A sys_id that returns NO ROW is a load-bearing fact: the set membership points at a deleted record. EMIT AN ' +
          'ABSENCE CLAIM for it — locus {table, sysId}, assertion "no record with this sys_id exists in <table>; the ' +
          'update-set entry that admitted it is dangling", capturedResponse the empty result — an area of misses at the end ' +
          'of the queue is exactly where the stagnation breaker would otherwise end the run. ' +
          'Why this area exists at all: ' + det.why;
      })(ctx),
      /*
       * METHOD-6 fix (3). A chain-repair area has no query to write — the sys_ids are the query.
       * Emitted as its own leg so the agent is not left applying stratum instructions to a list.
       */
      ((ctx) => {
        const q = ctx.state.queue || {};
        const remaining = (q.harvestAreas || []).filter((a) => !(q.harvestDone || []).includes(a));
        const det = ((q.harvestAreaDetail || []).find((d) => d.id === remaining[0])) || {};
        if (det.population !== 'chain-repair') { return null; }
        // PLAN 6.6: a repair area aimed at configuration-in-data takes its shape from
        // DATA_AREAS — sys_user_group is in no BODY_FIELDS entry and never will be.
        const shape = (BODY_FIELDS[det.tables[0]] || {}).shape || (DATA_AREAS[det.tables[0]] || {}).shape;
        return 'THIS IS A CHAIN-REPAIR AREA AND THE SYS_IDS ARE THE QUERY. These records are not a stratum you have to ' +
          'find; the run already holds references to every one of them and mapped none. Read them: ' +
          `sys_idIN with at most 40 ids per request, against ${det.tables[0]}, in ${Math.ceil((det.targets || []).length / 40)} request(s). ` +
          `The ids: ${(det.targets || []).slice(0, 40).join(',')}${(det.targets || []).length > 40 ? ` … and ${(det.targets || []).length - 40} more in queue.harvestAreaDetail for this area` : ''}. ` +
          '(1) dictionaryFields() on the table FIRST, as everywhere else — this table has never been read in this run, so nothing has validated a single column of it. ' +
          `(2) Claim ${shape ? `the declared columns for this table: ${shape.join(', ')}` : 'the identity and state columns the dictionary offers, and say in coverage.note which you chose and why — this table declares no columns in the stage table'}. ` +
          '(3) A sys_id that returns NO ROW is a load-bearing fact and not a miss: it means the reference points at a deleted or out-of-scope record, and the page citing it should say so rather than implying a record exists. ' +
          'EMIT A CLAIM FOR IT — locus {table, sysId}, assertion "no record with this sys_id exists in <table>; the reference from <column> is dangling", capturedResponse the empty result you actually got. ' +
          'This is not bookkeeping and coverage.note is NOT an alternative: an area that emits no claims is rejected, because harvest\'s stagnation breaker counts claims and two claimless iterations in a row terminate the whole run as `stalled` — and an area of misses is exactly where that would happen, at the end of the queue, after the budget is spent. ' +
          'Why this area exists at all: ' + det.why;
      })(ctx),
      /*
       * PLAN 6.12 PART (3). A dictionary area asks a DIFFERENT question from a chain-repair
       * area — not "read these records" but "what table do these ids live in, if any" — and
       * both of its answers are claims, so the area can never legitimately be empty.
       */
      ((ctx) => {
        const q = ctx.state.queue || {};
        const remaining = (q.harvestAreas || []).filter((a) => !(q.harvestDone || []).includes(a));
        const det = ((q.harvestAreaDetail || []).find((d) => d.id === remaining[0])) || {};
        if (det.population !== 'chain-repair-dictionary') { return null; }
        return 'THIS IS A DICTIONARY-REPAIR AREA AND THE QUESTION IS "WHAT TABLE DO THESE IDS LIVE IN". The run holds ' +
          `${det.targetsTotal} sys_id(s) in ${(det.from || [])[0]} and nothing anywhere says what table they point at. ` +
          `(1) ONE read against sys_dictionary: sysparm_query=name=${(det.tables || [])[0]}^element=${det.column}, fields name,element,internal_type,reference,sys_scope — internal_type and sys_scope are this table's must-claim columns, so request them or the claim is rejected. ` +
          '(2) IF the row is a reference (internal_type reference, or a list type carrying one): emit ONE claim on the sys_dictionary row — ' +
          `assertion "${(det.from || [])[0]} references <the table the reference field names>" — then read the targets exactly as a chain-repair area would: ` +
          'dictionaryFields() on the referenced table FIRST, sys_idIN with at most 40 ids per request, claims on its identity and state columns, ' +
          'and an ABSENCE claim for every sys_id that returns no row. ' +
          `DECLARE the discovered table in coverage.children — {parent: "${(det.tables || [])[0]}", table: <the referenced table>, parentsFollowed: ${det.targetsTotal}, rowsSeen: <n>} — ` +
          'because this area declares only the parent, and the area-table containment check refuses claims on tables the artifact does not account for. ' +
          '(3) IF the row is NOT a reference — a condition, a template body, a documentation string — the sys_ids are INLINE TEXT no read can follow. ' +
          'Emit ONE claim on the sys_dictionary row saying exactly that: locus the dictionary row, assertion ' +
          `"${(det.from || [])[0]} is <internal_type>, not a reference; the sys_ids appearing in it are inline text and cannot be traversed", capturedResponse the dictionary row. ` +
          'That claim SHUTS this class honestly — every later round and every reader now knows the chain ends there by construction, not by neglect. ' +
          '(4) IF the dictionary says document_id or the reference is polymorphic, the target table is named per ROW by a companion column — say which column in coverage.note and read the targets grouped by it. ' +
          `The ids: ${(det.targets || []).slice(0, 40).join(',')}${(det.targets || []).length > 40 ? ` … and ${(det.targets || []).length - 40} more in queue.harvestAreaDetail for this area` : ''}. ` +
          'Why this area exists at all: ' + det.why;
      })(ctx),
      // PLAN 5.43. A parent's DEFINING CHILDREN live on tables the census can never hand you.
      ((ctx) => {
        const q = ctx.state.queue || {};
        const remaining = (q.harvestAreas || []).filter((a) => !(q.harvestDone || []).includes(a));
        const det = ((q.harvestAreaDetail || []).find((d) => d.id === remaining[0])) || {};
        const plan = definingChildrenFor(det.tables || []);
        if (!plan.length) {
          return 'No table in this area declares defining children, so there is no child surface to follow and coverage.children may be omitted.';
        }
        return 'FOLLOW THE DEFINING CHILDREN, because nothing else in this run can. Census areas are sys_metadata sys_class_name strata, so these child tables cannot be handed to you as an area at any budget — the only route to them is from the parent you are reading right now: ' +
          plan.map((p) => `${p.parent} -> ${p.table} joined on ${p.on.parent.join('+')} = ${p.on.child.join('+')}` +
            `${p.also ? ` (and ${Object.entries(p.also).map(([k, v]) => `${k}=${v}`).join(', ')})` : ''}` +
            `, claim ${p.shape.join(', ')} — ${p.why}`).join(' · ') +
          '. Do it in this order, and it costs ONE call wherever the answer is nothing: ' +
          '(1) dictionaryFields() on the CHILD table first — a join column that does not exist on this instance drops the clause SILENTLY and returns the whole table, so an unvalidated child query is unsound rather than merely weak; ' +
          '(2) ONE aggregate count on the child, scoped to the parents you actually read, because a zero closes that child for this area in a single call and is itself a fact worth recording; ' +
          '(3) only where the count is non-zero, read the child in batches of at most 40 parent keys per query and emit one claim per (child locus, declared column), exactly as for the parent — an empty declared column on a child is a claim and not a skip, for the same reason it is on the parent. ' +
          'Report EVERY pair in coverage.children, including the zeroes, as {"parent":"<parent table>","table":"<child table>","parentsFollowed":<how many parents were in the query>,"rowsSeen":<rows returned>} plus an optional note. ' +
          'Measured on run 6ef14f5562: 65 sys_choice_set headers were claimed and ZERO sys_choice rows, so every choice value on the customer’s core tables — including the one that says category=10 means STS — is missing from a ledger of 8,299 claims. ' +
          'If a child genuinely cannot be reached inside this area’s budget, say so with deferred:true and a note: a declared deferral is a legitimate choice and mints a warning finding, an undeclared one is the defect this rule exists to remove.';
      })(ctx),
      // PRODUCT-78. Name the columns that carry meaning, per table, from the same table explain uses.
      ((ctx) => {
        const q = ctx.state.queue || {};
        const remaining = (q.harvestAreas || []).filter((a) => !(q.harvestDone || []).includes(a));
        const det = ((q.harvestAreaDetail || []).find((d) => d.id === remaining[0])) || {};
        const plan = declaredFieldsFor(det.tables || []);
        if (!plan.length) {
          return 'No table in this area declares meaning-bearing columns in the stage table, so claim the identity and ' +
            'state fields the dictionary offers and say in coverage.note which columns you chose and why.';
        }
        return 'CLAIM THE DECLARED COLUMNS. For these tables the columns that carry the record\'s meaning are fixed, ' +
          'and a claim set that omits them inventories the record without saying what it does: ' +
          plan.map((p) => `${p.table} → ${p.shape.join(', ')}${p.trigger.length ? ` (+ trigger: ${p.trigger.join(', ')})` : ''}` +
            `${p.must.length ? ` (+ REQUIRED, not optional: ${p.must.join(', ')})` : ''}` +
            `${p.unreadable ? ' [NO SCRIPT COLUMN: for this table the shape IS the definition, so these columns are the behaviour, not metadata]' : ''}`).join(' · ') +
          '. Emit one claim per (locus, declared column) for every record you read. ' +
          /*
           * PRODUCT-96. `must` is the difference between "the shape was read" and "the logic was
           * read". One discriminating shape column is enough to prove the first; only the named
           * column proves the second, and the last run passed the first while failing the second
           * on all five classes this list covers.
           */
          (plan.some((p) => p.must.length)
            ? 'THE REQUIRED COLUMNS ARE NOT SATISFIED BY READING A DIFFERENT ONE: they are where that class keeps its logic, ' +
              'and every one of them was either unrequested or requested-and-unclaimed on the last run — a state flow with no ' +
              'transition conditions, a UI policy with no scripts, a notification with no condition, and the single assignment ' +
              'rule that does all routing-group routing with its script unread while its group and user columns are empty. ' +
              'Where the column is a script, claim what it DOES in one line plus its first meaningful statement, not the whole body — ' +
              'the body is explain\'s job and a 4KB paste is not a claim. '
            : '') +
          'AN EMPTY DECLARED COLUMN IS A CLAIM, NOT A SKIP: "roles is empty" on a state flow means every transition is ' +
          'offered to everyone, which is a load-bearing fact about who may do what, and it is invisible if you only ' +
          'claim the columns that had values. If the dictionary says a declared column does not exist on this ' +
          'instance\'s version of the table, declare it in coverage.note as ' +
          '"no-column: <table>.<column> — <reason>" — a passing mention of the table name does not count, and do ' +
          'not silently drop it. This applies to EVERY table you end up claiming, not only the tables named above.';
      })(ctx),
      ((ctx) => {
        const d = ctx.state.config && ctx.state.config.domain;
        if (!d) { return 'No domain predicate is set: this run is instance-wide, and every claim is in scope by definition. Leave `admittedBy` off.'; }
        const legs = ['scope', 'author', 'name', 'updateSet'].filter((l) => (d[l] || []).length);
        return `DOMAIN PREDICATE, and it is a UNION — a record is in-domain if ANY leg admits it: ` +
          legs.map((l) => `${l} IN [${d[l].join(', ')}]`).join(' OR ') + '. ' +
          'Customer work genuinely scatters: a record can sit in a vendor scope, carry the customer prefix and ship in a story update set, and any one of those is enough. ' +
          'Set `admittedBy` on EVERY claim to the leg or legs that admitted that record — this is not bookkeeping. ' +
          'The reference run produced 96,606 claims of which 4.53% were plausibly in-domain, and nothing in its output could say which part of the boundary had done the admitting, so nobody could tell an over-wide leg from a productive one. ' +
          'A claim you cannot attribute to any leg should not have been harvested; say so in coverage.note rather than admitting it silently.';
      })(ctx),
      'Validate fields against sys_dictionary before issuing any filtered query, and set guards.fields="validated" on every piece of evidence.',
      'Emit one claim per (locus, assertion). Split compound facts: "active=true and order=100" is TWO claims, because the bottleneck in correction is error localization, not correction.',
      'capturedResponse is the response, verbatim, trimmed to the fields you requested. Not your description of it.',
      'Every claim you emit will be recorded with status=draft regardless of what you write. Only the verify stage can promote a claim, and it does so from a re-query, not from a re-read of your artifact.',
      'coverage.truncated must be true if any page came back full. A silently truncated harvest presented as complete poisons every absence claim downstream.',
      `Write to ${fwd(path.join('.brain', 'in', 'harvest.json'))} and ingest. The CLI pops this area and hands you the next one.`,
      // A leg that does not apply to this area returns null rather than a paragraph of "not
      // applicable" — the brief is read by an agent with a budget, so an inapplicable leg is
      // removed, not explained.
    ].filter(Boolean),
    schema: {
      type: 'object',
      required: ['area', 'claims', 'coverage'],
      props: {
        area: { type: 'string', minLength: 2 },
        claims: {
          type: 'array', min: 0,
          items: {
            type: 'object',
            required: ['locus', 'assertion', 'evidence', 'band'],
            forbidden: ['id', 'status', 'verifiedAt'],
            props: {
              locus: LOCUS_SCHEMA,
              assertion: { type: 'string', minLength: 3 },
              band: { type: 'string', enum: ['A', 'B', 'C'] },
              scope: { type: 'string', optional: true },
              /*
               * WHICH LEG OF THE DOMAIN PREDICATE ADMITTED THIS RECORD. Without it, "we mapped
               * the ACME domain" is unfalsifiable: the reference run produced 96,606 claims of
               * which 4.53% were plausibly in-domain, and nothing in the output could say which
               * part of the boundary had done the admitting. A leg that never admits anything
               * the others missed is pure cost; a leg admitting most of the ledger alone is the
               * one doing the work. Both facts are free once each claim carries this.
               */
              admittedBy: { type: 'array', optional: true, items: { type: 'string', enum: ['scope', 'author', 'name', 'updateSet'] } },
              rung: { type: 'string', optional: true, enum: RUNGS.slice() },
              evidence: EVIDENCE_SCHEMA,
              /*
               * PRODUCT-15. This was `any`, and nineteen harvest agents wrote the same concept
               * two incompatible ways — `sysUpdateName`/`updateXmlRows`/`updateSets:[object]`
               * against `updateName`/`xmlRows`/`updateSets:[string]`/`stories` — with nothing
               * rejecting either. Later stages join across this block, so `any` on it was not
               * permissiveness; it was deferred breakage, and it arrived as two half-populated
               * views of one instance that could not be reconciled after the fact.
               *
               * One shape, and every field optional: a rung that this instance does not carry
               * is legitimately absent, but a field that IS present now means one thing.
               */
              provenance: {
                type: 'object', optional: true,
                props: {
                  updateName: { type: 'string', optional: true },
                  updateXmlRows: { type: 'number', optional: true, min: 0 },
                  updateSets: {
                    type: 'array', optional: true,
                    items: { type: 'object', required: ['sysId'], props: { sysId: { type: 'string' }, name: { type: 'string', optional: true }, state: { type: 'string', optional: true }, isDefault: { type: 'boolean', optional: true } } },
                  },
                  stories: { type: 'array', optional: true, items: { type: 'string' } },
                  firstSeenOn: { type: 'string', optional: true },
                  rungs: { type: 'array', optional: true, items: { type: 'string', enum: ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8', 'P9', 'P10'] } },
                },
              },
            },
          },
        },
        coverage: {
          type: 'object',
          required: ['rowsSeen', 'truncated'],
          props: {
            rowsSeen: { type: 'number', min: 0 },
            rowsTotal: { type: 'number', optional: true, min: 0 },
            truncated: { type: 'boolean' },
            note: { type: 'string', optional: true },
            /*
             * PLAN 5.43. One row per (parent, defining child) pair the area touched, including
             * the pairs that came back empty. Typed rather than `any` for PRODUCT-15's reason:
             * `any` on a block later stages join across is deferred breakage, not permissiveness.
             * `parentsFollowed` is how many parent records were IN the child query — 0 means no
             * query was issued, which is a deferral and mints a finding; a non-zero
             * parentsFollowed with rowsSeen 0 is a measured absence and mints nothing.
             */
            children: {
              type: 'array', optional: true,
              items: {
                type: 'object',
                required: ['parent', 'table', 'parentsFollowed', 'rowsSeen'],
                props: {
                  parent: { type: 'string', minLength: 2 },
                  table: { type: 'string', minLength: 2 },
                  parentsFollowed: { type: 'number', min: 0 },
                  rowsSeen: { type: 'number', min: 0 },
                  deferred: { type: 'boolean', optional: true },
                  note: { type: 'string', optional: true },
                },
              },
            },
          },
        },
        findings: { type: 'array', optional: true, items: FINDING_SCHEMA },
      },
    },
    example: (ctx) => ({
      stage: 'harvest', instance: ctx.state.instance,
      usage: { apiCalls: 38, requestLog: '<sync-root>/spikes/scriptsync-read/snbrain-requests.ndjson' },
      area: ((ctx.state.queue && ctx.state.queue.harvestAreas) || ['business-rules'])[0],
      /*
       * PRODUCT-78. This example used to carry ONE claim — `active = true` — and the last run
       * copied it exactly: 8,239 claims that say records exist and not what they do. One claim per
       * (locus, declared column), and the columns are the ones BODY_FIELDS declares for the table.
       * One captured response serves every claim read from the same row; that is one API call.
       */
      claims: [
        ...[
          ['active', 'active = true', 'true'],
          ['when', 'when = before', 'before'],
          ['order', 'order = 100', '100'],
          ['action_update', 'action_update = true', 'true'],
          ['action_insert', 'action_insert = false', 'false'],
          ['action_delete', 'action_delete = false', 'false'],
          ['action_query', 'action_query = false', 'false'],
          ['condition', 'condition is empty — this rule is gated by filter_condition alone', ''],
          ['filter_condition', 'filter_condition = categoryIN10,qrt^stateCHANGESTO3', 'categoryIN10,qrt^stateCHANGESTO3'],
        ].map(([field, assertion]) => ({
          locus: { table: 'sys_script', sysId: '9ec847db1b8a43909e2aa934604bcb42', field },
          assertion, band: 'A', scope: 'x_acme_fm', rung: 'L1',
          evidence: {
            query: 'sys_idIN9ec847db1b8a43909e2aa934604bcb42',
            fields: 'sys_id,name,active,when,order,action_insert,action_update,action_delete,action_query,condition,filter_condition,sys_updated_on',
            capturedAt: '2026-08-04T09:12:44Z', transport: 'rest_request', completeness: 'complete',
            capturedResponse: {
              sys_id: '9ec847db1b8a43909e2aa934604bcb42', name: 'ACME guard', active: 'true',
              when: 'before', order: '100', action_insert: 'false', action_update: 'true',
              action_delete: 'false', action_query: 'false', condition: '',
              filter_condition: 'categoryIN10,qrt^stateCHANGESTO3', sys_updated_on: '2026-07-14 11:02:31',
            },
            guards: { fields: 'validated', identityCanary: 'pass' },
          },
        })),
      ],
      coverage: { rowsSeen: 412, rowsTotal: 412, truncated: false },
      acceptance: [{ id: 'AC-HARV-1', result: 'pass', evidence: 'dictionaryFields() called for sys_script before the filtered read' }],
    }),
    acceptance: [
      { id: 'AC-HARV-1', statement: 'Every filtered query in this area was field-validated before it was issued.', howToEvidence: 'guards.fields on each evidence block.' },
      { id: 'AC-HARV-2', statement: 'Coverage is honest: truncation is reported, and rowsSeen is the number actually transferred.', howToEvidence: 'restTable() returns `truncated` explicitly — carry it.' },
      { id: 'AC-HARV-3', statement: 'Every claim carries a captured response, not a description of one.', howToEvidence: 'evidence.capturedResponse.' },
      { id: 'AC-HARV-4', statement: 'No claim in this area was inferred. Every assertion is a value that was read.', howToEvidence: 'WHAT, never WHY.' },
    ],
    validate: (ctx, art) => {
      const rej = [];
      const q = ctx.state.queue || {};
      const remaining = (q.harvestAreas || []).filter((a) => !(q.harvestDone || []).includes(a));
      if (remaining.length && art.area !== remaining[0]) {
        rej.push(`area: the brief asked for "${remaining[0]}" and this artifact is for "${art.area}". The CLI hands out areas one at a time so the budget stays bounded; harvest the area you were given.`);
      }
      // PLATFORM-3 / PLATFORM-11, mechanised: both silently widen a result and neither errors.
      for (const c of art.claims) {
        for (const problem of lintEncodedQuery(c.evidence && c.evidence.query)) {
          rej.push(`claim on ${c.locus.table}/${c.locus.sysId}: ${problem}`);
        }
      }
      const unvalidated = art.claims.filter((c) => c.evidence.guards.fields !== 'validated');
      if (unvalidated.length) {
        rej.push(`${unvalidated.length} claim(s) carry guards.fields != "validated". The silent clause-drop is REPRODUCED on this instance: an unknown field in an encoded query returns UNFILTERED rows, so an unvalidated filtered query is not weak evidence, it is unsound evidence. Re-issue with dictionaryFields() first.`);
      }
      // PRODUCT-96, second half. See emptyAssertionViolations() for why this is tokens, not substrings.
      const emptyBad = emptyAssertionViolations(art.claims);
      if (emptyBad.length) { rej.push(emptyAssertionRejection(emptyBad, 'claim(s) in this harvest')); }
      /*
       * PRODUCT-88, leg one. A FINDING rather than a rejection: a uniformly empty column can be a
       * real fact about the customer's build, and rejecting it would push the run toward claiming
       * fewer columns — the opposite of PRODUCT-78. What it may not do is pass unremarked.
       */
      {
        const strata = emptyStrata(art.claims);
        if (strata.length) {
          (art.findings = art.findings || []).push({
            check: 'requested-column-empty-across-a-whole-stratum',
            severity: 'warning',
            rung: 'L1',
            message:
              `${strata.length} column(s) were requested and came back EMPTY on every locus read in this area ` +
              `(population: every (table, column) pair in this artifact claimed on ${EMPTY_STRATUM_MIN} or more ` +
              `distinct loci, where the column is present in the captured response): ` +
              `${strata.slice(0, 6).map((s) => `${s.table}.${s.field} (${s.loci} loci)`).join(', ')}` +
              `${strata.length > 6 ? `, and ${strata.length - 6} more` : ''}. ` +
              `One empty column is a load-bearing negative fact and this framework insists on claiming it. A whole ` +
              `stratum of them is a different statement, with two opposite causes: the customer genuinely does not ` +
              `use that column, or it does not surface over this transport. Say which. Measured on run 93838afe87: ` +
              `sys_decision_multi_result.result_elements came back empty on all 37 routing-group answer rows because it ` +
              `is a glide_var bucket the Table REST API does not expose, and the run recorded 37 empties instead of ` +
              `one finding — which cost a developer the name of every group the routing points at.`,
          });
        }
      }
      const bandC = art.claims.filter((c) => c.band === 'C');
      if (bandC.length > art.claims.length * 0.5 && art.claims.length > 4) {
        rej.push(`${bandC.length} of ${art.claims.length} claims are Band C (platform). Band C is inventory and is never askable; harvesting it burns budget for material no human has a decision history about. Re-aim at Band A.`);
      }
      if (art.claims.length === 0 && art.coverage.rowsSeen > 0) {
        rej.push('claims is empty but coverage.rowsSeen > 0. If rows were read and none produced a claim, say why in coverage.note — an unexplained empty harvest is indistinguishable from a broken read.');
      }
      /*
       * METHOD-6 fix (3), AND A HOLE I OPENED MYSELF. Harvest's stagnation mode is `claims-added`:
       * two consecutive ACCEPTED iterations adding zero claims terminate the whole run `stalled`.
       * Chain-repair areas are appended at the END of the queue sorted descending, so the last few
       * hold three targets each, and several are reached through a polymorphic column whose probes
       * are DESIGNED to come back empty. Two of those in a row would have killed the run after it
       * had spent its entire budget — the worst possible place to lose one.
       *
       * A rejection, not a warning, and that is the mechanism rather than a preference: a rejected
       * iteration is not `accepted`, so it never enters the stagnation window at all. The escape is
       * free and it improves the deliverable — an absence claim per unreachable sys_id is exactly
       * what lets a page say "this reference points at a record that does not exist" instead of
       * implying one does.
       */
      {
        const q = ctx.state.queue || {};
        const det = ((q.harvestAreaDetail || []).find((d) => d.id === art.area)) || {};
        // 6.12 (3): a dictionary area is held to the same rule — BOTH its answers are claims
        // (the reference mapping, or the class-shut "not a reference"), so empty is never legal.
        if (String(det.population || '').startsWith('chain-repair') && art.claims.length === 0) {
          rej.push(
            `claims is empty on chain-repair area "${art.area}", which reads ${(det.targets || []).length} named sys_id(s). ` +
            'Every target produces a claim: the record if it exists, or an ABSENCE claim if it does not — locus {table, sysId}, ' +
            'assertion "no record with this sys_id exists in ' + (det.tables || ['<table>'])[0] + '; the reference from ' +
            `${(det.from || ['<column>'])[0]} is dangling", capturedResponse the empty result you got. ` +
            'coverage.note is not an alternative here. An area of pure misses is a real and expected outcome — polymorphic ' +
            'columns are probed against every table they resolve into, so empty reads are guaranteed by design — but an ' +
            'accepted iteration that adds no claims counts toward the stagnation breaker, and two in a row terminate the ' +
            'run `stalled` at the end of the queue with the budget already spent. The absence is also the more useful fact: ' +
            'a page can say the reference is dead instead of implying a record exists.');
        }
      }
      /*
       * PRODUCT-78. A brief the artifact can ignore is prose, and the last run ignored this one
       * before it was written: 34 sf_state_flow rows claimed as `table` and `active`, with
       * from_state/to_state/roles — the entire state machine and the negative access fact —
       * left unread. If a table declares meaning-bearing columns and this artifact claimed NONE
       * of them, the area was inventoried rather than harvested.
       */
      {
        const claimed = new Map();
        for (const c of art.claims || []) {
          if (!c.locus || !c.locus.table) { continue; }
          if (!claimed.has(c.locus.table)) { claimed.set(c.locus.table, new Set()); }
          if (c.locus.field) { claimed.get(c.locus.table).add(c.locus.field); }
        }
        const note = String((art.coverage && art.coverage.note) || '');
        for (const [table, fields] of claimed) {
          const decl = declaredFieldsFor([table])[0];
          if (!decl || (!decl.shape.length && !decl.must.length)) { continue; }
          const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          /*
           * PRODUCT-96. The `must` escape is PER COLUMN, unlike the table-wide one below.
           * A table-wide escape is right for "the shape was not read": one declaration covers one
           * decision. It is wrong here, because declaring that `form_button_v2` is absent from an
           * old instance would also excuse never reading `script` — one true statement buying
           * silence on three unrelated columns.
           */
          const missingMustAll = (decl.must || []).filter((f) => !fields.has(f));
          const missingMust = missingMustAll.filter((f) => !new RegExp(`no-column:\\s*${esc(table)}\\.${esc(f)}\\b`, 'i').test(note));
          /*
           * THE ESCAPE IS AN EXPLICIT DECLARATION, NOT A MENTION.
           *
           * This used to be a bare substring test for the table name in coverage.note, which is
           * disarmed by prose: naming `sys_script_client` also cleared `sys_script`,
           * `sys_ui_policy_action` cleared `sys_ui_policy`, and the run's real coverage.note
           * already named nine of the fourteen shaped tables incidentally while narrating the
           * domain predicate. The new brief actively instructs the agent to write table names into
           * coverage.note, so the hole was about to be walked through on purpose.
           */
          const tableWideEscape = new RegExp(`no-column:\\s*${esc(table)}\\.`, 'i').test(note);
          /*
           * `active` is not evidence of anything. It appears in nearly every declared shape and it
           * is the cheapest column on the instance, so "at least one declared column" is satisfied
           * by the exact artifact this rule exists to reject — measured: run 6ef14f5562 claimed
           * `table` and `active` for all 34 sf_state_flow rows and nothing else. Two populations,
           * named, and the rule differs between them on principle rather than on a threshold:
           *   - a table with NO script column: the shape IS the definition, so ALL of it is required
           *   - a table with a body: the body carries the behaviour, so one DISCRIMINATING column
           *     (anything but `active`) is enough to show the shape was read at all
           */
          const missing = decl.shape.filter((f) => !fields.has(f));
          const discriminating = decl.shape.filter((f) => f !== 'active');
          const gotDiscriminating = discriminating.some((f) => fields.has(f));
          /*
           * PRODUCT-96, and it is a SEPARATE rejection from the one below on purpose: the two
           * fail for different reasons and the fix for one does not touch the other. The shape
           * rule asks whether this area was harvested at all; `must` asks whether the column
           * where this class keeps its logic was read. Run 93838afe87 passed the first on all
           * five of the classes carrying a `must` list and failed the second on all five.
           */
          if (missingMust.length) {
            rej.push(
              `claims on ${table}: ${missingMust.length} REQUIRED column(s) were not claimed — ${missingMust.join(', ')}. ` +
              `These are not "one of the declared columns"; they are where a ${table} record keeps its logic, and without ` +
              `them the claim set says the record exists and cannot say what it decides. You claimed ` +
              `${fields.size ? [...fields].join(', ') : 'no fields at all'}. ` +
              `Measured on the previous run: the one sysrule_assignment doing all routing-group routing had empty group and user ` +
              `columns — so the script WAS the mechanism — and the script was never requested; 64 UI policies were claimed ` +
              `without script_true/script_false; 14 notifications without condition; and 34 state flows without either ` +
              `transition condition, on a run whose subject is a state machine. ` +
              `Claim them INCLUDING the empty ones — an empty condition on a state flow means the transition is ungated, ` +
              `which is the fact. Where the column is a script, one line saying what it does plus its first meaningful ` +
              `statement is a claim; the whole body is not. If the column genuinely does not exist on this instance's ` +
              `version of the table, declare it as "no-column: ${table}.<column> — <reason>" in coverage.note.`);
          }
          const failed = decl.shape.length && (decl.unreadable ? missing.length > 0 : !gotDiscriminating);
          if (!failed || tableWideEscape) { continue; }
          rej.push(
            `claims on ${table}: the columns that carry this record's meaning were not claimed. ` +
            (decl.unreadable
              ? `This table has NO script column — ${decl.unreadable} So its declared shape IS the behaviour, and all of ` +
                `${decl.shape.join(', ')} must be claimed. Missing: ${missing.join(', ')}. `
              : `The stage table declares ${decl.shape.join(', ')}${decl.trigger.length ? ` (+ trigger ${decl.trigger.join(', ')})` : ''}, ` +
                `and none of the discriminating ones (${discriminating.join(', ')}) was claimed. `) +
            `You claimed ${fields.size ? [...fields].join(', ') : 'no fields at all'}, which records that these rows exist ` +
            `and not what they do — an inventory, not a harvest. Claim the declared columns INCLUDING the ones that come ` +
            `back empty: an empty roles column means every transition is offered to everyone, which is a fact about who ` +
            `may act and is invisible if you only claim columns that had values. If a declared column genuinely does not ` +
            `exist on this instance's version of the table, declare it in coverage.note as ` +
            `"no-column: ${table}.<column> — <reason>". A passing mention of the table name does not count. ` +
            `NOTE the scope: this applies to EVERY table you claim, not only the tables the brief listed for this area.`);
        }
      }
      /*
       * PRODUCT-9. A harvest reporting rowsSeen: 0 used to be accepted silently, and because
       * `apply` unconditionally pushes the area onto harvestDone, the area was then BURNED —
       * never revisited, and counted as covered by every downstream number.
       *
       * The census only emits an area with bandARows > 0 (its own validator refuses otherwise),
       * so an area that yields zero rows is a contradiction between two reads, not an empty
       * area. On this platform the overwhelmingly likelier cause is a dead session or a dropped
       * clause. That is `blocked`, and LOOP.md is explicit that a stage which could not run is
       * blocked and never green.
       */
      if (art.coverage.rowsSeen === 0) {
        const blocking = (art.findings || []).filter((f) => f.severity === 'blocking');
        if (!blocking.length) {
          rej.push(`coverage.rowsSeen is 0 for area "${art.area}", which the census derived because it counted Band A rows there. Two reads of the same instance disagree, and on this platform that is a dead session or a silently dropped clause far more often than an empty area. Raise a BLOCKING finding saying which, or re-read it — an accepted zero-row harvest burns this area for the rest of the run.`);
        }
      }
      /*
       * PLAN 5.43. THE POPULATION IS NAMED, and it is the loci IN THIS ARTIFACT whose table
       * declares defining children — not the ledger, not the run, not "claims". Three register
       * entries recurred because each asserted an invariant over an unnamed population that was
       * true while one population existed and false once a second appeared.
       *
       * Census areas are sys_metadata sys_class_name strata, so sys_choice, sys_translated_text,
       * sys_highlighted_value and sys_ux_m2m_action_layout_item cannot arrive as an area at any
       * budget. This artifact is the only place in the loop that can reach them, and run
       * 6ef14f5562 shows what happens when nothing asks: 65 choice-set headers, zero values.
       */
      {
        const claimedTables = new Set();
        const parents = new Map();
        for (const c of art.claims || []) {
          const t = c.locus && c.locus.table;
          if (!t) { continue; }
          claimedTables.add(t);
          if (!c.locus.sysId) { continue; }
          if (!definingChildrenFor([t], { depth: 1 }).length) { continue; }
          if (!parents.has(t)) { parents.set(t, new Set()); }
          parents.get(t).add(c.locus.sysId);
        }
        const declared = new Set();
        for (const row of (art.coverage && art.coverage.children) || []) { declared.add(`${row.parent}|${row.table}`); }
        for (const [parent, ids] of parents) {
          for (const child of definingChildrenFor([parent], { depth: 1 })) {
            if (claimedTables.has(child.table) || declared.has(`${parent}|${child.table}`)) { continue; }
            rej.push(
              `defining children: this artifact claims ${ids.size} record(s) on "${parent}" and nothing at all on ` +
              `"${child.table}" — and ${child.why} ` +
              `"${child.table}" is not one of this run's census areas and cannot become one, because areas are ` +
              `sys_metadata sys_class_name strata and the census validator refuses an area whose rows are not in ` +
              `Band A; this artifact is therefore the only place in the whole run that can reach it. Join it on ` +
              `${child.on.parent.join('+')} = ${child.on.child.join('+')}` +
              `${child.also ? ` with ${Object.entries(child.also).map(([k, v]) => `${k}=${v}`).join(', ')}` : ''}, ` +
              `dictionary-validating "${child.table}" first because an unknown column drops the clause silently and ` +
              `returns the whole table. If you DID read it and it was empty, say so: coverage.children needs a row ` +
              `{parent:"${parent}", table:"${child.table}", parentsFollowed:<how many parents were in the query>, ` +
              `rowsSeen:0} and that is an accepted answer. Measured on run 6ef14f5562: 65 sys_choice_set headers ` +
              `claimed and zero sys_choice values in an 8,299-claim ledger, which cost eight ground-truth facts in ` +
              `one scored area.`);
          }
        }
      }
      /*
       * PLAN 6.3 / PRODUCT-94 (1) — AREA-TABLE CONTAINMENT. Run 93838afe87's harvest banked
       * 3,750 sys_choice claims under an area declaring tables: ["sys_choice_set"], and nothing
       * asserted that an area's claims sit on tables the area names — so `harvestedIn` said
       * sys-choice-set on all 3,750 rows, census's bandARows sized a population that was never
       * read, and the run's own coverage reporting later declared the largest table in the
       * ledger unread (TBD-008, an accepted BLOCKING finding resting on a premise the ledger
       * falsifies).
       *
       * POPULATION, NAMED: every claim in THIS artifact whose locus.table is outside the area's
       * declared tables[], their defining children, and the children this artifact itself
       * declares in coverage.children. Those are the legitimate routes, and they are sufficient:
       * replayed over both scored ledgers this raises ZERO rejections, because the register's
       * six historical violations all sit on routes DEFINING_CHILDREN has since declared. The
       * check exists to stop the NEXT mis-attribution, and its cheapest legal satisfaction is
       * the wanted behaviour — an accurate declaration, either in the area or in
       * coverage.children.
       */
      {
        const qC = ctx.state.queue || {};
        const det = ((qC.harvestAreaDetail || []).find((d) => d.id === art.area)) || {};
        const allowed = new Set(det.tables || []);
        if (allowed.size) {
          for (const child of definingChildrenFor([...allowed])) { allowed.add(child.table); }
          for (const row of (art.coverage && art.coverage.children) || []) { if (row.table) { allowed.add(row.table); } }
          // A dictionary area's whole job is reading sys_dictionary and then the table it names;
          // the dictionary row is always legal, the discovered table arrives via coverage.children.
          if (det.population === 'chain-repair-dictionary') { allowed.add('sys_dictionary'); }
          const off = new Map();
          for (const c of art.claims || []) {
            const t = c.locus && c.locus.table;
            if (t && !allowed.has(t)) { off.set(t, (off.get(t) || 0) + 1); }
          }
          if (off.size) {
            rej.push(
              `area-table containment: area "${art.area}" declares tables ${(det.tables || []).join(', ')}, and this artifact ` +
              `claims ${[...off.values()].reduce((a, b) => a + b, 0)} record(s) on ${off.size} table(s) outside that declaration, ` +
              `its defining children, and your own coverage.children rows: ${[...off.entries()].slice(0, 5).map(([t, n]) => `${t} (${n})`).join(', ')}. ` +
              'A stratum that yields a different table than it declares is either a mis-declared area or a mis-attributed claim. ' +
              'If you followed a parent into these rows DELIBERATELY, declare the route: a coverage.children row ' +
              '{parent, table, parentsFollowed, rowsSeen} makes it visible and satisfies this check. If the claims belong to a ' +
              'different area, emit them from that area\'s artifact. Measured on run 93838afe87: an undeclared yield of 3,750 ' +
              'sys_choice claims led the deliverable to disclaim 19.4% of its own ledger as unread.');
          }
        }
      }
      return rej;
    },
    apply: (ctx, art) => {
      const q = ctx.state.queue || {};
      const done = (q.harvestDone || []).concat([art.area]);
      /*
       * METHOD-6, FIX (3). THE REPAIR QUEUE IS MINTED HERE, NOT IN next().
       *
       * `next()` returns a route and must not mutate; a leg that appended areas from there would
       * mint a fresh set on every call the CLI makes to compute a route. So the areas are appended
       * by the artifact that DRAINS the census queue, exactly once, and `next()` then sees a
       * non-empty remainder and routes to harvest without knowing anything new.
       *
       * The graph is built over the ledger AS IT NOW STANDS, including this artifact's claims —
       * which is the point: a target the area just harvested is no longer dangling and must not be
       * queued for repair. Rounds decrement whether or not any area is minted, so a run where the
       * graph is clean shuts the leg rather than re-deriving an empty answer on every iteration.
       */
      const queue = { harvestDone: done };
      const repairFindings = [];
      const roundsLeft = q.chainRepairRounds === undefined ? CHAIN_REPAIR_ROUNDS : q.chainRepairRounds;
      const drained = !(q.harvestAreas || []).filter((a) => !done.includes(a)).length;
      if (drained && roundsLeft > 0) {
        const ledger = [...ctx.brain.claims().values()].concat(art.claims);
        const repair = chainRepairAreas(ledger);
        queue.chainRepairRounds = roundsLeft - 1;
        // PLAN 6.12 (3): dictionary areas ride the same queue — one work list, two questions.
        const minted = repair.areas.concat(repair.dictionaryAreas);
        if (minted.length) {
          queue.harvestAreas = (q.harvestAreas || []).concat(minted.map((a) => a.id));
          queue.harvestAreaDetail = (q.harvestAreaDetail || []).concat(minted);
        }
        repairFindings.push(...chainRepairRoundFinding(repair, roundsLeft - 1));
      }
      /*
       * PRODUCT-101 — FILED THE FIRST TIME THE QUEUE STOPS FITTING, not at the close. Run 5's
       * operator learned the clock had won from the elapsed-capped close itself, at 19 of 29
       * areas with 78% of the money unspent; replayed against that run's own iteration history,
       * this finding would have fired at iteration 3. One warning, same id every iteration
       * (check+locus), message refreshed with the current projection; --hours is the exit.
       */
      const remainingAfter = (q.harvestAreas || []).filter((a) => !done.includes(a));
      const pace = stagePacing(ctx, { stage: 'harvest', remaining: remainingAfter.length });
      const pacingFindings = (pace && !pace.fits) ? [{
        check: 'wall-clock-pacing', severity: 'warning', rung: 'L1',
        locus: { table: 'queue', sysId: 'harvest' },
        message: pacingLine(pace, remainingAfter.slice(-pace.shortfall)),
      }] : [];
      return {
        // Status is FORCED to draft. A harvest cannot verify itself; only a re-query can,
        // and that is a different stage run by a different context on purpose.
        claims: art.claims.map((c) => Object.assign({}, c, { status: 'draft', rung: c.rung || 'L1', harvestedIn: art.area })),
        findings: pacingFindings.concat(repairFindings).concat(art.findings || []).concat(art.coverage.truncated ? [{
          check: `harvest-truncated-${art.area}`, severity: 'warning', rung: 'L1',
          message: `Area "${art.area}" was truncated at ${art.coverage.rowsSeen} rows. Every absence claim in this area is unsound until it is completed.`,
        }] : []).concat(
          /*
           * PLAN 5.43. A DECLARED DEFERRAL IS LEGITIMATE AND IT IS NOT FREE. These child tables
           * are the only surface in the run that no other stage and no later area can reach, so
           * a deferral has to be visible to questions and to render rather than closing quietly
           * inside a coverage field. A child that WAS queried and came back empty is a measured
           * absence and mints nothing.
           */
          ((art.coverage.children || []).filter((c) => c.deferred || !c.parentsFollowed)).map((c) => ({
            check: `defining-children-deferred-${art.area}-${c.table}`, severity: 'warning', rung: 'L1',
            message: `Area "${art.area}": "${c.table}" was declared as a defining child of "${c.parent}" and not ` +
              `followed (${c.parentsFollowed || 0} parent(s) in the query, ${c.rowsSeen || 0} row(s) read).` +
              `${c.note ? ` Reason given: ${c.note}` : ''} No census area can reach "${c.table}" — areas are ` +
              `sys_metadata class strata — so this surface stays unread for the whole run unless a later harvest ` +
              `picks it up deliberately.`,
          }))),
        raw: art.claims.map((c) => ({ kind: 'harvest', area: art.area, locus: c.locus, assertion: c.assertion, capturedAt: c.evidence.capturedAt })),
        queue,
        facts: { [`coverage.${art.area}`]: art.coverage },
        progress: true,
      };
    },
    /*
     * PRODUCT-35. Where the remainder goes when harvest cannot finish its queue — declared
     * HERE, beside closeOn, so the CLI never has to name a stage to route a close.
     */
    closeTo: 'explain',
    closeOn: (ctx, opts) => {
      const q = ctx.state.queue || {};
      const areas = q.harvestAreas || [];
      const done = q.harvestDone || [];
      const unreached = areas.filter((a) => !done.includes(a));
      // An empty queue is not a close: next() owns that route. Closing there would mint a
      // warning about unread work on a stage that read every area it was handed.
      if (!unreached.length) { return null; }
      /*
       * METHOD-6 fix (3). The repair tail minted at this stage's own close starts, by
       * construction, PAST the elapsed horizon — the close that minted it fired on that very
       * bound — so an elapsed check would close the tail before its first iteration and the leg
       * would be unreachable again, one door further down. A queue that is all chain-repair
       * areas is therefore exempt from the elapsed bound and from NOTHING else: rounds bound
       * how often it can be minted, the area cap bounds each round, the iteration ceiling
       * counts the queue the tail joined, and money still closes it.
       */
      const repairIds = new Set((q.harvestAreaDetail || []).filter((d) => String(d.population || '').startsWith('chain-repair')).map((d) => d.id));
      const tailOnly = unreached.every((a) => repairIds.has(a));
      return boundClose(ctx, Object.assign({}, opts, {
        unreached: unreached.length,
        population: areas.length,
        unit: tailOnly ? 'chain-repair area(s)' : 'census-derived harvest area(s)',
        populationName: tailOnly
          ? 'the chain-repair tail minted at this stage\'s own close'
          : `queue.harvestAreas for this run under boundary ${ctx.state.stamps.domainBoundary || '(none — instance-wide)'}`,
        exemptElapsed: tailOnly,
      }));
    },
    /*
     * METHOD-6 fix (3), THE DOOR THE FIX NEVER HAD. Repair areas were minted in apply() alone,
     * and apply() runs only when an artifact is ingested — but a bound close is a CLI action
     * computed in `next`, which never calls apply(). So on any run that closed early — the
     * NORMAL case: pilot-run-5 closed elapsed-capped at 19 of 29 areas with 3,920 of 5,000 calls
     * unspent, queue.chainRepairRounds undefined, zero repair areas ever minted — the leg had
     * never executed and could not. This hook is the close-path door: the CLI calls it when a
     * close fires, before advancing. The close is still recorded with the population it counted
     * and terminal success is still lost — the census remainder is genuinely unread — but with
     * `stay: true` the cursor holds in harvest so the repair queue is actually read.
     *
     * THE TAIL IS BOUNDED, because an unbounded repair loop is a run that never finishes: by
     * rounds (chainRepairRounds, decremented here exactly as at the drain), by the area cap
     * inside chainRepairAreas, and by the iteration ceiling, which counts the queue the tail
     * just joined. A budget-capped close mints nothing — the run cannot pay for the reads it
     * would queue — and the tail's own close never re-mints, which would be the unbounded loop
     * with extra steps.
     */
    onClose: (ctx, close) => {
      if (close.reason === 'budget-capped') { return null; }
      const q = ctx.state.queue || {};
      const roundsLeft = q.chainRepairRounds === undefined ? CHAIN_REPAIR_ROUNDS : q.chainRepairRounds;
      if (roundsLeft <= 0) { return null; }
      const detail = q.harvestAreaDetail || [];
      const repairIds = new Set(detail.filter((d) => String(d.population || '').startsWith('chain-repair')).map((d) => d.id));
      const done = q.harvestDone || [];
      const unreached = (q.harvestAreas || []).filter((a) => !done.includes(a));
      if (!unreached.length || unreached.some((a) => repairIds.has(a))) { return null; }
      const repair = chainRepairAreas([...ctx.brain.claims().values()]);
      // PLAN 6.12 (3): the dictionary areas ride the same salvage — one tail, two questions.
      const minted = repair.areas.concat(repair.dictionaryAreas);
      if (!minted.length) { return null; }
      return {
        stay: true,
        queue: {
          /*
           * The closed census remainder leaves the live queue, or every remaining-area
           * computation in this table — goal, procedure, next, the ceiling — would hand a
           * CLOSED area straight back out. The names are kept in harvestAreasClosed, because
           * the close record carries counts and a count with no names cannot be audited.
           */
          harvestAreas: (q.harvestAreas || []).filter((a) => !unreached.includes(a)).concat(minted.map((a) => a.id)),
          harvestAreasClosed: (q.harvestAreasClosed || []).concat(unreached),
          harvestAreaDetail: detail.concat(minted),
          chainRepairRounds: roundsLeft - 1,
        },
        findings: chainRepairRoundFinding(repair, roundsLeft - 1),
        note: `${repair.areas.length} chain-repair area(s) covering ${repair.areas.reduce((n, a) => n + a.targets.length, 0)} ` +
          `already-referenced record(s)${repair.dictionaryAreas.length ? ` and ${repair.dictionaryAreas.length} dictionary area(s) over classes whose target table is unknown` : ''} ` +
          `were minted from the ledger as it stands, and the cursor stays in harvest to read them. ` +
          `The tail is bounded by round count (${roundsLeft - 1} round(s) remain after this one), by the area caps of ` +
          `${CHAIN_REPAIR_MAX_AREAS} and ${CHAIN_REPAIR_DICT_MAX_AREAS}, and by the iteration ceiling; a further bound close still ends it.`,
      };
    },
    next: (ctx) => {
      const q = ctx.state.queue || {};
      const remaining = (q.harvestAreas || []).filter((a) => !(q.harvestDone || []).includes(a));
      return remaining.length ? 'harvest' : 'explain';
    },
  },

  // =========================================================================
  {
    id: 'explain',
    title: 'Explain — read the logic bodies, and say what each artifact DOES',
    stagnation: 'claims-added',
    goal: (ctx) => {
      const c = explainCandidates(ctx);
      const tables = [...new Set(c.ranked.map((x) => x.table))];
      return `Read the LOGIC BODIES of ${c.ranked.length} ranked candidate record(s) across ` +
        `${tables.length} table(s) (${tables.slice(0, 6).join(', ')}${tables.length > 6 ? ', …' : ''}) and emit one ` +
        `BEHAVIOUR claim each: what the record does, and what makes it run. ` +
        `${c.overflow.length} candidate(s) fall below the cap of ${c.cap} and ${c.unreadable.length} sit in ` +
        `tables whose behaviour this transport cannot read as a body — both sets must be reported, not dropped. ` +
        'The harvest recorded that these records EXIST. It did not record what they DO, because what they do ' +
        'lives in a field it never requested. This stage is the difference between an inventory and a brain: ' +
        'without it, "what does X do" is unanswerable from the deliverable, and that is measured, not feared.';
    },
    reads: () => [
      { path: 'tools/snbrain/lib/api.js', why: 'restTable() with an explicit narrow field list. Body fields are unbounded text; do not request them alongside a wide field list.', required: true },
      { path: '.brain/claims.jsonl', why: 'The harvested loci. Use `snbrain claims --json` rather than loading the file.', required: true },
      { path: '.claude/skills/snbrain-explain/SKILL.md', why: 'Engagement procedure, if the repo has one.', required: false },
    ],
    procedure: (ctx) => {
      const c = explainCandidates(ctx);
      const tables = [...new Set(c.ranked.map((x) => x.table))];
      return [
        `Work the ranked list the CLI computed. It is ${c.ranked.length} record(s); do not widen it and do not substitute your own ranking.`,
        'READ NARROW AND OFTEN. Batch by table with sys_idIN<up to 20 ids> and request ONLY that table\'s body + trigger + shape fields. PLATFORM-10: a wide field list additively breaks pagination on this transport, and body columns are unbounded text — a single fat request is the failure mode here, not many thin ones.',
        `Body/trigger/shape fields per table are fixed and listed here — use exactly these: ${tables.map((t) => `${t} → body[${(BODY_FIELDS[t].body || []).join(',')}] trigger[${(BODY_FIELDS[t].trigger || []).join(',')}]`).join(' · ') || '(no readable-body tables in the ranked set)'}.`,
        'For each record emit ONE claim whose assertion says what it does, in a sentence, in the customer\'s terms where the body gives them to you. "Sets is_sensitive=true on QRT incidents in state 0 or 6" is the target. "Business rule on sn_ohs_im_incident" is a restatement of the name and will be rejected.',
        'THE ASSERTION IS A READ, NOT A JUDGEMENT. Everything in it must be derivable from the body text you captured: the trigger condition verbatim, one-line scripts quoted in full, every callee, every gs.eventQueue event name, every message key, every table touched. You are extracting, not interpreting. WHY it does that is the interview\'s job and you must not guess it.',
        'behaviour.excerpt must be a VERBATIM SUBSTRING of the body you captured — the CLI checks this literally, character for character. It is what makes "what it does" auditable rather than plausible.',
        'A record whose body comes back EMPTY is reported with bodyEmpty=true, not skipped and not described from its name. An empty body is a fact; a guess dressed as a reading is the defect this stage exists to remove.',
        `Report every candidate you did not read in \`dropped\`, each with a reason. The CLI already knows about the ${c.overflow.length} below the cap and the ${c.unreadable.length} unreadable — say so explicitly anyway. Silent truncation is how the reference run lost six questions with no id, no text and no reason.`,
      ];
    },
    schema: {
      type: 'object',
      required: ['claims', 'coverage'],
      props: {
        claims: {
          type: 'array', min: 0,
          items: {
            type: 'object',
            required: ['locus', 'assertion', 'band', 'behaviour', 'evidence'],
            forbidden: ['id', 'status', 'verifiedAt'],
            props: {
              locus: LOCUS_SCHEMA,
              assertion: { type: 'string', minLength: 20 },
              band: { type: 'string', enum: ['A', 'B'] },
              scope: { type: 'string', optional: true },
              behaviour: {
                type: 'object',
                required: ['bodyField', 'bodyEmpty'],
                props: {
                  bodyField: { type: 'string', minLength: 2 },
                  bodyEmpty: { type: 'boolean' },
                  bodyLength: { type: 'number', optional: true, min: 0 },
                  excerpt: { type: 'string', optional: true },
                  trigger: { type: 'string', optional: true },
                  callees: { type: 'array', optional: true, items: { type: 'string' } },
                  events: { type: 'array', optional: true, items: { type: 'string' } },
                  messageKeys: { type: 'array', optional: true, items: { type: 'string' } },
                  tablesTouched: { type: 'array', optional: true, items: { type: 'string' } },
                },
              },
              evidence: EVIDENCE_SCHEMA,
            },
          },
        },
        coverage: {
          type: 'object',
          required: ['candidatesRead', 'bodiesReturned', 'bodiesEmpty'],
          props: {
            candidatesRead: { type: 'number', min: 0 },
            bodiesReturned: { type: 'number', min: 0 },
            bodiesEmpty: { type: 'number', min: 0 },
            truncated: { type: 'boolean', optional: true },
            note: { type: 'string', optional: true },
          },
        },
        dropped: {
          type: 'array', optional: true,
          items: { type: 'object', required: ['table', 'sysId', 'reason'], props: { table: { type: 'string' }, sysId: { type: 'string' }, reason: { type: 'string', minLength: 5 } } },
        },
        findings: { type: 'array', optional: true, items: FINDING_SCHEMA },
      },
    },
    example: (ctx) => ({
      stage: 'explain', instance: ctx.state.instance,
      usage: { apiCalls: 24, requestLog: '<sync-root>/spikes/scriptsync-read/snbrain-requests.ndjson' },
      claims: [{
        locus: { table: 'sys_script', sysId: '3811602f1b8a43909e2aa934604bcb42', field: 'script' },
        assertion: 'Sets is_sensitive to true on incidents whose category is qrt and whose state is 0 or 6, before insert and before update.',
        band: 'A', scope: 'x_acme_acme',
        behaviour: {
          bodyField: 'script', bodyEmpty: false, bodyLength: 96,
          excerpt: "current.setValue('is_sensitive', true);",
          trigger: 'category=qrt^stateIN0,6',
          callees: [], events: [], messageKeys: [], tablesTouched: [],
        },
        evidence: {
          query: 'sys_idIN3811602f1b8a43909e2aa934604bcb42', fields: 'sys_id,name,script,condition,when,order,active',
          capturedAt: '2026-08-04T09:31:10Z', transport: 'rest_request', completeness: 'complete',
          capturedResponse: {
            sys_id: '3811602f1b8a43909e2aa934604bcb42', name: 'ACME QRT Set Sensitive',
            script: "(function executeRule(current, previous) {\n  current.setValue('is_sensitive', true);\n})(current, previous);",
            condition: 'category=qrt^stateIN0,6', when: 'before', order: '100', active: 'true',
          },
          guards: { fields: 'validated', identityCanary: 'pass' },
        },
      }],
      coverage: { candidatesRead: 1, bodiesReturned: 1, bodiesEmpty: 0, truncated: false },
      dropped: [{ table: 'sys_hub_flow', sysId: 'a1b2c3d4e5f60718293a4b5c6d7e8f90', reason: 'unreadable: Flow Designer logic lives in the snapshot, not in a script column on the flow' }],
      acceptance: [{ id: 'AC-EXP-1', result: 'pass', evidence: 'every assertion quotes a verbatim substring of the captured body' }],
    }),
    acceptance: [
      { id: 'AC-EXP-1', statement: 'Every behaviour claim is grounded: its excerpt is a verbatim substring of the body captured in its own evidence.', howToEvidence: 'the CLI checks this character for character and will not take your word for it.' },
      { id: 'AC-EXP-2', statement: 'No assertion is a restatement of the record\'s own name, and none is a disclaimer about not having read the body.', howToEvidence: 'token overlap against the record name, and the absence of "purpose implied by" phrasing.' },
      { id: 'AC-EXP-3', statement: 'Records whose body came back empty are reported as empty, not described from their names.', howToEvidence: 'behaviour.bodyEmpty and the coverage counts.' },
      { id: 'AC-EXP-4', statement: 'Every candidate not read is recorded with a reason.', howToEvidence: 'the dropped list, reconciled by the CLI against the ranked set it handed you.' },
    ],
    validate: (ctx, art) => {
      const rej = [];
      const cand = explainCandidates(ctx);
      const allowed = new Map(cand.ranked.map((x) => [`${x.table}|${x.sysId}`, x]));

      for (const c of art.claims) {
        const key = `${c.locus.table}|${c.locus.sysId}`;
        // PLATFORM-3 / PLATFORM-11 apply to every filtered read, not just the harvest's.
        for (const problem of lintEncodedQuery(c.evidence && c.evidence.query)) {
          rej.push(`claims: ${key} — ${problem}`);
        }
        if (!allowed.has(key)) {
          rej.push(`claims: ${key} is not in the ranked candidate set the brief handed you. The CLI computes that list from the claim ledger so the budget stays bounded and the ranking stays deterministic; do not widen it.`);
          continue;
        }
        const known = BODY_FIELDS[c.locus.table] || {};
        const bodyFields = known.body || [];
        if (bodyFields.length && !bodyFields.includes(c.behaviour.bodyField)) {
          rej.push(`claims: ${key} reports bodyField "${c.behaviour.bodyField}", but behaviour on ${c.locus.table} lives in ${bodyFields.join(' or ')}.`);
        }

        if (c.behaviour.bodyEmpty) {
          // An empty body is a legitimate, recordable outcome — but then there is nothing to
          // assert about behaviour, so the assertion may not describe any.
          if (c.behaviour.excerpt) {
            rej.push(`claims: ${key} is marked bodyEmpty but carries an excerpt. One of the two is untrue.`);
          }
          continue;
        }

        // GROUNDING. The single check that makes this stage's output auditable: the excerpt
        // must literally occur in the response this claim captured. A model cannot satisfy
        // this by writing a more confident sentence.
        const resp = c.evidence && c.evidence.capturedResponse;
        const body = resp && typeof resp === 'object' ? resp[c.behaviour.bodyField] : null;
        if (!c.behaviour.excerpt || !String(c.behaviour.excerpt).trim()) {
          rej.push(`claims: ${key} has a non-empty body but no excerpt. behaviour.excerpt is what makes the assertion checkable.`);
        } else if (typeof body !== 'string' || !body.length) {
          rej.push(`claims: ${key} asserts behaviour but its capturedResponse carries no "${c.behaviour.bodyField}" text. The body must be IN the evidence, not merely read on the way past.`);
        } else if (!normText(body).includes(normText(c.behaviour.excerpt))) {
          rej.push(`claims: ${key} excerpt is not a verbatim substring of the captured ${c.behaviour.bodyField}. Quote the body, do not paraphrase it — this check is character for character.`);
        }

        // Spec check 17: a behaviour cell of fewer than eight words is a label, not a reading.
        if (String(c.assertion).trim().split(/\s+/).length < 8) {
          rej.push(`claims: ${key} assertion is under 8 words. "${truncateStr(c.assertion, 60)}" is a label; say what the record does.`);
        }
        // Spec check 18: it must not merely restate the record's own name.
        const name = (resp && typeof resp === 'object' && (resp.name || resp.sys_name)) || (allowed.get(key) || {}).name;
        if (name && tokenOverlap(c.assertion, name) >= 0.6) {
          rej.push(`claims: ${key} assertion restates the record's own name ("${truncateStr(name, 40)}"). A reader who can see the name learns nothing from it.`);
        }
        // Spec check 20: no disclaimers standing in for a reading.
        if (/purpose implied by|inferred from (the )?name|no (script |logic )?body was read|not read|unknown purpose/i.test(c.assertion)) {
          rej.push(`claims: ${key} assertion is a disclaimer, not a behaviour. If the body could not be read, set bodyEmpty or report it in dropped with a reason.`);
        }
      }

      /*
       * PRODUCT-96, second half, on the stage where it did the most damage. Explain writes the
       * sentences the wiki quotes, and on run 93838afe87 three of them said three `Save and Close`
       * actions "carry neither script nor condition" — read off the empty `script` column of a
       * workspace action whose logic lives in `client_script_v2`. `behaviour.bodyEmpty` is the
       * supported way to record that a body came back empty, and it is checked against the
       * captured response; prose asserting an absence over a column that was never requested is
       * not, and this is where it stops.
       */
      const emptyBad = emptyAssertionViolations(art.claims);
      if (emptyBad.length) { rej.push(emptyAssertionRejection(emptyBad, 'behaviour claim(s)')); }

      // Coverage arithmetic, and the empty-read rule this platform makes load-bearing.
      const cov = art.coverage;
      if (cov.bodiesReturned > cov.candidatesRead) {
        rej.push(`coverage: bodiesReturned (${cov.bodiesReturned}) exceeds candidatesRead (${cov.candidatesRead}).`);
      }
      if (cov.candidatesRead > 0 && cov.bodiesReturned === 0 && cov.bodiesEmpty === 0) {
        rej.push(`coverage: ${cov.candidatesRead} candidate(s) were read and NOTHING came back — neither a body nor an empty one. On this platform that is a broken session far more often than it is a table of blank scripts. The honest result is blocked, not an empty explain.`);
      }
      const claimed = new Set(art.claims.map((c) => `${c.locus.table}|${c.locus.sysId}`));
      const droppedKeys = new Set((art.dropped || []).map((d) => `${d.table}|${d.sysId}`));
      const unaccounted = cand.ranked.filter((x) => !claimed.has(`${x.table}|${x.sysId}`) && !droppedKeys.has(`${x.table}|${x.sysId}`));
      if (unaccounted.length) {
        rej.push(`${unaccounted.length} ranked candidate(s) are neither claimed nor dropped (e.g. ${unaccounted.slice(0, 3).map((x) => `${x.table}|${x.sysId}`).join(', ')}). Every candidate the CLI handed you must come back as a claim or as a drop with a reason.`);
      }
      return rej;
    },
    apply: (ctx, art) => {
      const cand = explainCandidates(ctx);
      const findings = (art.findings || []).slice();

      /*
       * PLAN 1.2 — `evidence-class-unread`, and it is BLOCKING on purpose.
       *
       * The reference run raised 232 findings and not one of them was blocking, so the single
       * most output-destroying fact available — that no logic body was ever read — was filed
       * five times as a `warning` and could not stop anything. A whole class of evidence going
       * unread is not a warning: it is the difference between a brain and a card index, and it
       * must stop the run going green while leaving the run itself free to finish.
       */
      const readByTable = new Map();
      for (const c of art.claims) {
        if (c.behaviour.bodyEmpty) { continue; }
        readByTable.set(c.locus.table, (readByTable.get(c.locus.table) || 0) + 1);
      }
      const inventoried = new Set(cand.ranked.map((x) => x.table));
      for (const table of inventoried) {
        if (!readByTable.get(table)) {
          const n = cand.ranked.filter((x) => x.table === table).length;
          findings.push({
            check: `evidence-class-unread-${table}`, severity: 'blocking', rung: 'L1',
            message: `${n} record(s) on ${table} were inventoried and ranked for explanation, and ZERO logic bodies were read. ` +
              `Behaviour on this table lives in ${(BODY_FIELDS[table].body || []).join('/')}. Until it is read, every page rendering ` +
              `${table} can say that a record exists and not what it does, and "what does X do" is unanswerable from this brain.`,
          });
        }
      }
      for (const u of cand.unreadable) {
        // Not blocking: an honest transport limit, recorded so silence cannot read as "no logic".
        findings.push({
          check: `behaviour-unreadable-${u.table}`, severity: 'warning', rung: 'L1',
          message: `${u.table}: ${BODY_FIELDS[u.table].unreadable || 'no body field is defined for this table'} Records here are inventoried without behaviour, and that is a property of the transport, not of the records.`,
        });
      }

      return {
        // Behaviour claims enter the ledger as draft like every other claim: verify re-queries
        // them, and a behaviour whose body has since changed is drift like any other.
        /*
         * PLAN 6.7 / PRODUCT-89 — THE RUNG IS L3, NOT L1, because the rung names the ladder step
         * that can close the claim. An interpretation's assertion is a sentence about behaviour:
         * L1 re-query confirms the BODY, never the sentence — run 93838afe87 stamped all 150
         * interpretations verified by comparing a field to itself — and the ladder's own row for
         * "fresh agent gets the claim text only and re-derives" is L3. verify's validator refuses
         * a `verified` verdict on these outright; the substrate is still re-read and hashed.
         */
        claims: art.claims.map((c) => Object.assign({}, c, { status: 'draft', rung: 'L3', kind: 'behaviour' })),
        findings,
        raw: (art.dropped || []).map((d) => Object.assign({ kind: 'explain-dropped' }, d)),
        facts: {
          explain: {
            candidatesRanked: cand.ranked.length, belowCap: cand.overflow.length, unreadable: cand.unreadable.length,
            coverage: art.coverage, tables: [...readByTable.keys()],
            bodiesRead: [...readByTable.values()].reduce((a, b) => a + b, 0),
          },
        },
        progress: true,
      };
    },
    next: (ctx) => {
      const cov = (ctx.state.facts.explain && ctx.state.facts.explain.coverage) || {};
      return cov.truncated ? 'explain' : 'verify';
    },
  },

  // =========================================================================
  {
    id: 'verify',
    title: 'Verify — L1 re-query of claims, diff values, mark verified/drifted/gone/unverifiable',
    stagnation: 'resolutions',
    /*
     * PLAN 5.17 / PRODUCT-37. Verify is the one stage that may declare claims unread and move on,
     * because it is the only stage whose job IS the ledger. Both fields are read by
     * `snbrain close-unsampled`; a stage that declares neither cannot take the exit at all, which
     * is a table entry rather than a special case in the CLI (invariant 7).
     *
     * `forwardRoute` deliberately mirrors `verifyForward` — the close takes its own route and
     * never consults `next()`, because `next()` returns 'verify' precisely while claims are open,
     * which is the state the close exists to escape.
     */
    allowsUnsampledClose: true,
    forwardRoute: (ctx) => verifyForward(ctx),
    goal: (ctx) => {
      const open = [...ctx.brain.claims().values()].filter((c) => ['draft', 'unverified', 'drifted'].includes(c.status));
      const stale = staleClaims(ctx.brain);
      /*
       * PRICE THE JOB IN THE UNIT THE TRANSPORT BILLS IN. This used to lead with the CLAIM
       * count — 8,179 on run 6ef14f5562 — two lines above telling the agent to batch by locus
       * and giving it no locus count. The run's quirks log then recorded convergence as "~8,179
       * further re-queries; 93 calls remained" and the third hand edit was performed on that
       * number. The real figure over the same ledger is 3,807 loci across 93 tables: 138 batched
       * reads plus 93 field validations, 231 calls. Short by ~138, not by 8,086.
       */
      const cost = claimReadCost(open);
      return `Re-query ${cost.loci} distinct locus/loci across ${cost.tables} table(s) — about ${cost.batchedReads} ` +
        `batched read(s) at ${cost.batchSize} ids each plus ${cost.fieldValidations} field validation(s), ` +
        `~${cost.estimatedCalls} call(s) — settling ${open.length} open claim(s)${stale.length ? ` plus ${stale.length} VERIFIED claim(s) whose staleness horizon has passed` : ''}, and diff the live value against the captured response. ` +
        `That estimate is ADVISORY: sys_idIN limits vary by table width on this platform, so check it against what your first batches actually cost and say so if it is wrong. ` +
        (stale.length ? 'A stale claim is one that was verified, and then left alone long enough that the verdict is a statement about the past. Re-querying it is how an incremental run stays honest instead of inheriting last month\'s confidence. ' : '') +
        'BATCH BY LOCUS, not by claim: several claims usually assert different fields of one record, and one re-query settles all of them. ' +
        'You are the CHECKER and you do not get the harvester\'s reasoning: you get the claim text and the ' +
        'recorded query, and you re-derive from ground truth. A claim you cannot settle is `unverifiable` ' +
        `with one of these reasons: ${AGENT_UNVERIFIABLE_REASONS.join(' | ')} — that is a real outcome, not a failure, and laundering it into ` +
        '`verified` is the specific defect this stage exists to prevent. BEHAVIOUR claims (kind: behaviour, from the ' +
        'explain stage) are INTERPRETATIONS: re-reading the script body confirms the body, never the sentence describing ' +
        'it, so `verified` is refused for them outright. Re-read the body anyway and record ' +
        '`unverifiable` with reason "interpretation" and the body you read in `observed` — the CLI hashes it so a later ' +
        'run can see the SUBSTRATE change — or `drifted` with a diff when the body changed, or `gone`. There is one more ' +
        'reason, `not-sampled`, and it is NOT yours: the CLI mints it from a recorded close over a named population, ' +
        'and an artifact carrying it is rejected at the schema and again at the ledger.';
    },
    reads: () => [
      { path: 'docs/rework-plan.md#296-307', why: 'The verification ladder L0-L5, and why an L4 finding may not be dismissed by L4.', required: true },
      { path: '.brain/claims.jsonl', why: 'The claims to re-query. Use `snbrain claims --status draft --json` to get them without loading the file.', required: true },
      { path: '.claude/skills/snbrain-verify/SKILL.md', why: 'Engagement procedure, if the repo has one.', required: false },
    ],
    procedure: () => [
      'L0 first: validate fields, run the batch canary. A canary that returns nothing means terminal `blocked`, NEVER `absent`.',
      'L1: replay each claim\'s recorded evidence.query, diff the values, and write a verdict per claim.',
      'verified = the value still matches. drifted = it changed (record from/to). gone = the record no longer exists. unverifiable = you could not settle it, with reason blocked-by-access | no-oracle | requires-write.',
      'L2: look for contradictions ACROSS claims — two claims asserting incompatible things about one locus, duplicate loci with different assertions. Raise them as findings.',
      'Raise a finding for anything that blocks. severity is IMMUTABLE once recorded: you close a finding by fixing it and setting a disposition, never by relabelling it. An artifact that changes a severity is rejected.',
      'Resolutions are counted by the CLI from the ledger. Two consecutive iterations that resolve NOTHING terminate the run as `stalled`, so if you cannot make progress, say why in a finding rather than re-submitting.',
    ],
    schema: {
      type: 'object',
      required: ['verdicts'],
      props: {
        verdicts: {
          type: 'array', min: 1,
          items: {
            type: 'object',
            required: ['claimId', 'status', 'query', 'capturedAt'],
            props: {
              claimId: { type: 'string', pattern: '^C-[0-9a-f]{12}$' },
              status: { type: 'string', enum: ['verified', 'drifted', 'gone', 'unverifiable'] },
              // PLAN 5.17: the AGENT reasons only. `not-sampled` is CLI-minted and this schema
              // is the door an agent knocks on. The ledger's own gate in upsertClaims is the
              // second door, because a guard in one of two doors is not a guard.
              unverifiableReason: { type: 'string', optional: true, enum: AGENT_UNVERIFIABLE_REASONS.slice() },
              query: { type: 'string', minLength: 1 },
              capturedAt: { type: 'string', minLength: 10 },
              observed: { type: 'any', optional: true },
              diff: { type: 'array', optional: true, items: { type: 'object', required: ['field', 'from', 'to'], props: { field: { type: 'string' }, from: { type: 'any' }, to: { type: 'any' } } } },
            },
          },
        },
        canary: { type: 'object', optional: true, required: ['result', 'rows'], props: { result: { type: 'string', enum: ['pass', 'fail'] }, rows: { type: 'number', min: 0 } } },
        findings: { type: 'array', optional: true, items: FINDING_SCHEMA },
      },
    },
    example: () => ({
      stage: 'verify', instance: '<instance>',
      usage: { apiCalls: 64, requestLog: '<sync-root>/spikes/scriptsync-read/snbrain-requests.ndjson' },
      canary: { result: 'pass', rows: 1 },
      verdicts: [
        { claimId: 'C-a1b2c3d4e5f6', status: 'verified', query: 'sys_idIN9ec847db…', capturedAt: '2026-08-04T10:00:00Z', observed: { active: 'true' } },
        { claimId: 'C-0f1e2d3c4b5a', status: 'drifted', query: 'sys_idINa7b58042…', capturedAt: '2026-08-04T10:00:02Z', observed: { active: 'false' }, diff: [{ field: 'active', from: 'true', to: 'false' }] },
        { claimId: 'C-9988aabbccdd', status: 'unverifiable', unverifiableReason: 'blocked-by-access', query: 'sys_idIN…', capturedAt: '2026-08-04T10:00:04Z' },
      ],
      acceptance: [{ id: 'AC-VER-1', result: 'pass', evidence: 'batch canary returned 1 row before any verdict was written' }],
    }),
    acceptance: [
      { id: 'AC-VER-1', statement: 'A batch canary returned rows in this session before any verdict was written.', howToEvidence: 'canary.rows > 0. Without it, every `gone` verdict is unsound.' },
      { id: 'AC-VER-2', statement: 'Every verdict came from a re-query, not from re-reading the harvest artifact.', howToEvidence: 'the query and capturedAt on each verdict.' },
      { id: 'AC-VER-3', statement: 'Claims that could not be settled are `unverifiable` with a reason, not `verified`.', howToEvidence: 'unverifiableReason from the closed set.' },
      { id: 'AC-VER-4', statement: 'Cross-claim contradictions were looked for and either found or shown absent.', howToEvidence: 'L2 findings, or an explicit statement that the L2 pass ran clean.' },
    ],
    validate: (ctx, art) => {
      const rej = [];
      const ledger = ctx.brain.claims();
      const unknown = art.verdicts.filter((v) => !ledger.has(v.claimId));
      if (unknown.length) {
        rej.push(`${unknown.length} verdict(s) name a claim id that is not in the ledger (${unknown.slice(0, 3).map((v) => v.claimId).join(', ')}). Ids are content hashes allocated by the CLI — get them from "snbrain claims --json", never construct them.`);
      }
      const missingReason = art.verdicts.filter((v) => v.status === 'unverifiable' && !v.unverifiableReason);
      if (missingReason.length) {
        rej.push(`${missingReason.length} unverifiable verdict(s) carry no reason. Pick one of: ${AGENT_UNVERIFIABLE_REASONS.join(' | ')}. An unverifiable with no reason is indistinguishable from a skipped claim — which is a real outcome with its own reason, minted by the CLI and not available to you.`);
      }
      const driftNoDiff = art.verdicts.filter((v) => v.status === 'drifted' && !(v.diff && v.diff.length));
      if (driftNoDiff.length) {
        rej.push(`${driftNoDiff.length} drifted verdict(s) carry no diff. Drift without from/to is an assertion, not a finding — and the supersession link needs the values to write the reconfirmation question.`);
      }
      if (art.canary && art.canary.result === 'fail') {
        rej.push('canary.result=fail. Do not write verdicts against a session whose canary failed: an empty read is more often a broken session than an empty table, and every `gone` you record would be confidently wrong.');
      }
      /*
       * PLAN 6.7 / PRODUCT-89 — AN INTERPRETATION IS NOT AN L1 CLAIM AND MUST NOT BE STAMPED BY
       * AN L1 VERB. Run 93838afe87 marked all 150 behaviour claims `verified` by re-querying the
       * body their assertion interprets: lastVerdict.diff was null on every one, because a field
       * always equals itself. A mis-read filter condition, an inverted branch, or an event
       * attributed to the wrong table would pass that verification with the same green as
       * `label = Next scheduled`. The legal verdicts for a behaviour claim name the enum values
       * outright (the render agent taught us prose requirements get implemented as prose):
       * status "unverifiable" with unverifiableReason "interpretation" and the re-read body in
       * `observed`; status "drifted" with a diff when the body changed; status "gone".
       */
      {
        const wrong = art.verdicts.filter((v) => { const c = ledger.get(v.claimId); return c && c.behaviour && v.status === 'verified'; });
        if (wrong.length) {
          rej.push(
            `${wrong.length} verdict(s) mark a BEHAVIOUR claim verified (${wrong.slice(0, 3).map((v) => v.claimId).join(', ')}). ` +
            'Re-reading a script body confirms the body; it says nothing about the sentence describing it — a field always ' +
            'equals itself, which is how the previous run stamped 150 interpretations green. Record status: "unverifiable" ' +
            'with unverifiableReason: "interpretation" and the body you re-read in `observed` (the CLI hashes it, so a later ' +
            'run can see the SUBSTRATE change even though the sentence cannot be mechanically re-checked); or status: ' +
            '"drifted" with a diff when the body changed; or status: "gone" when the record vanished. An interpretation ' +
            'closes at L3 (a fresh reader re-derives it from the claim text alone) or L5 (a human), never at L1.');
        }
        const unhashed = art.verdicts.filter((v) => {
          const c = ledger.get(v.claimId);
          return c && c.behaviour && v.status === 'unverifiable' && v.unverifiableReason === 'interpretation' && !v.observed;
        });
        if (unhashed.length) {
          rej.push(
            `${unhashed.length} interpretation verdict(s) carry no \`observed\` body (${unhashed.slice(0, 3).map((v) => v.claimId).join(', ')}). ` +
            'The whole point of re-reading an interpretation\'s substrate is the hash: without the body you read, a later run ' +
            'cannot tell whether the script changed under the sentence. Put the re-read body field in `observed`.');
        }
        /*
         * THE CHEAPEST LEGAL SATISFACTION, GUARDED. With "interpretation" in the reason enum, the
         * cheap dodge is marking ORDINARY claims unverifiable-interpretation and skipping the
         * re-query entirely. A <field> = <value> claim has an oracle; the reason belongs to
         * behaviour claims alone.
         */
        const misused = art.verdicts.filter((v) => { const c = ledger.get(v.claimId); return c && !c.behaviour && v.unverifiableReason === 'interpretation'; });
        if (misused.length) {
          rej.push(
            `${misused.length} verdict(s) mark a plain field claim unverifiable with reason "interpretation" ` +
            `(${misused.slice(0, 3).map((v) => v.claimId).join(', ')}). That reason belongs to claims carrying a behaviour ` +
            'block, and to nothing else: a <field> = <value> claim HAS an oracle — replay the recorded query and diff. ' +
            'Settle it honestly: verified, drifted, gone, or blocked-by-access | no-oracle | requires-write when that is true.');
        }
      }
      /*
       * METHOD-6 / PHASE B. Chain coherence, raised HERE and not at harvest or render.
       *
       * Not harvest: an edge dangles or does not depending on what every OTHER area harvested, so
       * a per-artifact version would report a break that the next area repairs. Not render: the
       * graph is final the moment the last claim lands, and render is downstream of the questions
       * and interview stages that would have wanted to ask about it. Verify is the first stage that
       * sees the whole ledger, and L2 — "look for contradictions ACROSS claims" — is already its
       * declared job. A reference to a record nobody mapped is exactly that kind of fact.
       *
       * Findings dedupe on (check, locus, rung), so a class emits one row however many verify
       * iterations run, and the row UPDATES rather than piling up.
       *
       * Rebuilt from scratch every iteration ON PURPOSE. Measured on pilot-run-4's ledger — 39,099
       * appended rows, 19,360 distinct claims, 4,830 artifacts — the whole graph costs 207ms, next
       * to a stage whose unit of work is a network round trip. A cache here would buy nothing and
       * could serve a stale answer to the one question the stage is being asked.
       */
      {
        const coherence = danglingFindings([...ledger.values()]);
        if (coherence.length) { (art.findings = art.findings || []).push(...coherence); }
      }
      return rej;
    },
    apply: (ctx, art) => {
      const ledger = ctx.brain.claims();
      const now = new Date().toISOString();
      const staleDays = (ctx.state.config && ctx.state.config.staleAfterDays) || 14;
      const claims = art.verdicts.map((v) => {
        const prev = ledger.get(v.claimId) || {};
        /*
         * PLAN 6.7 / PRODUCT-89. THE SUBSTRATE HASH. An interpretation's sentence cannot be
         * mechanically re-checked, but the body it interprets can be fingerprinted: the hash of
         * the re-read body is stored on the claim, so a later run diffing hashes sees the script
         * change underneath the sentence — the one drift signal an unverifiable claim can carry.
         */
        let substrateHash = prev.substrateHash || null;
        if (prev.behaviour && v.status === 'unverifiable' && v.unverifiableReason === 'interpretation' && v.observed) {
          const body = (typeof v.observed === 'object' && v.observed !== null && prev.behaviour.bodyField in v.observed)
            ? v.observed[prev.behaviour.bodyField] : v.observed;
          if (body !== null && body !== undefined && String(body).length) { substrateHash = digest(String(body), 8); }
        }
        return Object.assign({}, prev, {
          locus: prev.locus, assertion: prev.assertion,   // identity fields must not move
          status: v.status,
          unverifiableReason: v.unverifiableReason || null,
          verifiedAt: v.status === 'verified' ? v.capturedAt : (prev.verifiedAt || null),
          staleAfter: new Date(Date.now() + staleDays * 86400000).toISOString().slice(0, 10),
          substrateHash,
          lastVerdict: { status: v.status, query: v.query, at: v.capturedAt, observed: v.observed || null, diff: v.diff || null, recordedAt: now, substrateHash },
        });
      });
      return {
        claims,
        findings: art.findings || [],
        raw: art.verdicts.map((v) => Object.assign({ kind: 'verdict' }, v)),
        progress: true,   // progress is recomputed from RESOLUTIONS by the engine
        progressFrom: 'resolutions',
      };
    },
    next: (ctx) => {
      const open = [...ctx.brain.claims().values()].filter((c) => ['draft', 'unverified', 'drifted'].includes(c.status));
      // A stage loops only on blocking findings IT can act on. A structural finding raised
      // by the census (say, "we could not separate your work from ServiceNow's") is a
      // permanent property of the instance, not a repair task: looping on it would burn the
      // cap and terminate `exhausted` on a run that is actually finishing correctly. It
      // still blocks terminal success, and it is closed by an attributed disposition
      // (`snbrain disposition`), which is the honest way to close a fact you cannot fix.
      const mine = ctx.brain.openBlockingFindings().filter((f) => f.openedByStage === 'verify');
      // Stale claims keep the stage alive too, or the horizon is advisory again.
      if (open.length || mine.length || staleClaims(ctx.brain).length) { return 'verify'; }
      /*
       * PLAN 5.17 — A SETTLEMENT MAY NOT BE THE REASON THIS STAGE ADVANCES.
       *
       * `not-sampled` is settled, so it leaves `open` above — and that is precisely the hole.
       * If a settlement could empty the open set, one ingest would report 8,179 resolutions,
       * reset the stagnation counter and route to questions: the CLI declaring the unread
       * ledger closed. That is coverage theatre, and it is harder to see than the agent kind
       * because nothing in the payload looks wrong.
       *
       * So unsampled claims are held in their own queue leg. The sanctioned exit is
       * `snbrain close-unsampled`, which writes the close into `queue.unsampled.closes`,
       * names the population, names the person, prices what re-reading would have cost, and
       * takes the route from `forwardRoute` WITHOUT EVER CONSULTING THIS FUNCTION. What is
       * left for this leg to catch is a not-sampled claim with no close covering it — which
       * exists only after a hand edit or a caller that minted without recording, the two
       * things this whole file is for.
       */
      const orphan = orphanUnsampledClaims(ctx);
      if (orphan.length) { return 'verify'; }
      return verifyForward(ctx);
    },
  },

  // =========================================================================
  {
    id: 'questions',
    title: 'Questions — generate, scope-filter, rank, anti-waste filter, emit ranked questions',
    stagnation: 'none',
    goal: (ctx) =>
      `Compute questions FROM THE LEDGER. You do not author questions from impressions: every question ` +
      `is a named two-source disagreement with a support count, and a lone anomaly is DROPPED. ` +
      `You supply the wording and the observable ranking TERMS; the CLI computes V and WPM, applies the ` +
      `cap of ${(ctx.state.config && ctx.state.config.questionCap) || 10}, and orders deterministically. ` +
      `The top-N truncation is the safety mechanism that protects the human, not the gates, so the terms you report are load-bearing.`,
    reads: () => [
      { path: 'docs/rework-plan.md#556-716', why: 'The surviving signal catalogue with its priors, the ranker (4.9.5), and the six anti-waste gates (4.9.6). Read the admission rule: pB\' >= 0.60 is admitted, below is shadow and is never sent to a human.', required: true },
      { path: '.brain/claims.jsonl', why: 'The only legitimate source of a question.', required: true },
      { path: '.claude/skills/snbrain-questions/SKILL.md', why: 'Engagement procedure, if the repo has one.', required: false },
    ],
    procedure: (ctx) => [
      'QG1 CONTRADICTION-GATE: emit only where two sources disagree or a delta exists. A single odd-looking record is not a question. THE ONE EXCEPTION is gate=register-gap, which needs only sources.A — see the vocabulary rule below.',
      ((ctx) => {
        const vocab = vocabularyCandidates(ctx).slice(0, 12);
        const reserve = (ctx.state.config && ctx.state.config.vocabularyReserve) || 3;
        if (!vocab.length) { return 'VOCABULARY: no token recurs across two or more customer-authored records on this instance, so there is no register gap to ask about. Say so rather than inventing one.'; }
        return `VOCABULARY, and ${reserve} slot(s) of the cap are RESERVED for it so it cannot be crowded out. ` +
          `These tokens recur across the customer-authored surface and nothing in the ledger expands them: ` +
          `${vocab.map((v) => `${v.display} (${v.loci} records${v.looksLikeAcronym ? ', looks like an acronym' : ''})`).join(', ')}. ` +
          `Ask what the top ones MEAN, as gate=register-gap with sources.A naming a record that carries the word and NO sources.B — ` +
          `there is nothing for a vocabulary gap to disagree with, which is exactly why it needs its own gate. ` +
          `Rank these by BREADTH (how many records carry the word), never by blast radius: a word that expands to nothing breaks nothing, ` +
          `and that is why the ordinary ranker scores it near zero. It is also the cheapest knowledge in the engagement — one line of an ` +
          `expert's time — and without it every page written in the customer's own words is unreadable to the person holding the story.`;
      })(ctx),
      'QG2 CLUSTER: group by (table, change-type, author, time-window). One question per cluster with the member count attached.',
      ((ctx) => {
        const stated = ((ctx.state.queue || {}).statedConventions || []);
        const testable = stated.filter((c) => c.testable);
        if (!stated.length) {
          return `CONVENTIONS: none were stated at orientation (stamp conventions="${ctx.state.stamps.conventions || 'unknown'}"). There is nothing to reconcile, and you may not invent one from the ledger — an induced convention is indistinguishable from drift, because only the author knows whether it was deliberate.`;
        }
        return `CONVENTIONS STATED BY A HUMAN, and ${testable.length} of ${stated.length} are testable against this ledger: ` +
          `${testable.map((c) => `${c.kind} "${c.statement}" (pattern ${c.pattern}, claim ${c.claimId})`).join('; ')}. ` +
          `MEASURE EACH ONE AND MAKE THE GAP THE QUESTION, as gate="convention-gap", sources.A.ref = the convention's ` +
          `claim id, sources.B = the measured ratio with the query that produced it, closed form with two branches ` +
          `(deliberate class-conditional / drift). Slots are RESERVED for these so they cannot be crowded out. ` +
          `An untestable convention is not asked about and is not a failure — say nothing rather than guessing.`;
      })(ctx),
      'Run the anti-waste gates in cost order and record every kill with its gate and reason in `suppressed` — that list is the only recall-shaped signal this design produces, so a silent drop destroys information. A convention you cannot measure is killed with gate "AW-CONV" and a reason naming its kind.',
      `Gate availability on this run: AW-2a is "${ctx.state.stamps['gates.AW-2a'] || 'unknown'}", AW-3.governed is "${ctx.state.stamps['gates.AW-3.governed'] || 'unknown'}". Report an unavailable gate's kills as ZERO, never as absent.`,
      ctx.state.stamps.provenance && ctx.state.stamps.provenance !== 'full'
        ? `Provenance envelope is "${ctx.state.stamps.provenance}". Where the envelope carries (author, date, container), write the CLOSED form with two named branches. Where it is empty, an open "why does this exist" is permitted — and the field evidence says it will not be answered.`
        : 'Provenance is full: prefer the CLOSED two-branch form everywhere. It converts a question the human already failed to answer into one he can answer in twenty seconds.',
      'Any consequence countable in one aggregate call MUST carry the count. A question that carries the blast number gets answered.',
      'Report rank TERMS only (E, C_guard, C_signal, A, U, M). If you supply V or wpm or an id the artifact is rejected.',
    ],
    schema: {
      type: 'object',
      required: ['questions', 'counts'],
      props: {
        questions: {
          type: 'array', min: 0,
          items: {
            type: 'object',
            required: ['signal', 'signalState', 'gate', 'sources', 'locus', 'question', 'form', 'rank'],
            forbidden: ['id', 'status'],
            props: {
              signal: { type: 'string', minLength: 2 },
              signalState: { type: 'string', enum: ['admitted', 'shadow', 'refused'] },
              /*
               * `convention-gap` is 5.26's reconciliation gate. The closed vocabulary that
               * decides what may be asked had five values and none of them could carry a
               * convention — which is why the ACME-class convention was induced from 422 rows
               * instead of asked about in one line. A doc-vs-instance disagreement needs no new
               * value: it is a `contradiction`, which is the shape the ranker already scores
               * highest.
               */
              gate: { type: 'string', enum: ['contradiction', 'delta', 'register-gap', 'decision-reconfirmation', 'process-naming', 'convention-gap'] },
              /*
               * `B` is OPTIONAL IN THE SCHEMA and required by the validator for every gate
               * except `register-gap`. The two-source rule is right for a contradiction — a
               * lone odd-looking record is not a question — but a vocabulary gap has only one
               * source by construction: the word is there, and nothing anywhere explains it.
               * There is nothing for it to disagree with. Requiring a second source made the
               * single cheapest question in the engagement unaskable.
               */
              sources: { type: 'object', required: ['A'], props: { A: { type: 'object', required: ['kind', 'ref'], props: { kind: { type: 'string' }, ref: { type: 'string' }, says: { type: 'string', optional: true } } }, B: { type: 'object', optional: true, required: ['kind', 'ref'], props: { kind: { type: 'string' }, ref: { type: 'string' }, says: { type: 'string', optional: true } } } } },
              locus: { type: 'array', min: 1, items: { type: 'object', required: ['sysId'], props: { table: { type: 'string', optional: true }, sysId: { type: 'string' }, claim: { type: 'string', optional: true }, band: { type: 'string', optional: true, enum: ['A', 'B', 'C'] } } } },
              cluster: { type: 'object', optional: true, required: ['key', 'size'], props: { key: { type: 'string' }, size: { type: 'number', min: 1 }, members: { type: 'array', optional: true, items: { type: 'string' } }, dissenters: { type: 'array', optional: true, items: { type: 'string' } } } },
              question: { type: 'string', minLength: 20 },
              /*
               * F10 (2026-09-02). THE WORD A REGISTER-GAP QUESTION IS ABOUT, as a field. The
               * kernel used to recover it by matching tokens against the question's prose, so
               * every word the sentence mentioned inherited the answer ("APIM" and "Process"
               * carry the VendorX definition on the first run). The CLI stamps `term` from the
               * quoted token when the agent omits it, and refuses a register-gap question with
               * no quotable word.
               */
              term: { type: 'string', optional: true, minLength: 1 },
              form: { type: 'string', enum: ['open', 'closed'] },
              branchMap: { type: 'object', optional: true, props: { a: { type: 'string' }, b: { type: 'string' } } },
              consequence: { type: 'object', optional: true, props: { text: { type: 'string', optional: true }, count: { type: 'number', optional: true }, countQuery: { type: 'string', optional: true } } },
              rank: {
                type: 'object', required: ['E', 'C_guard', 'C_signal', 'A', 'U', 'M'],
                forbidden: ['V', 'wpm'],
                props: { E: { type: 'number', min: 0 }, C_guard: { type: 'number', min: 0, max: 1 }, C_signal: { type: 'number', min: 0, max: 1 }, A: { type: 'number', min: 0, max: 1 }, U: { type: 'number', min: 1, max: 3 }, M: { type: 'number', min: 0.5, max: 8 }, priorSource: { type: 'string', optional: true } },
              },
              gates: { type: 'any', optional: true },
              provenance: { type: 'any', optional: true },
            },
          },
        },
        suppressed: { type: 'array', optional: true, items: { type: 'object', required: ['gate', 'reason'], props: { gate: { type: 'string' }, reason: { type: 'string' }, locus: { type: 'array', optional: true, items: { type: 'any' } } } } },
        counts: { type: 'object', required: ['candidates', 'afterGates'], props: { candidates: { type: 'number', min: 0 }, afterGates: { type: 'number', min: 0 }, perGateKills: { type: 'any', optional: true } } },
        findings: { type: 'array', optional: true, items: FINDING_SCHEMA },
      },
    },
    example: () => ({
      stage: 'questions', instance: '<instance>',
      usage: { apiCalls: 22, requestLog: '<sync-root>/spikes/scriptsync-read/snbrain-requests.ndjson' },
      /*
       * The arithmetic in this example BALANCES, and it has to: candidates - afterGates must
       * equal both the number of recorded suppressions and the sum of perGateKills, and the
       * questions array must carry every survivor. Those are the checks in validate() below.
       * A worked example that its own stage would reject is what a fresh subagent copies.
       */
      counts: { candidates: 5, afterGates: 1, perGateKills: { 'AW-1': 2, 'AW-3': 1, 'AW-4b': 1, 'AW-2a': 0 } },
      suppressed: [
        { gate: 'AW-1', reason: 'derivable from the platform default; asking would spend an expert on something the docs answer' },
        { gate: 'AW-1', reason: 'derivable from the platform default' },
        { gate: 'AW-3', reason: 'already governed by DEC-0004; re-asking a settled decision' },
        { gate: 'AW-4b', reason: 'single-record anomaly with no cluster; a lone oddity is not a contradiction' },
      ],
      questions: [{
        signal: 'QS-02', signalState: 'admitted', gate: 'contradiction',
        sources: { A: { kind: 'claim', ref: 'C-a1b2c3d4e5f6', says: 'active=false' }, B: { kind: 'cluster', ref: 'US:fb060e8e', says: '3 of 4 cluster members active=true' } },
        locus: [{ table: 'sys_script_client', sysId: '7a029a06…', claim: 'C-a1b2c3d4e5f6', band: 'A' }],
        cluster: { key: 'sys_update_set|fb060e8e', size: 4, members: ['…'], dissenters: ['7a029a06…'] },
        form: 'closed', branchMap: { a: 'deliberate → mint-dec', b: 'unfinished → mint-tbd' },
        question: 'ACME Subaction Prefill Due Date was set active=false inside update set STRY0185005.00 rather than after it, while its three cluster-mates ship active. (a) deliberate, or (b) unfinished?',
        consequence: { text: 'the prefill never runs on the workspace create form', count: null },
        rank: { E: 7.7, C_guard: 1.0, C_signal: 0.35, A: 1.0, U: 1.5, M: 0.5, priorSource: 'backtest-pilot-2026-08' },
      }],
      acceptance: [{ id: 'AC-Q-1', result: 'pass', evidence: 'every question cites two sources; 0 lone-anomaly emissions' }],
    }),
    acceptance: [
      { id: 'AC-Q-1', statement: 'Every emitted question is a two-source disagreement or a delta. No lone anomalies.', howToEvidence: 'sources.A and sources.B on each.' },
      { id: 'AC-Q-2', statement: 'Every suppression is recorded with its gate and reason.', howToEvidence: 'the suppressed list, and counts.perGateKills with unavailable gates shown as zero.' },
      { id: 'AC-Q-3', statement: 'Closed form was used wherever the provenance envelope supports it.', howToEvidence: 'form=closed with a two-entry branchMap.' },
      { id: 'AC-Q-4', statement: 'Every countable consequence carries its count.', howToEvidence: 'consequence.count plus the countQuery that produced it.' },
    ],
    validate: (ctx, art) => {
      const rej = [];
      if (ctx.state.stamps.scopeFilter && ctx.state.stamps.scopeFilter !== 'pass') {
        rej.push(`The scope filter terminated as "${ctx.state.stamps.scopeFilter}". This run may NOT raise questions about this instance at all. Do not soften this: it is the gate that stops the product asking an expert about ServiceNow's own defaults, or about a vendor's half-built scratch.`);
        return rej;
      }
      // Two sources for everything except a register gap, which has exactly one by construction.
      /*
       * TWO CONSTANTS, NOT ONE, AND EACH NAMES ITS OWN POPULATION.
       *
       * These were the same list doing two unrelated jobs — "which gates may cite one source"
       * and "which gates are exempt from the closed two-branch form" — and they diverge the
       * moment `convention-gap` exists. A stated convention with no measurable population has
       * exactly one source (the statement) and still has two branches ("deliberate" /
       * "drift"), so it belongs in the first list and must stay out of the second. Merging
       * them would have made the best question shape available to this loop unaskable in its
       * own best form.
       */
      const ONE_SOURCE_GATES = ['register-gap', 'process-naming', 'convention-gap'];
      const OPEN_FORM_EXEMPT_GATES = ['register-gap', 'process-naming'];
      // F10: a vocabulary question names its word, or the CLI cannot key the answer to it.
      const termless = art.questions.filter((q) => q.gate === 'register-gap' && !(q.term || extractTerm(q.question)));
      if (termless.length) {
        rej.push(`${termless.length} register-gap question(s) name no term: put the word in quotes in the question text ('QRT') or set \`term\`. ` +
          `The interview answer is keyed to that exact word — the kernel and the glossary join on it and on nothing else — so a vocabulary question with no quotable word yields a definition nothing can be attached to. ` +
          `First offender: "${String(termless[0].question).slice(0, 90)}".`);
      }
      const oneSource = art.questions.filter((q) => !ONE_SOURCE_GATES.includes(q.gate) && !(q.sources && q.sources.B));
      if (oneSource.length) {
        rej.push(`${oneSource.length} question(s) cite only one source with a gate other than ${ONE_SOURCE_GATES.join(' or ')}. A lone anomaly is not a question: name the two things that disagree, or drop it. (A vocabulary gap legitimately has one source — use gate=register-gap for that.)`);
      }
      /*
       * The closed-form rule exists because "why does this exist" reliably produces
       * "unknown / doesn't recall". A REGISTER GAP is exempt, and for the same reason the
       * two-source rule exempts it: there are no two branches to name. "What does QRT stand
       * for?" has no (a) and no (b) — it is a fill-in-the-blank with a short factual answer
       * the expert holds in their head. It is not the open form this rule was written against;
       * it is the cheapest question in the engagement, and forcing it into a two-branch
       * template would make it unaskable rather than better.
       */
      const open = art.questions.filter((q) => q.form === 'open' && !OPEN_FORM_EXEMPT_GATES.includes(q.gate) && ctx.state.stamps.provenance === 'full');
      if (open.length) {
        rej.push(`${open.length} question(s) are in OPEN form while the provenance envelope is "full". Where the envelope carries (author, date, container) the CLI requires the CLOSED template with two named branches — that conversion is the mechanism, and the field evidence for the open form is that it produced "unknown/doesn't recall". (gate=register-gap is exempt: a vocabulary gap has no two branches.)`);
      }
      const noBranch = art.questions.filter((q) => q.form === 'closed' && !(q.branchMap && q.branchMap.a && q.branchMap.b));
      if (noBranch.length) { rej.push(`${noBranch.length} closed question(s) have no two-entry branchMap. closed implies branchMap non-empty.`); }
      const claimLedger = ctx.brain.claims();
      const badRefs = [];
      for (const q of art.questions) {
        for (const l of q.locus) { if (l.claim && !claimLedger.has(l.claim)) { badRefs.push(l.claim); } }
      }
      if (badRefs.length) { rej.push(`locus claim ids not in the ledger: ${[...new Set(badRefs)].slice(0, 5).join(', ')}.`); }
      if (art.counts.afterGates > art.counts.candidates) { rej.push('counts: afterGates exceeds candidates. Gates only shrink the queue.'); }

      /*
       * THE CAP IS THE CLI'S, AND SUPPRESSION IS RECALL DATA.
       *
       * On the reference run: candidates 82, afterGates 16, questions emitted 10. Six survivors
       * never reached the artifact at all — the model applied the cap itself — so they arrived
       * with no id, no text and no reason, and the CLI could not defer what it never received.
       * The procedure for this very stage calls the suppressed list "the only recall-shaped
       * signal this design produces". Six of them were destroyed by the one mechanism LOOP.md
       * calls the safety mechanism.
       *
       * Separately 82 - 63 recorded kills = 19, against a declared afterGates of 16: three
       * questions unaccounted for in the stage's own arithmetic, which nothing checked.
       *
       * So: emit every survivor. The CLI ranks, applies the cap, and marks the surplus
       * `deferred` — a queue is a record, a cap is a send limit, and those are not the same
       * thing. And the gate arithmetic must balance.
       */
      if (art.questions.length !== art.counts.afterGates) {
        rej.push(`counts: afterGates is ${art.counts.afterGates} but ${art.questions.length} question(s) were emitted. Emit EVERY question that survived the gates — the CLI ranks them, applies the cap of ${(ctx.state.config && ctx.state.config.questionCap) || 10}, and marks the surplus "deferred". A question you drop here has no id, no text and no reason, and nothing downstream can tell it ever existed.`);
      }
      const killed = art.counts.candidates - art.counts.afterGates;
      const suppressed = art.suppressed || [];
      if (killed > 0 && suppressed.length !== killed) {
        rej.push(`suppressed: ${killed} candidate(s) were killed by the gates (${art.counts.candidates} - ${art.counts.afterGates}) but ${suppressed.length} suppression(s) are recorded. Every kill carries its gate and its reason: that list is the only recall-shaped signal this stage produces, and an unrecorded drop is indistinguishable from a question that was never generated.`);
      }
      if (art.counts.perGateKills && typeof art.counts.perGateKills === 'object') {
        const summed = Object.values(art.counts.perGateKills).reduce((a, b) => a + (typeof b === 'number' ? b : 0), 0);
        if (summed !== killed) {
          rej.push(`counts.perGateKills sums to ${summed}, but ${killed} candidate(s) were killed. The per-gate distribution has to account for every drop — report an unavailable gate as 0 rather than omitting it.`);
        }
      }
      /*
       * PLAN 5.26 / PRODUCT-74. THE GAP IS THE QUESTION, and this is what makes it non-optional.
       *
       * POPULATION, NAMED: every entry of `state.queue.statedConventions` carrying
       * `testable: true` — a convention a human stated at orientation AND supplied a
       * ledger-measurable pattern for. Nothing else is in scope: an untestable convention
       * ("update sets in multiple scopes are batched when we migrate") is a recorded statement,
       * and demanding a question about it would be the guessing this stage exists to replace.
       *
       * Run 6ef14f5562 measured a stated naming convention at 99.8% precision and ~19.6% recall
       * and found it CLASS-CONDITIONAL — ~100% on logic artifacts, 0% on structural rows — which
       * no amount of sampling can tell apart from drift, because only the author knows. It asked
       * none of them. Either reconcile the convention against the ledger and put the gap to the
       * human, or kill it explicitly at gate AW-CONV; silence is neither.
       */
      {
        const stated = ((ctx.state.queue || {}).statedConventions || []).filter((c) => c && c.testable);
        const asked = new Set((art.questions || [])
          .filter((q) => q.gate === 'convention-gap')
          .map((q) => (q.sources && q.sources.A && q.sources.A.ref) || null)
          .filter(Boolean));
        const killed = new Set((art.suppressed || [])
          .filter((s) => s && (s.gate === 'AW-CONV' || /AW-CONV/.test(String(s.gate || ''))))
          .map((s) => s.conventionKind || s.kind || String(s.reason || '')));
        const silent = stated.filter((c) => !asked.has(c.claimId)
          && !killed.has(c.kind) && ![...killed].some((k) => String(k).includes(c.kind)));
        if (silent.length) {
          rej.push(`stated conventions: ${silent.length} of ${stated.length} testable convention(s) a human stated at ` +
            `orientation were neither reconciled against the ledger nor explicitly killed: ` +
            `${silent.map((c) => `${c.kind} ("${c.statement}", pattern ${c.pattern})`).join('; ')}. ` +
            `Measure each against this run's claims and ask the GAP as gate="convention-gap" with sources.A.ref = the ` +
            `convention's claim id and sources.B = the measured ratio plus the query that produced it — or kill it at ` +
            `gate "AW-CONV" naming its kind. The reference run induced a naming convention at 99.8% precision and 19.6% ` +
            `recall, discovered it was class-conditional, and asked nothing: only the author can say whether that was ` +
            `deliberate, and slots are reserved so this cannot be crowded out by the cap.`);
        }
      }
      return rej;
    },
    apply: (ctx, art) => {
      const cap = (ctx.state.config && ctx.state.config.questionCap) || 10;
      // Rank HERE. The model reported observable terms; the arithmetic is not its business.
      const ranked = art.questions
        .map((q) => Object.assign({}, q, { rank: computeRank(q.rank) }))
        .sort(rankOrder);

      /*
       * RESERVED SLOTS FOR THE REGISTER, and without them the reserve is decorative.
       *
       * WPM computes V from E, C and U — every term derived from record counts and blast
       * radius. A vocabulary question has none: expanding an acronym breaks nothing, fixes
       * nothing, and touches no records, so it scores near the floor and is deferred out of
       * every cap it ever meets. The one register-gap question the reference run did emit
       * scored 1.07 and fell below the admission floor.
       *
       * That ranking is not wrong about consequence; it is measuring the wrong thing. A word
       * nobody can expand does not break the instance, it breaks the DELIVERABLE — every page
       * written in the customer's own words stops being readable by the person holding the
       * story. So the register is filled first, from its own reserve, in rank order among
       * itself, and the general cap is filled from what remains.
       */
      /*
       * TWO RESERVES, EACH NAMING ITS OWN POPULATION. A convention question has the same
       * defect against WPM that a vocabulary question has: E, C and U are all derived from
       * record counts and blast radius, and "is this prefix rule deliberate?" breaks nothing,
       * touches no records and scores at the floor. It loses every cap it meets. A single
       * merged reserve would let a run with many vocabulary candidates crowd out the
       * conventions and vice versa, and then neither reserve means what it says.
       *
       * `reserveFor` reads 0 as zero. The old `|| 3` silently restored the default when an
       * operator passed `--vocab-reserve 0`, which is a switch that does not switch off.
       */
      const reserveFor = (key, fallback) => {
        const v = ctx.state.config && ctx.state.config[key];
        return Math.max(0, typeof v === 'number' ? v : fallback);
      };
      const RESERVE_BUCKETS = [
        { name: 'convention', gates: ['convention-gap'], slots: reserveFor('conventionReserve', 2) },
        { name: 'vocabulary', gates: ['register-gap', 'process-naming'], slots: reserveFor('vocabularyReserve', 3) },
      ];
      const admitted = ranked.filter((q) => q.signalState === 'admitted');
      const queued = new Set();
      for (const bucket of RESERVE_BUCKETS) {
        let taken = 0;
        for (const q of admitted) {
          if (taken >= bucket.slots || queued.size >= cap) { break; }
          if (!bucket.gates.includes(q.gate) || queued.has(q)) { continue; }
          queued.add(q); taken += 1;
        }
      }
      for (const q of admitted) {
        if (queued.size >= cap) { break; }
        if (queued.has(q)) { continue; }
        queued.add(q);
      }
      const finalised = ranked.map((q) => {
        // F10: the term is a CLI-stamped key. The agent's own `term` stands when it gave one.
        const term = q.gate === 'register-gap' ? (q.term || extractTerm(q.question) || null) : (q.term || undefined);
        const keyed = term === undefined ? q : Object.assign({}, q, { term });
        if (keyed.signalState !== 'admitted') { return Object.assign({}, keyed, { status: 'shadow' }); }
        // Surplus is DEFERRED, never discarded: the queue is a record, the cap is a send limit.
        return Object.assign({}, keyed, { status: queued.has(q) ? 'queued' : 'deferred' });
      });
      /*
       * PLAN 7.3 — the induction leg runs HERE, CLI-computed, and its result is persisted in
       * the queue so the interview (7.4) can put each candidate to the human as
       * confirm / deny / correct. The agent never invents a candidate; it only words them.
       */
      const induced = decisionCandidates(ctx);
      /*
       * PLAN 7.4 — the question set may grow ONLY in why-kind questions here: everything in
       * `finalised` is the agent's artifact ranked and capped as before, and the appended rows
       * are one CLI-minted why-decision question per candidate, each naming its candidate
       * (sources.A.ref) and its witnesses (locus[].claim). Their ids are content-hashed by the
       * ledger, so re-ingest updates rather than duplicates.
       */
      const whyQuestions = whyQuestionsFromCandidates(induced.candidates);
      return {
        questions: finalised.concat(whyQuestions),
        findings: art.findings || [],
        raw: (art.suppressed || []).map((s) => Object.assign({ kind: 'suppressed' }, s)),
        queue: { decisionCandidates: induced.candidates, decisionCandidatesDropped: induced.dropped },
        facts: {
          questionEngine: {
            candidates: art.counts.candidates, afterGates: art.counts.afterGates,
            perGateKills: art.counts.perGateKills || {},
            emitted: finalised.filter((q) => q.status === 'queued').length,
            deferred: finalised.filter((q) => q.status === 'deferred').length,
            shadow: finalised.filter((q) => q.status === 'shadow').length,
            ratio: pct(finalised.filter((q) => q.status === 'queued').length, art.counts.candidates),
          },
          decisionInduction: {
            minted: induced.candidates.length,
            bySource: induced.candidates.reduce((m, c) => { m[c.source] = (m[c.source] || 0) + 1; return m; }, {}),
            dropped: induced.dropped.length,
            hallucinatedWitnesses: induced.counts.hallucinatedWitnesses,
            deletedRecords: induced.counts.deletedRecords,
          },
        },
        progress: true,
      };
    },
    next: (ctx) => {
      const queued = [...ctx.brain.questionsLedger().values()].filter((q) => q.status === 'queued');
      if (!queued.length) {
        return 'render';   // nothing worth an expert's time. That is a result, not a failure.
      }
      return 'interview';
    },
  },

  // =========================================================================
  {
    id: 'interview',
    title: 'Interview — human answers, recorded as DECISIONS linked to the claims they explain',
    stagnation: 'none',
    humanGate: true,
    goal: (ctx) => {
      const queued = [...ctx.brain.questionsLedger().values()].filter((q) => q.status === 'queued');
      const why = queued.filter((q) => q.gate === 'why-decision');
      const byPersona = why.reduce((m, q) => { const k = q.askTo || '(persona unknown)'; m[k] = (m[k] || 0) + 1; return m; }, {});
      return `Put ${queued.length} ranked question(s) in front of the human and record what comes back. ` +
        'This is the ONLY rung that can close a WHY-claim, and it is the only stage in this loop with a ' +
        'human in it. Record the answer VERBATIM; a paraphrase of a rationale is an inference wearing a ' +
        'human\'s name. "I don\'t know" is a real, expected, majority-shaped outcome and is recorded as debt ' +
        'with an owner, not retried.' +
        (why.length
          ? ` ${why.length} of these are WHY-DECISION questions on their own budget (one per CLI-minted candidate, ` +
            `never competing with the general cap) — BATCH them by the persona who can answer: ` +
            `${Object.entries(byPersona).map(([k, v]) => `${k} (${v})`).join(', ')}. ` +
            'Each takes one line back: confirm / deny / correct-with-a-sentence (whyVerdict on the answer). ' +
            'A deny is recorded as refuted and never re-asked; an unanswered candidate ships as an INDUCED ' +
            'decision with its caveat, so silence costs precision, not correctness.'
          : '');
    },
    reads: () => [
      { path: 'docs/rework-plan.md#809-882', why: 'The decision schema, rationaleStrength, and witnessClaims vs explainsClaims — collapsing those two breaks supersession.', required: true },
      { path: '.brain/questions.jsonl', why: 'The queue. `snbrain questions --status queued --json`.', required: true },
    ],
    procedure: () => [
      'Present the evidence pack, not the transcript: cluster size, the blast number, the two branches, the provenance line.',
      'Record the answer verbatim in `verbatim`. Write `statement` and the alternative labels in your own words; write NOTHING else in your own words.',
      'kind=decision when a rationale was given. kind=debt when the answer is "unknown" or "later" — that needs an owner and a date. kind=unanswerable when the oracle failed. kind=deferred when it is simply not now.',
      'Do NOT supply explainsClaims, witnessClaims, rationaleStrength or any id: the CLI computes all four from the question record. That is what keeps the links trustworthy.',
      'Saturation is measured by the CLI: over the last five answered questions, fewer than two ledger deltas ends the stage. You do not decide when the interview is over.',
    ],
    schema: {
      type: 'object',
      required: ['answers'],
      props: {
        answers: {
          type: 'array', min: 1,
          items: {
            type: 'object',
            required: ['questionId', 'answeredBy', 'answeredAt', 'kind'],
            forbidden: ['id', 'explainsClaims', 'witnessClaims', 'rationaleStrength'],
            props: {
              questionId: { type: 'string', pattern: '^Q-[0-9a-f]{12}$' },
              answeredBy: { type: 'string', minLength: 2 },
              answeredAt: { type: 'string', minLength: 8 },
              kind: { type: 'string', enum: ['decision', 'debt', 'unanswerable', 'deferred'] },
              branch: { type: 'string', optional: true, enum: ['a', 'b'] },
              // PLAN 7.4 — the one-line answer form for a why-decision question. `correct`
              // requires the corrected sentence (statement or verbatim); the validator holds it to that.
              whyVerdict: { type: 'string', optional: true, enum: ['confirm', 'deny', 'correct'] },
              verbatim: { type: 'string', optional: true },
              rationale: { type: 'string', optional: true },
              statement: { type: 'string', optional: true },
              // PLAN 7.2 — the DEC ledger's forward-acting fields, worded from the human's
              // answer: what the decision DOES to the build, and the generalisation it sets
              // ("hide, don't delete"; "all user text via messages"). Words only; never links.
              impact: { type: 'string', optional: true },
              principle: { type: 'string', optional: true },
              alternatives: { type: 'array', optional: true, items: { type: 'object', required: ['label'], props: { label: { type: 'string' }, rejectedBecause: { type: 'string', optional: true } } } },
              owner: { type: 'string', optional: true },
              dueBy: { type: 'string', optional: true },
              channel: { type: 'string', optional: true },
              /*
               * The one thing only a human can supply: the CUSTOMER'S WORD for a cluster of
               * records. Answering a `process-naming` question binds it, and that name becomes
               * the unit the deliverable is organised by. `processDiscarded` is the equally
               * valuable negative answer — "those records are not a process, they are leftovers"
               * — because a cluster the human rejects must not become a page.
               */
              processName: { type: 'string', optional: true, minLength: 2 },
              processDiscarded: { type: 'boolean', optional: true },
              /*
               * F6/F10 (2026-09-02). A vocabulary answer names the term it defines and, when
               * the human said so, the aliases that mean the same thing ("QRT" / "case
               * bedrijfsongeval"). The decision carries both; the glossary and the kernel join
               * on them by exact normalised string. Omitted: the CLI keys the decision to the
               * question's own `term`. Anything else the sentence mentions stays undefined.
               */
              canonicalTerm: { type: 'string', optional: true, minLength: 1 },
              aliases: { type: 'array', optional: true, items: { type: 'string' } },
            },
          },
        },
      },
    },
    example: () => ({
      stage: 'interview', instance: '<instance>',
      usage: { apiCalls: 0, notes: 'no instance reads in this stage' },
      answers: [
        { questionId: 'Q-a1b2c3d4e5f6', answeredBy: 'a.developer', answeredAt: '2026-08-11', kind: 'decision', branch: 'a', verbatim: 'Yes, deliberate — the workspace create form sets it already, so the CS would double-fire.', rationale: 'the workspace create form already sets the value; running the client script would double-fire', statement: 'The prefill client script ships inactive because the workspace create form already sets due date', channel: 'batch-email' },
        { questionId: 'Q-0f1e2d3c4b5a', answeredBy: 'a.developer', answeredAt: '2026-08-11', kind: 'debt', verbatim: "Don't recall.", owner: 'a.developer', dueBy: '2026-09-01' },
      ],
      acceptance: [{ id: 'AC-INT-1', result: 'pass', evidence: 'every answer carries an attributed answerer and a date' }],
    }),
    acceptance: [
      { id: 'AC-INT-1', statement: 'Every answer carries a named answerer and a date.', howToEvidence: 'answeredBy and answeredAt. An unattributed decision is not a decision.' },
      { id: 'AC-INT-2', statement: 'Every rationale is the human\'s words, recorded verbatim, not a paraphrase.', howToEvidence: 'the verbatim field.' },
      { id: 'AC-INT-3', statement: '"I don\'t know" was recorded as debt with an owner, not retried or inferred.', howToEvidence: 'kind=debt with owner and dueBy.' },
    ],
    validate: (ctx, art) => {
      const rej = [];
      const ql = ctx.brain.questionsLedger();
      for (const a of art.answers) {
        const q = ql.get(a.questionId);
        if (!q) { rej.push(`answers: question ${a.questionId} is not in the ledger.`); continue; }
        if (q.status === 'shadow') { rej.push(`answers: ${a.questionId} is a SHADOW question. Shadow questions are operator-graded and are never put to the SME.`); }
        if (a.kind === 'debt' && !a.owner) { rej.push(`answers: ${a.questionId} is debt with no owner. Debt without an owner and a date is a note, not a register entry.`); }
        // PLAN 7.4 — the why-decision answer form is confirm / deny / correct, one line.
        if (q.gate === 'why-decision') {
          if (a.kind === 'decision' && !a.whyVerdict) {
            rej.push(`answers: ${a.questionId} is a why-decision question and the answer carries no whyVerdict. The form is one line: confirm / deny / correct — that is what keeps depth costing the SME minutes, not hours.`);
          }
          if (a.whyVerdict === 'correct' && !a.statement && !a.verbatim) {
            rej.push(`answers: ${a.questionId} says whyVerdict=correct with no corrected sentence. "Correct" without the correction is a deny wearing a nicer word — put the human's sentence in verbatim (and your wording of it in statement), or record deny.`);
          }
          continue;
        }
        if (a.whyVerdict) { rej.push(`answers: ${a.questionId} carries a whyVerdict but is not a why-decision question. That field is the induction leg's answer form, not a general one.`); }
        if (a.kind === 'decision' && !a.rationale && !a.branch) { rej.push(`answers: ${a.questionId} is kind=decision with neither a rationale nor a chosen branch. One of the two is what makes it a decision rather than an observation.`); }
      }
      return rej;
    },
    apply: (ctx, art) => {
      const ql = ctx.brain.questionsLedger();
      const decisions = [];
      const questions = [];
      const q0pre = ctx.state.queue || {};
      const storedCandidates = (q0pre.decisionCandidates || []).slice();
      const refutedCandidates = (q0pre.refutedCandidates || []).slice();
      const WHY_ANCHOR_SOURCE = { deletion: 'deletion', 'config-pattern': 'config-pattern', 'doc-contradiction': 'doc' };
      let candidatesTouched = false;
      for (const a of art.answers) {
        const q = ql.get(a.questionId);
        // The CLI computes the bindings. The model never writes a link.
        const explains = [...new Set(((q.locus || []).map((l) => l.claim).filter(Boolean))
          .concat((q.cluster && q.cluster.members) || []).filter((m) => ctx.brain.claims().has(m)))];
        const witness = [q.sources && q.sources.A && q.sources.A.ref, q.sources && q.sources.B && q.sources.B.ref]
          .filter((r) => r && ctx.brain.claims().has(r));

        /*
         * PLAN 7.4 — a why-decision answer disposes its CANDIDATE, and the links come from the
         * candidate the CLI minted, never from the wording. confirm/correct -> a `confirmed`
         * DEC carrying the candidate's witnesses; deny -> refuted, KEPT so the next run's
         * induction pass does not re-ask the same human the same hypothesis.
         */
        const cand = q.gate === 'why-decision'
          ? storedCandidates.find((c) => c && c.key === (q.candidateKey || (q.sources && q.sources.A && q.sources.A.ref)))
          : null;
        if (q.gate === 'why-decision' && cand && a.kind === 'decision') {
          candidatesTouched = true;
          if (a.whyVerdict === 'deny') {
            cand.disposed = 'refuted';
            refutedCandidates.push({ key: cand.key, statement: cand.statement, by: a.answeredBy, at: a.answeredAt, verbatim: a.verbatim || null });
          } else {
            cand.disposed = 'confirmed';
            decisions.push({
              statement: a.statement || cand.statement,
              rationale: a.rationale || a.verbatim || cand.rationaleDraft,
              rationaleStrength: (a.rationale || a.verbatim) ? 'stated' : 'confirmed-draft',
              impact: a.impact || null,
              principle: a.principle || cand.principleDraft || null,
              alternatives: a.alternatives || [],
              scope: { instance: ctx.state.instance, tables: cand.table ? [cand.table] : [] },
              answeredBy: a.answeredBy, answeredAt: a.answeredAt,
              answerProvenance: { fromQuestion: q.id, channel: a.channel || null, verbatim: a.verbatim || null, rationaleVolunteered: !!(a.rationale || a.verbatim), branch: a.whyVerdict },
              derivedFrom: 'interview',
              witnessClaims: cand.witnesses.filter((id) => ctx.brain.claims().has(id)),
              explainsClaims: [],
              tier: 'confirmed', anchorSource: WHY_ANCHOR_SOURCE[cand.source] || 'interview',
              linkage: cand.witnesses.length ? 'bound' : 'unbound',
              confidence: a.whyVerdict === 'correct' ? 'high' : 'medium',
              supersedes: null, supersededBy: null, confirmationStatus: 'current', reconfirmation: [],
            });
          }
          questions.push(Object.assign({}, q, {
            status: 'answered',
            outcome: a.whyVerdict === 'deny' ? 'refuted' : 'answered-with-rationale',
            answer: { by: a.answeredBy, at: a.answeredAt, kind: a.kind, whyVerdict: a.whyVerdict, verbatim: a.verbatim || null, branch: null, owner: null, dueBy: null },
            __cliAllocated: true,
          }));
          continue;
        }

        if (a.kind === 'decision') {
          decisions.push({
            statement: a.statement || (q.question || '').slice(0, 160),
            rationale: a.rationale || null,
            // stated when the human gave it; absent when only a branch was chosen. Never
            // inferred from this stage — inference is archaeology's label, not an answer's.
            rationaleStrength: a.rationale ? 'stated' : 'absent',
            // PLAN 7.2: the DEC ledger's two forward-acting fields. Worded by the agent from
            // the human's answer — the links stay CLI-computed, the words never carry them.
            impact: a.impact || null,
            principle: a.principle || null,
            alternatives: a.alternatives || [],
            scope: { instance: ctx.state.instance, tables: [...new Set((q.locus || []).map((l) => l.table).filter(Boolean))] },
            answeredBy: a.answeredBy, answeredAt: a.answeredAt,
            answerProvenance: { fromQuestion: q.id, channel: a.channel || null, verbatim: a.verbatim || null, rationaleVolunteered: !!a.rationale, branch: a.branch || null },
            derivedFrom: 'interview',
            witnessClaims: witness, explainsClaims: explains,
            /*
             * PLAN 7.2 (folds 6.8 / PRODUCT-75 fix 2). A human answered -> confirmed. linkage
             * is computed from the links the CLI just derived: empty on both sides is LEGAL
             * ONLY AS A DISCLOSURE — 'unbound' is what the DEC renderer renders instead of
             * refusing, and the run's own aggregate warning (below) is what stops it being
             * silent. On the run this fix measured, the three HIGHEST-RANKED questions all
             * produced unbound decisions and nothing said so.
             */
            tier: 'confirmed', anchorSource: 'interview',
            linkage: (witness.length || explains.length) ? 'bound' : 'unbound',
            confidence: a.rationale ? 'high' : 'medium',
            supersedes: null, supersededBy: null, confirmationStatus: 'current', reconfirmation: [],
            // F6/F10: the vocabulary key, minted here so no renderer has to guess it from prose.
            canonicalTerm: q.gate === 'register-gap'
              ? (a.canonicalTerm ? normText(a.canonicalTerm) : (q.term || extractTerm(q.question) || null))
              : (a.canonicalTerm ? normText(a.canonicalTerm) : null),
            aliases: [...new Set((a.aliases || []).map((x) => normText(x)).filter(Boolean))],
          });
        }
        questions.push(Object.assign({}, q, {
          status: a.kind === 'deferred' ? 'deferred' : 'answered',
          outcome: a.kind === 'decision' ? (a.rationale ? 'answered-with-rationale' : 'answered-attribution-only')
            : a.kind === 'unanswerable' ? 'unanswerable' : a.kind === 'deferred' ? 'deferred' : 'answered-attribution-only',
          answer: { by: a.answeredBy, at: a.answeredAt, kind: a.kind, verbatim: a.verbatim || null, branch: a.branch || null, owner: a.owner || null, dueBy: a.dueBy || null },
          __cliAllocated: true,
        }));
      }
      /*
       * PROCESS NAMES ARE THE PAGE UNIT, so they are recorded in the queue rather than only in
       * a decision: `render` reads them to decide which pages must exist. A discarded cluster is
       * recorded too — "those records are leftovers, not a process" is a real answer, and
       * without recording it the same cluster comes back as a candidate on the next run.
       */
      const q0 = ctx.state.queue || {};
      const named = (q0.namedProcesses || []).slice();
      for (const a of art.answers) {
        if (a.processDiscarded) {
          named.push({ fromQuestion: a.questionId, name: null, discarded: true, by: a.answeredBy, at: a.answeredAt });
        } else if (a.processName) {
          named.push({
            fromQuestion: a.questionId, name: a.processName, discarded: false,
            slug: normText(a.processName).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''),
            by: a.answeredBy, at: a.answeredAt,
          });
        }
      }
      /*
       * PLAN 7.2 / PRODUCT-75 fix (2), the interview door: unbound decisions are disclosed in
       * ONE aggregate warning where they are minted. Warning, not blocking — an unbound decision
       * is a real fact worth recording, and severity is immutable once minted.
       */
      const unboundDecisions = decisions.filter((d) => d.linkage === 'unbound');
      const findings = unboundDecisions.length ? [{
        check: 'decision-unbound', severity: 'warning', rung: 'L5',
        locus: { table: 'decisions', sysId: 'interview' },
        message: `${unboundDecisions.length} of ${decisions.length} decision(s) minted this interview iteration rest on no ` +
          `claim (their questions' sources are aggregates or findings, not claim ids; disclosed as linkage: 'unbound'). ` +
          `Supersession cannot reach them, and the DEC ledger renders each with its gap shown.`,
      }] : [];

      const queueDelta = {};
      if (named.length !== (q0.namedProcesses || []).length) { queueDelta.namedProcesses = named; }
      if (candidatesTouched) {
        queueDelta.decisionCandidates = storedCandidates;
        queueDelta.refutedCandidates = refutedCandidates;
      }
      return {
        decisions, questions, findings,
        queue: Object.keys(queueDelta).length ? queueDelta : undefined,
        raw: art.answers.map((a) => Object.assign({ kind: 'answer' }, a)),
        progress: true,
      };
    },
    next: (ctx) => {
      const all = [...ctx.brain.questionsLedger().values()];
      const queued = all.filter((q) => q.status === 'queued');
      if (!queued.length) { return 'render'; }
      // Saturation, counted by the CLI: over the last five answered questions, fewer than
      // two produced a ledger delta (a DEC or a claim promotion). Not judged by a model.
      const answered = all.filter((q) => q.status === 'answered')
        .sort((a, b) => String(a.recordedAt).localeCompare(String(b.recordedAt)));
      if (answered.length >= 5) {
        const last5 = answered.slice(-5);
        const deltas = last5.filter((q) => q.outcome === 'answered-with-rationale').length;
        if (deltas < 2) { return 'render'; }
      }
      return 'interview';
    },
  },

  // =========================================================================
  {
    id: 'render',
    title: 'Render — claims + decisions to wiki pages and kernel; the engagement repo becomes usable',
    stagnation: 'none',
    goal: () =>
      'Turn the ledgers into a WORKING ENGAGEMENT REPO. The test of this stage is not that pages exist: ' +
      'it is that an agent opening this repo tomorrow can do real development work in it. That needs four ' +
      'things on disk — a kernel carrying identity, hard rules and a routing map; enforcement hooks wired ' +
      'into .claude/settings.json; build-procedure skills; and a wiki carrying the registry, decisions, ' +
      'gotchas, conventions, TBDs and story records. Pages are a VIEW of the claim ledger, so a page may ' +
      'not be marked verified while it renders a claim that is not.',
    reads: (ctx) => [
      { path: 'docs/rework-plan.md#433-441', why: 'The DRAFT->VERIFIED promotion ritual, made machine-checkable. status is computed by the renderer from the claims a page renders, never written by hand.', required: true },
      { path: 'kernel/CLAUDE.template.md', why: 'The kernel template. The routing map must state that a draft page is quoted WITH its status.', required: true },
      { path: `${wikiRootOf(ctx)}/`, why: 'The page contracts the wiki must satisfy. This is the installed wiki scaffold; render INTO it rather than beside it.', required: true },
      { path: 'tools/snbrain/render.js', why: 'The rendering primitives you MUST use: displayName(), artifactTable(), pageStatus(), and `--check`. Naming, the asserts column and retirement marking are fixed here on purpose — the last run wrote its own renderer and got all three wrong.', required: true },
      { path: '.claude/skills/snbrain-render/SKILL.md', why: 'Engagement procedure, if the repo has one.', required: false },
    ],
    procedure: () => [
      /*
       * PRODUCT-81. Do not write a fourth renderer. Run 6ef14f5562 wrote a 2,219-line one that
       * resolved an artifact's name from `collection`/`table`/`table_name` — what it acts ON —
       * ahead of the name harvest captured. Measured against that run's own ledger: 147 artifacts
       * rendered under a target table, including `ACME - QRT Selection State Validation` appearing
       * as `sn_ohs_im_incident`, and 62 artifacts the ledger records as INACTIVE rendered as live.
       */
      'Use `tools/snbrain/render.js` for naming, the artifact table, and page status. It ships with the ' +
        'engagement. You may write page-shaping code around it; you may not re-implement displayName(), ' +
        'artifactTable() or pageStatus(), because a defect in those is a defect in every engagement at once.',
      'Every artifact table carries an ASSERTS column. The values are already in the ledger and were already ' +
        'paid for — a page that names a record and will not say what it says is an inventory with citations.',
      'An artifact the ledger records as inactive renders with a RETIRED marker where it appears. `active = false` ' +
        'in a column a reader skims is not a marker; a dead artifact listed beside live ones reads as live.',
      'Run `node tools/snbrain/render.js --root . --check` before you ingest, and fix what it names. It audits ' +
        'the page cap, the asserts column, retirement marking and name resolution against the ledger on disk.',
      'Render pages FROM claims. Every factual line on a page cites the claim id behind it.',
      /*
       * PRODUCT-95. The three numbers, and the one computation they all come from.
       */
      'THE THREE COUNTS MUST AGREE, per page: the claim ids the file prints, the `rendersClaims` array you declare ' +
        'for it, and its `claims-rendered` frontmatter. Derive all three from the file you just wrote — never write ' +
        'the count by hand. On the last run 21 of 33 pages declared a number that was not the number of ids they ' +
        'printed, the widest 582 against 69, and `--check` called it clean.',
      'Run `node tools/snbrain/render.js --root . --appendix --emit-manifest .brain/in/render-appendix.json` and splice ' +
        'that file\'s `pages[]` into your own. Do not retype it: the appendix cites every claim in the ledger and the ' +
        'accounting rule above is exact, so the fragment IS the declaration. ' +
        'It renders EVERY claim in the ledger, one page per table, each under the same 20KB cap, with the claim id on ' +
        'every row. It is the floor under curation and not a substitute for it: the process pages say what the work IS, ' +
        'the appendix says what the instance HOLDS. The last run banked 19,360 claims, cited 374 anywhere in the wiki, ' +
        'and left 107 present-and-complete facts a developer had to go to the ledger to find.',
      'Run `node tools/snbrain/render.js --root . --decisions --emit-manifest .brain/in/render-decisions.json` for the ' +
        'decision ledger and splice its `pages[]` entry into your own. Do NOT hand-write decisions.md: the generator is ' +
        'what renders each decision\'s tier (confirmed | induced | unknown), rationale, impact, principle and anchor ' +
        'links, routes tier-unknown entries into tbd.md, and REFUSES an unanchored decision that does not disclose ' +
        'linkage: \'unbound\' — the last hand-written ledger carried 36 decisions of which 23 rested on no claim and ' +
        'nothing said so.',
      'Run `node tools/snbrain/render.js --root . --source-appendix --emit-manifest .brain/in/render-source.json` and ' +
        'splice its `pages[]` into your own: the full captured body of every explain-selected artifact, quotable from ' +
        'the deliverable. All three blind testers went looking for script source and found it only in ' +
        '.brain/raw/verify.ndjson — the one file that does not ship — and one lost a verdict on it. The generator ' +
        'prints the LONGEST body the brain holds and says whether the claim\'s window or the raw capture won.',
      /*
       * 2026-09-02 (F6, F7, F8, F11, F12). The pages the last two runs' workers wrote by hand, or
       * left as scaffold, are GENERATED now, each emitting its manifest fragment. The order
       * matters: the story pages before the index (the index links what exists), every page
       * before the kernel (render-kernel refuses a route to a page that is not there yet).
       */
      'Run `node tools/snbrain/render.js --root . --glossary --emit-manifest .brain/in/render-glossary.json` and splice its ' +
        'entry. The glossary and the kernel\'s vocabulary section render from ONE model of the confirmed register-gap decisions ' +
        '(canonicalTerm + aliases); the validator refuses a glossary that does not name every confirmed term, and a definition ' +
        'attaches to its own term only — never to a word that merely co-occurred in the question.',
      'Run `node tools/snbrain/render.js --root . --stories --emit-manifest .brain/in/render-stories.json` and splice its ' +
        'entries: one immutable page per seeded story/epic pointer and per story root the anchor induced, paired to the resolved ' +
        'update sets by the shared work-item id in the set name (or the story root), several sets per story kept; the deployment ' +
        'matrix rows are spliced from the same pairing. Do NOT hand-write story pages, and do not leave the scaffold\'s examples ' +
        'in deployment-matrix.md — the validator refuses an undeclared story page and any DELETE-ME / dummy-id row in a live page.',
      'Run `node tools/snbrain/render.js --root . --interview --emit-manifest .brain/in/render-interview.json` for INTERVIEW.md ' +
        '(answered / open / deferred / shadow, from the questions ledger) and ' +
        '`node tools/snbrain/render.js --root . --proof --emit-manifest .brain/in/render-proof.json` for the read-only proof: it ' +
        'resolves the request log from run state — wherever the run kept it — copies it and the closing capability snapshot to ' +
        'stable names under the wiki, and writes the page the kernel routes to. Both are REQUIRED handoff evidence.',
      'Run `node tools/snbrain/render.js --root . --index --emit-manifest .brain/in/render-index.json` LAST among the pages: it ' +
        'links every process and story page on disk plus the ledgers, registries and generated evidence, and carries the run record.',
      'The scaffold is instantiated at bootstrap (`render.js --scaffold`); if a scaffold page is missing, run it again — it never ' +
        'overwrites a rendered page. No live page may carry `<fill at engagement>`, DELETE-ME rows, dummy STRY ids or ' +
        '`<open / …>` status alternatives; only `_TEMPLATE.md` files may. The validator scans every page under the wiki root and the kernel.',
      'Compute each page status from the claims it renders: verified only if every rendered claim is verified, mixed if some are, draft otherwise. Do not write the banner by hand.',
      'Run `node tools/snbrain/render.js --root . --gates` to mint enforcement from the stated conventions. It measures ' +
        'each candidate check against this run\'s own ledger first — a naming rule the customer\'s own work violates ' +
        'becomes an "enforcement: none — <why>" line on conventions.md, not a hook agents will delete — writes the gate ' +
        'scripts under .claude/hooks/, merges their entries into .claude/settings.json, and splices the enforcement ' +
        'block into conventions.md. Do not hand-write a gate: the generated header cites the convention claim it ' +
        'enforces, and render.validate refuses a check citing nothing.',
      'Run `node tools/snbrain/render.js --root . --kernel-facts` BEFORE rendering the kernel: it fills the persona ' +
        'line\'s instance landscape, the domain-vocabulary section and the org-map section in product.config.json from ' +
        'the claim ledger — slots filled from ledger facts, never free prose you invent. The last run\'s kernel told ' +
        'every agent the dev instance was the one the run happened to be connected to; the ledger knew better in 65 ' +
        'claims. An org map with no group claims renders as its own declared gap — leave that text alone.',
      'Render the kernel LAST, with `node tools/render-kernel.js`: it writes CLAUDE.md, .github/copilot-instructions.md and AGENTS.md ' +
        'from kernel/CLAUDE.template.md + product.config.json, derives the language and platform policy lines from typed config ' +
        '(language.targets; policy.platform[] — record a platform decision there when a human stated one), and REFUSES an unresolved slot, ' +
        'an HTML-comment slot, or a routing-map path that resolves to nothing. Add the engagement\'s artifact-type → skill rows to ' +
        'the template\'s routing map; name what has no governing skill as UNROUTED.',
      'The enforcement hooks and the build-skill library ship with the product (.claude/hooks, .claude/settings.json, .claude/skills — ' +
        'see .claude/og-layer.json). Run `node tools/snbrain/render.js --root . --gates` to merge the minted convention gates into ' +
        'settings.json, and `node tools/snbrain/snbrain.js skills-audit` before ingest: every skill must carry quoted trigger phrases ' +
        'and be reachable from the kernel, or it is a BLOCKING finding. Write an engagement-specific skill only where a mapped artifact ' +
        'class needs a procedure the library does not carry, and declare it in skills[].',
      'The CLI checks that the files you name actually exist on disk and that no verified page renders a draft claim. It will not take your word for either.',
      /*
       * PRODUCT-97. The commit is the CLI's action, not the agent's, and it is stated in the brief
       * anyway so the agent knows the deliverable is defined by `pages[]` — an output it does not
       * declare is an output that does not get committed.
       */
      'WHAT YOU DECLARE IS WHAT SHIPS. On ingest the CLI commits exactly the paths in `pages[]`, the kernel, the ' +
        'settings file, the build skills and the four brain files — and nothing else, so an operator\'s unrelated ' +
        'working-tree changes cannot ride along. A page you wrote and did not declare stays uncommitted, and run ' +
        '93838afe87\'s entire deliverable — 34 pages, the kernel, all three ledgers — existed only as working-tree ' +
        'state over a commit dated two days before the run.',
    ],
    schema: {
      type: 'object',
      required: ['pages', 'kernel', 'settings'],
      props: {
        pages: {
          type: 'array', min: 1,
          // `doc-sourced` is 5.50's rung on the page. It exists so a reader can tell a page
          // built from what somebody wrote down from a page built from what the instance says.
          items: { type: 'object', required: ['path', 'status', 'rendersClaims'], props: { path: { type: 'string', minLength: 3 }, status: { type: 'string', enum: ['draft', 'mixed', 'verified', 'probe-backed', 'doc-sourced'] }, rendersClaims: { type: 'array', items: { type: 'string' } }, tier: { type: 'string', optional: true } } },
        },
        kernel: { type: 'object', required: ['path', 'routingEntries'], props: { path: { type: 'string' }, routingEntries: { type: 'number', min: 1 } } },
        settings: { type: 'object', required: ['path', 'hooks'], props: { path: { type: 'string' }, hooks: { type: 'array', min: 1, items: { type: 'string' } } } },
        skills: { type: 'array', optional: true, items: { type: 'object', required: ['path'], props: { path: { type: 'string' }, covers: { type: 'string', optional: true } } } },
        findings: { type: 'array', optional: true, items: FINDING_SCHEMA },
      },
    },
    // Every path here must be one the validator below can stat in the ENGAGEMENT repo:
    // it calls fs.existsSync on pages, kernel, settings and skills, so a worked example
    // carrying framework-repo paths costs a real iteration to discover.
    example: (ctx) => ({
      stage: 'render', instance: ctx.state.instance,
      usage: { apiCalls: 0, notes: 'render reads the ledgers, not the instance' },
      pages: [{ path: `${wikiRootOf(ctx)}/registry-sys-ids.md`, status: 'verified', rendersClaims: ['C-a1b2c3d4e5f6'], tier: 'registry' }],
      kernel: { path: 'CLAUDE.md', routingEntries: 12 },
      settings: { path: '.claude/settings.json', hooks: ['PreToolUse:scope-guard', 'PostToolUse:registry-sync'] },
      skills: [{ path: '.claude/skills/business-rule-patterns/SKILL.md', covers: 'sys_script' }],
      acceptance: [
        { id: 'AC-REN-1', result: 'pass', evidence: 'no page marked verified renders a draft claim' },
        { id: 'AC-REN-6', result: 'pass', evidence: 'render.json pages[] + kernel + settings + skills + state.json + the three ledgers, committed by the CLI on ingest' },
      ],
    }),
    acceptance: [
      { id: 'AC-REN-1', statement: 'No page marked verified renders a claim that is not verified.', howToEvidence: 'the CLI recomputes this from the ledger and refuses otherwise.' },
      { id: 'AC-REN-2', statement: 'The kernel carries identity, hard rules and a routing map that names every wiki page.', howToEvidence: 'routingEntries, and the file on disk.' },
      { id: 'AC-REN-3', statement: 'Enforcement hooks are wired in .claude/settings.json, not merely described.', howToEvidence: 'the settings file on disk with its hooks array.' },
      { id: 'AC-REN-4', statement: 'Build-procedure skills exist for the artifact classes this engagement actually contains.', howToEvidence: 'one skill per harvested area, or a stated reason for each gap.' },
      { id: 'AC-REN-5', statement: 'An agent can do real development work in this repo: the four layers are present and consistent.', howToEvidence: 'If you cannot evidence this, the honest result is not-demonstrated. It blocks success, which is correct.' },
      /*
       * PRODUCT-97. Stated as an acceptance condition rather than only as a validator so it is
       * answered three-valued and recorded, and so a run that CANNOT commit says so in its own
       * artifact rather than being silently un-handed-over.
       */
      { id: 'AC-REN-6', statement: 'The deliverable is in a commit: every path declared here, plus the kernel, settings, build skills, state.json and the three ledgers, is tracked and clean in the engagement repo.', howToEvidence: 'the CLI commits the declared paths on ingest and re-checks; `node tools/snbrain/render.js --root . --deliverable-check` is the same assertion, runnable against a finished run.' },
    ],
    validate: (ctx, art) => {
      const rej = [];
      const claims = ctx.brain.claims();
      // Refuse to render a page as verified if any claim it renders is still draft.
      for (const p of art.pages) {
        const bad = (p.rendersClaims || []).filter((id) => { const c = claims.get(id); return !c || c.status !== 'verified'; });
        if (p.status === 'verified' && bad.length) {
          rej.push(`pages: "${p.path}" is marked verified but renders ${bad.length} claim(s) that are not verified (${bad.slice(0, 3).join(', ')}). status is computed from the claims a page renders; it is not a banner you write.`);
        }
        const unknown = (p.rendersClaims || []).filter((id) => !claims.has(id));
        if (unknown.length) { rej.push(`pages: "${p.path}" cites claim ids not in the ledger: ${unknown.slice(0, 3).join(', ')}.`); }

        /*
         * 5.50 — A DOCUMENT IS A LEAD, NEVER A VERIFIED CLAIM.
         *
         * POPULATION, NAMED: every page in this artifact that renders at least one claim whose
         * status is `documented`. Such a page may not carry a `verified` status by any route,
         * and a page built ENTIRELY from documents must say so on its face.
         *
         * The justification is measured on the reference engagement's own hand-built brain: its
         * glossary carried a wrong QRT expansion for FIVE MONTHS, and the instance-driven
         * interview is what corrected it. Documents rot; the instance is the as-built. Where a
         * document contradicts the instance the contradiction is the finding, and it is raised
         * as a `contradiction` question — never resolved in the document's favour here.
         */
        const docs = (p.rendersClaims || []).map((id) => claims.get(id)).filter((c) => c && c.status === 'documented');
        if (docs.length && p.status === 'verified') {
          rej.push(`pages: "${p.path}" is marked verified and renders ${docs.length} doc-sourced claim(s) (${docs.slice(0, 3).map((c) => c.id).join(', ')}). A document is undated, human-authored and unverifiable by construction — there is nothing to replay — so it can never satisfy a verified page status. Use "doc-sourced" if the page is built from documents, or "mixed" if it also renders verified instance claims.`);
        }
        if (docs.length && docs.length === (p.rendersClaims || []).length && p.status !== 'doc-sourced') {
          /*
           * THE MESSAGE NAMES THE ENUM VALUE, because the check is an enum comparison and the
           * old wording ("say so on the page's face") read as a prose requirement. On pilot-run-5
           * the render agent implemented it as a banner in the page body TWICE, burned the
           * 3-iteration cap on a rejection that was already deterministic, and needed an
           * operator override (3 -> 6) to land the one-word fix. A rejection that knows the
           * only legal answer says it, verbatim.
           */
          rej.push(`pages: "${p.path}" renders ${docs.length} claim(s) and every one of them is doc-sourced, but the page is marked status "${p.status}". Set this artifact's pages[] entry to status: "doc-sourced" — the literal enum value this validator compares against; prose on the page body does not satisfy it and is not what is being checked. Why the status matters: a reader who cannot tell a page built from what someone wrote down from a page built from what the instance says will treat both as the as-built.`);
        }
      }

      /*
       * PRODUCT-73, the measurable half. On run 6ef14f5562 `docs/wiki/conventions.md` shipped
       * with `claimsRendered: 0` in its frontmatter and an empty `rendersClaims` array in
       * `.brain/render-manifest.json` — one of 12 of 160 pages in that state — and this
       * validator passed it trivially, because it only ever checked the ids that WERE there.
       * A mandatory governance page manufactured entirely out of band is worse than an absent
       * one: it reads as governed.
       *
       * POPULATION, NAMED: the single page in this artifact whose path ends `conventions.md`,
       * and only when a human actually stated conventions at orientation.
       */
      {
        const stated = ((ctx.state.queue || {}).statedConventions || []).filter((c) => c && c.claimId);
        if (stated.length) {
          const page = art.pages.find((p) => /conventions\.md$/i.test(fwd(p.path)));
          if (!page) {
            rej.push(`pages: ${stated.length} convention(s) were stated at orientation and no conventions.md page renders them. claimsRendered would be 0 for the one governance page the contract mandates.`);
          } else {
            const missing = stated.filter((c) => !(page.rendersClaims || []).includes(c.claimId));
            if (missing.length) {
              rej.push(`pages: "${page.path}" does not render ${missing.length} of the ${stated.length} convention(s) a human stated at orientation (${missing.map((c) => `${c.kind}=${c.claimId}`).join(', ')}). A conventions page with claimsRendered: 0 is a governance page manufactured out of band, which is exactly what the previous run shipped — cite the claim behind every line.`);
            }
          }
        }
      }
      /*
       * PLAN 7.2 (folds 6.8 / PRODUCT-75). A DECISION WITH ZERO ANCHORS AND NO DISCLOSURE MAY
       * NOT RENDER. Same predicate as the register's recurrence check and as the DEC generator's
       * refusal — one implementation each of the escape (`linkage: 'unbound'`, set by the mint
       * paths, never by the agent) and one aggregate rejection however many rows it finds.
       * Measured: 23 of pilot-run-5's 36 decisions and 40 of pilot-run-4's 51 fire it, as ONE
       * rejection per artifact each — the emptiness both runs shipped silently, made illegal.
       */
      {
        const undisclosed = [...ctx.brain.decisions().values()]
          .filter((d) => !decisionAnchors(d).length && d.linkage !== 'unbound' && decisionTier(d) !== 'unknown');
        if (undisclosed.length) {
          rej.push(
            `${undisclosed.length} decision(s) in .brain/decisions.jsonl carry zero anchor claims and no ` +
            `linkage: 'unbound' disclosure (${undisclosed.slice(0, 5).map((d) => d.id).join(', ')}` +
            `${undisclosed.length > 5 ? `, and ${undisclosed.length - 5} more` : ''}), so the DEC ledger refuses them ` +
            `and this wiki would render a decision no L1 drift verdict can ever reach — silently, which is exactly ` +
            `what PRODUCT-75 measured twice. The mint paths set linkage themselves; a decision in this state entered ` +
            `the ledger around them. Re-mint it through interview/orientation, or leave it out of the deliverable.`);
        }
      }

      /*
       * PLAN 7.5 — ENFORCEMENT, NOT DESCRIPTION, and both halves auditable. Two aggregate
       * checks, one rejection each at most:
       * (a) a minted convention gate must cite a claim the ledger holds ("a check citing
       *     nothing enforces nothing") — population: every .claude/hooks/convention-*.js on
       *     disk, matched on its @enforces header;
       * (b) every stated convention must be accounted for on conventions.md — either "enforced
       *     by <gate>" or an explicit "enforcement: none — <why>" line. The gap is visible or
       *     the artifact is refused; silence is the one unavailable answer. Replayed: both
       *     scored runs' conventions pages fire this once each (8 and 7 unaccounted stated
       *     conventions), one rejection per artifact.
       */
      {
        const hooksDir = path.resolve(ctx.brain.root, '.claude', 'hooks');
        const uncited = [];
        if (fs.existsSync(hooksDir)) {
          for (const f of fs.readdirSync(hooksDir).filter((n) => /^convention-.*\.js$/.test(n))) {
            const m = /@enforces\s+(C-[0-9a-f]{12})/.exec(fs.readFileSync(path.join(hooksDir, f), 'utf8'));
            if (!m || !claims.has(m[1])) { uncited.push(`${f}${m ? ` (cites ${m[1]}, not in the ledger)` : ' (no @enforces header)'}`); }
          }
        }
        if (uncited.length) {
          rej.push(
            `${uncited.length} convention gate(s) cite no live claim: ${uncited.slice(0, 4).join(' · ')}` +
            `${uncited.length > 4 ? ` · and ${uncited.length - 4} more` : ''}. ` +
            'A check citing nothing enforces nothing — it cannot be reconfirmed when the convention drifts, and an agent ' +
            'reading it cannot see whose rule it is. Mint gates with `node tools/snbrain/render.js --root . --gates`, ' +
            'which writes the @enforces header from the convention claim itself.');
        }
        const stated = ((ctx.state.queue || {}).statedConventions || []);
        if (stated.length) {
          const convAbs = path.resolve(ctx.brain.root, wikiRootOf(ctx), 'conventions.md');
          const text = fs.existsSync(convAbs) ? fs.readFileSync(convAbs, 'utf8') : '';
          const convLines = text.split('\n');
          // Accounted = some line carries the convention's claim id AND says which it is:
          // an enforcement pointer or the explicit none-line. The generated block satisfies
          // this by construction; a hand-written page can too.
          const unaccounted = stated.filter((c) => !convLines.some((l) =>
            l.includes(String(c.claimId)) && (/enforced by/.test(l) || /enforcement: none/.test(l))));
          if (unaccounted.length) {
            rej.push(
              `conventions.md accounts for enforcement on ${stated.length - unaccounted.length} of ${stated.length} stated ` +
              `convention(s); missing: ${unaccounted.map((c) => `${c.kind} (${c.claimId})`).slice(0, 5).join(', ')}` +
              `${unaccounted.length > 5 ? `, and ${unaccounted.length - 5} more` : ''}. ` +
              'A verified convention is minted into a hook that refuses violating work, or its page says ' +
              '"enforcement: none — <why>" so the gap is visible instead of silent. ' +
              '`node tools/snbrain/render.js --root . --gates` measures each candidate check against this run\'s own ' +
              'ledger (a rule the mapped work itself violates becomes the none-line, not a hook agents will delete) ' +
              'and splices the block into conventions.md.');
          }
        }
      }

      /*
       * PLAN 7.6 (folds 6.5 / PRODUCT-92). Two aggregate checks on the kernel's ground truth:
       *
       * (a) THE DELIVERED CONFIG MAY NOT SHIP ITS OWN PROMPT. Run 4 delivered
       *     `instances.test = "OPTIONAL — test instance name"` — instruction copy rendered
       *     into a config file — and nothing noticed. A slot the evidence can fill is filled
       *     from the evidence (`--kernel-facts`); one it cannot is null, never placeholder
       *     text. Measured: fires once on each scored run's delivered config (3 values each).
       *
       * (b) AN INSTANCE THE LEDGER WITNESSES IN >=10 CLAIMS APPEARS IN THE DELIVERABLE. Run 4
       *     read a four-instance landscape at L1 and shipped a kernel naming one instance —
       *     the one the run was pointed at — and a deployment-matrix empty by design. Measured:
       *     pilot-run-4 fires (devinst02 37, prodinst01 29, both absent from its whole rendered corpus);
       *     pilot-run-5 passes (all four present). The connection is not the landscape.
       */
      {
        const cfgAbs = path.resolve(ctx.brain.root, 'product.config.json');
        if (fs.existsSync(cfgAbs)) {
          let cfg = null;
          try { cfg = JSON.parse(fs.readFileSync(cfgAbs, 'utf8').replace(/^﻿/, '')); } catch (e) { cfg = null; }
          const bad = [];
          (function scan(node, trail) {
            if (!node || typeof node !== 'object') { return; }
            for (const [k, v] of Object.entries(node)) {
              const dotted = trail ? `${trail}.${k}` : k;
              if (v && typeof v === 'object') { scan(v, dotted); } else if (typeof v === 'string' && /^(REQUIRED|OPTIONAL|TODO\b|<.*>$)/.test(v)) { bad.push(dotted); }
            }
          })(cfg, '');
          if (bad.length) {
            rej.push(
              `product.config.json ships ${bad.length} placeholder-shaped value(s): ${bad.slice(0, 6).join(', ')}` +
              `${bad.length > 6 ? `, and ${bad.length - 6} more` : ''}. ` +
              'A delivered config slot holds a real value or null — never its own instruction copy: the last run shipped ' +
              '"OPTIONAL — test instance name" as a config value and the kernel around it named the wrong instance as dev. ' +
              'Fill the ledger-fact slots with `node tools/snbrain/render.js --root . --kernel-facts`; fill the rest from ' +
              'evidence or set them null so the gap is a gap, not a prompt.');
          }
        }
        const witnessed = renderLib.instanceMentions([...claims.values()])
          .filter((i) => i.claims >= renderLib.INSTANCE_CLAIM_FLOOR);
        if (witnessed.length) {
          let corpus = '';
          for (const rel of art.pages.map((p) => p.path).concat([art.kernel && art.kernel.path]).filter(Boolean)) {
            const abs = path.resolve(ctx.brain.root, rel);
            if (fs.existsSync(abs)) { corpus += fs.readFileSync(abs, 'utf8'); }
          }
          const unmentioned = witnessed.filter((i) => !corpus.includes(i.host));
          if (unmentioned.length) {
            rej.push(
              `${unmentioned.length} instance(s) the ledger witnesses in >=${renderLib.INSTANCE_CLAIM_FLOOR} claims appear ` +
              `nowhere in the rendered deliverable: ${unmentioned.map((i) => `${i.host} (${i.claims} claims)`).join(', ')} ` +
              `(population: hostnames counted over the deduplicated claim ledger, platform subdomains excluded). ` +
              'A run that reads a multi-instance landscape and renders one instance has not rendered the landscape — and ' +
              'the one it renders is usually just its own connection, which misdirects every future write. Name them in ' +
              'the kernel\'s instance line (`--kernel-facts` composes it) or on deployment-matrix.md, at minimum as the ' +
              'instances this run could not map.');
          }
        }
      }

      // The files must EXIST. This stage's acceptance criterion is a working repo.
      const missing = [];
      for (const rel of art.pages.map((p) => p.path).concat([art.kernel.path, art.settings.path], (art.skills || []).map((s) => s.path))) {
        if (!fs.existsSync(path.resolve(ctx.brain.root, rel))) { missing.push(rel); }
      }
      if (missing.length) {
        rej.push(`${missing.length} declared file(s) do not exist on disk: ${missing.slice(0, 5).join(', ')}. This stage's deliverable is a repo, not a description of one.`);
      }

      /*
       * F8 / F11 / F6 (2026-09-02) — THREE HANDOFF CHECKS, one aggregate rejection each, run here
       * with the SAME code export and finalize run afterwards (lib/handoff.js), so "finished"
       * means one thing in every place it is asked.
       *
       * (a) NO PLACEHOLDER IN A LIVE PAGE. The second engagement's export passed `render --check`
       *     with `<fill at engagement>`, DELETE-ME rows and dummy STRY ids in seven live pages;
       *     the first run's CONTRACT.md carries the same marker. Population: every .md/.json
       *     under the wiki root plus the kernel mirrors; `_TEMPLATE.md` files exempt.
       * (b) EVERY KERNEL ROUTE RESOLVES. Both runs' kernels routed open questions to
       *     `docs/wiki/../INTERVIEW.md`, a file that does not exist. Population: backticked
       *     local paths in the rendered kernel, parsed by tools/render-kernel.js.
       * (c) CONFIRMED VOCABULARY REACHES THE GLOSSARY. Population: every register-gap decision;
       *     when there is at least one, the glossary page must be declared and must name every
       *     canonical term — the scaffold's blank table is not a glossary.
       */
      {
        const wikiRel = wikiRootOf(ctx);
        const files = handoff.listFiles(ctx.brain.root, wikiRel)
          .concat([art.kernel.path].concat(art.pages.map((p) => p.path)).filter((p) => fs.existsSync(path.resolve(ctx.brain.root, p))));
        const scan = handoff.scanPlaceholders(ctx.brain.root, [...new Set(files.map(fwd))]);
        const described = handoff.describePlaceholders(scan);
        if (described) { rej.push(`pages: ${described}`); }

        const routeProblems = fs.existsSync(path.resolve(ctx.brain.root, art.kernel.path))
          ? handoff.kernelRouteProblems(ctx.brain.root, fwd(art.kernel.path)) : [];
        if (routeProblems.length) {
          rej.push(`the kernel's routing map carries ${routeProblems.length} route(s) that resolve to nothing: ${routeProblems.slice(0, 4).join('; ')}` +
            `${routeProblems.length > 4 ? `; and ${routeProblems.length - 4} more` : ''}. A route is an executable contract — an agent follows it the moment it has a question. ` +
            'Fix kernel/CLAUDE.template.md or generate the page it names, then re-run node tools/render-kernel.js.');
        }

        /*
         * F7 (2026-09-02) — SEEDED STORIES BECOME PAGES. The second engagement seeded four work
         * items and five exact sets and exported no story page; the scaffold's STRY examples
         * were the only story content. Population: every seed pointer of kind story/epic, plus
         * every story root the anchor induced from a resolved set's name. Each must have a
         * stories/ page declared, and the index must link the stories tier.
         */
        {
          let built = null;
          try { built = require('./pages.js').buildStoryPages(ctx.brain.root, { wiki: wikiRel }); } catch (e) { built = null; }
          if (built && built.pages.length) {
            const declared = new Set(art.pages.map((p) => fwd(p.path).toLowerCase()));
            const undeclared = built.pages.filter((p) => !declared.has(fwd(p.path).toLowerCase()));
            if (undeclared.length) {
              rej.push(`${undeclared.length} of ${built.pages.length} story page(s) the seed and the anchor determine are not declared in pages[]: ` +
                `${undeclared.slice(0, 5).map((p) => p.path).join(', ')}${undeclared.length > 5 ? ', …' : ''}. ` +
                'A seeded work item pairs to its update sets by the shared work-item id (or the induced story root) deterministically — ' +
                'generate them with node tools/snbrain/render.js --root . --stories --emit-manifest .brain/in/render-stories.json and splice the entries; do not hand-write story pages.');
            }
            const indexPage = art.pages.find((p) => /(^|\/)index\.md$/i.test(fwd(p.path)) && !/evidence/.test(fwd(p.path)));
            if (indexPage) {
              const text = fs.existsSync(path.resolve(ctx.brain.root, indexPage.path)) ? fs.readFileSync(path.resolve(ctx.brain.root, indexPage.path), 'utf8') : '';
              const unlinked = built.pages.filter((p) => !text.includes(path.posix.basename(p.path)));
              if (unlinked.length) {
                rej.push(`"${indexPage.path}" links ${built.pages.length - unlinked.length} of ${built.pages.length} story page(s); missing: ${unlinked.slice(0, 5).map((p) => path.posix.basename(p.path)).join(', ')}. ` +
                  'Generate the index — node tools/snbrain/render.js --root . --index — after the story pages exist; a story page the index does not reach is a page an agent will not find.');
              }
            }
          }
        }

        let model = null;
        try { model = require('./vocabulary.js').buildVocabularyModel(ctx.brain.root); } catch (e) { model = null; }
        if (model && model.unresolvable.length) {
          rej.push(`${model.unresolvable.length} vocabulary decision(s) carry no canonical term (${model.unresolvable.map((u) => u.id).join(', ')}): a definition nothing can be keyed to reaches neither the glossary nor the kernel. Re-answer with canonicalTerm.`);
        }
        if (model && model.terms.length) {
          const page = art.pages.find((p) => /glossary\.md$/i.test(fwd(p.path)));
          if (!page) {
            rej.push(`${model.terms.length} vocabulary term(s) were confirmed at the interview (${model.terms.slice(0, 5).map((t) => t.canonicalTerm).join(', ')}) and no glossary.md page is declared in pages[]. ` +
              'The glossary is the wiki\'s single source for terminology; generate it — node tools/snbrain/render.js --root . --glossary --emit-manifest .brain/in/render-glossary.json — and splice the entry.');
          } else {
            const abs = path.resolve(ctx.brain.root, page.path);
            const text = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : '';
            const absent = model.terms.filter((t) => !text.includes(t.canonicalTerm));
            if (absent.length) {
              rej.push(`"${page.path}" does not name ${absent.length} of the ${model.terms.length} confirmed term(s): ${absent.map((t) => t.canonicalTerm).join(', ')}. ` +
                'Confirmed vocabulary has one source of truth and every projection renders from it; a glossary missing a confirmed term is the scaffold with a new date. Generate it with --glossary.');
            }
          }
        }
      }

      /*
       * PLAN 6.3 — THE DELIVERABLE MAY NOT DISCLAIM WHAT THE RUN ALREADY READ. Two checks over
       * the rendered files, each ONE aggregate rejection however many lines it finds (the
       * PRODUCT-95 precedent: a wall of per-line rejections against a render cap of 3 is a
       * terminated run, not a fix cycle).
       *
       * (a) PRODUCT-93. A `blocked_on` slot may not name a table this very run read. Measured on
       * pilot-run-4: personas-and-access.md and case-lifecycle.md both declare
       * `blocked_on: sys_user_group` while `.brain/raw/data-layer-sweep.ndjson` — in the same
       * directory the pages were rendered from — holds 21 groups and the five grants that fill
       * the empty slot exactly. A stated blocker closes a reader's line of inquiry, which is
       * worse than a gap.
       *
       * (b) PRODUCT-94 (2). A coverage line may not declare a table unread while the ledger
       * holds claims on it: coverage is per TABLE, differenced against DISTINCT locus.table —
       * the route is a qualifier, never the subject. Measured on pilot-run-4: `sys_choice`
       * declared unread on two pages and one accepted BLOCKING finding, over 3,750 verified
       * claims — 19.4% of the ledger disclaimed, and the prescribed remedy ("read them live")
       * a wholly wasted budget line for the next run. Recurred at scale on pilot-run-5: 11 such
       * lines, worst `sys_atf_step` declared unread over 4,088 claims.
       *
       * FALSE POSITIVES ARE MEASURED OUT, twice, because METHOD-4 forbids a rejection a correct
       * artifact cannot satisfy. A blocked_on token must be TABLE-SHAPED — in the ledger's table
       * set, or carrying an underscore and found as a word in raw — or it is prose ("blocked_on:
       * interview answer needed"): the naive form raised 40 false hits on pilot-run-5's own wiki.
       * And a line that quantifies ROWS ("6 rows were suppressed") declares rows, not the table:
       * on pilot-run-4 that carve-out is exactly the sys_security_acl line the register documented
       * as the check's own false positive.
       */
      {
        const ledgerTables = new Map();
        for (const c of claims.values()) {
          const t = c.locus && c.locus.table;
          if (t) { ledgerTables.set(t, (ledgerTables.get(t) || 0) + 1); }
        }
        // Raw is loaded lazily and once: pilot-run-5's raw directory is 53MB, and most runs have
        // no table-shaped blocked_on token that misses the ledger.
        let rawText = null;
        const raw = () => {
          if (rawText !== null) { return rawText; }
          rawText = '';
          const rawDir = path.join(ctx.brain.root, '.brain', 'raw');
          if (fs.existsSync(rawDir)) {
            for (const f of fs.readdirSync(rawDir)) {
              if (f.endsWith('.ndjson')) { rawText += fs.readFileSync(path.join(rawDir, f), 'utf8'); }
            }
          }
          return rawText;
        };
        const blocked = [];
        const unread = [];
        for (const p of art.pages) {
          const abs = path.resolve(ctx.brain.root, p.path);
          if (!fs.existsSync(abs)) { continue; }
          const text = fs.readFileSync(abs, 'utf8');
          for (const m of text.matchAll(/blocked_on:\s*([a-z0-9_]+)/gi)) {
            const t = m[1].toLowerCase();
            const inLedger = ledgerTables.has(t);
            const inRaw = !inLedger && t.includes('_') && new RegExp(`\\b${t}\\b`).test(raw());
            if (inLedger || inRaw) {
              blocked.push(`"${p.path}" is blocked_on ${t} while ${inLedger ? `the ledger holds ${ledgerTables.get(t)} claim(s) on it` : 'the run read it live (.brain/raw)'}`);
            }
          }
          for (const line of text.split('\n')) {
            if (!/unprobed|not read|not proven empty/i.test(line)) { continue; }
            if (/\b\d+\s*rows?\b/i.test(line)) { continue; }
            for (const mm of line.matchAll(/`([a-z0-9_]+)`/g)) {
              if (ledgerTables.has(mm[1])) {
                unread.push(`"${p.path}" declares ${mm[1]} unread; the ledger holds ${ledgerTables.get(mm[1])} claim(s) on it`);
              }
            }
          }
        }
        if (blocked.length) {
          rej.push(
            `pages: ${blocked.length} blocked_on slot(s) name a table this very run read: ${blocked.slice(0, 3).join(' · ')}` +
            `${blocked.length > 3 ? ` · and ${blocked.length - 3} more` : ''}. ` +
            'A stated blocker closes a reader\'s line of inquiry over evidence sitting in the same repo. blocked_on states ' +
            'what the RUN could not reach, never what the pipeline could not bank: either fill the slot from what the run ' +
            'holds and cite it, or restate the blocker truthfully — "the pipeline has no bank for this read; the evidence ' +
            'sits in .brain/raw/<file>" — so the reader knows where to look.');
        }
        if (unread.length) {
          rej.push(
            `pages: ${unread.length} coverage line(s) declare a table unread while the ledger holds claims on it: ` +
            `${unread.slice(0, 4).join(' · ')}${unread.length > 4 ? ` · and ${unread.length - 4} more` : ''}. ` +
            'Coverage is per TABLE, differenced against DISTINCT locus.table — the route is a qualifier, never the subject. ' +
            'Write the fact instead: "<table> was read via the <area> area (<n> claims) and NOT via <route>", which is more ' +
            'useful than either half. A line that quantifies ROWS ("6 of its rows were suppressed") is legal and skipped ' +
            'by this check.');
        }
      }

      /*
       * PRODUCT-95. THE SELF-REPORT, TURNED INTO A CHECK.
       *
       * `rendersClaims` was an unvalidated agent self-report and `claims-rendered` was a number in
       * frontmatter that nothing computed. Measured on run 93838afe87: 21 of the 33 pages carrying
       * the key declare a count that is not the number of distinct claim ids they print, widest 582
       * against 69, and `render --check` reported clean over all of it. Two of the 33 print MORE
       * ids than they declare, which is the same defect in the other direction and is why the rule
       * is set EQUALITY rather than a bound.
       *
       * THE CHEAPEST LEGAL SATISFACTION IS A CODE CHANGE, NOT A DELETION — which is the test
       * METHOD-4 sets. Containment in one direction alone is satisfiable by trimming `rendersClaims`
       * (PRODUCT-79's worked example: deleting the evidence graph to pass a guard about evidence) or
       * by deleting citations from the page. Demanding both directions at once leaves exactly one
       * cheap answer: derive all three numbers from one computation over the file you just wrote.
       *
       * BOUNDED: three rejections maximum for any artifact, whatever the page count, because 21
       * per-page rejections against a render cap of 3 is a terminated run rather than a fix cycle.
       */
      {
        const rows = renderLib.pageClaimAccounting(ctx.brain.root, art).filter((r) => r.exists);
        const notPrinted = rows.filter((r) => r.manifestNotPrinted.length);
        const notCited = rows.filter((r) => r.printedNotInManifest.length);
        const miscounted = rows.filter((r) => r.declared !== null && r.declared !== r.printed);
        if (notPrinted.length) {
          rej.push(
            `${notPrinted.length} page(s) declare rendersClaims ids that do not appear anywhere in the rendered file ` +
            `(population: every page in this artifact that exists on disk): ` +
            `${notPrinted.slice(0, 6).map((r) => `${r.path} (${r.manifestNotPrinted.length} of ${r.manifest} absent, e.g. ${r.manifestNotPrinted[0]})`).join('; ')}` +
            `${notPrinted.length > 6 ? `, and ${notPrinted.length - 6} more` : ''}. ` +
            `A manifest is a claim about a page and this one is not true of it. Cite the id on the line it supports, ` +
            `or say on the page why a claim it derives from is not cited — and do NOT fix this by shortening ` +
            `rendersClaims: the citation graph is this deliverable's evidence.`);
        }
        if (notCited.length) {
          rej.push(
            `${notCited.length} page(s) print claim ids that rendersClaims does not list ` +
            `(same population): ${notCited.slice(0, 6).map((r) => `${r.path} (${r.printedNotInManifest.length} uncounted, e.g. ${r.printedNotInManifest[0]})`).join('; ')}` +
            `${notCited.length > 6 ? `, and ${notCited.length - 6} more` : ''}. ` +
            `The manifest is what the CLI computes page status and verification coverage from, so a citation missing ` +
            `from it is a page resting on evidence nothing checked — decisions-sealed-recall.md printed 35 ids under an ` +
            `empty manifest on the last run and was marked draft on the strength of it.`);
        }
        if (miscounted.length) {
          const worst = miscounted.slice().sort((a, b) => Math.abs(b.declared - b.printed) - Math.abs(a.declared - a.printed));
          rej.push(
            `${miscounted.length} page(s) declare a claims-rendered count that is not the number of distinct claim ids ` +
            `they print (population: every page in this artifact carrying the frontmatter key): ` +
            `${worst.slice(0, 6).map((r) => `${r.path} declares ${r.declared}, prints ${r.printed}`).join('; ')}` +
            `${worst.length > 6 ? `, and ${worst.length - 6} more` : ''}. ` +
            `That key is the reader's only measure of what a page rests on. Compute it from the ids in the file.`);
        }
      }

      /*
       * PRODUCT-99. A ROUTING MAP THAT NAMES A SKILL THAT DOES NOT EXIST.
       *
       * The kernel's routing map is the first thing an agent reads and the only index it has from
       * "I am about to touch table X" to "here is the procedure". On run 93838afe87 it routed four
       * classes to four `acme-*` skills and **all four were absent from `.claude/skills/`** —
       * including `acme-vendorx-intake`, which a head-to-head tester went looking for by name because
       * the kernel told them to, and whose absence decided that task's verdict. The wiki's own
       * UNROUTED list proves the run knew how to say "no skill governs this"; it just did not
       * notice that four of the routed ones were fictional.
       *
       * The population is named and narrow: backticked slugs appearing in a TABLE ROW of the
       * kernel, matching `word-word`. Measured against the real kernel: 33 candidates, 29 resolve
       * to a shipped skill, and the 4 that do not are exactly the 4 phantoms — no false positives.
       * Table names are excluded by construction, because every ServiceNow table name in that map
       * carries an underscore and no skill slug does.
       */
      {
        const kernelAbs = path.resolve(ctx.brain.root, art.kernel.path);
        if (fs.existsSync(kernelAbs)) {
          const declared = new Set((art.skills || []).map((s) => path.basename(path.dirname(fwd(s.path)))));
          const named = new Set();
          for (const line of fs.readFileSync(kernelAbs, 'utf8').split(/\n/)) {
            if (!/^\s*\|/.test(line)) { continue; }
            for (const m of line.match(/`[a-z][a-z0-9]*(?:-[a-z0-9]+)+`/g) || []) { named.add(m.replace(/`/g, '')); }
          }
          const missing = [...named].filter((slug) => !declared.has(slug)
            && !fs.existsSync(path.resolve(ctx.brain.root, '.claude', 'skills', slug, 'SKILL.md')));
          if (missing.length) {
            rej.push(
              `the kernel's routing map sends work to ${missing.length} skill(s) that do not exist: ` +
              `${missing.sort().join(', ')} (population: backticked \`word-word\` slugs in a table row of ` +
              `${fwd(art.kernel.path)}; ${named.size} candidates, ${named.size - missing.length} resolve). ` +
              `A routing entry is a promise that a procedure is there when an agent arrives — the previous run ` +
              `promised four and shipped none of them, and a tester who went looking for one by name lost a ` +
              `head-to-head task on its absence. Either write the skill, declare it in skills[], or move the ` +
              `class to the UNROUTED list, which is the honest sentence and one this kernel already knows how ` +
              `to write.`);
          }
        }
      }

      /*
       * PRODUCT-97. A DELIVERABLE THAT IS NOT IN A COMMIT HAS NOT BEEN DELIVERED.
       *
       * Only the PRECONDITION is a rejection here: the repo must be one a commit can land in. The
       * acceptance itself — every declared path tracked AND clean — cannot be evaluated at validate
       * time, because these files were written seconds ago and are dirty by construction. It runs
       * after the commit, in cmdIngest, and its failure is a blocking finding rather than a
       * rejection, because by then the artifact is already correct and the thing left undone is
       * an action the CLI takes, not one the agent does.
       */
      {
        const g = deliverable.gitState(ctx.brain.root);
        if (!g.isRepo) {
          rej.push(
            `the engagement repo at ${fwd(ctx.brain.root)} is not a git repository, so nothing this stage writes can be ` +
            `handed over: a deliverable that exists only as working-tree state is one \`git clean -fd\` from being the ` +
            `installer's scaffold, which is exactly what both previous runs shipped. Run \`git init\` and commit the ` +
            `scaffold before rendering into it.`);
        }
      }

      /*
       * THE PERSONAS CLAUSE, ENFORCED. CONTRACT.md mandates four subsections on every process
       * page, and the reference deliverable's CONTRACT.md was a near-copy of the real one with
       * exactly this clause missing — so the generated pages mapped four personas to landing
       * pages and called it access documentation. A contract clause that nothing checks is a
       * clause that gets dropped, and this one is the part a developer needs most, because it
       * is the part no read can produce.
       */
      /*
       * ONE PAGE PER NAMED PROCESS. The human named these clusters at Gate 1, which is the only
       * way a process name can ever exist — the instance has tables and scripts, and a process
       * is the customer's word for a bundle of them. Rendering an artifact-class taxonomy
       * instead is what produced ten slugs like `automation-and-scripts` and no page able to
       * answer "I have a story about cancelling a case; what does it touch?"
       *
       * Only NAMED clusters are required. A cluster the human discarded must not become a page,
       * which is why the discard is recorded as an answer rather than as silence.
       */
      const named = ((ctx.state.queue || {}).namedProcesses || []).filter((n) => n && n.name && !n.discarded);
      if (named.length) {
        const pagePaths = art.pages.map((p) => fwd(p.path).toLowerCase());
        const unrendered = named.filter((n) => !pagePaths.some((pp) => pp.includes('/processes/') && pp.includes(n.slug)));
        if (unrendered.length) {
          rej.push(`${unrendered.length} named process(es) have no page: ${unrendered.map((n) => `"${n.name}" (expected a processes/ page containing "${n.slug}")`).join(', ')}. These names came from the human at Gate 1 and are the unit this deliverable is organised by — an artifact-class taxonomy in their place is the ServiceNow object model the reader already knows, instead of the work breakdown they do not.`);
        }
      }

      /*
       * PRODUCT-79 / PRODUCT-80. A page must say WHAT IT READ, not only that it read something.
       *
       * Measured on run 6ef14f5562, against the SME's hand-built brain: of 398 ground-truth facts,
       * 13 were present and complete. `rg ' = true' docs/wiki/processes/*.md` returned ZERO hits
       * across 160 pages. Every process and registry page printed `table | name | sys_id | story |
       * verify | evidence` — the LOCUS, never the ASSERTION — so 8,239 claims the run paid to
       * capture reached a reader in exactly two places. `sys_ui_policy_action.mandatory = true`
       * (55 claims), `sys_dictionary.mandatory` (76), and every sys_ui_message body text — all
       * harvested, all invisible. Three independent testers named fixing this as the single
       * highest-leverage change available, and it costs no additional instance reads.
       *
       * PRODUCT-80 is where the same defect turns from a gap into a hazard: four retired UI
       * actions rendered indistinguishably from live buttons while the ledger held
       * `active = false` for all four, and a dead business rule rendered as `verified`, which a
       * reader takes as "live and checked". A reader's most likely conclusion about that button
       * set was the exact opposite of the truth, which is worse than saying nothing.
       */
      {
        const norm = (s) => String(s).replace(/\s+/g, ' ').trim().toLowerCase();
        const quality = { pages: [], retired: [] };
        const DEAD =/\b(active|enabled|published)\s*=\s*(false|0|no)\b/i;
        const RETIRED_MARK = /\b(retired|inactive|deactivated|disabled|not active|superseded)\b/i;
        for (const p of art.pages) {
          const ids = p.rendersClaims || [];
          if (!ids.length) { continue; }
          const abs = path.resolve(ctx.brain.root, p.path);
          if (!fs.existsSync(abs)) { continue; }
          const rawText = fs.readFileSync(abs, 'utf8');
          const rawLines = rawText.split(/\n/);
          const text = norm(rawText);
          const rendered = ids.map((id) => claims.get(id)).filter(Boolean);
          if (!rendered.length) { continue; }

          /*
           * MEASURE HERE, JUDGE IN apply(). Two corrections from attacking this against the run:
           * count DISTINCT assertions (heavily duplicated, median 22 chars, so counting claims let
           * ONE distinct string satisfy a 174-claim citation), and match a TRUNCATED prefix
           * (artifactTable() truncates at 90 chars, so the 131 longest assertions — the explain
           * behaviour claims, the most valuable content in the ledger — could never count as shown
           * by any renderer this framework permits).
           */
          /*
           * Target-field claims are excluded from the demand. `artifactTable()` renders them in
           * their own "Acts on" column as a bare VALUE, so the assertion string `table_name =
           * sn_ohs_im_observation` never appears verbatim and the claim could never count as shown
           * — the framework's own renderer would be permanently faulted for the one column it
           * deliberately displays separately. `sc_cat_item_producer` is the sharp case: its only
           * discriminating declared column IS `table_name`.
           */
          const wanted = [...new Set(rendered
            .filter((c) => !(c.locus && c.locus.field && TARGET_FIELDS.includes(c.locus.field)))
            .map((c) => norm(c.assertion)).filter(Boolean))];
          const shown = wanted.filter((a) => text.includes(a) || (a.length > 89 && text.includes(a.slice(0, 89))));
          quality.pages.push({ path: p.path, cited: rendered.length, wanted: wanted.length, shown: shown.length });

          /*
           * ADJACENCY, NOT PAGE-WIDE. A page-wide marker search passed 15 pages holding up to 24
           * unmarked retirements each, cleared by one unrelated sentence in a personas table — and
           * `disabled` is a declared shape column of sys_ui_policy_action, so a live policy action
           * rendering `disabled = false` self-cleared every retirement on its own page. The marker
           * must sit on the line that names the artifact, which is what render.js already emits.
           */
          const dead = rendered.filter((c) => c.assertion && DEAD.test(c.assertion));
          if (dead.length) {
            const markedLines = rawLines.filter((l) => RETIRED_MARK.test(l)).map(norm);
            const unmarked = dead.filter((c) => {
              const needle = norm((c.locus && c.locus.key) || (c.locus && c.locus.sysId) || '');
              return needle && !markedLines.some((l) => l.includes(needle));
            });
            if (unmarked.length) {
              quality.retired.push({
                path: p.path, count: unmarked.length,
                sample: unmarked.slice(0, 3).map((c) => `${c.locus && c.locus.table}/${(c.locus && c.locus.key) || (c.locus && c.locus.sysId)}`),
              });
            }
          }
        }
        /*
         * PRODUCT-95, THE SELECTION HALF, AS A FINDING.
         *
         * The population is nameable and small: DISTINCT locus.table in the finished ledger, at
         * five claims or more, minus the tables named anywhere under the wiki root. Measured on
         * run 93838afe87: 99 of 146 — question_choice (1,192 claims), sys_metadata_delete (805),
         * sys_ux_form_action_layout_item (231), sys_decision_question (151), pa_indicators (127).
         *
         * A FINDING, NOT A REJECTION, and the reasoning is METHOD-4's: 99 diffuse signals against
         * a render cap of 3 is a terminated run, and not every one of those tables deserves a page.
         * What it demands is that dropping a whole class of evidence be a decision someone took and
         * can be held to, rather than a side effect of curating by hand. `--appendix` satisfies it
         * by construction, which is the point: the cheapest legal answer RENDERS the evidence.
         */
        const wikiAbs = path.resolve(ctx.brain.root, wikiRootOf(ctx));
        const corpus = [];
        const walkWiki = (dir) => {
          if (!fs.existsSync(dir)) { return; }
          for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            const abs = path.join(dir, e.name);
            if (e.isDirectory()) { walkWiki(abs); } else if (/\.md$/i.test(e.name)) { corpus.push(fs.readFileSync(abs, 'utf8')); }
          }
        };
        walkWiki(wikiAbs);
        quality.unmentioned = renderLib.unmentionedTables([...claims.values()], corpus.join('\n'));
        ctx.renderQuality = quality;
      }

      const PERSONA_H4 = ['Who works this process', 'What each persona may DO', 'What each persona may SEE', 'Where each rule is enforced'];
      for (const p of art.pages) {
        if (!/(^|[\\/])processes[\\/]/.test(p.path) || /_TEMPLATE\.md$/i.test(p.path)) { continue; }
        const abs = path.resolve(ctx.brain.root, p.path);
        if (!fs.existsSync(abs)) { continue; }   // already reported above
        const text = fs.readFileSync(abs, 'utf8');
        if (!/^##\s+Personas\s*&\s*Permissions\s*$/im.test(text)) {
          rej.push(`pages: "${p.path}" is a process page with no "## Personas & Permissions" section. CONTRACT.md makes it mandatory because it is the one part of a process page that no instance read can produce, and it is what a developer holding a story actually needs. If it is unfilled, emit the slot marker and say what it is blocked on — do not omit it.`);
          continue;
        }
        const absent = PERSONA_H4.filter((h) => !new RegExp(`^###\\s+${h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'im').test(text));
        if (absent.length) {
          rej.push(`pages: "${p.path}" has a Personas & Permissions section missing ${absent.length} of its four mandated subsections: ${absent.map((h) => `"${h}"`).join(', ')}. The wording is fixed by CONTRACT.md so the section is checkable at all.`);
        }
        if (/^###\s+What each persona may DO\s*$/im.test(text) && !/\bMay not\b/.test(text)) {
          rej.push(`pages: "${p.path}" documents what personas may do with no "May not" column. An absent denial and a deliberate prohibition are the same absence in the data, and telling them apart is the whole question — record deliberate denials so they are not "fixed" by mistake.`);
        }
      }

      /*
       * METHOD-6, FIX (2) — THE MECHANISM HALF OF THE CONTRACT.
       *
       * Until this existed, the ONLY completeness test on a process page was four persona
       * subsections, so the technical account — the half a developer opens the page for — was
       * entirely unpoliced. Measured on run 93838afe87: `case-triage-and-routing.md` cites
       * ELEVEN artifacts and carries zero machine-followable edges between any of them, and it is
       * the routing chain, the most-cited mechanism in the build. The page reads well. An agent
       * asked "what happens to a case after triage" cannot traverse a single link of it.
       *
       * WHAT IS DEMANDED IS A SENTENCE, NOT A CHAIN, and that distinction is METHOD-4 doing its
       * job. Demanding a resolving edge is UNSATISFIABLE for a process that genuinely has none —
       * the agent cannot invent a reference the instance does not contain — and an unsatisfiable
       * rejection is discharged by deleting the page or padding its citation list, both of which
       * make the deliverable worse. So the page must either carry one followable link, or SAY that
       * it does not and why, in the slot form CONTRACT.md already defines for every other unfilled
       * slot. That converts a silent gap into a counted one, which is the whole of the fix.
       *
       * Bounded by construction: at most one rejection per process page. Three on this run,
       * against a render cap of 3 — and the 175-rejection version of an earlier guard is the
       * reason that number is checked before shipping rather than after.
       */
      {
        const MECH_MIN_ARTIFACTS = 3;
        const MECH_SLOT = /<!--\s*slot:\s*mechanism(\.[a-z_]+)?\s*\|/i;
        const graph = referenceGraph([...claims.values()]);
        for (const p of art.pages) {
          if (!/(^|[\\/])processes[\\/]/.test(p.path) || /_TEMPLATE\.md$/i.test(p.path)) { continue; }
          const abs = path.resolve(ctx.brain.root, p.path);
          if (!fs.existsSync(abs)) { continue; }
          const arts = new Set();
          for (const id of p.rendersClaims || []) {
            const k = graph.artifactOf.get(id);
            if (k) { arts.add(k.slice(k.indexOf('|') + 1)); }
          }
          if (arts.size < MECH_MIN_ARTIFACTS) { continue; }   // no chain is possible, so none is owed
          const out = graph.mech.filter((e) => arts.has(e.from));
          const intact = out.filter((e) => graph.known.has(e.to));
          if (intact.length) { continue; }
          if (MECH_SLOT.test(fs.readFileSync(abs, 'utf8'))) { continue; }
          rej.push(
            `pages: "${p.path}" cites ${arts.size} artifact(s) and carries NO followable mechanism link ` +
            `${out.length ? `— all ${out.length} reference(s) out of those artifacts point at records this brain never mapped` : '— none of those artifacts references another record at all'}. ` +
            `The page can be read; it cannot be TRAVERSED, and traversal is what an agent holding a story does with it. ` +
            `Two legal answers, and only two. Either cite the record that carries the link — the reference lives in a ` +
            `column of an artifact you already harvested, so this costs no instance read — or declare the gap in the ` +
            `slot form CONTRACT.md defines: "<!-- slot: mechanism.chain | source: HV | status: unfilled | blocked_on: ` +
            `<what> -->" followed by one line saying where the chain stops and why. Do NOT satisfy this by citing more ` +
            `artifacts: an unrelated citation that happens to resolve is exactly the reading this check exists to refuse.`);
        }
      }
      return rej;
    },
    apply: (ctx, art) => {
      /*
       * PLAN 7.4 (7.3's disposition line) — AN UNANSWERED CANDIDATE SHIPS AS AN INDUCED
       * DECISION, WITH ITS CAVEAT. Confirmed candidates became DECs at the interview; denied
       * ones are refuted and kept; what remains is an evidence-backed hypothesis nobody
       * contradicted, and the harness is more honest carrying it as `induced` than silently
       * dropping it. The DEC renderer prints the caveat on every such entry, and
       * applySupersession retires it outright the day its witness dies. Ids are content-hashed,
       * so a re-rendered iteration updates rather than duplicates.
       */
      const WHY_ANCHOR_SOURCE = { deletion: 'deletion', 'config-pattern': 'config-pattern', 'doc-contradiction': 'doc' };
      const refuted = new Set((((ctx.state.queue || {}).refutedCandidates) || []).map((r) => r.key));
      const induced = (((ctx.state.queue || {}).decisionCandidates) || [])
        .filter((c) => c && !c.disposed && !refuted.has(c.key) && (c.witnesses || []).length)
        .map((cand) => ({
          statement: cand.statement,
          rationale: cand.rationaleDraft || null,
          rationaleStrength: 'inferred',
          impact: null,
          principle: cand.principleDraft || null,
          alternatives: [],
          scope: { instance: ctx.state.instance, tables: cand.table ? [cand.table] : [] },
          answeredBy: null, answeredAt: null,
          answerProvenance: { fromQuestion: cand.fromQuestion || null, channel: 'induction', verbatim: null, rationaleVolunteered: false, branch: null },
          derivedFrom: 'induced',
          witnessClaims: cand.witnesses.filter((id) => ctx.brain.claims().has(id)),
          explainsClaims: [],
          tier: 'induced', anchorSource: WHY_ANCHOR_SOURCE[cand.source] || 'config-pattern',
          linkage: 'bound',
          confidence: 'low',
          supersedes: null, supersededBy: null, confirmationStatus: 'current', reconfirmation: [],
        }));
      return {
        decisions: induced,
        facts: {
          render: {
            pages: art.pages.length,
            verified: art.pages.filter((p) => p.status === 'verified').length,
            mixed: art.pages.filter((p) => p.status === 'mixed').length,
            draft: art.pages.filter((p) => p.status === 'draft').length,
            kernel: art.kernel, settings: art.settings, skills: (art.skills || []).length,
            inducedDecisionsMinted: induced.length,
          },
        },
        findings: (art.findings || []).concat(renderQualityFindings(ctx), storyPairingFindings(ctx)),
        raw: art.pages.map((p) => Object.assign({ kind: 'page' }, p)),
        progress: true,
      };
    },
    next: () => 'done',
  },
];

/**
 * F7 (2026-09-02). A resolved update set that pairs to NO seeded story and carries no induced
 * story root is an unresolved link: it shipped something, and nothing says what work item asked
 * for it. A warning, visible in the deliverable and askable at the next interview — never a
 * silent drop, and never a rejection the render worker cannot satisfy (it cannot invent the
 * pairing the set name does not carry).
 */
function storyPairingFindings(ctx) {
  let built = null;
  try { built = require('./pages.js').buildStoryPages(ctx.brain.root, { wiki: wikiRootOf(ctx) }); } catch (e) { return []; }
  if (!built || !built.unpaired.length) { return []; }
  return [{
    check: 'story-set-unpaired', severity: 'warning', rung: 'L1',
    locus: { table: 'sys_update_set', sysId: 'stories' },
    message: `${built.unpaired.length} resolved update set(s) pair to no seeded story or induced story root: ` +
      `${built.unpaired.slice(0, 5).map((s) => `${s.name} (${s.members} members)`).join('; ')}${built.unpaired.length > 5 ? '; …' : ''}. ` +
      'They are listed on deployment-matrix.md as "pairs to no story". Ask the developer which work item shipped them; a set with no story is history nobody can cite.',
  }];
}

/**
 * PRODUCT-79 / PRODUCT-80 as BOUNDED findings rather than per-page rejections.
 *
 * The first version rejected 136 of 148 eligible pages plus 39 retirement failures — 175
 * rejections in a single ingest — against a render cap of 3. Three such artifacts terminate the
 * run `exhausted`, and going from 175 to 0 in three attempts is not a fix cycle. Worse,
 * `rendersClaims` carries no completeness constraint and the rule skipped a page citing nothing,
 * so the CHEAPEST legal answer was to trim every page's citations to four — destroying the
 * evidence graph the ledger exists to produce, in order to satisfy a guard about quality.
 *
 * A guard whose cheapest answer is to delete the evidence is worse than no guard. So the diffuse
 * signal is a finding: bounded, visible at ingest, dispositionable with attribution, and carried
 * into the deliverable — and the blocking one still stops terminal success until a human closes it.
 */
function renderQualityFindings(ctx) {
  const q = (ctx && ctx.renderQuality) || { pages: [], retired: [], unmentioned: null };
  const out = [];
  const un = q.unmentioned;
  if (un && un.tables.length) {
    out.push({
      check: 'ledger-classes-rendered-nowhere',
      /*
       * Blocking only when the wiki names NONE of them, which is a wiki that renders no evidence
       * at all rather than one that curated some out. Everything between is a warning carried into
       * the deliverable with attribution — the same shape as the assertion finding above, for the
       * same METHOD-4 reason.
       */
      severity: un.tables.length === un.eligible ? 'blocking' : 'warning',
      rung: 'L1',
      message:
        `${un.tables.length} of ${un.eligible} table(s) carrying ${un.minClaims} or more claims are named nowhere in the ` +
        `wiki (population: DISTINCT locus.table over the finished ledger, counted at >= ${un.minClaims} claims; ` +
        `${un.total} tables have claims at all). Worst: ` +
        `${un.tables.slice(0, 8).map((t) => `${t.table} (${t.claims})`).join(', ')}` +
        `${un.tables.length > 8 ? `, and ${un.tables.length - 8} more` : ''}. ` +
        `These claims were read, banked, verified and paid for, and a reader has no route to them. Generate the ` +
        `evidence appendix — \`node tools/snbrain/render.js --root . --appendix\` — which renders every claim in the ` +
        `ledger one page per table under the same 20KB cap, or state on a page why a class is not worth rendering. ` +
        `Not every table deserves a curated page; every table deserves a decision.`,
    });
  }
  const eligible = q.pages.filter((p) => p.wanted >= 5);
  const bare = eligible.filter((p) => p.shown * 2 < p.wanted);
  if (bare.length) {
    const worst = bare.slice().sort((a, b) => (a.shown / a.wanted) - (b.shown / b.wanted)).slice(0, 5);
    out.push({
      check: 'pages-render-loci-not-assertions',
      severity: bare.length === eligible.length ? 'blocking' : 'warning',
      rung: 'L1',
      message:
        `${bare.length} of ${eligible.length} page(s) cite five or more distinct claims and show fewer than half ` +
        `their assertions — the page names the record and will not say what it says. The values are already in ` +
        `the ledger and were already paid for. Worst: ${worst.map((p) => `${p.path} (${p.shown}/${p.wanted})`).join(', ')}. ` +
        `Render an Asserts column beside each artifact — tools/snbrain/render.js artifactTable() emits it. ` +
        `Do NOT satisfy this by trimming rendersClaims: the citation graph is this deliverable's evidence.`,
    });
  }
  if (q.retired.length) {
    const total = q.retired.reduce((n, r) => n + r.count, 0);
    out.push({
      check: 'retired-artifacts-render-as-live',
      severity: 'blocking',
      rung: 'L1',
      message:
        `${total} artifact(s) the ledger records as inactive are rendered on ${q.retired.length} page(s) with no ` +
        `retirement marker on the line that names them: ` +
        `${q.retired.slice(0, 5).map((r) => `${r.path} (${r.count}: ${r.sample.join(', ')})`).join(' · ')}. ` +
        `A dead artifact listed beside live ones reads as live, which is worse than omitting it — the previous run ` +
        `shipped four retired UI actions and a business rule that has never executed, one of them marked verified. ` +
        `Mark each RETIRED on its own row; a marker elsewhere on the page does not disarm this.`,
    });
  }
  return out;
}

/*
 * ANCHOR's arithmetic, measured on run pilot-run-6 (2026-08-28, devinst02, 7 seeded sets, median 11
 * members). MIN_OVERLAP 2: a recovered set sharing a single seeded artifact was, every time, a
 * neighbouring process reached through a shared form section. AREA_MIN 5 / AREA_PACK 15: 30 of 51
 * tables held three records or fewer, and a brief — not a call — is the expensive unit.
 */
const ANCHOR_MIN_OVERLAP_RATIO = 0.5;   // pilot-run-7: every neighbour scored <= 0.13; the genuine recovery shared a story root
const ANCHOR_AREA_MIN = 5;
const ANCHOR_AREA_PACK = 15;

const STAGE_BY_ID = new Map(STAGES.map((s) => [s.id, s]));
const STAGE_ORDER = STAGES.map((s) => s.id);

/**
 * PRODUCT-82. The stages a boundary change invalidates, in run order, filtered to those this run
 * has actually STARTED.
 *
 * "Started" is `status` in {active, complete} OR any recorded iteration — not `status === complete`
 * alone. A stage rejected on its first attempt is `active` with a spent budget and an artifact on
 * disk cast in the old population; leaving it out would send the run back to census and leave
 * harvest holding `harvestDone` entries naming areas that no longer exist.
 *
 * A stage never entered is absent by construction, which is what makes a refine BEFORE census — the
 * boundary decision the loop actually wants — cost nothing and discard nothing.
 */
function boundaryCastStages(state) {
  const table = (state && state.stages) || {};
  return STAGES.filter((s) => s.boundaryCast).filter((s) => {
    const st = table[s.id];
    if (!st) { return false; }
    return st.status === 'active' || st.status === 'complete' || (st.iterations || []).length > 0;
  }).map((s) => ({
    stage: s.id,
    why: s.boundaryCast.why,
    queue: (s.boundaryCast.queue || []).slice(),
    facts: (s.boundaryCast.facts || []).slice(),
    accepted: ((table[s.id].iterations) || []).filter((it) => it.accepted).length,
  }));
}

module.exports = {
  STAGES, STAGE_BY_ID, STAGE_ORDER, boundaryCastStages,
  HARD_RULES, ENVELOPE_SCHEMA,
  LOCUS_SCHEMA, EVIDENCE_SCHEMA, FINDING_SCHEMA,
  computeRank, rankOrder,
  BODY_FIELDS, readableBodyTables, explainCandidates, tokenOverlap, declaredFieldsFor,
  EMPTY_ASSERTION_RE, requestedFields, emptyAssertionViolations, emptyStrata, EMPTY_STRATUM_MIN,
  referenceGraph, danglingClasses, danglingFindings, DANGLING_CLASS_MIN_TARGETS,
  chainRepairAreas, CHAIN_REPAIR_ROUNDS, CHAIN_REPAIR_MAX_AREAS, CHAIN_REPAIR_MAX_IDS,
  DEFINING_CHILDREN, definingChildrenFor, CHILD_DEPTH_CAP,
  DATA_AREAS, dataAreasFor,
  vocabularyCandidates, VOCAB_STOPWORDS, staleClaims, lintEncodedQuery,
  decisionCandidates, decisionCandidatesFromLedger, DECISION_CANDIDATES_MAX, SIBLING_MODULE_PREFIXES,
  tokenPrefixKin, validateCandidateWitnesses, whyQuestionsFromCandidates,
  stagePacing, pacingLine,
  CONVENTION_KINDS, DOCUMENT_KINDS, TRACKER_KINDS, INSTANCE_WIDE_BOUNDARY,
  corpusGateStamp, governedGateStamp, blindSkipsOrientation,
  ANCHOR_MIN_OVERLAP_RATIO, ANCHOR_AREA_MIN, ANCHOR_AREA_PACK,
};
