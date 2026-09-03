# Technical Categories Reference

Extraction patterns for each technical category when analyzing update set XMLs.

## Business Rules (sys_script)

| Field | What to Extract |
|-------|----------------|
| sys_id | Record sys_id |
| name | Display name |
| collection | Target table |
| when | before/after/async |
| action_insert/update/delete | Trigger actions |
| filter_condition | When it runs (encoded query) |
| script | What it does (summarize) |

**Output table:** Name | sys_id | Scope | Table | When | What it does

## Script Includes (sys_script_include)

| Field | What to Extract |
|-------|----------------|
| sys_id | Record sys_id |
| name | Class name |
| api_name | Full API name |
| client_callable | Available to client? |
| script | Methods and purpose |

**Output table:** Name | sys_id | Scope | What it does

## Client Scripts (sys_script_client)

| Field | What to Extract |
|-------|----------------|
| sys_id | Record sys_id |
| name | Display name |
| table | Target table |
| type | onLoad/onChange/onSubmit |
| field | Trigger field (onChange) |
| script | What it does |

**Output table:** Name | sys_id | Scope | Table | Type | What it does

## Tables & Columns (sys_dictionary)

| Field | What to Extract |
|-------|----------------|
| sys_id | Record sys_id |
| name | Table name |
| element | Field name |
| column_label | Display label |
| internal_type | Field type |
| mandatory | Required? |

**Output table:** Table | Field | Label | Type | Required

## Choices (sys_choice)

| Field | What to Extract |
|-------|----------------|
| name | Table name |
| element | Field name |
| value | Choice value |
| label | Display label |

**Output table:** Table | Field | Value | Label (source language) | Label (target language, if bilingual)

## UI Policies (sys_ui_policy)

| Field | What to Extract |
|-------|----------------|
| sys_id | Record sys_id |
| short_description | Name |
| table | Target table |
| conditions | When it applies |
| script | What it does |

**Output table:** Name | sys_id | Table | Condition | Behavior

## UI Actions (sys_ui_action)

| Field | What to Extract |
|-------|----------------|
| sys_id | Record sys_id |
| name | Button/link name |
| table | Target table |
| action_name | Internal name |
| script | What it does |

**Output table:** Name | sys_id | Table | Type | What it does

## System Properties (sys_properties)

| Field | What to Extract |
|-------|----------------|
| sys_id | Record sys_id |
| name | Property name |
| value | Current value |
| description | Purpose |
| type | Data type |

**Output table:** Property | sys_id | Value | Description

## UI Messages (sys_ui_message)

| Field | What to Extract |
|-------|----------------|
| sys_id | Record sys_id |
| key | Message key |
| message (source language) | Source-language text |
| message (target language) | Translated text, if bilingual |

**Output table:** Key | sys_id | Source text | Translation(s) | Used in

## ACLs (sys_security_acl)

| Field | What to Extract |
|-------|----------------|
| sys_id | Record sys_id |
| name | ACL identifier |
| type | Record/field ACL |
| operation | read/write/create/delete |
| script | Condition script |
| admin_overrides | Admin bypass? |

**Output table:** Name | sys_id | Type | Operation | Roles/Condition

## Scheduled Jobs (sysauto_script)

| Field | What to Extract |
|-------|----------------|
| sys_id | Record sys_id |
| name | Job name |
| run_type | Schedule type |
| script | What it does |

**Output table:** Name | sys_id | Schedule | What it does

## Notifications (sysevent_email_action)

| Field | What to Extract |
|-------|----------------|
| sys_id | Record sys_id |
| name | Notification name |
| event_name | Trigger event |
| collection | Table |
| recipient_fields | Who gets it |

**Output table:** Name | sys_id | Table | Trigger | Recipients

---

## Groups (sys_user_group)

| Field | What to Extract |
|-------|----------------|
| sys_id | Record sys_id |
| name | Group name |
| description | Purpose |
| type | Group type |

**Output table:** Name | sys_id | Roles | Purpose

---

> **IMPORTANT:** Always extract and include `sys_id` for every artifact. This is critical for autonomous development — agents need sys_ids to directly query, update, or reference records without name-based searches.
