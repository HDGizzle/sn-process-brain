#!/usr/bin/env node
'use strict';
/*
 * tools/snbrain/probe.js — WP-A transport preflight probe suite.
 *
 * Eleven probes, specified in docs/rework-plan.md section 6.12, with kill criteria
 * written BEFORE the run exactly as playbooks/03-enforce.md:27-46 demands of every new
 * check. The point of writing them first is that a kill criterion invented after seeing
 * the data is not a criterion, it is a rationalization.
 *
 * Two rules govern every probe here:
 *
 *   A PROBE NEVER RECORDS A PASS IT DID NOT EARN. If it cannot run, it records
 *   `unavailable` with a reason. Absence of rows is never reported as a negative result,
 *   because on this platform an empty read is more often a broken session than an empty
 *   table.
 *
 *   NEGATIVE CONTROLS MUST REPRODUCE THEIR FAILURE. Probes 6 and 7 exist to confirm that
 *   a known silent-failure mode still occurs on THIS instance and THIS protocol version.
 *   A negative control that "passes" because nothing went wrong has actually failed, and
 *   is reported as such. Without them the guard layer defends against a documented
 *   failure rather than an observed one.
 *
 * Read-only is enforced in lib/api.js, structurally. See its header.
 *
 * Usage:
 *   node tools/snbrain/probe.js --instance <name> --root <sync-folder> [--probe N]
 *                              [--out <dir>] [--budget N]
 */

const fs = require('fs');
const path = require('path');
const { connect, ApiError, ReadOnlyViolation, READ_ONLY_COMMANDS } = require('./lib/api');

const DEFAULT_BUDGET = 120;
const EXIT_OK = 0, EXIT_KILL = 1, EXIT_PREFLIGHT = 2;

// --- CLI ---------------------------------------------------------------------

function usage() {
  return [
    'snbrain WP-A transport probe suite',
    '',
    'Usage:',
    '  node tools/snbrain/probe.js --instance <name> --root <sync-folder> [options]',
    '',
    'Required:',
    '  --instance <name>   sn-scriptsync instance folder name (e.g. devinst01)',
    '  --root <path>       scriptsync sync root, the folder holding .vscode/sn-agent-port.json',
    '',
    'Options:',
    '  --probe <N>         run one probe only (1-11)',
    '  --out <dir>         output dir (default: <root>/spikes/scriptsync-read)',
    '  --budget <N>        hard cap on API calls (default: ' + DEFAULT_BUDGET + ')',
    '  --help              this text',
    '',
    'Output is written OUTSIDE the product repo by design: probe results are instance',
    'data and belong in the engagement sync folder, never in the framework repo.',
    '',
    'Exit codes: 0 all probes conclusive, 1 a kill criterion fired, 2 preflight failed.',
  ].join('\n');
}

function parseArgs(argv) {
  const args = { budget: DEFAULT_BUDGET };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--instance') { args.instance = next(); }
    else if (a === '--root') { args.root = next(); }
    else if (a === '--out') { args.out = next(); }
    else if (a === '--probe') { args.probe = Number(next()); }
    else if (a === '--budget') { args.budget = Number(next()); }
    else if (a === '--help' || a === '-h') { args.help = true; }
    else { args.unknown = a; }
  }
  return args;
}

// --- probe helpers -----------------------------------------------------------

const CONCLUSIVE = 'conclusive';
const UNAVAILABLE = 'unavailable';

function conclusive(data, note) { return { status: CONCLUSIVE, data, note }; }
function unavailable(reason) { return { status: UNAVAILABLE, reason }; }

/** Human-account heuristic: exclude the install and integration accounts. */
const SYSTEM_ACCOUNTS = new Set(['system', 'admin', 'guest', 'glide.maint', 'glide.maint.rollback']);
function looksHuman(userName) {
  if (!userName) { return false; }
  const u = String(userName).toLowerCase();
  if (SYSTEM_ACCOUNTS.has(u)) { return false; }
  return !/^(sys|svc|int|integration|glide)[._-]/.test(u);
}

// --- the eleven probes -------------------------------------------------------

const PROBES = [
  {
    id: 1,
    title: 'rest_request GET is reachable with write gates off',
    whatItSettles: 'Whether the R2 read path exists at all through the browser hop on THIS instance.',
    killCriterion: 'E_DISABLED on a GET means R2 collapses to R1-only: no paging, no display-value control, no counts, and A3/A5/A7 become blocking prerequisites.',
    kill: (r) => r.status === CONCLUSIVE && r.data.getDisabled === true,
    async run(ctx) {
      try {
        const body = await ctx.s.restGet('/api/now/table/sys_scope', { sysparm_limit: '1', sysparm_fields: 'sys_id,scope' });
        const rows = (body && body.result) || [];
        return conclusive({ getDisabled: false, rows: rows.length },
          'GET returned rows with the write gates off, so the full REST read surface is available.');
      } catch (err) {
        const disabled = /E_DISABLED/.test(err.message || '') || /E_DISABLED/.test(JSON.stringify(err.detail || ''));
        if (disabled) {
          return conclusive({ getDisabled: true, error: err.message }, 'GET is gated on this build. R2 is unavailable.');
        }
        return unavailable(`rest_request GET failed for a reason other than gating: ${err.message}`);
      }
    },
  },

  {
    id: 2,
    title: 'sysparm_offset paging works and page 2 differs from page 1',
    whatItSettles: 'Whether we can enumerate a table larger than one page, which every count and absence claim depends on.',
    killCriterion: 'If offset is ignored (page 2 identical to page 1), enumeration is impossible over REST and A3 becomes blocking.',
    kill: (r) => r.status === CONCLUSIVE && r.data.offsetIgnored === true,
    async run(ctx) {
      const qp = (offset) => ({ sysparm_limit: '5', sysparm_offset: String(offset), sysparm_fields: 'sys_id', sysparm_query: 'ORDERBYsys_id' });
      const p1 = await ctx.s.restGet('/api/now/table/sys_dictionary', qp(0));
      const p2 = await ctx.s.restGet('/api/now/table/sys_dictionary', qp(5));
      const ids1 = ((p1 && p1.result) || []).map((r) => r.sys_id);
      const ids2 = ((p2 && p2.result) || []).map((r) => r.sys_id);
      if (!ids1.length || !ids2.length) {
        return unavailable(`paging test got ${ids1.length} and ${ids2.length} rows; too few to judge (sys_dictionary should be large).`);
      }
      const overlap = ids1.filter((id) => ids2.includes(id));
      return conclusive({ offsetIgnored: overlap.length === ids1.length, page1: ids1, page2: ids2, overlap: overlap.length },
        overlap.length === 0 ? 'Offset works cleanly.' : `Pages overlap by ${overlap.length} of ${ids1.length}.`);
    },
  },

  {
    id: 3,
    title: '/api/now/stats aggregate count is reachable',
    whatItSettles: 'Whether we can count without transferring rows. This is guard G8 fallback and it sets the cost of every census query.',
    killCriterion: 'If stats is unreachable, every count costs a full row transfer and the census budget rises by roughly an order of magnitude.',
    kill: (r) => r.status === CONCLUSIVE && r.data.reachable === false,
    async run(ctx) {
      try {
        const n = await ctx.s.countRows('sys_script');
        if (n === null) { return conclusive({ reachable: false }, 'stats endpoint responded but carried no count.'); }
        return conclusive({ reachable: true, sys_script_count: n }, `Aggregate count works: ${n} sys_script rows.`);
      } catch (err) {
        return conclusive({ reachable: false, error: err.message }, 'stats endpoint not reachable through the relay.');
      }
    },
  },

  {
    id: 4,
    title: 'get_table_metadata returns inherited columns, and carries a columns key at all',
    whatItSettles: 'Whether we can read a table shape in one call. records.js:408 silently falls back to returning the whole result object, so the absence of a columns key is itself the finding.',
    killCriterion: 'No columns key means the command cannot be used for schema reads and the dictionary path is the only option.',
    kill: (r) => r.status === CONCLUSIVE && r.data.hasColumnsKey === false,
    async run(ctx) {
      const res = await ctx.s.call('get_table_metadata', { table: 'incident' });
      const result = res.result || {};
      const hasColumnsKey = Object.prototype.hasOwnProperty.call(result, 'columns');
      const cols = hasColumnsKey ? result.columns : null;
      const names = Array.isArray(cols) ? cols.map((c) => c.element || c.name || c).filter(Boolean)
        : (cols && typeof cols === 'object' ? Object.keys(cols) : []);
      // `number` and `short_description` are inherited from task; their presence proves inheritance is included.
      const inherited = ['number', 'short_description', 'sys_id'].filter((f) => names.includes(f));
      return conclusive({ hasColumnsKey, columnCount: names.length, inheritedFound: inherited, topLevelKeys: Object.keys(result) },
        hasColumnsKey ? `columns present (${names.length}), inherited fields found: ${inherited.join(', ') || 'none'}`
          : `NO columns key. Top-level keys were: ${Object.keys(result).join(', ')}`);
    },
  },

  {
    id: 5,
    title: 'Relay payload ceiling, by bounded bisection',
    whatItSettles: 'The largest page of heavy rows the browser relay will carry, which sets the harvest page size for every payload-bearing table.',
    killCriterion: 'A ceiling below 10 rows of sys_update_xml makes update-set archaeology impractical over this transport.',
    kill: (r) => r.status === CONCLUSIVE && typeof r.data.ceiling === 'number' && r.data.ceiling < 10,
    async run(ctx) {
      const sizes = [1, 5, 10, 25, 50];   // bounded and monotonic: no runaway, at most 5 calls
      const steps = [];
      let ceiling = 0;
      for (const size of sizes) {
        try {
          const body = await ctx.s.restGet('/api/now/table/sys_update_xml', {
            sysparm_limit: String(size), sysparm_fields: 'sys_id,name,payload', sysparm_display_value: 'false',
          });
          const rows = (body && body.result) || [];
          const bytes = JSON.stringify(body).length;
          steps.push({ size, ok: true, rows: rows.length, bytes });
          if (rows.length > 0) { ceiling = size; }
          if (rows.length < size) { steps.push({ size, note: 'table exhausted before the ceiling was found' }); break; }
        } catch (err) {
          steps.push({ size, ok: false, error: err.message });
          break;   // first failure is the ceiling; do not probe higher
        }
      }
      if (!steps.some((s) => s.ok)) { return unavailable('every page size failed; sys_update_xml may be empty or unreadable.'); }
      return conclusive({ ceiling, steps }, `Largest successful page: ${ceiling} rows of sys_update_xml with payload.`);
    },
  },

  {
    id: 6,
    title: 'NEGATIVE CONTROL: an unknown field in an encoded query returns unfiltered rows',
    whatItSettles: 'Whether the silent clause-drop still happens on this instance and protocol version. Guard G1 exists only because of it.',
    killCriterion: 'If the failure does NOT reproduce, G1 is defending against a documented failure rather than an observed one, and the guard design must be revisited rather than trusted.',
    kill: (r) => r.status === CONCLUSIVE && r.data.reproduced === false,
    async run(ctx) {
      const total = await ctx.s.countRows('sys_user').catch(() => null);
      const body = await ctx.s.restGet('/api/now/table/sys_user', {
        sysparm_limit: '5', sysparm_fields: 'sys_id',
        sysparm_query: 'u_snbrain_field_that_does_not_exist=zzz',
      }).catch((err) => ({ __error: err.message }));
      if (body && body.__error) {
        return conclusive({ reproduced: false, errored: true, error: body.__error },
          'The platform ERRORED on the unknown field instead of silently dropping the clause. The silent-drop class did not reproduce here.');
      }
      const rows = (body && body.result) || [];
      const reproduced = rows.length > 0;   // rows returned despite an impossible filter
      return conclusive({ reproduced, rowsReturned: rows.length, tableTotal: total },
        reproduced
          ? `REPRODUCED: ${rows.length} rows returned for a filter that can match nothing. The clause was silently dropped.`
          : 'Zero rows returned. The clause was NOT silently dropped, which contradicts the documented behaviour and must be investigated before G1 ships.');
    },
  },

  {
    id: 7,
    title: 'NEGATIVE CONTROL: a query value containing & corrupts through R1, and R2 handles it',
    whatItSettles: 'Guard G1b canary. query.js:35,37 concatenates the encoded query raw, so a value with & or = re-parses as a delimiter and silently changes the filter.',
    killCriterion: 'If R1 corrupts AND R2 also corrupts, no safe path exists for values containing reserved characters and the harvest must exclude them explicitly.',
    kill: (r) => r.status === CONCLUSIVE && r.data.r1Corrupted === true && r.data.r2Safe === false,
    /*
     * DESIGN NOTE, after the first run rejected the obvious test. The naive version used
     * an impossible value containing "&" and asked whether rows came back. That cannot
     * discriminate: if the "&" splits the URL the query truncates to something that
     * matches nothing (zero rows), and if it does not split, the full impossible value
     * also matches nothing (zero rows). Both outcomes are identical, so a "clean" result
     * was measuring nothing.
     *
     * This version injects a parameter that CHANGES AN OBSERVABLE. We ask for 5 rows and
     * smuggle sysparm_limit=1 inside the query value. If the "&" is treated as a URL
     * delimiter, the injected limit wins and we get exactly 1 row. If it is carried as
     * part of the value, the query is nonsense and we get 0. One row versus none is a
     * real discriminator.
     */
    async run(ctx) {
      const injected = 'sys_idISNOTEMPTY&sysparm_limit=1';
      const probeOne = async (label, fn) => {
        try { return { label, rows: await fn(), error: null }; }
        catch (err) { return { label, rows: null, error: err.message }; }
      };
      const r1 = await probeOne('R1', async () => {
        const q = await ctx.s.queryRecords('sys_user', injected, ['sys_id'], 5);
        return q.records.length;
      });
      const r2 = await probeOne('R2', async () => {
        const body = await ctx.s.restGet('/api/now/table/sys_user', {
          sysparm_limit: '5', sysparm_fields: 'sys_id', sysparm_query: injected,
        });
        return ((body && body.result) || []).length;
      });
      // Exactly 1 row when 5 were requested means the injected parameter took effect.
      const r1Corrupted = r1.rows === 1;
      const r2Safe = r2.rows !== 1;
      return conclusive({ r1Corrupted, r2Safe, injected, r1Rows: r1.rows, r2Rows: r2.rows, r1Error: r1.error, r2Error: r2.error },
        `Requested 5 rows with sysparm_limit=1 smuggled into the query value. ` +
        `R1 returned ${r1.rows}, R2 returned ${r2.rows}. ` +
        `1 row means the injected parameter took effect (corruption); anything else means it did not.`);
    },
  },

  {
    id: 8,
    title: 'get_capabilities gates block, recorded verbatim',
    whatItSettles: 'Which write gates are actually open on this machine, including createArtifacts which defaults to TRUE.',
    killCriterion: 'None. This is a record, not a test. But createArtifacts being open is reported prominently because it is the one gate that is on unless someone turned it off.',
    kill: () => false,
    async run(ctx) {
      const res = await ctx.s.call('get_capabilities', {});
      const result = res.result || {};
      const gates = result.gates || null;
      return conclusive({ gates, license: result.license || result.tier || null, cdp: result.cdp || null, raw: result },
        gates ? `createArtifacts=${gates.createArtifacts}, restRequest=${gates.restRequest}, deleteRecords=${gates.deleteRecords}, backgroundScripts=${gates.backgroundScripts}`
          : 'No gates block in the response.');
    },
  },

  {
    id: 9,
    title: 'Provenance ladder counts AND the authorship distribution',
    whatItSettles: 'Whether this instance has any usable change provenance, and whether what it has is real authorship or base content wearing a human name. The highest-information item on the list.',
    killCriterion: 'A small authored count means the PoC measures nothing. A large count dominated by admin inside base packages means it measures the WRONG thing. Both change the run before any adapter is written.',
    kill: (r) => r.status === CONCLUSIVE && (r.data.verdict === 'no-provenance' || r.data.verdict === 'authored-but-base-dominated'),
    async run(ctx) {
      const counts = {};
      counts.sys_update_xml = await ctx.s.countRows('sys_update_xml').catch(() => null);
      counts.sys_update_version = await ctx.s.countRows('sys_update_version').catch(() => null);
      counts.sys_metadata = await ctx.s.countRows('sys_metadata').catch(() => null);

      // The distribution, not another total: totals detect "too few authored records",
      // the distribution detects base and demo records passing an authorship filter.
      const byAuthor = await ctx.s.groupCount('sys_metadata', 'sys_created_by').catch(() => []);
      const byPackage = await ctx.s.groupCount('sys_metadata', 'sys_package').catch(() => []);

      const humanAuthors = byAuthor.filter((a) => looksHuman(a.key));
      const humanAuthored = humanAuthors.reduce((n, a) => n + a.count, 0);
      const totalAuthored = byAuthor.reduce((n, a) => n + a.count, 0);
      const humanShare = totalAuthored ? humanAuthored / totalAuthored : 0;

      let verdict = 'usable';
      if (humanAuthored < 50) { verdict = 'no-provenance'; }
      else if (humanShare < 0.02) { verdict = 'authored-but-base-dominated'; }

      return conclusive({
        counts, verdict, humanAuthored, totalAuthored, humanShare: Number(humanShare.toFixed(4)),
        topAuthors: byAuthor.sort((a, b) => b.count - a.count).slice(0, 15),
        topPackages: byPackage.sort((a, b) => b.count - a.count).slice(0, 15),
        humanAuthorNames: humanAuthors.map((a) => a.key).slice(0, 20),
      }, `verdict=${verdict}: ${humanAuthored} of ${totalAuthored} sys_metadata rows created by a human-looking account (${(humanShare * 100).toFixed(2)}%).`);
    },
  },

  {
    id: 10,
    title: 'Session privilege, and therefore whether ACL blindness is testable at all',
    whatItSettles: 'Whether the session is admin. If it is, read ACLs never filter anything and the ACL-blindness failure class is structurally out of reach, not merely untested.',
    killCriterion: 'None, but an admin session means the report MUST say the ACL class was unreachable rather than letting a reader assume it was tested and passed.',
    kill: () => false,
    async run(ctx) {
      let userSysId = null, userName = null;
      const me = await ctx.s.restTable('sys_user', {
        query: 'sys_id=javascript:gs.getUserID()', fields: ['sys_id', 'user_name', 'name'], pageSize: 1, maxPages: 1,
      }).catch(() => ({ records: [] }));
      if (me.records.length) { userSysId = me.records[0].sys_id; userName = me.records[0].user_name; }
      if (!userSysId) {
        return unavailable('could not resolve the current user (javascript:gs.getUserID() did not resolve through this transport); session privilege is unknown, so treat aclExposure as UNKNOWN rather than none.');
      }
      const roles = await ctx.s.restTable('sys_user_has_role', {
        query: `user=${userSysId}`, fields: ['role.name', 'role'], pageSize: 200, maxPages: 3,
      }).catch(() => ({ records: [] }));
      const roleNames = roles.records.map((r) => r['role.name'] || r.role).filter(Boolean);
      const isAdmin = roleNames.some((n) => String(n).toLowerCase() === 'admin');
      return conclusive({ userName, userSysId, roleCount: roleNames.length, roles: roleNames.slice(0, 40), isAdmin, aclExposure: isAdmin ? 'none' : 'partial' },
        isAdmin
          ? 'Session holds admin. aclExposure=none: read ACLs will not filter, so the ACL-blindness class is STRUCTURALLY OUT OF REACH in this run. It was not tested and must not be reported as passed.'
          : `Session is non-admin (${roleNames.length} roles). ACL filtering is live, so absence claims carry ACL risk and G-ACL applies.`);
    },
  },

  {
    id: 11,
    title: 'Update-set membership as a record-level authorship rung, and the F9 publisher collision',
    whatItSettles: 'Whether the scope filter has a record-level authorship rung at all. A3 rests entirely on it and it has never been verified against this release or transport.',
    killCriterion: 'If update-set membership covers a base population and a customer population indiscriminately, or covers neither, A3 is dead, the surviving path is package-level (A1) only, and the run stamps authorship=package-level-only.',
    kill: (r) => r.status === CONCLUSIVE && r.data.a3Dead === true,
    async run(ctx) {
      // sys_package.source is dot-walked deliberately: the package's SOURCE string is what
      // separates com.snc/com.glide base content from everything else, and the reference
      // display value alone does not carry it.
      const META = ['sys_update_name', 'sys_mod_count', 'sys_package', 'sys_package.source', 'sys_created_by', 'sys_scope'];

      /*
       * THE SOURCE IS sys_update_xml, AND THE NAME "sys_customer_update" IS A GHOST.
       * Earlier drafts of this probe, and LOOP.md rung R-e, named the source
       * `sys_customer_update` and this probe looked for it as a COLUMN on sys_metadata.
       * There is no such table and no such column on any release. That string is the
       * LABEL of sys_update_xml ("Customer Update"), mistaken for its name. The probe
       * therefore fired its kill on every instance in existence, for a fact about our
       * own vocabulary rather than about the instance.
       *
       * The real rung is update-set membership, joined on the key the platform already
       * provides: sys_metadata.sys_update_name IS sys_update_xml.name. Validate that
       * column exists before filtering on it — the silent clause-drop probe 6 confirms
       * one level up applies here too, and an unknown field returns UNFILTERED rows,
       * which would read as 100% coverage of both populations.
       */
      const dict = await ctx.s.restTable('sys_dictionary', {
        query: 'name=sys_update_xml^element=name', fields: ['element'], pageSize: 5, maxPages: 1,
      }).catch(() => ({ records: [] }));
      if (!dict.records.length) {
        return conclusive({
          a3Dead: true, joinKeyExists: false, authorship: 'package-level-only',
          reason: 'sys_update_xml.name is not readable here, so update-set membership cannot be joined to metadata.',
        }, 'A3 IS DEAD: no readable update-set membership to join on. Package-level (A1) is the only rung.');
      }
      /*
       * SAMPLE FROM THE SMALL POPULATION, WHICH IS THE UPDATE SETS.
       * The obvious construction — draw metadata rows and ask whether each appears in
       * sys_update_xml — is underpowered to the point of being fraudulent. On this
       * instance sys_update_xml holds ~6k rows against ~905k sys_metadata rows, a 0.7%
       * prior, so a 50-row metadata sample returns zero hits WHETHER OR NOT membership
       * discriminates, and the probe would report "A3 is dead" from pure sampling noise.
       * A test whose failure output is identical to its no-signal output measures nothing.
       *
       * So go the other way: take the update-set entries, resolve what they TARGET, and
       * ask what that covered set is made of. Discrimination means the covered set is
       * enriched for customer-authored records relative to the instance as a whole.
       */
      const isBase = (src) => /^com\.(snc|glide)/.test(String(src || ''));

      const entries = await ctx.s.restTable('sys_update_xml', {
        query: 'nameISNOTEMPTY', fields: ['name', 'target_name', 'type', 'update_set'],
        pageSize: 100, maxPages: 3,
      }).catch((err) => ({ records: [], error: err.message }));

      if (entries.records.length < 20) {
        return unavailable(
          `need at least 20 update-set entries to judge; got ${entries.records.length}. ` +
          `An instance that never used update sets is itself a finding for the provenance stage.`);
      }

      // Resolve the covered records back to their owning package, in batches.
      const names = [...new Set(entries.records.map((r) => r.name).filter(Boolean))];
      const covered = [];
      for (let i = 0; i < names.length && i < 300; i += 15) {
        const batch = names.slice(i, i + 15);
        const res = await ctx.s.restTable('sys_metadata', {
          query: `sys_update_nameIN${batch.join(',')}`, fields: META, pageSize: 100, maxPages: 2,
        }).catch(() => ({ records: [] }));
        res.records.forEach((r) => { if (batch.includes(r.sys_update_name)) covered.push(r); });
      }

      if (covered.length < 10) {
        return unavailable(
          `resolved only ${covered.length} of ${names.length} update-set entries back to live sys_metadata rows; ` +
          `too few to judge composition. The entries may target deleted records or non-metadata tables.`);
      }

      // Composition of the covered set, against the instance-wide baseline.
      const custHits = covered.filter((r) => !isBase(r['sys_package.source'] || r.sys_package)).length;
      const baseHits = covered.length - custHits;
      const custRate = custHits / covered.length;   // customer share INSIDE update sets
      const baseRate = baseHits / covered.length;
      /*
       * Instance-wide customer share, so "enriched" is measured rather than assumed. If
       * the covered set looks like the instance, membership tells us nothing new.
       */
      const wide = await ctx.s.countRows('sys_metadata', 'sys_package.source NOT LIKEcom.snc^sys_package.source NOT LIKEcom.glide^sys_package.sourceISNOTEMPTY')
        .catch(() => null);
      const wideTotal = await ctx.s.countRows('sys_metadata', 'sys_idISNOTEMPTY').catch(() => null);
      const baseline = (wide && wideTotal) ? (wide / wideTotal) : null;
      // Dead if update-set membership is not enriched for customer content over baseline.
      const a3Dead = baseline === null ? custRate < 0.2 : (custRate - baseline) < 0.2;

      // F9: does a store-app publisher match a human account? If so the instance owner's
      // own published app bins as vendor content and takes his most decision-rich work with it.
      const apps = await ctx.s.restTable('sys_store_app', { fields: ['name', 'vendor', 'scope'], pageSize: 100, maxPages: 1 })
        .catch(() => ({ records: [] }));
      const publishers = apps.records.map((a) => a.vendor).filter(Boolean);

      return conclusive({
        a3Dead, joinKeyExists: true,
        entriesRead: entries.records.length, namesResolved: covered.length, namesTried: Math.min(names.length, 300),
        custRate: Number(custRate.toFixed(3)), baseRate: Number(baseRate.toFixed(3)),
        custHits, baseHits,
        instanceWideCustomerShare: baseline === null ? null : Number(baseline.toFixed(3)),
        enrichment: baseline === null ? null : Number((custRate - baseline).toFixed(3)),
        distinctUpdateSets: new Set(entries.records.map((r) => r.update_set).filter(Boolean)).size,
        authorship: a3Dead ? 'package-level-only' : 'record-level-available',
        storeAppPublishers: publishers.slice(0, 20),
        f9Note: 'Compare these publishers against probe 9 humanAuthorNames by hand: a match is the F9 case.',
      }, `${covered.length} update-set-covered records resolved from ${entries.records.length} entries: ` +
         `${(custRate * 100).toFixed(0)}% customer-packaged vs ${baseline === null ? 'unknown' : (baseline * 100).toFixed(0) + '%'} instance-wide. ` +
         (a3Dead ? 'A3 IS DEAD: update-set membership is not enriched for customer content.' : 'A3 discriminates and is usable; sys_update_set groups the co-shipped clusters.'));
    },
  },
];

// --- reporting ---------------------------------------------------------------

function renderMarkdown(meta, results) {
  const L = [];
  L.push('# WP-A transport probe results');
  L.push('');
  L.push('> Machine-generated by `tools/snbrain/probe.js`. Kill criteria were written before the run.');
  L.push('');
  L.push('| Field | Value |');
  L.push('|---|---|');
  L.push(`| Instance | ${meta.instance} |`);
  L.push(`| Date | ${meta.date} |`);
  L.push(`| Extension version | ${meta.extensionVersion || 'unknown'} |`);
  L.push(`| Agent API version | ${meta.apiVersion || 'unknown'} |`);
  L.push(`| API calls used | ${meta.callsUsed} of ${meta.budget} |`);
  L.push(`| Request log | ${meta.logPath} |`);
  L.push('');
  const fired = results.filter((r) => r.killFired);
  L.push(fired.length
    ? `**${fired.length} kill criterion/criteria fired: ${fired.map((r) => '#' + r.id).join(', ')}. Read those first.**`
    : '**No kill criteria fired.**');
  L.push('');
  L.push('| # | Probe | Status | Kill fired |');
  L.push('|---|---|---|---|');
  for (const r of results) {
    L.push(`| ${r.id} | ${r.title} | ${r.status}${r.status === UNAVAILABLE ? '' : ''} | ${r.killFired ? '**YES**' : 'no'} |`);
  }
  L.push('');
  for (const r of results) {
    L.push(`## Probe ${r.id}. ${r.title}`);
    L.push('');
    L.push(`**Settles:** ${r.whatItSettles}`);
    L.push('');
    L.push(`**Kill criterion (written first):** ${r.killCriterion}`);
    L.push('');
    L.push(`**Status:** ${r.status}${r.killFired ? '  |  **KILL CRITERION FIRED**' : ''}`);
    L.push('');
    if (r.status === UNAVAILABLE) {
      L.push(`**Could not run:** ${r.reason}`);
    } else if (r.error) {
      L.push(`**Errored:** ${r.error}`);
    } else {
      if (r.note) { L.push(r.note); L.push(''); }
      L.push('```json');
      L.push(JSON.stringify(r.data, null, 2));
      L.push('```');
    }
    L.push('');
  }
  return L.join('\n');
}

// --- main --------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || (!args.instance && !args.root)) {
    process.stdout.write(usage() + '\n');
    return EXIT_OK;
  }
  if (!args.instance || !args.root) {
    process.stderr.write('ERROR: both --instance and --root are required.\n\n' + usage() + '\n');
    return EXIT_PREFLIGHT;
  }
  const syncRoot = path.resolve(args.root);
  if (!fs.existsSync(syncRoot)) {
    process.stderr.write(`ERROR: --root does not exist: ${syncRoot}\n` +
      `This must be the scriptsync sync folder (the one holding .vscode/sn-agent-port.json).\n`);
    return EXIT_PREFLIGHT;
  }
  const outDir = path.resolve(args.out || path.join(syncRoot, 'spikes', 'scriptsync-read'));
  const logPath = path.join(outDir, 'snbrain-requests.ndjson');
  const budget = { max: args.budget, used: 0 };

  process.stdout.write(`snbrain WP-A: instance=${args.instance} root=${syncRoot}\n`);
  process.stdout.write(`Output: ${outDir}\n\n`);

  let conn;
  try {
    process.stdout.write('Preflight: port file, health, browser readiness, canary read...\n');
    conn = await connect({ syncRoot, repoRoot: args.root || process.cwd(), instance: args.instance, logPath, budget });
    process.stdout.write(`Preflight OK (canary returned ${conn.canary} row).\n\n`);
  } catch (err) {
    process.stderr.write(`\nPREFLIGHT FAILED: ${err.message}\n`);
    if (err.detail) { process.stderr.write(`Detail: ${JSON.stringify(err.detail).slice(0, 500)}\n`); }
    process.stderr.write('\nNo probes were run. Nothing was read, nothing was written to the instance.\n');
    return EXIT_PREFLIGHT;
  }

  const ctx = { s: conn.session };
  const selected = args.probe ? PROBES.filter((p) => p.id === args.probe) : PROBES;
  const results = [];

  for (const probe of selected) {
    process.stdout.write(`Probe ${probe.id}: ${probe.title}\n`);
    let outcome;
    try {
      outcome = await probe.run(ctx);
    } catch (err) {
      const isViolation = err instanceof ReadOnlyViolation;
      outcome = { status: UNAVAILABLE, reason: `${isViolation ? 'READ-ONLY VIOLATION (this is a bug in the probe, not the instance): ' : ''}${err.message}` };
      if (err instanceof ApiError && /budget exhausted/i.test(err.message)) {
        process.stderr.write(`  BUDGET EXHAUSTED. Stopping.\n`);
        results.push({ ...probe, ...outcome, killFired: false });
        break;
      }
    }
    const killFired = outcome.status === CONCLUSIVE && probe.kill(outcome) === true;
    process.stdout.write(`  -> ${outcome.status}${killFired ? '  ** KILL CRITERION FIRED **' : ''}\n`);
    if (outcome.note) { process.stdout.write(`     ${outcome.note}\n`); }
    if (outcome.reason) { process.stdout.write(`     ${outcome.reason}\n`); }
    results.push({
      id: probe.id, title: probe.title, whatItSettles: probe.whatItSettles, killCriterion: probe.killCriterion,
      status: outcome.status, data: outcome.data, note: outcome.note, reason: outcome.reason, killFired,
    });
  }

  const meta = {
    instance: args.instance,
    date: new Date().toISOString(),
    extensionVersion: (conn.live && conn.live.version) || null,
    apiVersion: (conn.live && conn.live.apiVersion) || (conn.portInfo && conn.portInfo.apiVersion) || null,
    callsUsed: budget.used,
    budget: budget.max,
    logPath,
    allowlist: [...READ_ONLY_COMMANDS],
  };

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify({ meta, results }, null, 2));
  fs.writeFileSync(path.join(outDir, 'RESULTS.md'), renderMarkdown(meta, results));

  const fired = results.filter((r) => r.killFired);
  const unavail = results.filter((r) => r.status === UNAVAILABLE);
  process.stdout.write(`\nWrote ${path.join(outDir, 'RESULTS.md')}\n`);
  process.stdout.write(`API calls used: ${budget.used} of ${budget.max}\n`);
  if (unavail.length) { process.stdout.write(`Unavailable: ${unavail.map((r) => '#' + r.id).join(', ')}\n`); }
  if (fired.length) {
    process.stdout.write(`\nKILL CRITERIA FIRED: ${fired.map((r) => '#' + r.id).join(', ')}\n`);
    return EXIT_KILL;
  }
  return EXIT_OK;
}

if (require.main === module) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      process.stderr.write(`\nUNHANDLED: ${err && err.stack ? err.stack : err}\n`);
      process.exit(EXIT_PREFLIGHT);
    });
}

module.exports = { PROBES, parseArgs, renderMarkdown, looksHuman };
