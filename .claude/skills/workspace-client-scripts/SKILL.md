---
name: workspace-client-scripts
description: Invoke when a client script behaves differently in workspace vs classic UI — "workspace client script", "getMessage callback", "getMessage returns key", "async getMessage", "showFieldMsg workspace", "field message not translated", "ui_type 10" — or any sys_script_client work targeting Agent/Configurable Workspace.
---

# Workspace Client Scripts — Types & the `getMessage` Callback Rule

Client Scripts (`sys_script_client`) behave **differently in Agent / Configurable Workspace (Next Experience)** than in classic UI. The biggest silent trap is `getMessage()`.

Message keys below use the `<namespace>` placeholder — substitute your project's message-key namespace (`naming.messageKeyNamespace` in product.config.json).

## 1. `getMessage()` is ASYNCHRONOUS in workspace — use the callback form

In **classic UI**, `getMessage('key')` returns the translated string synchronously. In **Agent Workspace and Service Portal**, the message catalog is fetched from the server asynchronously, so the **inline/synchronous call returns the raw key (or `undefined`)** instead of the translated text. No console error — it just shows wrong text.

**Always use the 2-argument callback form**, and do the UI work *inside* the callback:

```javascript
// ❌ WRONG — synchronous; in workspace shows the key, not the translation
g_form.showFieldMsg('short_description', getMessage('acme.case.guidance'), 'info');

// ✅ CORRECT — callback receives the translated message once it arrives
getMessage('acme.case.guidance', function(msg) {
    g_form.showFieldMsg('short_description', msg, 'info');
});
```
(Keys are examples — use `<namespace>.<key>`.)

This applies to **every** consumer of the translated value — `showFieldMsg`, `setLabelOf`, `addInfoMessage`, `addErrorMessage`, `confirm`, etc.

### Value used in a loop / multiple times
Fetch once, then use inside the callback:

```javascript
var fields = ['a.b', 'a.c'];
for (var i = 0; i < fields.length; i++) {
    g_form.setReadOnly(fields[i], true);          // not message-dependent → keep outside
}
getMessage('acme.case.inherited_info', function(msg) {
    for (var j = 0; j < fields.length; j++) {
        g_form.showFieldMsg(fields[j], msg, 'info');
    }
});
```

### Multiple keys / nested messages
Nest the callbacks (each is independent and order-safe), or fetch each where it's used:

```javascript
getMessage('acme.case.field_attention', function(fieldMsg) {
    g_form.showFieldMsg('u_category', fieldMsg, 'error');
    getMessage('acme.case.category_required', function(m) {
        g_form.addErrorMessage(m);
    });
});
```

### ⚠️ `onSubmit` caveat
In `onSubmit`, callbacks fire **after** the submit has already proceeded — you cannot use an async `getMessage` result to block submission. For onSubmit validation messages, register the messages and either pre-fetch them in onLoad, or use a key already cached. Do not rely on the callback to abort the submit.

## 2. `messages` field is still required (separate rule)
Every key passed to `getMessage('key')` MUST also be listed in the client script's **`messages`** field (newline- or comma-separated). Otherwise the key is never sent to the client and `getMessage` returns the raw key — even with the callback form. (Server-side `gs.getMessage()` does NOT need this.)

## 3. `ui_type` must be `10` (All)
- `ui_type: "0"` (Desktop only) → the script **does not run** in Agent/Configurable Workspace.
- Always create `sys_script_client` with **`ui_type: "10"`** so it fires in classic *and* workspace.

## 4. Client script types — workspace support
| Type | Fires in workspace? | Notes |
|---|---|---|
| `onLoad` | ✅ | Safe place to pre-fetch `getMessage` values. |
| `onChange` | ✅ | Use callback form for any message shown. |
| `onSubmit` | ✅ | Async `getMessage` cannot gate the submit — see caveat above. |
| `onCellEdit` | ⚠️ list-only | Limited/none in workspace list editing; verify before relying on it. |

## 5. `showFieldMsg` surface differences
- Works in **classic UI** and **Agent/Configurable Workspace**.
- Known limitations in **Service Portal**: `showFieldMsg` may not render, and is cleared if `setValue` runs after it. If the same form is used in SP, verify visually.

## Quick checklist for a workspace-safe client script
1. `ui_type = 10`.
2. Every `getMessage` key is in the `messages` field.
3. Every `getMessage` uses the **callback** form; UI work happens inside the callback.
4. `onSubmit` does not depend on an async message to abort.
5. Verify visually in the actual workspace view (`g_form.getViewName()` guards are common in modal views).

## Customer Project Rules

<!-- Engagement overlay — record THIS customer's mandatory conventions and
     discovered rules for this artifact type here. Framework updates never touch
     this section. -->
