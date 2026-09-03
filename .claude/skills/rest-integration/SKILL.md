---
name: rest-integration
description: Invoke when the user asks to "call external API", "REST API", "integration", "webhook", "outbound REST", "RESTMessageV2", "HTTP request", "OAuth profile", or any outbound API integration from ServiceNow.
---

# REST Integration (Outbound)

> ⚠️ **Resurrected reference — not instance-verified.** This skill was rewritten from an
> archived outline. The patterns below are standard platform behavior, but none of them
> carry this framework's "verified on a live instance" stamp — treat every API signature,
> field name, and behavior claim as "(verify on your instance first)".

Outbound REST from ServiceNow goes through `sn_ws.RESTMessageV2` — either constructed
inline in a script, or (preferred for anything reusable) driven by a **REST Message
record** (`sys_rest_message`) with named HTTP methods (`sys_rest_message_fn`) and
variable substitutions. For *inbound* APIs (Scripted REST), see the scoped-apps skill's
Scripted REST section.

## Building the artifacts (framework doctrine)

REST Message records, their methods, and the scripts that call them are ordinary
configuration records — all the kernel's write rules apply:

- Confirm the story-named update set **before** any write; verify capture afterward
  (update-set-workflow skill).
- When the integration lives in a scoped app: **dual `switch_context`** (update set AND
  application) before `create_artifact`/`update_record`, and pass the scope's **sys_id**
  — never the scope name string (see the wiki's hard-rules and registry-sys-ids pages).
- Read back every write. An API "success" response proves nothing.

## Inline requests

### GET

```javascript
var request = new sn_ws.RESTMessageV2();
request.setEndpoint('https://api.example.com/users'); // example endpoint
request.setHttpMethod('GET');
request.setRequestHeader('Accept', 'application/json');

var response = request.execute();
var status = response.getStatusCode();
if (status == 200) {
    var data = JSON.parse(response.getBody());
    gs.info('Fetched ' + data.length + ' users');
}
```

### POST with a JSON body

```javascript
var request = new sn_ws.RESTMessageV2();
request.setEndpoint('https://api.example.com/cases'); // example endpoint
request.setHttpMethod('POST');
request.setRequestHeader('Content-Type', 'application/json');
request.setRequestHeader('Accept', 'application/json');

var payload = {
    title: 'New case',
    description: 'Created from ServiceNow',
    priority: 'high'
};
request.setRequestBody(JSON.stringify(payload));

var response = request.execute();
```

## REST Message records (preferred for reusable integrations)

Define the endpoint, auth, headers, and per-method variable substitutions once on a
`sys_rest_message` record; scripts then reference it by message + method name:

```javascript
// Constructor: (REST Message name, HTTP Method name)
var request = new sn_ws.RESTMessageV2('ACME - External API', 'Create User'); // example names

// Fill the ${...} variable substitutions defined on the method record
request.setStringParameterNoEscape('user_name', userName);
request.setStringParameter('email', email); // setStringParameter escapes for XML contexts

var response = request.execute();
```

Benefits: credentials live on the record (not in script), endpoints are environment-
configurable, and methods can be tested from the record form before any code exists.

## Authentication

| Method | How | Notes |
|---|---|---|
| Basic | Auth profile on the REST Message record, or `request.setBasicAuth(user, pass)` inline | Prefer the record profile — inline hardcodes credentials in script. |
| Bearer token | `request.setRequestHeader('Authorization', 'Bearer ' + token)` | Fetch/refresh the token yourself, or use an OAuth profile. |
| OAuth 2.0 | `request.setAuthenticationProfile('oauth2', profileSysId)` | The second argument is the **sys_id** of the OAuth entity profile, not its name (verify on your instance first). |
| API key | `request.setRequestHeader('X-API-Key', key)` or `request.setQueryParameter('api_key', key)` | Header preferred; query-string keys end up in logs. |

Store secrets in Connection & Credential aliases or system properties with restricted
read access — never as string literals in scripts committed to an update set.

## Timeouts, errors, and response handling

```javascript
try {
    var request = new sn_ws.RESTMessageV2();
    request.setEndpoint('https://api.example.com/data'); // example
    request.setHttpMethod('GET');
    request.setHttpTimeout(10000); // ms — always set one; the default is generous

    var response = request.execute();
    var status = response.getStatusCode();

    if (status == 200) {
        var data = JSON.parse(response.getBody());
        // process
    } else if (status == 401) {
        gs.error('[Integration] Authentication failed');
    } else if (status == 404) {
        gs.error('[Integration] Resource not found');
    } else if (status >= 500) {
        gs.error('[Integration] Remote server error: ' + status);
    } else {
        gs.error('[Integration] Unexpected status: ' + status);
    }
} catch (ex) {
    // Network failures / timeouts surface as exceptions, not status codes
    gs.error('[Integration] REST exception: ' + ex.message);
}
```

Useful response accessors:

```javascript
var body = response.getBody();
var contentType = response.getHeader('Content-Type');
var remaining = response.getHeader('X-RateLimit-Remaining');
var errorFlag = response.haveError();          // transport-level error
var errorMsg = response.getErrorMessage();
```

Parse defensively: wrap `JSON.parse` in try/catch, default missing arrays
(`data.items || []`), and never assume nested keys exist.

## Async execution

`execute()` blocks the current thread. For slow endpoints called from interactive
contexts (business rules, UI actions), use async:

```javascript
var response = request.executeAsync();
response.waitForResponse(60); // seconds — only if you actually need the result now
```

Better: move the call into an event-driven Script Include method or a scheduled job so
user-facing transactions never wait on a remote system (see the scheduled-jobs skill).

## MID Server routing

For endpoints not reachable from the instance (on-premise systems), route through a MID
Server: `request.setMIDServer('MyMidServer')` or set it on the REST Message record. The
call becomes asynchronous via the ECC queue — design for eventual response handling.

## Retry with backoff

```javascript
function callWithRetry(endpoint, maxRetries) {
    var retries = 0;
    var delay = 1000; // ms

    while (retries < maxRetries) {
        try {
            var request = new sn_ws.RESTMessageV2();
            request.setEndpoint(endpoint);
            request.setHttpMethod('GET');
            request.setHttpTimeout(10000);

            var response = request.execute();
            var status = response.getStatusCode();

            if (status == 200) {
                return JSON.parse(response.getBody());
            }
            if (status < 500) {
                // Client error — retrying won't help
                throw new Error('Client error: ' + status);
            }
            // 5xx — fall through to retry
        } catch (ex) {
            if (retries + 1 >= maxRetries) {
                throw ex;
            }
        }
        retries++;
        gs.sleep(delay); // global scope only — see caveat below
        delay = delay * 2;
    }
    return null;
}
```

**`gs.sleep` caveat:** it exists only in global scope; in scoped apps (and some script
sandboxes) it is unavailable (verify on your instance first). In a scoped app, retry via
re-queued events or a scheduled job instead of sleeping in-line.

## Debugging

- Test methods directly from the REST Message record form before writing script.
- The Outbound HTTP log (`sys_outbound_http_requests`) records request/response detail
  when outbound logging is enabled for the message (verify availability and the enabling
  property on your instance first).
- Log every non-200 outcome with a stable script prefix (`'[IntegrationName] ...'`) so
  syslog filtering works.

## Best practices

1. **REST Message records over inline endpoints** — configuration beats hardcoding.
2. **Always set a timeout** — an integration without `setHttpTimeout` can hang a thread.
3. **Handle every status class**, not just 200 — and `catch` transport exceptions separately.
4. **Never block user transactions** on remote calls — go async or event-driven.
5. **Secrets out of scripts** — auth profiles, credential aliases, or protected properties.
6. **Idempotency + dedup keys** on outbound writes, so retries don't double-create remotely.
7. **Respect rate limits** — read the remote's rate-limit headers and back off.
8. **Match the script's ES level to its scope** — see the es5-compliance skill.

## Customer Project Rules
<!-- Engagement overlay — record THIS customer's mandatory conventions and
     discovered rules for this artifact type here. Framework updates never touch
     this section. -->
