# Wiki scaffold

The customer knowledge wiki, ready to instantiate. At onboarding: copy this directory's
contents (minus this README) to the path configured as `paths.wikiRoot` in
`product.config.json`, then work through the onboarding playbook to populate it from the
customer's live instance.

Two kinds of pages:

- **Pre-filled platform knowledge** (ship as-is, extend per engagement):
  [gotchas.md](gotchas.md) — the silent-failure catalog; [agent-api.md](agent-api.md) —
  vendor-doc corrections for the sn-scriptsync agent API; [hard-rules.md](hard-rules.md)
  — rule mechanics + verification; [conventions.md](conventions.md) — coding law;
  [CONTRACT.md](CONTRACT.md) — the governance contract every page follows.
- **Empty scaffolds** (fill per customer): [index.md](index.md), the ledgers
  ([decisions.md](decisions.md), [tbd.md](tbd.md)),
  [registry-sys-ids.md](registry-sys-ids.md), [deployment-matrix.md](deployment-matrix.md),
  [glossary.md](glossary.md), [INTERVIEW.md](INTERVIEW.md), and the
  [story](stories/_TEMPLATE.md) / [process](processes/_TEMPLATE.md) templates.
  Dummy rows are marked DELETE-ME.

Entries flagged *(verify on your instance first)* were confirmed on one real instance —
re-verify before relying on them. That flag is a feature, not a hedge: it tells the
agent exactly which knowledge to re-ground per customer.
