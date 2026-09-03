---
name: ui-builder-patterns
description: Invoke when the user asks to "create workspace", "UI Builder", "UIB", "workspace page", "macroponent", "data broker", "UX page", "configurable workspace", or when building on ServiceNow Next Experience / UI Builder.
---

# UI Builder Patterns

UI Builder (UIB) is the framework behind Next Experience: configurable workspaces, UX pages, and portal-style experiences. Everything you place on a canvas ultimately lives in `sys_ux_*` records. This skill covers the conceptual model — hierarchy, data brokers, client state, events, components, macroponents — so you know which moving part to reach for.

## Architecture

### Component Hierarchy

An experience nests like this:

```
UX Application
└── App Shell
    └── Chrome (Header, Navigation)
        └── Pages
            └── Variants
                └── Macroponents
                    └── Components
                        └── Elements
```

### Key Concepts

| Concept          | What it is                                                        |
| ---------------- | ----------------------------------------------------------------- |
| **Macroponent**  | A composable container bundling layout, components, and logic     |
| **Component**    | A single UI building block — list, form, button, card             |
| **Data Broker**  | The declared data source a component binds to                     |
| **Client State** | Page-scoped state parameters shared across components             |
| **Event**        | The message bus wiring components to handlers and to each other   |

## Page Structure

A page is more than its layout — it owns variants, data brokers, client state, and event wiring. A typical record-list page decomposes as:

```
Page: case_list
├── Variants
│   ├── Default (desktop)
│   └── Mobile
├── Data Brokers
│   ├── case_data (GraphQL)
│   └── user_preferences (Script)
├── Client States
│   ├── selectedRecord
│   └── filterActive
├── Events
│   ├── RECORD_SELECTED
│   └── FILTER_APPLIED
└── Layout
    ├── Header (macroponent)
    ├── Sidebar (macroponent)
    └── Content (macroponent)
```

## Data Brokers

Components should never fetch their own data — they bind to a broker. Four broker types cover the cases:

| Type          | Reach for it when                    | Example              |
| ------------- | ------------------------------------ | -------------------- |
| **GraphQL**   | Straight table queries               | Record list          |
| **Script**    | Server-side logic or aggregation     | Calculated metrics   |
| **REST**      | External API data                    | Third-party lookup   |
| **Transform** | Reshaping data already on the page   | Date formatting      |

### GraphQL Data Broker

A GraphQL broker wraps a `GlideRecord_Query` — fields come back as `{ value, displayValue }` pairs, and variables can be fed from client state or component props:

```graphql
# Data Broker: case_list (type: GraphQL) — example against the incident table
query ($limit: Int, $query: String) {
  GlideRecord_Query {
    incident(queryConditions: $query, limit: $limit) {
      number { value displayValue }
      short_description { value }
      priority { value displayValue }
      state { value displayValue }
      assigned_to { value displayValue }
      sys_id { value }
    }
  }
}
```

```json
// Variables (bound from client state or props)
{ "limit": 50, "query": "active=true" }
```

### Script Data Broker

Script brokers run server-side in an `execute(inputs, outputs)` wrapper. Write them in **ES5** (`var`, no arrow functions) and put results on `outputs`:

```javascript
// Data Broker: case_metrics (type: Script)
;(function execute(inputs, outputs) {
  var result = { total: 0, byPriority: {} };

  var gr = new GlideRecord('incident'); // example table
  gr.addQuery('active', true);
  gr.query();
  while (gr.next()) {
    result.total++;
    var priority = gr.getValue('priority');
    result.byPriority[priority] = (result.byPriority[priority] || 0) + 1;
  }

  outputs.metrics = result;
})(inputs, outputs);
```

## Client State Parameters

Client state holds page-level UI state — the selected record, active filters, view mode. Declare each parameter with a type and default:

```json
{
  "selectedCase": { "type": "string", "default": "" },
  "filterQuery": { "type": "string", "default": "active=true" },
  "viewMode": {
    "type": "string",
    "default": "list",
    "enum": ["list", "card", "split"]
  },
  "selectedRecords": {
    "type": "array",
    "items": { "type": "string" },
    "default": []
  }
}
```

Components read state through `@state.` bindings, and events write it back:

```javascript
// In component configuration
{
  "query": "@state.filterQuery",
  "selectedItem": "@state.selectedCase"
}

// Updating client state via an event handler
{
  "eventName": "NOW_RECORD_LIST#RECORD_SELECTED",
  "handlers": [
    {
      "action": "UPDATE_CLIENT_STATE",
      "payload": { "selectedCase": "@payload.sys_id" }
    }
  ]
}
```

## Events and Handlers

### Event Types

| Event                             | Fired by        | Payload           |
| --------------------------------- | --------------- | ----------------- |
| `NOW_RECORD_LIST#RECORD_SELECTED` | Row click       | { sys_id, table } |
| `NOW_BUTTON#CLICKED`              | Button click    | { label }         |
| `NOW_DROPDOWN#SELECTED`           | Dropdown change | { value }         |
| `CUSTOM#EVENT_NAME`               | Custom event    | Custom payload    |

### Event Handler Configuration

One event can trigger a chain of handlers — update state, refresh a broker, re-dispatch:

```json
{
  "eventName": "NOW_RECORD_LIST#RECORD_SELECTED",
  "handlers": [
    {
      "action": "UPDATE_CLIENT_STATE",
      "payload": { "selectedCase": "@payload.sys_id" }
    },
    {
      "action": "REFRESH_DATA_BROKER",
      "payload": { "dataBrokerId": "case_details" }
    },
    {
      "action": "DISPATCH_EVENT",
      "payload": { "eventName": "CASE_SELECTED", "payload": "@payload" }
    }
  ]
}
```

### Client Script Event Handler

When declarative handlers aren't enough, a client script handler receives `coeffects` — dispatch, state, and the triggering action. ES5 applies here too:

```javascript
;(function (coeffects) {
  var dispatch = coeffects.dispatch;
  var payload = coeffects.action.payload;

  // Update several state parameters at once
  dispatch('UPDATE_CLIENT_STATE', {
    selectedCase: payload.sys_id,
    detailsVisible: true
  });

  // Conditional re-dispatch
  if (payload.priority === '1') {
    dispatch('DISPATCH_EVENT', {
      eventName: 'CRITICAL_CASE_SELECTED',
      payload: payload
    });
  }
})(coeffects);
```

## Component Configuration

### Common Components

| Component         | Role           | Key Properties        |
| ----------------- | -------------- | --------------------- |
| `now-record-list` | Data table     | columns, query, table |
| `now-record-form` | Record form    | table, sysId, fields  |
| `now-button`      | Action button  | label, variant, icon  |
| `now-card`        | Card container | header, content       |
| `now-tabs`        | Tab container  | tabs, activeTab       |
| `now-modal`       | Modal dialog   | opened, title         |

### Record List Configuration

```json
{
  "component": "now-record-list",
  "properties": {
    "table": "incident",
    "query": "@state.filterQuery",
    "columns": [
      { "field": "number", "label": "Number" },
      { "field": "short_description", "label": "Description" },
      { "field": "priority", "label": "Priority" },
      { "field": "state", "label": "State" }
    ],
    "pageSize": 20,
    "selectable": true,
    "selectedRecords": "@state.selectedRecords"
  }
}
```

### Form Configuration

```json
{
  "component": "now-record-form",
  "properties": {
    "table": "incident",
    "sysId": "@state.selectedCase",
    "fields": ["short_description", "description", "priority", "assignment_group"],
    "readOnly": false
  }
}
```

## Macroponents

A macroponent packages layout + data + state behind a typed property interface, so the same block can be dropped on multiple pages:

```
Macroponent: case-summary-card
├── Properties (inputs)
│   ├── caseSysId (string)
│   └── showActions (boolean)
├── Internal State
│   └── expanded (boolean)
├── Data Broker
│   └── case_data (uses caseSysId)
└── Layout
    ├── now-card
    │   ├── Header: @data.case.number
    │   ├── Content: @data.case.short_description
    │   └── Footer: Action buttons
    └── now-modal (if expanded)
```

Property definitions carry type, requiredness, defaults, and enums:

```json
{
  "properties": {
    "caseSysId": {
      "type": "string",
      "required": true,
      "description": "Sys ID of the record to display"
    },
    "showActions": {
      "type": "boolean",
      "default": true,
      "description": "Show action buttons"
    },
    "variant": {
      "type": "string",
      "default": "default",
      "enum": ["default", "compact", "detailed"]
    }
  }
}
```

## Best Practices

1. **Data brokers own data.** Components bind; they never fetch.
2. **Client state is for UI state** — filters, selections, view modes; not a data cache.
3. **Communicate through events** so components stay decoupled.
4. **Package reuse as macroponents** instead of copy-pasting layouts across pages.
5. **Prefer GraphQL brokers** over Script brokers for plain table queries.
6. **Verify the record graph after every write** — UIB pages span many `sys_ux_*` records, and a missing link renders silently as a blank area. Read back what you wrote.
7. **Build mobile variants** rather than relying on the desktop variant to scale down.
8. **Keep it accessible** — WCAG applies to workspace pages too.

## Customer Project Rules

<!-- Engagement overlay — record THIS customer's mandatory conventions and
     discovered rules for this artifact type here. Framework updates never touch
     this section. -->
