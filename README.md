# jPulse Framework / Plugins / Anthropic AI Provider Plugin v1.0.0

Claude provider for `ai-core`. Streams Messages API completions into the turn loop, accounts for input / output / cache tokens in $/MTok, and stores the API key as a password field that Verify never returns to the browser.

Requires jPulse Framework >= 2.0.2. Installing this package pulls `ai-core` (`@jpulse-net/plugin-ai-core`).

`autoEnable` is true (the site chose to install it). Single-plugin package — not a bundle.

## Install

```bash
npx jpulse plugin install @jpulse-net/plugin-ai-anthropic
```

That command installs this plugin and, if needed, the `ai-core` bundle. Then:

1. Enable **ai-anthropic** under **Admin → Plugins** if it is not already enabled, and restart.
2. Open **Plugins → ai-anthropic → Configure**.
3. Paste the API key on the **Provider** tab.
4. Click **Verify API key** — it uses the value in the field, so you do not need to Save first. Then **Save Changes**.
5. On **Site Configuration → AI**, set the default provider / model (or the allowed list) to Anthropic.

Until the chat panel ships, start a thread and a turn over HTTP the same way `ai-mock` does. Guide: `/jpulse-docs/installed-plugins/ai-anthropic/README` — a trailing slash 404s.

## Hooks used

`onAiProviderRegister` and `onAiComplete`, defined by `ai-core`. This plugin only handles them. It does not import from `plugins/ai-core/`.

## Tests

Unit tests live in `webapp/tests/unit/` and use the framework Jest config (Babel, global setup, `.jpulse/app.json`). This tree has to sit at `plugins/ai-anthropic` inside a jPulse checkout.

From **this directory**:

```bash
npm test
```

Or the same `npx jest plugins/ai-anthropic/webapp/tests/unit --runInBand` from here or from the **framework repo root**. A bare `npx jest` against these files without that config treats them as CommonJS and fails on `import`.

## 1.0.0

First release: published `ai-core` 1.0.0 contract (array `tool_use`, four-way usage, $/MTok price table), password key, unsaved Verify, Pricing tab override.
