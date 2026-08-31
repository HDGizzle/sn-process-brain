'use strict';
/*
 * tools/snbrain/lib/state.js — the durable spine of an engagement brain.
 *
 * THE CLI OWNS THE STATE MACHINE. The agent supplies reasoning only. Everything that
 * decides what happens next — the stage cursor, the iteration caps, the budget, the
 * stagnation breaker, the terminal states, the ids in every ledger — lives here, on
 * disk, and is computed by this file. That is what makes the model a COMPONENT rather
 * than the ORCHESTRATOR: it is also what stops a model deciding it is finished.
 *
 * STATE IS THE PRODUCT'S MEMORY, so every mutation is flushed to disk immediately and
 * `next` after a kill -9 returns the same brief. Long agent sessions degrade as context
 * fills and compaction silently drops standing constraints; on this platform that
 * produces SILENT failures. Nothing important is allowed to live in the conversation.
 *
 * FIVE DEFECTS FROM THE REFERENCE ENGAGEMENT (<reference-engagement>/.claude/loop) ARE
 * FIXED HERE BY CONSTRUCTION, NOT BY DISCIPLINE:
 *
 *   1. THE STAGNATION BREAKER THAT NEVER FIRED. the pilot customer keys stagnation on set-equality of
 *      model-authored finding ids (state.js:140-146). Model-authored ids never repeat,
 *      so the breaker fired zero times in 32 recorded iterations. Here the trigger is
 *      RESOLUTIONS COUNTED FROM THE LEDGER: a claim whose status left draft/unverified/
 *      drifted. Two consecutive iterations with zero resolutions is `stalled`, and no
 *      string a model writes can influence it.
 *
 *   2. IDS ALLOCATED BY THE MODEL. Every id in every ledger here is a content hash
 *      computed by this file over the fields that define identity. Re-ingesting the same
 *      claim yields the same id, which is what makes dedupe, transition counting and
 *      supersession possible at all.
 *
 *   3. SEVERITY REWRITING AS A CLOSURE STRATEGY. the pilot customer state/STRY0186518.json shows six
 *      findings re-emitted with severity downgraded blocking->info, taking the blocking
 *      count 2->0, because closure read `findings.filter(f => f.severity === 'blocking')`.
 *      Here `severity` is IMMUTABLE after first recording, `disposition` and
 *      `dispositionBy` are separate fields, and closure is "no finding with
 *      severity=blocking AND disposition=open". A downgrade attempt is a rejection.
 *
 *   4. TWO-VALUED TEST OUTCOMES. the pilot customer records a case literally titled "NOT DEMONSTRATED"
 *      as `result: pass`, because a binary schema gives an honest non-demonstration
 *      nowhere to go. Outcomes here are three-valued and `not-demonstrated` blocks
 *      terminal `success` exactly as `fail` does.
 *
 *   5. A PROJECTION THAT LIES. the pilot customer's `show` prints "loop A: 4/3 iterations" because it
 *      counts one array and is blind to archived ones. Here iteration counting has a
 *      single source (`stages[id].iterations`), `sinceProgress` and `total` are separate
 *      recorded numbers, and nothing is ever archived out of view.
 *
 * A SIXTH, WHICH IS THIS FILE'S OWN JUDGEMENT: the cap applies to iterations SINCE THE
 * LAST PROGRESS, not to the stage's lifetime. the pilot customer's cap of 3 was hit five times and
 * overridden five times, which is a speed bump that generates schema drift rather than a
 * control. Progress resets the cap; a separate runaway ceiling bounds the lifetime; and
 * `override` is a first-class attributed verb so the overrides that do happen are data.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SCHEMA_VERSION = 1;

/** LOOP.md section 6. Only `success` permits handoff; everything else requires a human. */
const TERMINAL_STATES = Object.freeze(['success', 'no-op', 'blocked', 'stalled', 'exhausted', 'abandoned']);

/** Claim lifecycle. `unverifiable` is first class and carries a sub-reason. */
/*
 * Claim lifecycle. `unverifiable` is first class and carries a sub-reason.
 *
 * `documented` is SETTLED and is the whole of 5.50's document rung. A doc-sourced fact —
 * a convention a human stated, a line from a way-of-working page — has no oracle by
 * construction: there is nothing to replay, so `verify` can never promote it and
 * `unverifiable/no-oracle` would file it beside instance reads that a broken session ate.
 * It leaves UNRESOLVED_STATUSES on arrival, which is what keeps invariant 2 true (every
 * claim reaches a settled status) without pretending the instance was ever asked.
 *
 * A document is a LEAD, never a verified claim. The justification is measured, not feared:
 * the SME's own hand-built brain carried a wrong accident report expansion for five months and it was
 * the instance-driven interview that corrected it. Documents rot; the instance is the
 * as-built.
 */
const CLAIM_STATUSES = Object.freeze(['draft', 'unverified', 'verified', 'drifted', 'gone', 'unverifiable', 'documented']);
/** A claim in one of these is OPEN WORK. Leaving this set is a RESOLUTION. */
const UNRESOLVED_STATUSES = Object.freeze(new Set(['draft', 'unverified', 'drifted']));
/*
 * PLAN 5.17 / PRODUCT-37. THE FOURTH SUB-REASON, and the only claim vocabulary in this file
 * that no artifact may write.
 *
 * On run 6ef14f5562 a claim the CLI itself declined to sample had two available descriptions
 * and both were false: `draft` (a member of UNRESOLVED_STATUSES, so it blocks handoff forever)
 * or one of the agent reasons above, none of which is true of a claim nobody looked at. The
 * operator escaped with a hand edit to state.json. `unverifiable` is already settled, already
 * outside UNRESOLVED_STATUSES, already refused by render's verified-page guard and already
 * carries a reason field, so this is a fourth VALUE, not a seventh status.
 *
 * The split matters more than the addition. AGENT_UNVERIFIABLE_REASONS is what the verify
 * verdict schema offers; UNVERIFIABLE_REASONS is what the ledger will store. An agent that
 * types `not-sampled` is rejected at the schema, and if it reaches upsertClaims by any other
 * door it is rejected there too — a guard that lives in only one of two doors is not a guard.
 */
/*
 * PLAN 6.7 / PRODUCT-89 — `interpretation` is the fourth agent-writable reason. An explain
 * claim's assertion is a SENTENCE ABOUT BEHAVIOUR, and re-reading the script body confirms the
 * body, not the sentence: run 93838afe87 stamped all 150 interpretations `verified` at L1 by
 * comparing a field to itself, so a mis-read filter condition would have passed with the same
 * green as `label = Next scheduled`. The honest verdict for an interpretation whose substrate
 * still matches is unverifiable-with-reason, carrying the re-read body so the CLI can hash the
 * SUBSTRATE — a later run then detects that the body changed even though the sentence can never
 * be mechanically re-checked. It closes at L3 (round-trip re-derivation) or L5 (a human), never
 * at L1.
 */
const AGENT_UNVERIFIABLE_REASONS = Object.freeze(['blocked-by-access', 'no-oracle', 'requires-write', 'interpretation']);
const NOT_SAMPLED = 'not-sampled';
const UNVERIFIABLE_REASONS = Object.freeze(AGENT_UNVERIFIABLE_REASONS.concat([NOT_SAMPLED]));

/*
 * PLAN 7.2 — THE THREE CONFIDENCE TIERS, VISIBLE IN THE DELIVERABLE.
 *
 * `confirmed`: a human said yes — orientation, sealed recall, or an interview answer. The DEC
 * ledger renders it as the architects' own position.
 * `induced`:  an evidence-backed hypothesis the CLI minted from claim patterns and no human has
 * confirmed. Usable WITH its caveat, and its witnesses are its whole argument — which is why an
 * induced decision whose witness dies is retired outright in applySupersession() rather than
 * flagged: a hypothesis that lost its evidence is not a caveat, it is gone.
 * `unknown`:  a TBD. It renders into tbd.md, never into the DEC ledger, and the harness rule is
 * the pilot customer's: the agent must not improvise over it.
 */
const DECISION_TIERS = Object.freeze(['confirmed', 'induced', 'unknown']);
const DECISION_ANCHOR_SOURCES = Object.freeze(['update-set', 'deletion', 'config-pattern', 'interview', 'doc']);

/**
 * One implementation, required by state (supersession), render (the DEC ledger) and stages
 * (render.validate) alike — the claims-rendered miscount taught that two copies of one rule
 * drift apart silently (METHOD-4's missed-mutation table).
 *
 * Legacy rows predate the `tier` field. Every mint path before it was human-answered
 * (orientation `stated`, sealed `recall`, `interview`), so a human-attributed legacy row is
 * `confirmed`; anything else has no honest tier and reads `unknown`.
 */
function decisionTier(dec) {
  if (dec && DECISION_TIERS.includes(dec.tier)) { return dec.tier; }
  if (dec && dec.answeredBy && ['stated', 'recall', 'interview'].includes(dec.derivedFrom)) { return 'confirmed'; }
  return 'unknown';
}

/** The distinct claim ids a decision rests on, both roles. Empty means supersession cannot reach it. */
function decisionAnchors(dec) {
  return [...new Set([].concat((dec && dec.witnessClaims) || [], (dec && dec.explainsClaims) || []))];
}
/** The token `settleUnsampled` stamps on a row. Mirrors `__cliAllocated` on questions. */
const UNSAMPLED_TOKEN = '__cli-minted-unsampled__';

/**
 * What it costs to re-read a set of claims, in the unit the transport bills in.
 *
 * THE NUMBER THIS EXISTS TO CORRECT. Run 6ef14f5562 left 8,179 claims draft, and its own
 * quirks log priced convergence at "~8,179 further re-queries; 93 calls remained" — the CLAIM
 * count, not the CALL count. Measured over that run's ledger those 8,179 claims are 3,807
 * distinct `table|sysId` loci across 93 tables, which is 138 batched reads at 60 ids per
 * `sys_idIN` plus 93 dictionaryFields validations: 231 calls against 93 remaining. Verify's
 * stopping rule was unreachable ON THAT RUN by about 138 calls, not unreachable in principle,
 * and that changes the fix from "let verify sample" to "price the job and reserve the money".
 * It is also why `settleUnsampled` writes this number down: a close that abandons 8,179 claims
 * to save 138 calls should read as absurd, and it only reads that way if both numbers are there.
 *
 * ADVISORY, deliberately (PRODUCT-40's critic correction): `sys_idIN` limits vary by table
 * width and result size on this platform, so this estimate never seeds a stage-closing cap and
 * is always printed with its arithmetic shown so a reader can disbelieve it.
 */
const CLAIM_BATCH_IDS = 60;
function claimReadCost(claims, batchSize) {
  const size = batchSize || CLAIM_BATCH_IDS;
  const byTable = new Map();
  for (const c of claims) {
    const t = (c.locus && c.locus.table) || '(no table)';
    if (!byTable.has(t)) { byTable.set(t, new Set()); }
    byTable.get(t).add((c.locus && c.locus.sysId) || c.id);
  }
  let loci = 0;
  let batchedReads = 0;
  for (const ids of byTable.values()) { loci += ids.size; batchedReads += Math.ceil(ids.size / size); }
  return {
    claims: claims.length, loci, tables: byTable.size, batchSize: size,
    batchedReads, fieldValidations: byTable.size, estimatedCalls: batchedReads + byTable.size,
  };
}

/*
 * PRODUCT-35 / PRODUCT-36 — WHY A STAGE CLOSED, as a closed vocabulary.
 *
 * A stage leaves for one of two reasons and they are not the same fact. Either its own next()
 * said the work was done — `queue-empty` — or a BOUND fired with work still queued: the money,
 * the clock, or its own ceiling. The distinction is the product. A run that stopped because it
 * ran out of budget did not finish, and `successBlockers()` keys on BOUND_CLOSE_REASONS and
 * nothing else, so adding a reason here is a visible choice about which of the two it is
 * rather than a silent one.
 */
const CLOSE_REASONS = Object.freeze(['queue-empty', 'budget-capped', 'elapsed-capped', 'iteration-capped']);
const BOUND_CLOSE_REASONS = Object.freeze(new Set(['budget-capped', 'elapsed-capped', 'iteration-capped']));

const SEVERITIES = Object.freeze(['blocking', 'warning', 'info']);
const DISPOSITIONS = Object.freeze(['open', 'fixed', 'accepted', 'wontfix', 'superseded']);
/** PRODUCT-64. Allocated by `dispositionFinding` alone; refused everywhere else. */
const DISPOSITION_FIELDS = Object.freeze(['disposition', 'dispositionBy', 'dispositionRung', 'dispositionReason']);
/**
 * PRODUCT-65. Names the loop gives itself when asked who is accountable, at a rung that claims a
 * human accepted something.
 *
 * WHAT THIS CATCHES, STATED CORRECTLY. An earlier draft of this comment claimed the run's five
 * `dispositionBy: "orchestrator (explain retry, verified at ingest)"` closures were the incident.
 * They were not: all five were recorded at `dispositionRung: 'L1'` with real `disposition` events
 * in history.ndjson, and an L1 closure asserts "I re-read the evidence and it is fixed", which an
 * agent may honestly assert. Those five are legal and stay legal. The actual incident was four
 * findings carrying `disposition: 'accepted'` / `dispositionBy: 'snbrain-verify (checker)'` with
 * no reason and no history event at all, and PRODUCT-64 is what catches those.
 *
 * So this guard is narrow on purpose: **L5 alone**, because L5 is the rung that means a named
 * human accepted a blocking finding nobody can fix. At L1-L3 the closure rests on replayed
 * evidence and `cli:explain` is an honest signature.
 *
 * ANCHORED, NOT SUBSTRING. The first version denylisted substrings and rejected nine honest names
 * out of thirty-seven tested: `Ben Bot` (a real Dutch surname), `Claude Dubois` (a common given
 * name), `M. Jansen, service agent` (ServiceNow's own word for a fulfiller), and every job title
 * containing `automation`, `model`, `pipeline` or `CLI`. For a person actually named Bot there was
 * no legal L5 closure at all, which is invariant 6 — a guard whose only escape is hand-editing
 * `.brain/`. Blocking the honest path is worse than not guarding.
 *
 * BE HONEST ABOUT WHAT THIS IS NOT. map-instance.md makes the agent the only caller of this CLI,
 * so `--by` is always a string a model typed and no pattern stops a model typing "the developer".
 * This makes the dishonest path require a deliberate impersonation instead of a shrug. The real
 * guarantee needs the human gate to deposit something the CLI observes — 5.18, not this.
 */
const AGENT_IDENTITY_RE = /^\s*(the\s+)?(orchestrator|sub-?agent|agent|assistant|checker|maker|model|bot|llm|claude|gpt|snbrain|the\s+loop|this\s+run)\s*(\(.*\))?\s*$|^\s*(cli:|snbrain[-\s:]|agent[-\s:])/i;
/*
 * The verification ladder, plus one value that is deliberately NOT on it. `DOC` marks a
 * claim or finding whose only source is a human-authored document or a stated convention:
 * undated, unverified, not replayable. It sorts nowhere on L0..L5 because it is not weaker
 * evidence of the same kind — it is evidence about what somebody wrote down, which is a
 * different population from evidence about what the instance does. Where the two
 * contradict, the contradiction is the finding, and that is the highest-value question
 * shape the ranker already knows how to score.
 */
const RUNGS = Object.freeze(['L0', 'L1', 'L2', 'L3', 'L4', 'L5', 'DOC']);

/** Three-valued, and the third value is the whole point. */
const OUTCOME_RESULTS = Object.freeze(['pass', 'fail', 'not-demonstrated']);

const QUESTION_STATUSES = Object.freeze(['queued', 'asked', 'answered', 'suppressed', 'deferred', 'merged', 'shadow']);

const DEFAULTS = Object.freeze({
  capPerStage: 3,          // iterations since last progress
  runawayCeiling: 12,      // iterations per stage lifetime; above the highest observed real convergence
  /*
   * PRODUCT-7. Was 2,000, which the design set before any full run existed. The first real
   * scoped run — ONE domain on one instance — spent 3,397 and had to have its budget raised
   * mid-flight. A default that a correct, bounded run cannot live within is not a safety
   * ceiling, it is an interruption, and every interruption it causes is an attributed override
   * that teaches the operator overrides are routine. 5,000 is what a scoped run measured;
   * an instance-wide run should be raised deliberately at init.
   */
  maxCalls: 5000,
  questionCap: 10,
  staleAfterDays: 14,
  /*
   * How many candidate records the `explain` stage may read logic bodies for. Bounded because
   * body fields are the most expensive read on the platform — they are unbounded text, and
   * PLATFORM-10 says a wide field list additively breaks pagination — and because the point is
   * the ranked head of the distribution, not the tail. Everything the cap drops is RECORDED
   * with a reason; the question cap's silent truncation of six questions is the counter-example
   * this must not repeat.
   */
  explainCap: 150,
  /*
   * Slots of the question cap held for domain-vocabulary questions. RESERVED rather than
   * ranked, because WPM scores a vocabulary gap near the floor by construction: expanding an
   * acronym breaks nothing, touches no records and has no blast radius, so it loses every cap
   * it ever meets. That ranking is not wrong about consequence, it is measuring the wrong
   * thing — a word nobody can expand does not break the instance, it breaks the deliverable.
   */
  vocabularyReserve: 3,
  /*
   * Slots of the question cap held for CONVENTION reconciliations. Same argument as the
   * vocabulary reserve and the same arithmetic behind it: WPM scores "is this naming rule
   * deliberate?" at the floor, because a convention breaks nothing and touches no records. It
   * is also, measurably, the question the reference run most needed and never asked. Two,
   * not three: a run typically states a handful of conventions and only some are testable,
   * and a reserve larger than the population it serves is a cap reduction wearing a nicer name.
   */
  conventionReserve: 2,
  /*
   * PRODUCT-35. The share of the WHOLE budget held back for the stages after the one currently
   * spending. Harvest spent 269 calls on 1 of 431 areas and nothing reserved anything for
   * anyone; verify's own job was then ~255 batched reads against 93 calls left. A stage CLOSES
   * (it does not terminate) when one more iteration at its own MEASURED rate would eat into
   * this. 0.25 is what the reference run's downstream stages actually cost as a share of its
   * budget — explain 36 + verify 80 + questions 12 + render 0 = 128 of 800 — with the balance
   * held for the retry line LOOP.md section 10 already budgets.
   */
  downstreamReserveShare: 0.25,
  /*
   * PRODUCT-35(c). Calls were never the binding resource: the reference run was 7h58m end to
   * end, ~4h15m of it machine time, to produce ONE harvest area at 72 minutes, and every
   * stopping rule it had was denominated in API calls. LOOP.md section 10 says it outright —
   * "wall clock is the real constraint, not calls". Stages with a human in them declare no
   * `closeOn`, so this can never close a stage that is waiting for a person.
   */
  stageWallClockHours: 4,
});

// ---------------------------------------------------------------------------
// identity: content hashes, computed here, never supplied by a model
// ---------------------------------------------------------------------------

/** Deterministic JSON: keys sorted at every level, so a hash is stable across writers. */
function canonical(value) {
  if (Array.isArray(value)) { return '[' + value.map(canonical).join(',') + ']'; }
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort()
      .map((k) => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  }
  return JSON.stringify(value === undefined ? null : value);
}

function digest(parts, bytes) {
  return crypto.createHash('sha256').update(canonical(parts)).digest('hex').slice(0, (bytes || 6) * 2);
}

/** The legs a domain predicate can be built from. Order is the order they are reported in. */
const DOMAIN_LEGS = Object.freeze(['scope', 'author', 'name', 'updateSet']);

/**
 * Parse a composable domain predicate.
 *
 *   scope:sn_ohs_im,x_acme_acme; author:jan.jansen; name:ACME*,accident report*; updateset:STRY01850*
 *
 * WHY THIS REPLACES A BARE SCOPE LIST. A scope is a deployment container, not a domain, and
 * the two came apart badly on the reference run: harvest was scoped to one application plus
 * `global`, and 4.53% of the resulting 96,606 claims were plausibly in-domain. Two areas were
 * half the ledger and 0.47% of it was on-topic. Meanwhile widening the definition beyond scope
 * — by author and by name — would have added only 155 claims, which says the scopes were not
 * too narrow: `global` was simply the wrong place to be looking, and it was being SWEPT rather
 * than reached into.
 *
 * A domain is a UNION of cheap, independently measurable legs. Union rather than intersection
 * because customer work genuinely scatters — a ACME record can live in a vendor scope, carry
 * the customer's prefix, and ship in a story update set, and any one of those is enough to
 * admit it. Each admitted claim records WHICH leg admitted it, so the next run can see which
 * legs earned their reads and which only produced volume. That per-leg yield is the number
 * that was missing: without it "we mapped the ACME domain" is unfalsifiable.
 */
function parseDomain(spec) {
  if (!spec || typeof spec !== 'string') { return null; }
  const out = { scope: [], author: [], name: [], updateSet: [] };
  const alias = { scope: 'scope', scopes: 'scope', author: 'author', authors: 'author', name: 'name', names: 'name', prefix: 'name', updateset: 'updateSet', 'update-set': 'updateSet', us: 'updateSet' };
  for (const clause of spec.split(';')) {
    const trimmed = clause.trim();
    if (!trimmed) { continue; }
    const at = trimmed.indexOf(':');
    if (at < 0) { throw new BrainError(`--domain: "${trimmed}" has no leg. Use <leg>:<value,value>, legs being ${DOMAIN_LEGS.join(' | ')}.`); }
    const leg = alias[trimmed.slice(0, at).trim().toLowerCase()];
    if (!leg) { throw new BrainError(`--domain: unknown leg "${trimmed.slice(0, at).trim()}". Legs are ${DOMAIN_LEGS.join(' | ')}.`); }
    for (const v of trimmed.slice(at + 1).split(',')) {
      const value = v.trim();
      if (value) { out[leg].push(value); }
    }
  }
  if (!DOMAIN_LEGS.some((l) => out[l].length)) {
    throw new BrainError('--domain: no legs carried a value. A predicate with no legs admits nothing, which is not the same as no predicate at all.');
  }
  return out;
}

/** Human-readable, and it is what gets stamped on every rendered page. */
function describeDomain(domain) {
  if (!domain) { return null; }
  return DOMAIN_LEGS.filter((l) => domain[l] && domain[l].length)
    .map((l) => `${l}:${domain[l].join(',')}`).join(' ∪ ');
}

/**
 * The tables whose rows ARE `sys_metadata` rows, so they carry `sys_name` (the display name) and
 * `sys_scope` (a REFERENCE, never a name). This is an ALLOWLIST and it errs toward `unknown` on
 * purpose: listing a table here that does not extend sys_metadata makes the compiler emit a clause
 * that table cannot honour, and an unknown field in an encoded query returns UNFILTERED rows on
 * this instance (PLATFORM-1) — that would be PLATFORM-1 reproduced through our own code, which is
 * the one outcome worse than a leg we admit we cannot compile. Omitting a table costs that table
 * its scope and name legs and SAYS SO; the remedy carried in `unavailableLegs` recovers them.
 * The first 25 entries are exactly the keys of stages.js BODY_FIELDS; all 25 are application files.
 */
const DOMAIN_METADATA_TABLES = Object.freeze(new Set([
  'sys_metadata',
  'sys_script', 'sys_script_client', 'sys_script_include', 'sys_ui_action', 'sys_ui_policy',
  'sys_ui_policy_action', 'sys_security_acl', 'sysevent_email_action', 'sysauto', 'sysauto_script',
  'sys_processor', 'sys_ws_operation', 'sys_ui_script', 'sys_script_fix', 'sys_transform_script',
  'sys_transform_entry', 'sp_widget', 'sys_ui_page', 'sc_cat_item_producer', 'item_option_new',
  'sys_data_policy2', 'wf_activity', 'sys_hub_flow', 'sys_hub_action_type_definition', 'sf_state_flow',
  // and the classes the reference run's own census put at the top of its area list
  'sc_cat_item', 'sys_dictionary', 'sys_documentation', 'sys_db_object', 'sys_ui_view',
  'sys_ui_list', 'sys_ui_section', 'sys_ui_form', 'sys_relationship', 'sys_ui_message', 'sys_report',
]));

/**
 * Which column each leg lives in, per table family. `sys_created_by` / `sys_updated_by` are on
 * EVERY table and are the only leg that survives a table this product cannot classify.
 */
function domainColumnsFor(table) {
  const t = String(table || '');
  const author = ['sys_created_by', 'sys_updated_by'];
  if (t === 'sys_update_xml') {
    // The only table where update-set membership is ONE hop — and `update_set` is a reference, so
    // the leg is the dot-walk `update_set.name`, never `update_set=<a story id>`.
    return { profile: 'update-xml', scope: null, author, name: null, updateSet: 'update_set.name' };
  }
  if (DOMAIN_METADATA_TABLES.has(t)) {
    return { profile: 'metadata', scope: 'sys_scope.scope', author, name: 'sys_name', updateSet: null };
  }
  return { profile: 'unknown', scope: null, author, name: null, updateSet: null };
}

/**
 * AND a clause onto EVERY leg of a `^NQ` query. PLATFORM-11, mechanised: a clause appended once at
 * the end binds to the LAST leg alone — the query stays valid and returns rows, just the wrong set
 * — and our own dictionaryFields() shipped exactly that bug in the one query that guards against
 * the silent clause-drop. This is the only supported way to intersect a compiled boundary with
 * anything: a Band A predicate, a class filter, a date floor.
 */
function conjoinQuery(compiled, clause) {
  const c = String(clause || '').trim().replace(/^\^+/, '');
  const query = typeof compiled === 'string' ? compiled : ((compiled && compiled.query) || '');
  if (!query) { return c; }
  if (!c) { return query; }
  return query.split('^NQ').map((leg) => `${leg}^${c}`).join('^NQ');
}

/** A leg the named table cannot honour: reported with what it is and how to reach it anyway. */
function domainLegUnavailable(leg, table, profile, values) {
  const base = { leg, values, reason: 'no-column-on-table' };
  if (leg === 'updateSet') {
    // One level of recursion only: the updateSet leg IS available on sys_update_xml, so the
    // compiled remedy below cannot re-enter this branch.
    return Object.assign(base, {
      detail: 'update-set membership is not a column. `sys_update_name` is a PER-RECORD capture id matching <table>_<sys_id> — measured ~1:1 with row count, 10,173 distinct over 12,382 rows — not the bundle.',
      remedy: `two hops: query sys_update_xml with \`${compileDomain({ updateSet: values }, 'sys_update_xml').query}\`, take \`name\` from each row, then filter ${table} with \`sys_update_nameIN<those names>\`. On the reference instance 49.3% of sys_update_xml rows carried an EMPTY update_set (3,303 of 6,694), so this leg has a measured recall hole; state it rather than reporting its count as the leg's yield.`,
    });
  }
  /*
   * PRODUCT-84. ESTABLISH FIRST, AND SAY WHAT ZERO MEANS.
   *
   * Both remedies below used to open with "every application-file row IS a sys_metadata row with
   * the same sys_id" and hand over `sys_class_name=<table>`. That premise is true of application
   * files and asserted here of a table the compiler has just declared it CANNOT CLASSIFY — and
   * when it is false the emitted query does not error, it returns zero rows. Measured on run
   * `pilot-run-4`: `sys_metadata` holds 0 rows of class `sys_user_group`, because groups are data, so
   * the remedy for reaching 21 ACME-named groups by name was a query that could only ever answer
   * "there are none". A confident empty answer is the worst failure mode this platform has —
   * PLATFORM-1 returns too much and is at least visible in the count, PLATFORM-28 and this return
   * nothing and read as a clean result.
   *
   * So the remedy is now two-step and the disambiguation is ONE CALL: count sys_metadata for the
   * class. Non-zero, the intersect is sound. Zero, the table is DATA and the whole sys_metadata
   * route is void — which is a finding about what this run cannot reach, not a query to retry.
   */
  const establish = `First establish which kind of table this is — one call: \`count(sys_metadata, sys_class_name=${table})\`. NON-ZERO means "${table}" is an application file and the intersect below is sound. ZERO means it is a DATA table (rows are not application files), and no sys_metadata route reaches it AT ALL: the query below would return zero rows and report it as an answer.`;
  if (leg === 'scope') {
    return Object.assign(base, {
      detail: profile === 'update-xml'
        ? 'sys_update_xml carries `application`, not `sys_scope`, and `application` is itself a reference — `application=<a scope name>` returns zero rows silently, exactly like `sys_scope=`.'
        : `\`sys_scope\` exists on sys_metadata and its descendants. "${table}" is not a table this product can PROVE is one, and a clause on a column a table does not have returns UNFILTERED rows on this instance (PLATFORM-1), not an error.`,
      remedy: profile === 'update-xml'
        ? `issue this leg against sys_metadata and intersect on sys_id: \`${conjoinQuery(compileDomain({ scope: values }, 'sys_metadata'), `sys_class_name=${table}`)}\`.`
        : `${establish} If NON-ZERO: \`${conjoinQuery(compileDomain({ scope: values }, 'sys_metadata'), `sys_class_name=${table}`)}\`. If ZERO: a data table has no scope to be in, and the scope leg of this boundary cannot reach "${table}" at any budget — record that as a finding rather than a zero-row result, and reach it on the NAME leg instead.`,
    });
  }
  return Object.assign(base, {
    detail: `\`sys_name\` is the display column on sys_metadata and its descendants; on an arbitrary table the equivalent is \`name\`, and this product cannot prove "${table}" has either. Guessing emits a clause the table cannot honour, which returns UNFILTERED rows (PLATFORM-1), not an error.`,
    remedy: `${establish} If NON-ZERO: \`${conjoinQuery(compileDomain({ name: values }, 'sys_metadata'), `sys_class_name=${table}`)}\`. If ZERO: the name leg lives on the table's OWN column — dictionary-validate \`name\` on "${table}" first (an unknown column drops the clause and returns the whole table), then issue the same compiled fragments against it with \`name\` substituted for \`sys_name\`. Say in the artifact which branch you took: a name leg answered from sys_metadata and one answered from the table itself are counting different populations.`,
  });
}

/**
 * COMPILE the boundary into encoded-query fragments. The fourth domain function, and the one
 * everything downstream was missing: `parseDomain` reads the predicate, `describeDomain` prints it,
 * `domainYield` scores it, and until now nothing turned it into a QUERY — so every stage re-encoded
 * it by hand from prose (the harvest brief emitted `name IN [ACME*, OHS*]`, which is not a
 * ServiceNow operator at all) and each re-encoding was an independent chance to hit a platform
 * trap. PRODUCT-28.
 *
 * IT TAKES THE TABLE, and that is not a convenience. `sys_name` exists on `sys_metadata`; the
 * equivalent on an arbitrary table is `name`; `sys_created_by` exists everywhere; and `sys_scope`
 * does not exist on a non-metadata table AT ALL. A compiler that emits a clause the table cannot
 * honour reproduces PLATFORM-1 through our own code. A leg that cannot be honoured is REPORTED in
 * `unavailableLegs`, never dropped and never guessed at.
 *
 * Three rules, each a trap measured on the reference instance:
 *
 *  1. SCOPE IS A REFERENCE COLUMN. `sys_scope=sn_ohs_im` returns ZERO rows on a 12,382-row scope
 *     with no error (PLATFORM-28); only `sys_scope.scope=sn_ohs_im` means what it reads. Two
 *     subagents rediscovered that at full price on one run, and the product's own CLI help taught
 *     the broken form.
 *  2. A TRAILING `*` IS `STARTSWITH`, NEVER `LIKE`. `sys_nameLIKESTRY` returns 984 against a true
 *     36 because it also matches "regiSTRY". A caller who wants a substring writes `*X*` and gets
 *     it back flagged `superset: true` with the count declared an upper bound.
 *  3. EVERY FRAGMENT IS ITS OWN `^NQ` LEG. A trailing clause after `^OR` binds to the last leg only
 *     (PLATFORM-11) — our own dictionaryFields() shipped that bug. The compiled query therefore
 *     contains no `^OR` at all, and `conjoinQuery()` is the only supported way to AND onto it.
 *
 * CASE, stated as a FIELD rather than as prose so the product can read it: `STARTSWITH` is
 * CASE-INSENSITIVE here. An `OHS*` leg admitted `Ohs task`, `ohs_task_sys_id` and
 * `ohs_risk_matrix_unique` — that is how four out-of-domain loci got in — so any downstream
 * re-derivation that is case-SENSITIVE will undercount and the two numbers will disagree with no
 * visible cause.
 *
 * The result is plain JSON on purpose: census stamps it into `facts.census.compiledDomain`, which
 * is what makes a boundary replayable instead of merely describable.
 */
function compileDomain(domain, table) {
  const cols = domainColumnsFor(table);
  const out = {
    table: String(table || ''), profile: cols.profile,
    legs: [], fragments: [], query: '', unavailableLegs: [],
    caseSensitive: false,
    caseNote: 'STARTSWITH and LIKE are CASE-INSENSITIVE on this platform. An `OHS*` leg admitted `Ohs task`, `ohs_task_sys_id` and `ohs_risk_matrix_unique` — four out-of-domain loci entered that way. A re-derivation that is case-SENSITIVE will undercount and the two numbers will disagree with no visible cause.',
    unionNote: 'The fragments are a UNION, one `^NQ` leg each. Count them by issuing `query` ONCE; issuing each fragment separately and summing double-counts every record more than one leg admits.',
    notes: [],
  };
  if (!domain) { return out; }
  for (const leg of DOMAIN_LEGS) {
    const values = (domain[leg] || []).map((v) => String(v || '').trim()).filter(Boolean);
    if (!values.length) { continue; }
    const column = cols[leg];
    if (!column) { out.unavailableLegs.push(domainLegUnavailable(leg, out.table, cols.profile, values)); continue; }
    const columns = Array.isArray(column) ? column : [column];
    const entry = { leg, columns, values, fragments: [], superset: false };
    for (const c of columns) {
      const exact = [];
      for (const v of values) {
        const core = v.replace(/^\*+/, '').replace(/\*+$/, '');
        if (!core) {
          out.notes.push(`${leg}: "${v}" is a bare wildcard and admits every row on ${out.table}. Dropped — a leg that admits everything is not a boundary.`);
          continue;
        }
        if (v.startsWith('*')) {
          // Leading wildcard: LIKE is a strict SUPERSET of what was asked for, and it is declared
          // as one. ENDSWITH exists but nothing on this instance measured it, and a wider result
          // that says it is wider is recoverable where a narrower one from an unmeasured operator
          // is not.
          entry.fragments.push(`${c}LIKE${core}`);
          entry.superset = true;
          out.notes.push(`${leg}: "${v}" leads with a wildcard, so it compiles to LIKE and its count is a SUPERSET — measured here, sys_nameLIKESTRY returns 984 against a true 36 because it also matches "regiSTRY". Treat the number as an upper bound and sample what it matched before using it.`);
        } else if (v.endsWith('*')) {
          entry.fragments.push(`${c}STARTSWITH${core}`);
        } else {
          exact.push(core);
        }
      }
      if (exact.length === 1) { entry.fragments.push(`${c}=${exact[0]}`); }
      else if (exact.length > 1) { entry.fragments.push(`${c}IN${exact.join(',')}`); }
    }
    if (!entry.fragments.length) { continue; }
    out.legs.push(entry);
    out.fragments.push(...entry.fragments);
  }
  out.query = out.fragments.join('^NQ');
  if (out.fragments.length > 20) {
    out.notes.push(`this boundary compiles to ${out.fragments.length} ^NQ legs on ${out.table}. If the transport truncates the URL, issue the legs in batches and de-duplicate on sys_id — never sum the per-leg counts (see unionNote).`);
  }
  return out;
}

/**
 * Per-leg yield over the claim ledger: how many claims each leg admitted, and how many it
 * admitted ALONE. The second number is the one that matters — a leg that never admits anything
 * the others missed is pure cost, and a leg that admits most of the ledger by itself is the
 * one doing the work.
 */
function domainYield(claims) {
  const totals = {};
  for (const leg of DOMAIN_LEGS) { totals[leg] = { admitted: 0, soleAdmitter: 0 }; }
  let attributed = 0;
  let unattributed = 0;
  let documented = 0;
  for (const c of claims) {
    const legs = (c.admittedBy || []).filter((l) => DOMAIN_LEGS.includes(l));
    /*
     * POPULATION, NAMED: this yield counts INSTANCE claims — the ones the domain predicate
     * admitted or failed to admit. A doc-sourced claim was never a candidate for any leg:
     * nobody harvested it, a human said it. Counting it as "attributable to no leg" would
     * put two populations in one denominator, which is the shape of the three register
     * entries that came back as different defects at full price once `--domain` introduced
     * a second population. It is reported separately rather than dropped silently.
     */
    if (c && (c.rung === 'DOC' || c.status === 'documented')) { documented += 1; continue; }
    if (!legs.length) { unattributed += 1; continue; }
    attributed += 1;
    for (const leg of legs) { totals[leg].admitted += 1; }
    if (legs.length === 1) { totals[legs[0]].soleAdmitter += 1; }
  }
  return { legs: totals, attributed, unattributed, documented };
}

/** Whitespace-normalized but case-preserving: `active=true` and `active=True` differ. */
function normText(s) { return String(s === undefined || s === null ? '' : s).replace(/\s+/g, ' ').trim(); }

/**
 * A claim is identified by WHERE it is and WHAT it asserts. Two harvests of the same
 * fact collide on purpose: that collision is how re-ingest is idempotent and how the
 * resolution counter can see a transition at all.
 */
function claimId(locus, assertion) {
  return 'C-' + digest({
    t: normText(locus && locus.table),
    s: normText(locus && locus.sysId),
    f: normText(locus && locus.field),
    k: normText(locus && locus.key),
    a: normText(assertion),
  });
}

/**
 * A question is identified by its LOCUS SET and signal, never by its wording
 * (rework-plan 4.9.6, AW-3). Rewording a question must not create a new question.
 */
function questionId(signal, locusSysIds, clusterKey) {
  const ids = (locusSysIds || []).map(normText).filter(Boolean).sort();
  return 'Q-' + digest({ sig: normText(signal), loci: ids, ck: normText(clusterKey) });
}

function findingId(check, locus, rung) {
  return 'F-' + digest({
    c: normText(check), r: normText(rung),
    t: normText(locus && locus.table), s: normText(locus && locus.sysId), f: normText(locus && locus.field),
  });
}

function decisionId(fromQuestion, answeredBy, answeredAt, statement) {
  return 'DEC-' + digest({ q: normText(fromQuestion), by: normText(answeredBy), at: normText(answeredAt), s: normText(statement) });
}

function tbdId(fromQuestion, statement) {
  return 'TBD-' + digest({ q: normText(fromQuestion), s: normText(statement) });
}

// ---------------------------------------------------------------------------
// declarative schema validation
// ---------------------------------------------------------------------------

/**
 * Small path-qualified validator. Rejections must be SPECIFIC, because the rejection
 * text is fed straight back into the next brief and is the only thing a fresh subagent
 * with no conversation history will know about its predecessor's failure.
 */
function validate(schema, value, where) {
  const at = where || '$';
  const out = [];
  if (!schema) { return out; }
  const t = schema.type;
  const isNull = value === undefined || value === null;

  if (isNull) {
    if (schema.optional) { return out; }
    out.push(`${at}: required, but missing`);
    return out;
  }
  if (t === 'array') {
    if (!Array.isArray(value)) { out.push(`${at}: expected an array, got ${typeName(value)}`); return out; }
    if (schema.min !== undefined && value.length < schema.min) {
      out.push(`${at}: expected at least ${schema.min} item(s), got ${value.length}`);
    }
    if (schema.max !== undefined && value.length > schema.max) {
      out.push(`${at}: expected at most ${schema.max} item(s), got ${value.length}`);
    }
    if (schema.items) {
      value.forEach((v, i) => { out.push(...validate(schema.items, v, `${at}[${i}]`)); });
    }
    return out;
  }
  if (t === 'object') {
    if (typeof value !== 'object' || Array.isArray(value)) { out.push(`${at}: expected an object, got ${typeName(value)}`); return out; }
    for (const key of schema.required || []) {
      if (value[key] === undefined || value[key] === null) { out.push(`${at}.${key}: required, but missing`); }
    }
    for (const [key, sub] of Object.entries(schema.props || {})) {
      if (value[key] === undefined || value[key] === null) {
        if (!sub.optional && !(schema.required || []).includes(key)) { out.push(`${at}.${key}: required, but missing`); }
        continue;
      }
      out.push(...validate(sub, value[key], `${at}.${key}`));
    }
    for (const key of schema.forbidden || []) {
      if (value[key] !== undefined) {
        out.push(`${at}.${key}: MUST NOT be supplied. The CLI allocates it. Remove the key and re-ingest.`);
      }
    }
    return out;
  }
  if (t === 'string') {
    if (typeof value !== 'string') { out.push(`${at}: expected a string, got ${typeName(value)}`); return out; }
    if (schema.enum && !schema.enum.includes(value)) {
      out.push(`${at}: "${truncate(value, 40)}" is not one of: ${schema.enum.join(' | ')}`);
    }
    if (schema.minLength && value.trim().length < schema.minLength) {
      out.push(`${at}: at least ${schema.minLength} characters required, got ${value.trim().length}`);
    }
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) {
      out.push(`${at}: "${truncate(value, 40)}" does not match ${schema.pattern}`);
    }
    return out;
  }
  if (t === 'number') {
    if (typeof value !== 'number' || Number.isNaN(value)) { out.push(`${at}: expected a number, got ${typeName(value)}`); return out; }
    if (schema.min !== undefined && value < schema.min) { out.push(`${at}: must be >= ${schema.min}, got ${value}`); }
    if (schema.max !== undefined && value > schema.max) { out.push(`${at}: must be <= ${schema.max}, got ${value}`); }
    return out;
  }
  if (t === 'boolean') {
    if (typeof value !== 'boolean') { out.push(`${at}: expected true or false, got ${typeName(value)}`); }
    return out;
  }
  if (t === 'any') { return out; }
  out.push(`${at}: unknown schema type "${t}" (this is a bug in the stage table)`);
  return out;
}

function typeName(v) { return Array.isArray(v) ? 'array' : (v === null ? 'null' : typeof v); }
function truncate(s, n) { return String(s).length > n ? String(s).slice(0, n) + '…' : String(s); }

// ---------------------------------------------------------------------------
// durable files
// ---------------------------------------------------------------------------

function writeJsonAtomic(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n');
  try { fs.renameSync(tmp, file); } catch (err) {
    // Windows can hold a handle briefly (indexer, AV). Falling back is safer than losing
    // the write: an unflushed mutation is the one failure mode this file cannot have.
    fs.writeFileSync(file, JSON.stringify(obj, null, 2) + '\n');
    try { fs.unlinkSync(tmp); } catch (ignored) { /* nothing to clean */ }
  }
}

function appendJsonl(file, rows) {
  if (!rows || !rows.length) { return 0; }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  return rows.length;
}

function readJsonl(file) {
  if (!fs.existsSync(file)) { return []; }
  const out = [];
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const s = line.trim();
    if (!s) { continue; }
    try { out.push(JSON.parse(s)); } catch (err) {
      // A corrupt line is a fact about the run, not a reason to crash the CLI.
      out.push({ __corrupt: true, line: truncate(s, 200) });
    }
  }
  return out;
}

class BrainError extends Error {
  constructor(message, code) { super(message); this.name = 'BrainError'; this.code = code === undefined ? 2 : code; }
}

// ---------------------------------------------------------------------------
// the brain
// ---------------------------------------------------------------------------

class Brain {
  constructor(root) {
    this.root = path.resolve(root);
    this.dir = path.join(this.root, '.brain');
    this.paths = {
      state: path.join(this.dir, 'state.json'),
      claims: path.join(this.dir, 'claims.jsonl'),
      questions: path.join(this.dir, 'questions.jsonl'),
      decisions: path.join(this.dir, 'decisions.jsonl'),
      history: path.join(this.dir, 'history.ndjson'),
      raw: path.join(this.dir, 'raw'),
      inbox: path.join(this.dir, 'in'),
      findings: path.join(this.dir, 'findings.jsonl'),
      claimDecisionIndex: path.join(this.dir, 'index', 'claim-decisions.json'),
    };
    this.state = null;
    this._cache = {};
  }

  // --- lifecycle ---------------------------------------------------------

  static exists(root) { return fs.existsSync(path.join(path.resolve(root), '.brain', 'state.json')); }

  static init(opts) {
    const brain = new Brain(opts.root || process.cwd());
    if (fs.existsSync(brain.paths.state) && !opts.force) {
      throw new BrainError(
        `A brain already exists at ${brain.dir}. Run "snbrain status" to see where it stopped, ` +
        `or pass --force to start over (this does NOT delete the existing ledgers, it overwrites state.json).`);
    }
    const order = opts.stageOrder;
    if (!Array.isArray(order) || !order.length) { throw new BrainError('init requires a stage order from the stage table.'); }

    const now = new Date().toISOString();
    brain.state = {
      version: SCHEMA_VERSION,
      runId: crypto.randomBytes(5).toString('hex'),
      instance: opts.instance,
      root: brain.root,
      syncRoot: opts.syncRoot || null,
      createdAt: now,
      updatedAt: now,
      stage: order[0],
      stageOrder: order.slice(),
      terminal: null,
      terminalNote: null,
      terminalBy: null,
      terminalAt: null,
      caps: {
        perStage: Object.assign({}, opts.caps || {}),
        default: opts.cap || DEFAULTS.capPerStage,
        runawayCeiling: opts.runawayCeiling || DEFAULTS.runawayCeiling,
      },
      budget: {
        maxCalls: opts.maxCalls || DEFAULTS.maxCalls,
        usedCalls: 0,
        reportedCalls: 0,
        spendUnknownIterations: 0,
        spendDiscrepancyIterations: 0,
      },
      config: {
        questionCap: opts.questionCap || DEFAULTS.questionCap,
        staleAfterDays: opts.staleAfterDays || DEFAULTS.staleAfterDays,
        explainCap: opts.explainCap || DEFAULTS.explainCap,
        vocabularyReserve: opts.vocabularyReserve === undefined ? DEFAULTS.vocabularyReserve : opts.vocabularyReserve,
        conventionReserve: opts.conventionReserve === undefined ? DEFAULTS.conventionReserve : opts.conventionReserve,
        /*
         * SCOPE BOUNDARY. A list of sys_scope names the HARVEST is confined to, or null for
         * the whole instance. It deliberately does NOT constrain the census: the census is
         * aggregates, it is cheap, and it is the denominator that makes "we mapped ACME"
         * mean something rather than "we mapped what we chose to look at". Scoping the
         * denominator to the numerator is how a coverage claim becomes circular.
         *
         * It rides as a stamp on every rendered page, because a precision figure computed
         * inside one scope reads as instance-wide to anyone who was not in the room.
         */
        scopeFilter: opts.scopeFilter && opts.scopeFilter.length ? opts.scopeFilter : null,
        /*
         * The composable predicate. `--scope a,b` is kept as the scope-only special case and
         * folded in here, so an existing invocation means exactly what it always did while
         * everything downstream reads one shape. A scope is a deployment container, not a
         * domain; keeping both lets a run say which of the two it was actually bounded by.
         */
        domain: opts.domain || (opts.scopeFilter && opts.scopeFilter.length
          ? { scope: opts.scopeFilter.slice(), author: [], name: [], updateSet: [] }
          : null),
        /*
         * BLIND RUN. Drops knowledge-bearing inputs from every brief. Set it when the target
         * instance is one this product already documents — otherwise the run measures the
         * briefing rather than the loop. Recorded here so a blind run and a knowledge-assisted
         * one can never be confused after the fact.
         */
        blind: !!opts.blind,
        /*
         * PRODUCT-35. The two bounds a stage may CLOSE on, recorded in config so a run's own
         * envelope travels with its state and a later reader can tell which numbers it was
         * bounded by. Read only by stage-table `closeOn` hooks; the engine never applies them.
         */
        downstreamReserveShare: opts.downstreamReserveShare === undefined
          ? DEFAULTS.downstreamReserveShare : opts.downstreamReserveShare,
        stageWallClockHours: opts.stageWallClockHours || DEFAULTS.stageWallClockHours,
      },
      stages: {},
      facts: {},      // transport / census / provenance facts, recorded not narrated
      /*
       * Stamps ride onto every rendered page. These two are set AT INIT rather than earned
       * by a stage, because they describe the run's own conditions rather than the
       * instance's: a scoped run's precision figure reads as instance-wide to anyone who
       * was not in the room, and a knowledge-assisted run is indistinguishable from a blind
       * one after the fact unless the distinction was recorded before it started.
       */
      stamps: {
        scopeBoundary: opts.scopeFilter && opts.scopeFilter.length ? opts.scopeFilter : null,
        domainBoundary: describeDomain(opts.domain || (opts.scopeFilter && opts.scopeFilter.length
          ? { scope: opts.scopeFilter.slice(), author: [], name: [], updateSet: [] } : null)),
        blind: !!opts.blind,
      },
      queue: {},      // stage-owned work queues (e.g. harvest areas from the census)
      outcomes: [],   // three-valued acceptance outcomes
      overrides: [],  // attributed, never silent
      /*
       * PRODUCT-35 / PRODUCT-36. Every time the CLI moved the cursor when no artifact did, or
       * because a bound fired: stage, reason, where the remainder went, and THE POPULATION IT
       * COUNTED. A stamp says a close happened; this says what it cost.
       */
      closes: [],
      counters: { claims: 0, questions: 0, decisions: 0, findings: 0, resolutions: 0 },
    };
    for (const id of order) {
      brain.state.stages[id] = {
        status: id === order[0] ? 'active' : 'pending',
        enteredAt: id === order[0] ? now : null,
        completedAt: null,
        sinceProgress: 0,
        total: 0,
        iterations: [],
        lastRejections: [],
      };
    }
    fs.mkdirSync(brain.paths.raw, { recursive: true });
    fs.mkdirSync(brain.paths.inbox, { recursive: true });
    brain.save('init');
    return brain;
  }

  /**
   * OPEN, AND MIGRATE THE STAGE TABLE. PRODUCT-66, and a hard prerequisite of PRODUCT-73.
   *
   * `state.stages` is persisted at init from the table as it stood THEN. Insert a stage into
   * STAGES afterwards and every existing brain becomes unadvanceable: `preflight.next()`
   * returns a stage name the persisted object has never heard of and `advance()` throws
   * `stage table returned unknown next stage`. The only escape available to the operator is
   * hand-editing `.brain/`, which invariant 6 forbids — so the guard would have created the
   * defect it was added to fix.
   *
   * ABSENT STAGES ARE INSERTED AS `skipped`, NEVER `pending`, and that distinction is the
   * whole migration. `successBlockers()` lists every stage that is neither complete nor
   * skipped, so a `pending` insert would block terminal success on every brain created
   * before the edit, forever, including finished ones. `skipped` is also the truthful value:
   * nothing about that stage was measured on that run, and the skipReason says so.
   *
   * `stageOrder` is passed IN rather than imported, because lib/stages.js requires this file
   * and this file must never learn what a stage is (invariant 7).
   */
  static open(root, stageOrder) {
    const brain = new Brain(root || process.cwd());
    if (!fs.existsSync(brain.paths.state)) {
      throw new BrainError(
        `No brain at ${brain.dir}. Run:\n  node snbrain.js init --instance <name> --root ${brain.root}`);
    }
    brain.state = JSON.parse(fs.readFileSync(brain.paths.state, 'utf8'));
    if (Array.isArray(stageOrder) && stageOrder.length) { brain.migrateStageTable(stageOrder); }
    return brain;
  }

  /**
   * Reconcile a persisted brain with the stage table as it stands now. Returns the ids it
   * inserted. Persists ONLY when something was inserted, so `status` on an up-to-date brain
   * is still a pure read.
   */
  migrateStageTable(order) {
    const have = this.state.stages || {};
    const inserted = [];
    const next = {};
    const now = new Date().toISOString();
    for (const id of order) {
      if (have[id]) { next[id] = have[id]; continue; }
      next[id] = {
        status: 'skipped',
        enteredAt: null,
        completedAt: now,
        sinceProgress: 0,
        total: 0,
        iterations: [],
        lastRejections: [],
        skipReason: `added to the stage table after this brain was created (${now.slice(0, 10)}); ` +
          `inserted as SKIPPED so the run stays advanceable without a hand edit. Nothing this ` +
          `stage settles was measured on this run — read every downstream number accordingly.`,
      };
      inserted.push(id);
    }
    // A stage the table no longer declares keeps its record. Deleting it would erase the only
    // evidence that it ran, which is worse than an entry nothing routes to.
    for (const [id, st] of Object.entries(have)) { if (!next[id]) { next[id] = st; } }
    this.state.stages = next;
    if (!inserted.length) { return { inserted }; }
    this.state.stageOrder = order.slice();
    this.save('stage-table-migrated', { inserted, order: order.slice() });
    return { inserted };
  }

  /** Every mutation flushes. There is no "save at the end". */
  save(event, detail) {
    this.state.updatedAt = new Date().toISOString();
    writeJsonAtomic(this.paths.state, this.state);
    if (event) {
      appendJsonl(this.paths.history, [{ at: this.state.updatedAt, event, stage: this.state.stage, detail: detail || null }]);
    }
  }

  // --- ledgers -----------------------------------------------------------

  /**
   * Ledgers are append-only, so the CURRENT value of a record is its LAST line. That is
   * what makes status history readable and transitions countable without a second store.
   */
  _ledger(name) {
    if (!this._cache[name]) {
      const rows = readJsonl(this.paths[name]).filter((r) => !r.__corrupt);
      const map = new Map();
      for (const row of rows) { if (row && row.id) { map.set(row.id, row); } }
      this._cache[name] = map;
    }
    return this._cache[name];
  }

  claims() { return this._ledger('claims'); }
  questionsLedger() { return this._ledger('questions'); }
  decisions() { return this._ledger('decisions'); }
  findings() { return this._ledger('findings'); }

  /**
   * Merge claims. Ids are allocated HERE. Returns the transition record the stagnation
   * breaker consumes, which is why it is counted rather than reported.
   */
  upsertClaims(rows, ctx) {
    const now = new Date().toISOString();
    const ledger = this.claims();
    const lines = [];
    const result = { added: 0, updated: 0, unchanged: 0, resolutions: [], transitions: [], ids: [] };

    for (const row of rows) {
      const id = claimId(row.locus, row.assertion);
      const prev = ledger.get(id);
      const prevStatus = prev ? prev.status : null;
      const nextStatus = row.status || (prev ? prev.status : 'draft');
      /*
       * PRODUCT-37(a). `nextStatus` used to be taken verbatim, so CLAIM_STATUSES described the
       * ledger rather than constraining it and "CLI-minted only" had nowhere to live. Both the
       * enum and the token gate are enforced HERE because upsertClaims has callers that never
       * pass through a stage schema, and because the schema is the door an agent knocks on
       * while this is the door every write goes through.
       */
      if (!CLAIM_STATUSES.includes(nextStatus)) {
        throw new BrainError(`claim ${id}: status "${nextStatus}" is not one of ${CLAIM_STATUSES.join(' | ')}.`);
      }
      const prevReason = (prev && prev.unverifiableReason) || null;
      const nextReason = Object.prototype.hasOwnProperty.call(row, 'unverifiableReason')
        ? (row.unverifiableReason || null) : prevReason;
      if (nextStatus === 'unverifiable' && nextReason && !UNVERIFIABLE_REASONS.includes(nextReason)) {
        throw new BrainError(`claim ${id}: unverifiableReason "${nextReason}" is not one of ${UNVERIFIABLE_REASONS.join(' | ')}.`);
      }
      const wasUnsampled = !!prev && prev.status === 'unverifiable' && prevReason === NOT_SAMPLED;
      const isUnsampled = nextStatus === 'unverifiable' && nextReason === NOT_SAMPLED;
      if (isUnsampled && !wasUnsampled && row.__cliUnsampled !== UNSAMPLED_TOKEN) {
        throw new BrainError(
          `claim ${id}: "${NOT_SAMPLED}" is minted by the CLI alone, from a close recorded over a named ` +
          `population — never by a stage artifact and never by a checker who ran out of budget. The ` +
          `reasons you may write are ${AGENT_UNVERIFIABLE_REASONS.join(' | ')}. If the sample did not reach ` +
          `these claims, leave them draft and run "snbrain close-unsampled --by <person> --reason <text>", ` +
          `which records who decided the ledger would go unread and what re-reading it would have cost.`);
      }
      const merged = Object.assign({}, prev || {}, row, {
        id,
        status: nextStatus,
        firstSeenAt: (prev && prev.firstSeenAt) || now,
        recordedAt: now,
        /*
         * PLAN 6.7 / PRODUCT-89. FIRST WRITER WINS: recordedByStage is the stage that RECORDED
         * the claim, not the stage that last touched it. It used to be overwritten on every
         * upsert, so after verify's verdicts it read `verify` on 19,353 of run 93838afe87's
         * 19,360 rows and the ledger could not say which stage produced a single claim —
         * harvest and explain appeared nowhere. The per-transition `history` rows below still
         * carry who touched what, so nothing is lost by keeping the origin.
         */
        recordedByStage: (prev && prev.recordedByStage) || (ctx && ctx.stage) || this.state.stage,
        history: ((prev && prev.history) || []).concat(
          prevStatus === nextStatus ? [] : [{ at: now, from: prevStatus, to: nextStatus, stage: (ctx && ctx.stage) || this.state.stage }]),
      });
      // severity-style immutability for evidence: an earlier captured response is never
      // overwritten silently; a verify verdict adds `observed`, it does not rewrite history.
      // PLAN 6.7: only when the evidence actually CHANGED — a verdict that hands the harvest
      // evidence back unmodified used to stamp priorEvidence deep-equal to evidence on every
      // verified row (all 60,922 on pilot-run-5), a ledger reporting two observations while
      // holding one. The second observation lives in lastVerdict.observed.
      if (prev && prev.evidence && row.evidence && row.evidence !== prev.evidence &&
          JSON.stringify(row.evidence) !== JSON.stringify(prev.evidence)) { merged.priorEvidence = prev.evidence; }
      // The reason is a property of `unverifiable`, so it is cleared the moment the status
      // leaves it — otherwise a claim re-harvested to `draft` on run two carries "nobody read
      // this" into run two's counters. The CLI token never reaches the ledger.
      merged.unverifiableReason = nextStatus === 'unverifiable' ? nextReason : null;
      delete merged.__cliUnsampled;

      result.ids.push(id);
      if (!prev) { result.added += 1; } else if (prevStatus !== nextStatus || JSON.stringify(prev.assertion) !== JSON.stringify(merged.assertion)) { result.updated += 1; } else { result.unchanged += 1; }

      if (prevStatus !== nextStatus) {
        result.transitions.push({ id, from: prevStatus, to: nextStatus });
        // THE resolution rule. A claim leaving draft/unverified/drifted for a settled
        // status is progress; nothing else counts, and no model string participates.
        const wasOpen = prevStatus === null ? true : UNRESOLVED_STATUSES.has(prevStatus);
        const isOpen = UNRESOLVED_STATUSES.has(nextStatus);
        // PRODUCT-37(b). A claim the CLI settled BECAUSE NOBODY READ IT is settled, not
        // resolved. Counting it would let one close report 8,179 resolutions, reset the
        // stagnation cap and hand the run a clean bill of progress for reading nothing —
        // coverage theatre, and harder to see than the kind an agent commits.
        if (wasOpen && !isOpen && !isUnsampled) { result.resolutions.push({ id, from: prevStatus || 'draft', to: nextStatus }); }
      }
      ledger.set(id, merged);
      lines.push(merged);
    }
    appendJsonl(this.paths.claims, lines);
    this.state.counters.claims = ledger.size;
    this.state.counters.resolutions += result.resolutions.length;
    return result;
  }

  upsertQuestions(rows) {
    const now = new Date().toISOString();
    const ledger = this.questionsLedger();
    const lines = [];
    const out = { added: 0, updated: 0, ids: [] };
    for (const row of rows) {
      const loci = (row.locus || []).map((l) => l && l.sysId);
      const id = row.id && /^Q-/.test(row.id) && row.__cliAllocated ? row.id : questionId(row.signal, loci, row.cluster && row.cluster.key);
      const prev = ledger.get(id);
      const merged = Object.assign({}, prev || {}, row, { id, recordedAt: now, firstSeenAt: (prev && prev.firstSeenAt) || now });
      delete merged.__cliAllocated;
      if (prev) { out.updated += 1; } else { out.added += 1; }
      out.ids.push(id);
      ledger.set(id, merged);
      lines.push(merged);
    }
    appendJsonl(this.paths.questions, lines);
    this.state.counters.questions = ledger.size;
    return out;
  }

  upsertDecisions(rows) {
    const now = new Date().toISOString();
    const ledger = this.decisions();
    const lines = [];
    const out = { added: 0, updated: 0, ids: [] };
    for (const row of rows) {
      const id = row.id || decisionId(row.answerProvenance && row.answerProvenance.fromQuestion, row.answeredBy, row.answeredAt, row.statement);
      const prev = ledger.get(id);
      const merged = Object.assign({}, prev || {}, row, { id, recordedAt: now });
      if (prev) { out.updated += 1; } else { out.added += 1; }
      out.ids.push(id);
      ledger.set(id, merged);
      lines.push(merged);
    }
    appendJsonl(this.paths.decisions, lines);
    this.state.counters.decisions = ledger.size;
    this.rebuildClaimDecisionIndex();
    return out;
  }

  /**
   * Findings. SEVERITY IS IMMUTABLE. This is the mechanism that makes "no blocking
   * finding is open" a real closure predicate instead of a string a stage can rewrite.
   */
  upsertFindings(rows, ctx, opts) {
    const now = new Date().toISOString();
    const ledger = this.findings();
    const lines = [];
    const out = { added: 0, updated: 0, rejections: [], ids: [] };
    // PRODUCT-64. Disposition is CLI-allocated. The schema forbids these keys on an artifact,
    // but upsertFindings has callers that never pass through schema validation, so the ledger
    // refuses them too — a guard that lives in only one of two doors is not a guard.
    // `dispositionFinding` is the sole caller that sets cliAllocated.
    const cliAllocated = !!(opts && opts.cliAllocated);
    for (const raw of rows) {
      let row = raw;
      if (!cliAllocated) {
        const smuggled = DISPOSITION_FIELDS.filter((k) => raw[k] !== undefined);
        if (smuggled.length) {
          const id = findingId(raw.check, raw.locus, raw.rung);
          out.rejections.push(
            `finding ${id} (${raw.check}): ${smuggled.join(', ')} may not be set from a stage artifact. ` +
            `A finding is closed by "snbrain disposition --finding ${id} --as <fixed|accepted|wontfix|superseded> ` +
            `--by <name> --reason <text> [--rung L1|L2|L3|L5]", which records who closed it and why. ` +
            `Closing your own finding from the artifact that raised it leaves no attribution and no history event. ` +
            `Use --rung L1 with the replayed evidence when the CLI itself re-read the thing and it is genuinely ` +
            `fixed; L5 asserts that a named HUMAN accepted a blocking finding nobody can fix.`);
          /*
           * Strip and keep, never drop. An earlier version did `continue`, which discarded the row
           * entirely — so a caller that ignores `rejections` would silently LOSE a blocking finding,
           * which is the exact failure class this guard exists to prevent, arriving through a
           * different door. The finding is recorded `open`; only the closure is refused.
           */
          row = Object.assign({}, raw);
          for (const k of DISPOSITION_FIELDS) { delete row[k]; }
        }
      }
      const id = findingId(row.check, row.locus, row.rung);
      const prev = ledger.get(id);
      if (prev && row.severity && row.severity !== prev.severity) {
        out.rejections.push(
          `finding ${id} (${row.check}): severity is IMMUTABLE. It was recorded "${prev.severity}" ` +
          `and this artifact says "${row.severity}". A finding is closed by fixing it and setting ` +
          `disposition, never by relabelling its severity. Remove the severity change and re-ingest.`);
        continue;
      }
      const merged = Object.assign({}, prev || {}, row, {
        id,
        severity: prev ? prev.severity : row.severity,
        disposition: row.disposition || (prev && prev.disposition) || 'open',
        dispositionBy: row.dispositionBy || (prev && prev.dispositionBy) || null,
        dispositionRung: row.dispositionRung || (prev && prev.dispositionRung) || null,
        firstSeenAt: (prev && prev.firstSeenAt) || now,
        recordedAt: now,
        openedByStage: (prev && prev.openedByStage) || (ctx && ctx.stage) || this.state.stage,
      });
      // An L4 finding may not be dismissed by L4 (LOOP.md:71), mechanized.
      if (merged.disposition !== 'open' && merged.rung === 'L4' && merged.dispositionRung === 'L4') {
        out.rejections.push(
          `finding ${id}: an L4 (model judge) finding cannot be dispositioned by L4. Close it with an ` +
          `L1/L2/L3 re-verification or a named human (dispositionRung: L5, dispositionBy: <name>).`);
        continue;
      }
      if (prev) { out.updated += 1; } else { out.added += 1; }
      out.ids.push(id);
      ledger.set(id, merged);
      lines.push(merged);
    }
    appendJsonl(this.paths.findings, lines);
    this.state.counters.findings = ledger.size;
    return out;
  }

  appendRaw(stage, rows) {
    if (!rows || !rows.length) { return 0; }
    return appendJsonl(path.join(this.paths.raw, `${stage}.ndjson`), rows);
  }

  /**
   * claim -> decisions[]. Rebuilt on every decision write. This index is the whole
   * argument for tooling over a markdown template: it is what lets an L1 drift verdict
   * flip a decision to needs-reconfirmation IN THE SAME CALL.
   */
  rebuildClaimDecisionIndex() {
    const index = {};
    for (const dec of this.decisions().values()) {
      for (const cid of dec.explainsClaims || []) {
        (index[cid] = index[cid] || []).push({ id: dec.id, role: 'explains' });
      }
      for (const cid of dec.witnessClaims || []) {
        (index[cid] = index[cid] || []).push({ id: dec.id, role: 'witness' });
      }
    }
    writeJsonAtomic(this.paths.claimDecisionIndex, { rebuiltAt: new Date().toISOString(), index });
    return index;
  }

  /**
   * Supersession. A drifted or gone claim re-opens every decision that rests on it, and
   * mints a `decision-reconfirmation` question. THE thing no template can do.
   */
  applySupersession(transitions) {
    if (!transitions.length || !this.decisions().size) { return { flagged: [], questions: [] }; }
    const idx = this.rebuildClaimDecisionIndex();
    const flagged = [];
    const questions = [];
    const decLedger = this.decisions();
    const touched = new Map();
    for (const tr of transitions) {
      if (tr.to !== 'drifted' && tr.to !== 'gone') { continue; }
      for (const ref of idx[tr.id] || []) {
        const dec = decLedger.get(ref.id);
        if (!dec) { continue; }
        /*
         * PLAN 7.2 — an induced WHY whose witness died is not a caveat, it is GONE. The tier's
         * whole warrant is its evidence, so it is retired outright and no reconfirmation
         * question is minted: putting a dead hypothesis to the SME spends interview minutes on
         * something the next induction round re-mints from live evidence if the pattern is
         * real. `confirmed` decisions keep the existing path — a human said it, so a human is
         * asked again.
         */
        if (decisionTier(dec) === 'induced') {
          const retired = Object.assign({}, touched.get(dec.id) || dec);
          retired.confirmationStatus = 'retired';
          retired.reconfirmation = (retired.reconfirmation || []).concat([{
            trigger: tr.to === 'gone' ? 'claim-gone' : 'claim-drift',
            claim: tr.id, claimRole: ref.role, from: tr.from, to: tr.to, at: new Date().toISOString(),
            outcome: 'retired-induced-witness-died',
          }]);
          touched.set(dec.id, retired);
          flagged.push({ decision: dec.id, claim: tr.id, role: ref.role, to: tr.to, retired: true });
          continue;
        }
        const updated = Object.assign({}, touched.get(dec.id) || dec);
        updated.confirmationStatus = 'needs-reconfirmation';
        if (ref.role === 'witness') { updated.confidence = demote(updated.confidence); }
        updated.reconfirmation = (updated.reconfirmation || []).concat([{
          trigger: tr.to === 'gone' ? 'claim-gone' : 'claim-drift',
          claim: tr.id, claimRole: ref.role, from: tr.from, to: tr.to, at: new Date().toISOString(),
        }]);
        touched.set(dec.id, updated);
        flagged.push({ decision: dec.id, claim: tr.id, role: ref.role, to: tr.to });
        questions.push({
          signal: 'DEC-RECONFIRM', signalState: 'admitted', gate: 'decision-reconfirmation',
          sources: { A: { kind: 'decision', ref: dec.id, says: dec.statement }, B: { kind: 'claim', ref: tr.id, says: `status ${tr.from} -> ${tr.to}` } },
          locus: [{ table: null, sysId: tr.id, claim: tr.id, band: 'A' }],
          cluster: { key: `dec|${dec.id}`, size: (dec.explainsClaims || []).length || 1, members: dec.explainsClaims || [] },
          form: 'closed',
          branchMap: { a: 'still holds → reconfirm', b: 'no longer holds → supersede' },
          question: ref.role === 'witness'
            ? `${dec.id} may have been REVERSED: the claim that witnessed it (${tr.id}) is now ${tr.to}. Does the decision still stand?`
            : `${dec.id} rests on ${tr.id}, which is now ${tr.to}. Does the decision still hold, or is it superseded?`,
          rank: { E: Math.max(1, (dec.explainsClaims || []).length), C_guard: 1.0, C_signal: 1.0, A: 1.0, U: 3.0, M: 1.0, priorSource: 'drift-is-an-L1-fact' },
          status: 'queued',
        });
      }
    }
    if (touched.size) { this.upsertDecisions([...touched.values()]); }
    if (questions.length) { this.upsertQuestions(questions); }
    return { flagged, questions: questions.map((q) => q.question) };
  }

  // --- control flow ------------------------------------------------------

  capFor(stage) {
    const c = this.state.caps;
    return (c.perStage && c.perStage[stage] !== undefined) ? c.perStage[stage] : c.default;
  }

  budgetRemaining() { return Math.max(0, this.state.budget.maxCalls - this.state.budget.usedCalls); }

  /** Wall clock since the cursor entered `stage` — its whole span once it has completed. */
  stageElapsedMs(stage) {
    const st = this.state.stages[stage];
    if (!st || !st.enteredAt) { return 0; }
    const from = Date.parse(st.enteredAt);
    if (!Number.isFinite(from)) { return 0; }
    const to = st.completedAt ? Date.parse(st.completedAt) : Date.now();
    return Math.max(0, (Number.isFinite(to) ? to : Date.now()) - from);
  }

  runElapsedMs() {
    const from = Date.parse(this.state.createdAt);
    return Number.isFinite(from) ? Math.max(0, Date.now() - from) : 0;
  }

  /**
   * Record that the CLI CLOSED a stage — moved the cursor when no artifact did, or because a
   * bound fired with work still queued. `close` is what the stage table's `closeOn` returned,
   * or `{reason: 'queue-empty', ...}` synthesised by the CLI when a stage's own next() routed
   * it forward with nothing left to ingest.
   *
   * It RECORDS; it does not move the cursor. Ordering skip/advance belongs to the one caller
   * that owns routing, and splitting those two responsibilities is what stops this method
   * becoming a second, quieter way to write `state.stage`.
   */
  recordClose(stage, close, opts) {
    if (!this.state.stages[stage]) { throw new BrainError(`cannot close unknown stage "${stage}"`); }
    if (!close || !CLOSE_REASONS.includes(close.reason)) {
      throw new BrainError(`close reason must be one of: ${CLOSE_REASONS.join(' | ')} (got ${close && close.reason})`);
    }
    const row = {
      stage,
      reason: close.reason,
      to: close.to || null,
      at: new Date().toISOString(),
      by: (opts && opts.by) || 'cli',
      note: (opts && opts.reason) || close.detail || null,
      unreached: typeof close.unreached === 'number' ? close.unreached : null,
      population: typeof close.population === 'number' ? close.population : null,
      populationName: close.populationName || null,
      unit: close.unit || null,
      measured: close.measured || null,
      elapsedMs: this.stageElapsedMs(stage),
    };
    this.state.closes = (this.state.closes || []).concat([row]);
    this.state.stamps[`close.${stage}`] = close.stamp || close.reason;
    this.save('close', { stage, reason: row.reason, to: row.to, unreached: row.unreached });
    return row;
  }

  /** Blocking findings that are still open. The ONLY closure predicate. */
  openBlockingFindings() {
    return [...this.findings().values()].filter((f) => f.severity === 'blocking' && f.disposition === 'open');
  }

  claimsByStatus() {
    const out = {};
    for (const c of this.claims().values()) { out[c.status] = (out[c.status] || 0) + 1; }
    return out;
  }

  /** NAMED POPULATION: claims the CLI settled `not-sampled` — settled, and unread. */
  notSampledClaims() {
    return [...this.claims().values()].filter((c) => c.status === 'unverifiable' && c.unverifiableReason === NOT_SAMPLED);
  }

  /** NAMED POPULATION: claims that are still OPEN WORK — draft, unverified or drifted. */
  openClaims() {
    return [...this.claims().values()].filter((c) => UNRESOLVED_STATUSES.has(c.status));
  }

  /**
   * PLAN 5.17 / PRODUCT-37 — settle "the budget did not reach it", once, attributably.
   *
   * THE POPULATION IS NAMED TWICE, because three fixed register entries recurred from checks
   * that asserted over an unnamed population. `sampleId` is a digest of the claims verify
   * actually READ (the ones carrying a verdict), so "not sampled" means "not in THAT set" and
   * the set is recomputable from the ledger rather than asserted. The count of what was settled
   * and the count of what was read are both written into the close and into the finding.
   *
   * IT COSTS SOMETHING TO SAY IT. The close records what convergence would have cost in calls
   * beside what was left in the budget, because the number that justified this on run
   * 6ef14f5562 — "~8,179 further re-queries" — was the claim count wearing a call count's
   * clothes. The real figure was 231 calls against 93 remaining, short by ~138.
   *
   * IT NEEDS A PERSON. `.claude/commands/map-instance.md` makes the agent the only caller of
   * this CLI, so a close the agent can authorise itself is the same defect with a tidier audit
   * trail. AGENT_IDENTITY_RE is the same guard PRODUCT-65 put on closing a blocking finding at
   * L5, and it is here for the same reason: `not-sampled` is a one-way door.
   */
  settleUnsampled(opts) {
    const o = opts || {};
    const stage = o.stage || this.state.stage;
    if (!o.reason) { throw new BrainError('settleUnsampled requires a reason: what stopped the sample reaching these claims.'); }
    if (!o.by) { throw new BrainError('settleUnsampled requires --by <name>. Declaring part of the ledger unread is an accepted partial, and an unattributed one is indistinguishable from a bug.'); }
    if (AGENT_IDENTITY_RE.test(o.by)) {
      throw new BrainError(
        `--by "${o.by}" names the agent, not a person. "${NOT_SAMPLED}" is a one-way door: once the ledger ` +
        `can say nobody read this, nothing makes it smaller again, and every page built over those claims ` +
        `inherits the gap. A person signs for that. If no person has, leave the claims draft and finish the ` +
        `run at a non-success terminal — that is the honest outcome, not a blocked one.`);
    }
    const all = [...this.claims().values()];
    const open = all.filter((c) => UNRESOLVED_STATUSES.has(c.status));
    if (!open.length) { throw new BrainError('nothing to settle: no claim is draft, unverified or drifted.'); }
    /*
     * PRODUCT-37(d). Census denominators are one `/stats` call each, and every honesty number
     * in the deliverable — coverage, verified share, per-leg yield — is computed OVER them. If
     * they may settle unread they become the cheapest thing in the ledger to leave unread, and
     * the run reports success with its own denominators unverified. They are structurally
     * exempt: they stay open, they keep blocking success, and they cost a call each to clear.
     */
    const held = open.filter((c) => c.kind === 'aggregate');
    const target = open.filter((c) => c.kind !== 'aggregate');
    if (!target.length) {
      throw new BrainError(
        `all ${held.length} open claim(s) are kind=aggregate. An aggregate claim is a DENOMINATOR — one ` +
        `/stats call each — and it may never settle "${NOT_SAMPLED}". Re-query them; that is the cheapest ` +
        `verification in this ledger and everything else is measured against it.`);
    }
    const read = all.filter((c) => c.lastVerdict);
    const sampleId = 'S-' + digest({ run: this.state.runId, stage, read: read.map((c) => c.id).sort() }, 6);
    const cost = claimReadCost(target);
    const now = new Date().toISOString();
    const rows = target.map((c) => Object.assign({}, c, {
      status: 'unverifiable',
      unverifiableReason: NOT_SAMPLED,
      notSampledBecause: o.reason,
      notSampledSampleId: sampleId,
      notSampledBy: o.by,
      notSampledAt: now,
      __cliUnsampled: UNSAMPLED_TOKEN,
    }));
    const r = this.upsertClaims(rows, { stage });
    const close = {
      sampleId, stage, at: now, by: o.by, reason: o.reason,
      settled: rows.length, aggregatesHeldOpen: held.length, readClaims: read.length,
      cost, budgetRemaining: this.budgetRemaining(),
    };
    /*
     * THEIR OWN QUEUE LEG. This is what keeps a settlement from satisfying `verify.next()`:
     * the stage advances past unsampled claims only on a close recorded HERE, and a claim
     * carrying `notSampledSampleId` with no matching close keeps the stage alive, because the
     * only ways one exists are a hand edit and a caller that minted without recording.
     */
    const q = this.state.queue || (this.state.queue = {});
    q.unsampled = { closes: ((q.unsampled || {}).closes || []).concat([close]) };
    this.upsertFindings([{
      check: `ledger-unsampled-${stage}-${sampleId}`, severity: 'warning', rung: 'L1',
      message:
        `${rows.length} claim(s) were settled "${NOT_SAMPLED}" at ${stage} by ${o.by}: ${o.reason}. ` +
        `POPULATION: every open claim outside sample ${sampleId}, which is the ${read.length} claim(s) carrying ` +
        `a verdict. Re-querying the rest was ${cost.loci} distinct locus/loci across ${cost.tables} table(s) — ` +
        `${cost.batchedReads} batched read(s) at ${cost.batchSize} ids each plus ${cost.fieldValidations} field ` +
        `validation(s), about ${cost.estimatedCalls} call(s) — against ${close.budgetRemaining} call(s) remaining. ` +
        (held.length ? `${held.length} kind=aggregate claim(s) were HELD OPEN: a denominator may not settle unread. ` : '') +
        `No page may present any of these claims as read, and this run does not reach success while they stand.`,
    }], { stage });
    this.save('settle-unsampled', close);
    return Object.assign({}, close, { resolutions: r.resolutions.length });
  }

  /**
   * Record one iteration of a stage and let the CLI decide whether the run may continue.
   * Returns { terminal, reason } — a terminal here is a FACT, not a warning.
   */
  recordIteration(stage, entry) {
    const st = this.state.stages[stage];
    if (!st) { throw new BrainError(`unknown stage "${stage}"`); }
    const n = st.total + 1;
    /*
     * PRODUCT-35(c). Wall clock, per iteration, because calls were never the binding resource:
     * the reference run spent 7h58m to produce one harvest area and priced every stopping rule
     * in API calls. Measured from the previous iteration of THIS stage, or from the moment the
     * cursor entered it — so it is the time the agent actually took, not the time since boot.
     */
    const at = new Date().toISOString();
    const since = Date.parse(st.iterations.length
      ? st.iterations[st.iterations.length - 1].at
      : (st.enteredAt || this.state.createdAt || at));
    const row = {
      n,
      at,
      elapsedMs: Number.isFinite(since) ? Math.max(0, Date.parse(at) - since) : 0,
      accepted: !!entry.accepted,
      progress: !!entry.progress,
      rejections: entry.rejections || [],
      resolutions: entry.resolutions || 0,
      claimsAdded: entry.claimsAdded || 0,
      apiCalls: entry.apiCalls === undefined ? null : entry.apiCalls,
      spendSource: entry.spendSource || 'unknown',
      artifact: entry.artifact || null,
    };
    st.iterations.push(row);
    st.total = n;
    st.lastRejections = row.rejections;
    st.sinceProgress = row.progress ? 0 : st.sinceProgress + 1;

    // Spend always counts against the budget, even when only self-reported: an unverified
    // number is better than none for a ceiling. But a stage that DID read the instance and
    // cannot be reconciled against lib/api.js's append-before-send log is recorded
    // `spend-unknown`, which blocks terminal success exactly as `not-demonstrated` does
    // (rework-plan 4.6). `not-applicable` is a stage that issued no instance reads at all.
    //
    // ONLY ACCEPTED ITERATIONS CAN POISON THE RUN THIS WAY. A rejected artifact contributed
    // no work, so letting its unmeasurable spend block terminal success would mean one
    // malformed submission permanently forecloses success — a bound with no relationship to
    // the thing it is supposed to guard.
    this.state.budget.usedCalls += row.apiCalls || 0;
    /*
     * PRODUCT-19. This used to also count `self-reported`, which made HONEST REPORTING THE
     * PENALISED OPTION: a stage that read the instance and truthfully said "120 calls" with no
     * log path to hand was marked spend-unknown and blocked terminal success permanently, while
     * a stage claiming `apiCalls: 0` was classed `not-applicable` and cost nothing. The
     * incentive pointed exactly the wrong way, and on the reference run one iteration was
     * poisoned this way.
     *
     * What actually deserves to block is the ABSENCE of a number — a stage that cannot say what
     * it spent — and a self-report that the append-before-send log CONTRADICTS. Those are
     * handled here and by `spendDiscrepancyIterations` respectively. An honest unreconciled
     * number is weaker evidence than the log, not misconduct.
     */
    if (row.accepted && row.spendSource === 'unknown') {
      this.state.budget.spendUnknownIterations += 1;
    }
    if (row.accepted && row.spendSource === 'discrepancy') {
      this.state.budget.spendDiscrepancyIterations = (this.state.budget.spendDiscrepancyIterations || 0) + 1;
    }
    if (entry.reportedCalls) { this.state.budget.reportedCalls += entry.reportedCalls; }

    const verdict = this._stoppingRules(stage, entry);
    this.save('iteration', { stage, n, accepted: row.accepted, progress: row.progress, terminal: verdict.terminal });
    return verdict;
  }

  /**
   * The stopping rules, enforced here so no agent can argue past them.
   * Order matters: budget first (it is a hard external cost), then stagnation (cheapest
   * true signal), then the caps.
   */
  _stoppingRules(stage, entry) {
    const st = this.state.stages[stage];

    if (this.state.budget.usedCalls > this.state.budget.maxCalls) {
      return this.setTerminal('exhausted',
        `API budget exceeded: ${this.state.budget.usedCalls} calls used against a ceiling of ` +
        `${this.state.budget.maxCalls}. Raise it deliberately with "snbrain override --budget <n> --by <name> --reason <text>".`);
    }

    /*
     * PRODUCT-14 / PRODUCT-3. Everything below this line bounds work happening INSIDE a stage.
     * None of it may fire on the iteration that leaves the stage: a bound against going round
     * in circles has nothing to say about the step that stopped circling. The budget ceiling
     * above is deliberately outside this guard, because an external cost is spent whatever the
     * cursor does next.
     */
    if (entry.leavingStage) { return { terminal: null, reason: null }; }

    // Stagnation is scoped to stages whose progress is measurable IN THE LEDGER. On the
    // others the cap is the bound, and saying so is more honest than pretending a
    // ledger-shaped rule applies to a stage with no ledger.
    const mode = entry.stagnationMode || 'none';
    if (mode !== 'none') {
      const relevant = st.iterations.filter((i) => i.accepted || mode === 'accepted');
      const metric = (row) => (mode === 'resolutions' ? row.resolutions : mode === 'claims-added' ? row.claimsAdded : (row.accepted ? 1 : 0));
      const last2 = relevant.slice(-2);
      if (last2.length === 2 && metric(last2[0]) === 0 && metric(last2[1]) === 0) {
        return this.setTerminal('stalled',
          `Stage "${stage}" produced ZERO ${mode === 'resolutions' ? 'claim resolutions' : 'new claims'} in two ` +
          `consecutive iterations (${last2[0].n} and ${last2[1].n}). Re-attempting an unchanged failure cannot ` +
          `progress. Counted by the CLI from the ledger, not from finding ids.`);
      }
    }

    /*
     * PRODUCT-3. A flat ceiling of 12 is right for a stage that converges by repairing itself
     * and wrong for one that converges by working through a queue: nineteen harvest areas
     * against a ceiling of twelve is not a runaway, it is arithmetic. The STAGE TABLE supplies
     * the queue-aware number, because this file must never learn what a harvest area is.
     */
    const ceiling = entry.runawayCeiling || this.state.caps.runawayCeiling;
    if (st.total >= ceiling) {
      return this.setTerminal('exhausted',
        `Stage "${stage}" hit the runaway ceiling of ${ceiling} lifetime iterations. ` +
        `That is above what this stage's own work queue accounts for, so this is abnormal rather than merely long.`);
    }
    if (st.sinceProgress >= this.capFor(stage)) {
      return this.setTerminal('exhausted',
        `Stage "${stage}" made no progress in ${st.sinceProgress} consecutive iterations (cap ${this.capFor(stage)}). ` +
        `Last rejections:\n  - ${(st.lastRejections || ['(none recorded)']).join('\n  - ')}`);
    }
    return { terminal: null, reason: null };
  }

  /** Move the cursor. The stage table decides WHERE; this only records it. */
  advance(toStage) {
    const now = new Date().toISOString();
    const from = this.state.stage;
    if (this.state.stages[from]) {
      this.state.stages[from].status = 'complete';
      this.state.stages[from].completedAt = now;
    }
    if (toStage === 'done') {
      this.state.stage = 'done';
    } else {
      if (!this.state.stages[toStage]) { throw new BrainError(`stage table returned unknown next stage "${toStage}"`); }
      this.state.stage = toStage;
      this.state.stages[toStage].status = 'active';
      this.state.stages[toStage].enteredAt = this.state.stages[toStage].enteredAt || now;
      this.state.stages[toStage].sinceProgress = 0;
    }
    this.save('advance', { from, to: toStage });
  }

  /*
   * PRODUCT-82. RECAST: put stages whose artifacts were MEASURED under the old boundary back to
   * `pending`, and drop what they own.
   *
   * `refine` used to change `config.domain` and touch nothing else. Measured on run
   * `pilot-run-4`: the run initialised instance-wide, census derived 475 areas summing to
   * `bands.A` = 257,352 (a correct one-population census — `runDomain()` was null, so the
   * two-population rule at census.validate could not fire), the operator then refined to a
   * 13,447-row boundary DURING harvest, and `queue.harvestAreas` stayed at 475. The run was
   * left holding a work queue cast in a population 19x larger than its own boundary, at a
   * measured 269 calls per area against 4,795 remaining — the identical stranding that
   * PLAN 5.4 was written to end, arriving through a door 5.4 does not watch.
   *
   * WHAT THE ENGINE MAY KNOW: nothing. `entries` arrives from the stage table, each carrying its
   * own `stage`, the `queue` keys it wrote and the `facts` prefixes it owns. Invariant 7 holds —
   * this method never names a stage, and adding a boundary-cast stage is adding a table field.
   *
   * Iterations are MOVED to `superseded`, never deleted and never left in place. Deleted, the run
   * loses the evidence that a census ran at all; left in place, `cmdNext`'s `produced` test sees an
   * accepted iteration and routes straight past the stage it was just sent back to.
   */
  recast(entries, meta) {
    const now = new Date().toISOString();
    const dropped = { queue: [], facts: [], stages: [], discarded: 0 };
    for (const e of entries || []) {
      const st = this.state.stages[e.stage];
      if (!st) { continue; }
      const accepted = (st.iterations || []).filter((it) => it.accepted).length;
      dropped.discarded += accepted;
      dropped.stages.push(e.stage);
      st.superseded = (st.superseded || []).concat((st.iterations || []).map((it) => Object.assign({ recastAt: now }, it)));
      st.iterations = [];
      st.lastRejections = [];
      st.status = 'pending';
      st.completedAt = null;
      st.sinceProgress = 0;
      st.total = 0;
      st.recasts = (st.recasts || []).concat([{
        at: now, by: meta.by, reason: meta.reason, from: meta.from || null, to: meta.to || null, discarded: accepted,
      }]);
      for (const k of e.queue || []) {
        if (this.state.queue && Object.prototype.hasOwnProperty.call(this.state.queue, k)) {
          dropped.queue.push(k);
          delete this.state.queue[k];
        }
      }
      for (const p of e.facts || []) {
        for (const k of Object.keys(this.state.facts || {})) {
          if (k === p || k.indexOf(p) === 0) { dropped.facts.push(k); delete this.state.facts[k]; }
        }
      }
    }
    const to = dropped.stages.length ? dropped.stages[0] : null;
    if (to) {
      this.state.stage = to;
      this.state.stages[to].status = 'active';
      this.state.stages[to].enteredAt = now;
    }
    this.save('recast', { to, by: meta.by, reason: meta.reason, dropped });
    return dropped;
  }

  skip(stage, reason) {
    if (!this.state.stages[stage]) { return; }
    this.state.stages[stage].status = 'skipped';
    this.state.stages[stage].completedAt = new Date().toISOString();
    this.state.stages[stage].skipReason = reason;
  }

  recordOutcome(outcome) {
    if (!OUTCOME_RESULTS.includes(outcome.result)) {
      throw new BrainError(`outcome result must be one of: ${OUTCOME_RESULTS.join(' | ')}`);
    }
    // Latest-wins per acceptance id per stage: a re-run after a fix must supersede the
    // earlier result, otherwise a fixed failure blocks success forever.
    this.state.outcomes = this.state.outcomes
      .filter((o) => !(o.id === outcome.id && o.stage === outcome.stage))
      .concat([Object.assign({ at: new Date().toISOString() }, outcome)]);
  }

  setTerminal(terminalState, note, by) {
    if (!TERMINAL_STATES.includes(terminalState)) {
      throw new BrainError(`terminal must be one of: ${TERMINAL_STATES.join(' | ')}`);
    }
    this.state.terminal = terminalState;
    this.state.terminalNote = note || null;
    this.state.terminalBy = by || 'cli';
    this.state.terminalAt = new Date().toISOString();
    this.save('terminal', { terminal: terminalState, note });
    return { terminal: terminalState, reason: note };
  }

  /**
   * Everything that stands between this run and terminal `success`. Returns [] when the
   * run may be handed off. Three-valued outcomes and spend-unknown block here, which is
   * precisely the guard the reference engagement did not have.
   */
  successBlockers() {
    const blockers = [];
    const incomplete = Object.entries(this.state.stages)
      .filter(([, s]) => s.status !== 'complete' && s.status !== 'skipped')
      .map(([id]) => id);
    if (this.state.stage !== 'done' || incomplete.length) {
      blockers.push(`stages not complete: ${incomplete.join(', ') || this.state.stage}`);
    }
    const blocking = this.openBlockingFindings();
    if (blocking.length) {
      blockers.push(`${blocking.length} finding(s) with severity=blocking AND disposition=open: ` +
        blocking.slice(0, 5).map((f) => `${f.id} ${f.check}`).join('; '));
    }
    const bad = this.state.outcomes.filter((o) => o.result !== 'pass');
    if (bad.length) {
      blockers.push(`${bad.length} acceptance outcome(s) not passing (not-demonstrated blocks exactly as fail): ` +
        bad.map((o) => `${o.stage}/${o.id}=${o.result}`).join('; '));
    }
    if (this.state.budget.spendUnknownIterations > 0) {
      blockers.push(`${this.state.budget.spendUnknownIterations} iteration(s) recorded spend-unknown. ` +
        `A stage that cannot say what it spent cannot be part of a successful run — re-run it reporting usage. ` +
        `An honest self-reported number is fine; the absence of a number is not.`);
    }
    if (this.state.budget.spendDiscrepancyIterations > 0) {
      blockers.push(`${this.state.budget.spendDiscrepancyIterations} iteration(s) reported a spend the request log contradicts. ` +
        `lib/api.js appends before each request leaves, so the log is authoritative — including for calls that crashed. ` +
        `Reconcile the difference or record why it stands.`);
    }
    /*
     * PRODUCT-35 — A RUN THAT RAN OUT OF MONEY DID NOT FINISH.
     *
     * This is the leg that makes it safe to give the CLI a stopping rule that can close a
     * stage. Without it, "the budget stopped us at area 1 of 431" and "we mapped the domain"
     * are the same green run. It NAMES ITS POPULATION — the stages of THIS run that the CLI
     * closed on a bound, each with the count of queued work it left unread — because the three
     * register entries that recurred all asserted an invariant over a population nobody stated.
     *
     * It is deliberately UNCLEARABLE: no disposition, no override, no acceptance verb (PLAN
     * 5.19, and the absolute rule the critics required on PRODUCT-34). The sanctioned exits are
     * a non-success terminal via `snbrain finish`, and `snbrain export --force --by <name>
     * --reason <text>`, which stamps NOT FIT FOR HANDOFF onto the kernel the next reader opens.
     * `queue-empty` closes are NOT counted here: a stage whose own next() said it was finished
     * is a stage that finished.
     */
    const bound = (this.state.closes || []).filter((c) => BOUND_CLOSE_REASONS.has(c.reason));
    if (bound.length) {
      blockers.push(`${bound.length} stage(s) closed on a bound rather than on completion: ` +
        bound.map((c) => `${c.stage} ${c.reason}, ` +
          `${c.unreached === null ? 'an unrecorded number of' : c.unreached} of ${c.population === null ? '?' : c.population} ` +
          `${c.unit || 'item(s)'} queued and never read (population: ${c.populationName || 'NOT NAMED'})`).join('; ') +
        `. A run that stopped because it ran out of budget, clock or iterations did not finish. This ` +
        `blocker is not clearable by disposition or override: finish on a non-success terminal, and ` +
        `export with --force --by <name> --reason <text> if the partial deliverable is wanted.`);
    }
    /*
     * THREE LEGS, THREE NAMED POPULATIONS. This used to be one leg counting "claims", which was
     * unambiguous while one population existed and stopped being so the moment `not-sampled`
     * created a second — the same failure three fixed register entries recurred through when
     * `--domain` introduced a second claim population.
     *
     * The wording of the first leg is LOAD-BEARING: snbrain.js filters `!/still in draft/` out
     * of PRODUCT-25's success-unreachable banner, because harvest forces every claim to draft
     * and only verify settles them, so draft is the normal condition of every healthy run
     * between the two stages. Do not reword this string without changing that filter, and do
     * not remove the filter: both coherence critics rejected that, and it would fire the banner
     * on the first harvest ingest of every run.
     */
    const draft = [...this.claims().values()].filter((c) => UNRESOLVED_STATUSES.has(c.status));
    if (draft.length) {
      blockers.push(`${draft.length} claim(s) still in draft/unverified/drifted. Every claim must reach ` +
        `verified, gone, unverifiable or documented before handoff.`);
    }
    const unsampled = this.notSampledClaims();
    if (unsampled.length) {
      const closes = (((this.state.queue || {}).unsampled || {}).closes || []);
      const covered = new Set(closes.map((c) => c.sampleId));
      const orphan = unsampled.filter((c) => !covered.has(c.notSampledSampleId));
      blockers.push(
        `${unsampled.length} claim(s) in the population "claims the CLI settled not-sampled" — nobody read them. ` +
        (closes.length
          ? closes.map((c) => `${c.sampleId}: ${c.settled} settled at ${c.stage} by ${c.by}, re-reading them was ~${c.cost.estimatedCalls} call(s) against ${c.budgetRemaining} remaining`).join('; ') + '. '
          : '') +
        (orphan.length ? `${orphan.length} carry no recorded close and are unattributable — that is a hand edit or a caller minting without recording. ` : '') +
        `A run whose ledger went unread does not reach success. Spend the calls the close priced and re-verify, ` +
        `or finish the run at an honest terminal with "snbrain finish --terminal blocked --by <name>".`);
    }
    const aggregateUnread = [...this.claims().values()].filter(
      (c) => c.kind === 'aggregate' && c.status === 'unverifiable' && c.unverifiableReason === NOT_SAMPLED);
    if (aggregateUnread.length) {
      blockers.push(
        `${aggregateUnread.length} claim(s) in the population "kind=aggregate — the census denominators" are ` +
        `settled not-sampled. settleUnsampled refuses to do this, so a ledger in this state was hand-edited or ` +
        `written by an older build. Every honesty number in the deliverable is a ratio over these claims; the ` +
        `run cannot report success with its own denominators unverified. They are one /stats call each.`);
    }
    return blockers;
  }

  /**
   * Close a finding you cannot FIX. Some blocking findings are permanent facts about the
   * instance ("we could not separate your work from ServiceNow's"), and without an
   * attributed way to dispose of them the only route to a terminal state is hand-editing
   * the ledger — which is exactly the memory-as-suggestion failure this file exists to
   * prevent. severity still never moves; only disposition does, and it carries a name.
   */
  dispositionFinding(id, as, by, reason, rung) {
    if (!DISPOSITIONS.includes(as)) { throw new BrainError(`--as must be one of: ${DISPOSITIONS.join(' | ')}`); }
    if (as === 'open') { throw new BrainError('use --as fixed | accepted | wontfix | superseded. Re-opening is not a disposition.'); }
    if (!by || !reason) { throw new BrainError('disposition requires --by <name> and --reason <text>. An unattributed closure is how a blocking finding disappears.'); }
    const f = this.findings().get(id);
    if (!f) { throw new BrainError(`no finding ${id}. List them with "snbrain findings".`); }
    // PRODUCT-65. A blocking finding closed at L5 asserts a NAMED HUMAN accepted it. Five of this
    // product's six blocking findings on run 6ef14f5562 were closed by the loop naming itself.
    const atRung = rung || 'L5';
    if (f.severity === 'blocking' && atRung === 'L5' && AGENT_IDENTITY_RE.test(by)) {
      throw new BrainError(
        `--by "${by}" names the agent, not a person. Closing a BLOCKING finding at L5 asserts that a ` +
        `named human accepted it; "${by}" is this loop signing its own homework, which is how run ` +
        `6ef14f5562 closed five of its six blocking findings. Put the accountable person's name here. ` +
        `If no human has accepted it, the finding is still open — say so in the run rather than closing it, ` +
        `or close it at a lower rung with the re-verification that actually settles it ` +
        `(--rung L1|L2|L3 with --reason naming the replayed evidence).`);
    }
    const r = this.upsertFindings([{
      check: f.check, locus: f.locus, rung: f.rung, message: f.message,
      disposition: as, dispositionBy: by, dispositionRung: atRung, dispositionReason: reason,
    }], { stage: this.state.stage }, { cliAllocated: true });
    if (r.rejections.length) { throw new BrainError(r.rejections.join('\n')); }
    this.save('disposition', { finding: id, as, by });
    return this.findings().get(id);
  }

  /** Attributed, recorded, never silent. the pilot customer had to hand-edit JSON to do this. */
  override(kind, value, by, reason) {
    if (!by || !reason) { throw new BrainError('override requires --by <name> and --reason <text>. An unattributed override is schema drift.'); }
    // PRODUCT-101: the wall clock is the third bounded axis, and until it had an override
    // verb the pacing forecast's only actionable exit was the budget's. Global on purpose —
    // config.stageWallClockHours is one knob, and a per-stage clock would be four bounds again.
    const before = kind === 'budget' ? this.state.budget.maxCalls
      : kind === 'hours' ? ((this.state.config || {}).stageWallClockHours !== undefined ? this.state.config.stageWallClockHours : 4)
        : this.capFor(kind);
    if (kind === 'budget') { this.state.budget.maxCalls = value; } else if (kind === 'hours') {
      this.state.config = this.state.config || {};
      this.state.config.stageWallClockHours = value;
    } else {
      this.state.caps.perStage[kind] = value;
    }
    this.state.overrides.push({ kind, from: before, to: value, by, reason, at: new Date().toISOString() });
    // An override is the operator taking responsibility for continuing, so it also
    // clears a terminal that the overridden bound itself produced.
    if (this.state.terminal === 'exhausted') {
      this.state.terminal = null; this.state.terminalNote = null; this.state.terminalAt = null; this.state.terminalBy = null;
      const st = this.state.stages[this.state.stage];
      if (st && kind !== 'budget') { st.sinceProgress = 0; }
    }
    this.save('override', { kind, from: before, to: value, by });
    return { kind, from: before, to: value };
  }
}

function demote(confidence) {
  const order = ['high', 'medium', 'low'];
  const i = order.indexOf(confidence);
  return i < 0 ? 'low' : order[Math.min(order.length - 1, i + 1)];
}

/**
 * Count what actually left the machine. lib/api.js appends a `sent` line BEFORE each
 * request leaves, so this file is authoritative in a way a model's self-report can never
 * be — including for a call that crashed or timed out. Self-reported usage is recorded
 * alongside, and a discrepancy is a finding rather than a silent correction.
 */
/**
 * Collapse an append-only ledger to one line per id — the last, which is already the one
 * every reader takes.
 *
 * PRODUCT-20 / PRODUCT-23. The ledgers are append-only by design: that is what makes status
 * history readable and transitions countable without a second store. But it means one line per
 * claim PER STAGE, and each line carries the captured response verbatim. The reference run
 * shipped a 494 MB claims.jsonl to a customer.
 *
 * Compaction is lossless for every consumer, because `_ledger()` already keys by id and keeps
 * the last row — the superseded lines are only ever read by a human doing archaeology, and the
 * full ledger stays in the working repo. Only the EXPORT is compacted.
 *
 * Deliberately not gzipped: the rendered wiki cites `.brain/claims.jsonl` by that path, and a
 * deliverable whose primary evidence is at a filename nothing links to is the defect this is
 * meant to reduce, not a smaller version of it.
 */
function compactLedgerFile(srcPath, destPath) {
  if (!fs.existsSync(srcPath)) { return null; }
  const rows = readJsonl(srcPath).filter((r) => !r.__corrupt);
  const last = new Map();
  let anonymous = 0;
  for (const row of rows) {
    if (row && row.id) { last.set(row.id, row); } else { anonymous += 1; }
  }
  const out = [...last.values()].map((r) => JSON.stringify(r)).join('\n') + (last.size ? '\n' : '');
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.writeFileSync(destPath, out);
  return {
    linesBefore: rows.length, linesAfter: last.size, anonymous,
    bytesBefore: fs.statSync(srcPath).size, bytesAfter: fs.statSync(destPath).size,
  };
}

function countRequestLog(logPath, sinceIso) {
  if (!logPath || !fs.existsSync(logPath)) { return null; }
  let n = 0;
  for (const line of fs.readFileSync(logPath, 'utf8').split(/\r?\n/)) {
    const s = line.trim();
    if (!s) { continue; }
    try {
      const row = JSON.parse(s);
      if (row.phase !== 'sent') { continue; }
      if (sinceIso && row.at && row.at < sinceIso) { continue; }
      n += 1;
    } catch (err) { /* a corrupt line is not a call */ }
  }
  return n;
}

module.exports = {
  Brain, BrainError,
  validate, canonical, digest, normText,
  claimId, questionId, findingId, decisionId, tbdId,
  countRequestLog, compactLedgerFile,
  parseDomain, describeDomain, domainYield, compileDomain, conjoinQuery, DOMAIN_LEGS,
  writeJsonAtomic, appendJsonl, readJsonl,
  AGENT_IDENTITY_RE,
  digest,
  SCHEMA_VERSION, TERMINAL_STATES, CLAIM_STATUSES, UNRESOLVED_STATUSES, UNVERIFIABLE_REASONS,
  AGENT_UNVERIFIABLE_REASONS, NOT_SAMPLED, claimReadCost, CLAIM_BATCH_IDS,
  DECISION_TIERS, DECISION_ANCHOR_SOURCES, decisionTier, decisionAnchors,
  CLOSE_REASONS, BOUND_CLOSE_REASONS,
  SEVERITIES, DISPOSITIONS, RUNGS, OUTCOME_RESULTS, QUESTION_STATUSES, DEFAULTS,
};
