---
name: es5-compliance
description: Invoke when writing or fixing ANY ServiceNow server-side JavaScript — "business rule", "script include", "background script", "scheduled job", "fix SyntaxError", "ES5", "ES12", "JavaScript Mode" — the Rhino engine defaults to ES5-only; ES12 is a per-script/per-app opt-in with a deploy trap.
---

# ES5 / ES12 Compliance for ServiceNow

Server-side ServiceNow scripts run on Rhino in one of two modes: **ES5** (the always-safe baseline) and **ES12 / ES2021** (opt-in, supported in scoped apps since the Tokyo release). Set the project's default mode as a policy in the Customer Project Rules section below; absent a stated policy, write ES5 and treat ES12 as a deliberate per-artifact opt-in.

One rule overrides everything else: **match the mode of the file you are editing.** If an existing Script Include already uses `class` / template literals, it runs in ES12 mode — do not "fix" it down to ES5, and do not paste ES6 syntax into a script that is currently pure ES5.

## Which mode where

| Context | Mode | Why |
|---|---|---|
| Business Rules, Fix Scripts, Scheduled Jobs, Workflow scripts (any scope) | **ES5** | Safe everywhere; no mode toggle to remember at deploy time. |
| Script Includes in **scoped apps** (e.g. `x_acme_fm`) | **ES5 by default**; **ES12 acceptable** when classes / destructuring / template literals / optional chaining genuinely make the code clearer | Scoped scripts support ES12 since Tokyo. Note that some OOTB plugin Script Includes already ship as ES12 `class` syntax — match them when extending. |
| Script Includes in **global scope** | **ES5** | Xanadu advertised ES12 for global scope, but it is broken through Yokohama (ServiceNow KB1699139 / PRB1794568; targeted fix in Zurich). Do not rely on it. (Verify on your instance first.) |
| Client Scripts / UI Scripts running in **workspace** (V8) | Modern JS fine | Workspace client code runs on the browser's V8 engine. |
| Client Scripts (**classic UI**) | ES5 recommended | Conservative browser/engine target. |
| Sandbox / guarded scripts (filter conditions, dynamic defaults, AMB conditions, `javascript:` prefixes) | **Single expression only** | A sandbox restriction, not a JS-version question: no `var`, no `if`, no loops, no multi-statement code in any mode. Put logic in a Script Include and call it as a one-liner. |

## The ES12 deploy trap — the mode flag does NOT travel in update sets

The per-script ES12 opt-in is stored on the **`sys_es_latest_script`** table, a separate record referenced from the script artifact. When you build a Script Include in ES12 mode on dev, the update set XML for the Script Include **does not carry that flag**. On commit in test/prod the imported script silently reverts to ES5 mode — and every piece of ES12 syntax in it becomes a runtime `SyntaxError`.

Mitigations, in order of preference:

1. **Write ES5 unless ES12 earns its keep.** Most utility/helper Script Includes lose nothing in ES5.
2. If you do use per-script ES12: record the manual step in the story's deploy notes — after each environment's update-set commit, open the script and flip **JavaScript Mode** to ES12 by hand, or ship a Fix Script that updates `sys_es_latest_script` for the known sys_ids.
3. App-wide opt-in via Studio → **Application Settings → JavaScript Mode → ECMAScript2021 (ES12)** *does* carry forward with the app — but it flips the entire application, not one script.

## ES5 rules (when writing in ES5 mode)

Everything in this section throws `SyntaxError` in ES5 mode; all of it is legal in ES12 mode.

| ES6+ syntax | ES5 replacement |
| --- | --- |
| `const x = 5` | `var x = 5` |
| `let items = []` | `var items = []` |
| `() => {}` | `function() {}` |
| `` `Hello ${name}` `` | `'Hello ' + name` |
| `for (x of arr)` | `for (var i = 0; i < arr.length; i++)` |
| `{a, b} = obj` | `var a = obj.a; var b = obj.b;` |
| `[a, b] = arr` | `var a = arr[0]; var b = arr[1];` |
| `...spread` | `Array.prototype.slice.call()` |
| `class MyClass {}` | Constructor functions |
| `async` / `await` | Callbacks / synchronous GlideRecord |
| `Promise` | Callbacks / synchronous GlideRecord |

### Examples

```javascript
// WRONG (ES6)                          // CORRECT (ES5)
const MAX_RETRIES = 3;                  var MAX_RETRIES = 3;
let currentUser = gs.getUser();         var currentUser = gs.getUser();
```

```javascript
// WRONG — arrow function + filter
var active = records.filter(function(r) { return r.active; }); // .filter is fine; arrows are not
var process = () => 'done';

// CORRECT — function expressions / index loops
var active = [];
for (var i = 0; i < records.length; i++) {
    if (records[i].active) {
        active.push(records[i]);
    }
}
var process = function() {
    return 'done';
};
```

```javascript
// WRONG — template literal
var message = 'Case ' + number;         // CORRECT
var message = `Case ${number}`;         // WRONG
```

```javascript
// WRONG — default parameter
function process(record, priority = 3) { /* ... */ }

// CORRECT — manual default
function process(record, priority) {
    if (typeof priority === 'undefined') {
        priority = 3;
    }
}
```

### Pre-deploy self-check

Before shipping any server-side script written for ES5 mode, scan it for:

1. `const` / `let` → `var`
2. `=>` → `function()`
3. Backtick template literals → string concatenation
4. Destructuring `{a, b}` / `[a, b]` → explicit property/index access
5. `for...of` → index-based loop

## ES12 mode — what you get when you opt in

Confirmed working in scoped-app scripts since Tokyo:

- `const` / `let` block scoping
- Arrow functions
- Template literals
- ES6 `class` with `extends`
- Destructuring, spread / rest
- Optional chaining `?.`, nullish coalescing `??`
- Default parameters
- `Map`, `Set`, `Symbol`
- `for...of`

**Still NOT available even in ES12 mode:**

- `Promise` / `async` / `await`
- ES Modules (`import` / `export`)
- Generators (unreliable)

Rhino has no true event loop — stay with callbacks and synchronous patterns.

## Sources

- [ServiceNow community — Tokyo introduces ECMAScript 2021](https://developer.servicenow.com/blog.do?p=%2Fpost%2Ftokyo-ecmascript-2021%2F)
- [ServiceNow docs — Set ES12 mode for scripts (Xanadu)](https://www.servicenow.com/docs/bundle/xanadu-api-reference/page/script/JavaScript-engine-upgrade/concept/set-es12-mode-scripts.html)
- [Community — per-script ES12 mode deploy gotcha](https://www.servicenow.com/community/servicenow-ai-platform-articles/ecmascript-2021-es12-mode-in-individual-script-there-s-an/ta-p/3026751)
- [Community — Xanadu ES12 in global scope broken (KB1699139)](https://www.servicenow.com/community/itsm-forum/xanadu-es12-in-global/td-p/3009263)

## Customer Project Rules
<!-- Engagement overlay — record THIS customer's mandatory conventions and
     discovered rules for this artifact type here. Framework updates never touch
     this section. -->
