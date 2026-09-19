# jPulse Docs / Installed Plugins / Anthropic AI Provider Plugin v1.0.1

The Anthropic plugin is a Claude backend for the site AI agent. It does not add a panel of its own. Enable it, save an API key, then set **Site Configuration → AI** to Anthropic (default provider / model, or the allowed list).

This page is at `/jpulse-docs/installed-plugins/ai-anthropic/README`. A trailing slash is rewritten to `index.shtml` before markdown routing and 404s.

## Features

- **Claude completions** — streams the Messages API into the `ai-core` turn loop (text, parallel tool use, usage, done).
- **Prompt cache** — ephemeral cache on the system prompt and the last tool in the list.
- **Four-way token accounting** — input, output, cache write, and cache read, in USD per million tokens.
- **Password API key** — bulk config reads return a mask; completions use the stored secret on the server.
- **Verify** — GET `/v1/models` with the key in the form field. The button never receives the stored-only value.

## Setup

1. Install: `npx jpulse plugin install @jpulse-net/plugin-ai-anthropic` (pulls `ai-core` if needed).
2. Enable **ai-anthropic** under **Admin → Plugins** if it is not already enabled, and restart.
3. Open **Plugins → ai-anthropic → Configure**.
4. Paste the API key on the **Provider** tab.
5. Click **Verify API key** — it uses the value in the field, so you do not need to Save first. Then **Save Changes**.
6. On **Site Configuration → AI**, set the default provider / model or the allowed list.

Until the chat panel ships, start a thread and a turn over HTTP:

```
POST /api/1/ai/thread          { "scopeType": "doc", "scopeId": "<id>" }
POST /api/1/ai/thread/:id/turn { "text": "Summarize this." }
```

The second call is Server-Sent Events.

## Provider tab

| Field | Default | Notes |
|-------|---------|-------|
| API key | empty | `sk-ant-…`. Masked in GET config. Reveal on this form is audited. |
| Verify API key | — | Calls GET `{endpoint}/v1/models` with the key in the field (unsaved is fine). Never returns the key. |
| Default model | Claude Sonnet 5 | Used when Site Configuration → AI does not pick a model. |
| API endpoint | `https://api.anthropic.com` | No trailing path. Completions POST `{endpoint}/v1/messages`. |
| Request timeout (ms) | 60000 | Abort one HTTP request after this many milliseconds. |
| Max output tokens | 8192 | Cap on a single completion. |

Models in the list: Claude Sonnet 5, Claude Haiku 4.5, Claude Opus 5, Claude Fable 5.1.

## Pricing tab

Leave the override empty to use the built-in prices (USD per million tokens, verified 2026-09-15 from Anthropic). Cache write is the 5-minute TTL rate. An unknown model stores cost `null` — it must not cost $0.

To override, paste a JSON object. Keys are model ids. Each value needs four numbers — `input`, `output`, `cacheWrite`, `cacheRead` — in $/MTok:

```json
{ "claude-sonnet-5": { "input": 2, "output": 10, "cacheWrite": 2.5, "cacheRead": 0.2 } }
```

Invalid JSON is ignored and the built-in table stays in effect.

## Security

- The key is `type: "password"`. Completions read it with `PluginModel.getSecret`.
- Verify and error messages never include the key.
- The Verify button posts only the form field (mask or newly typed). It does not read the stored secret in the browser.

## Technical details

- **JavaScript**: `webapp/controller/aiAnthropic.js` — `onAiProviderRegister` / `onAiComplete`; `webapp/view/jpulse-common.js` — Verify button (`jPulse.plugins.aiAnthropic.verifyApiKey`).
- **Hooks**: `onAiProviderRegister` (continue) and `onAiComplete` (abort), defined by `ai-core`. This plugin only handles them. It does not import from `plugins/ai-core/`.
- **Depends on**: `ai-core` (`@jpulse-net/plugin-ai-core` >= 1.0.0). jPulse >= 2.0.2.

## Plugin releases

- **1.0.1**, W-236, 2026-09-19: Transient network failures (`ECONNRESET`, `ECONNREFUSED`, `ETIMEDOUT`, `EPIPE`, `EAI_AGAIN`, `UND_ERR_SOCKET`, `UND_ERR_CONNECT_TIMEOUT`) emit `retryable: true` so the turn loop retries. The cause code rides the message (`fetch failed (ECONNRESET)`). `ENOTFOUND` and TLS / certificate failures stay fatal.
- **1.0.0**, W-224, 2026-09-17: First release: published `ai-core` 1.0.0 contract (array `tool_use`, four-way usage, $/MTok price table), password key, unsaved Verify, Pricing tab override.
