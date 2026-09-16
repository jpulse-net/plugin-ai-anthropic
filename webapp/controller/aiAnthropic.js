/**
 * @name            jPulse Framework / Plugins / AI Anthropic / WebApp / Controller
 * @tagline         Claude onAiComplete provider with SSE and prompt cache
 * @description     Streams Messages API events into the published ai-core
 *                  contract: array tool_use, four-way usage, $/MTok prices
 * @file            plugins/ai-anthropic/webapp/controller/aiAnthropic.js
 * @version         1.0.0
 * @release         2026-09-17
 * @repository      https://github.com/jpulse-net/plugin-ai-anthropic
 * @author          Peter Thoeny, https://twiki.org & https://github.com/peterthoeny/
 * @copyright       2026 Peter Thoeny, https://twiki.org & https://github.com/peterthoeny/
 * @license         BSL 1.1 -- see LICENSE file; for commercial use: team@jpulse.net
 * @genai           80%, Cursor 3.20, Grok 4.6
 */

const PLUGIN_ID = 'ai-anthropic';
const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_ENDPOINT = 'https://api.anthropic.com';
const DEFAULT_MODEL = 'claude-sonnet-5';
const DEFAULT_TIMEOUT_MS = 60000;
const DEFAULT_MAX_TOKENS = 8192;
const SENSITIVE_MASK = '********';

/** USD per million tokens. Cache write = 5-minute TTL. Verified 2026-09-15 from Anthropic pricing. */
export const PRICE_TABLE = {
    'claude-sonnet-5': { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.2 },
    'claude-haiku-4-5': { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 },
    'claude-opus-5': { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
    'claude-fable-5-1': { input: 10, output: 50, cacheWrite: 12.5, cacheRead: 0.25 }
};

export const DEFAULT_MODELS = [
    { id: 'claude-sonnet-5', label: 'Claude Sonnet 5' },
    { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
    { id: 'claude-opus-5', label: 'Claude Opus 5' },
    { id: 'claude-fable-5-1', label: 'Claude Fable 5.1' }
];

function isMask(value) {
    if (global.PluginModel && typeof global.PluginModel.isSensitiveMask === 'function') {
        return global.PluginModel.isSensitiveMask(value);
    }
    return value === SENSITIVE_MASK;
}

function isUsableKey(value) {
    return typeof value === 'string' && value !== '' && !isMask(value);
}

function isValidPriceRow(row) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
        return false;
    }
    return ['input', 'output', 'cacheWrite', 'cacheRead'].every((k) => {
        return typeof row[k] === 'number' && Number.isFinite(row[k]);
    });
}

function clonePriceTable(table) {
    const out = {};
    Object.keys(table).forEach((id) => {
        out[id] = { ...table[id] };
    });
    return out;
}

export function mergePriceTable(overrideJson) {
    const merged = clonePriceTable(PRICE_TABLE);
    if (typeof overrideJson === 'string' && overrideJson.trim()) {
        try {
            const parsed = JSON.parse(overrideJson);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                Object.keys(parsed).forEach((id) => {
                    if (!parsed[id] || typeof parsed[id] !== 'object' || Array.isArray(parsed[id])) {
                        return;
                    }
                    const candidate = { ...(merged[id] || {}), ...parsed[id] };
                    if (isValidPriceRow(candidate)) {
                        merged[id] = candidate;
                    }
                });
            }
        } catch (_err) { /* keep built-in table */ }
    }
    return merged;
}

export function ratesForModel(model, overrideJson) {
    const table = mergePriceTable(overrideJson);
    const row = table[model];
    if (!row || typeof row !== 'object') {
        return null;
    }
    const out = {};
    let known = false;
    ['input', 'output', 'cacheWrite', 'cacheRead'].forEach((k) => {
        if (typeof row[k] === 'number' && Number.isFinite(row[k])) {
            out[k] = row[k];
            known = true;
        }
    });
    return known ? out : null;
}

export function toAnthropicTools(tools) {
    const list = Array.isArray(tools) ? tools : [];
    return list.map((t, i) => {
        const schema = t.schema && typeof t.schema === 'object'
            ? t.schema
            : { type: 'object', properties: {} };
        const item = {
            name: t.name,
            description: t.description || t.name,
            input_schema: schema
        };
        if (i === list.length - 1) {
            item.cache_control = { type: 'ephemeral' };
        }
        return item;
    });
}

export function toAnthropicMessages(messages) {
    const out = [];
    (messages || []).forEach((m) => {
        if (!m || !m.role) return;
        if (m.role === 'system') return;
        if (m.role === 'tool') {
            const block = {
                type: 'tool_result',
                tool_use_id: m.toolCallId || m.id || '',
                content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content || '')
            };
            const last = out[out.length - 1];
            if (last && last.role === 'user' && Array.isArray(last.content)) {
                last.content.push(block);
            } else {
                out.push({ role: 'user', content: [block] });
            }
            return;
        }
        if (m.role === 'assistant') {
            const content = [];
            if (m.content) content.push({ type: 'text', text: String(m.content) });
            (m.toolCalls || []).forEach((tc) => {
                content.push({
                    type: 'tool_use',
                    id: tc.id || '',
                    name: tc.name || '',
                    input: tc.args && typeof tc.args === 'object' ? tc.args : {}
                });
            });
            if (content.length) out.push({ role: 'assistant', content });
            return;
        }
        if (m.role === 'user') {
            if (Array.isArray(m.content)) {
                const content = m.content.map((part) => {
                    if (part && part.type === 'image') {
                        return {
                            type: 'image',
                            source: {
                                type: 'base64',
                                media_type: part.mimeType || 'image/jpeg',
                                data: String(part.data || '')
                            }
                        };
                    }
                    return {
                        type: 'text',
                        text: part && part.type === 'text' ? String(part.text || '') : String((part && part.text) || '')
                    };
                });
                out.push({ role: 'user', content });
                return;
            }
            out.push({ role: 'user', content: String(m.content || '') });
        }
    });
    return out;
}

export function mapUsage(raw) {
    const u = raw && typeof raw === 'object' ? raw : {};
    return {
        tokensIn: u.input_tokens || 0,
        tokensOut: u.output_tokens || 0,
        cacheWrite: u.cache_creation_input_tokens || 0,
        cacheRead: u.cache_read_input_tokens || 0
    };
}

export function mapStopReason(reason) {
    if (reason === 'tool_use') return 'tool';
    if (reason === 'max_tokens') return 'length';
    return 'end';
}

export function sanitizeError(text) {
    return String(text || 'Anthropic request failed').replace(/sk-ant-[A-Za-z0-9_-]+/g, 'sk-ant-…');
}

export function consumeSse(buffer) {
    const normalized = String(buffer || '').replace(/\r\n/g, '\n');
    const parts = normalized.split('\n\n');
    const rest = parts.pop() || '';
    const events = [];
    parts.forEach((block) => {
        let data = '';
        String(block).split('\n').forEach((line) => {
            if (line.indexOf('data:') === 0) {
                const chunk = line.slice(5).trim();
                data = data ? data + '\n' + chunk : chunk;
            }
        });
        if (!data || data === '[DONE]') return;
        try {
            events.push(JSON.parse(data));
        } catch (_err) { /* skip malformed */ }
    });
    return { events, rest };
}

async function loadPluginModel() {
    if (global.PluginModel) return global.PluginModel;
    const mod = await import('../../../../webapp/model/plugin.js');
    return mod.default;
}

async function defaultGetSecret() {
    const PluginModel = await loadPluginModel();
    if (!PluginModel || typeof PluginModel.getSecret !== 'function') return '';
    const value = await PluginModel.getSecret(PLUGIN_ID, 'apiKey');
    return typeof value === 'string' ? value : '';
}

async function defaultGetConfig() {
    const PluginModel = await loadPluginModel();
    if (!PluginModel || typeof PluginModel.getByName !== 'function') return {};
    const doc = await PluginModel.getByName(PLUGIN_ID);
    return (doc && doc.config) || {};
}

function headerMap(apiKey) {
    return {
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'content-type': 'application/json'
    };
}

function endpointOf(config) {
    const raw = (config && config.endpoint) || DEFAULT_ENDPOINT;
    return String(raw).replace(/\/+$/, '');
}

/**
 * Same rule as EmailController._resolveTestSmtpPass: a newly typed (non-empty,
 * non-mask) field value is used as-is so Verify works before Save. Mask or
 * empty falls back to the stored secret.
 * @param {*} submitted - apiKey from the request body
 * @param {*} stored - PluginModel.getSecret value
 * @returns {string}
 */
export function resolveVerifyApiKey(submitted, stored) {
    if (isUsableKey(submitted)) {
        return submitted;
    }
    if (isUsableKey(stored)) {
        return stored;
    }
    return '';
}

export async function buildProviderDescriptor(deps) {
    deps = deps || {};
    const getSecret = deps.getSecret || defaultGetSecret;
    const getConfig = deps.getConfig || defaultGetConfig;
    let maxTokens = DEFAULT_MAX_TOKENS;
    let overrideJson = '';
    try {
        const config = await getConfig();
        const n = parseInt(config.maxTokens, 10);
        if (Number.isFinite(n) && n > 0) maxTokens = n;
        if (typeof config.priceTableOverride === 'string') {
            overrideJson = config.priceTableOverride;
        }
    } catch (_err) { /* tests and first boot have no plugin doc */ }
    let apiKey = '';
    try {
        apiKey = await getSecret();
    } catch (_err) { /* same: no plugin doc yet */ }
    return {
        plugin: PLUGIN_ID,
        label: 'Anthropic Claude',
        models: DEFAULT_MODELS.slice(),
        capabilities: { vision: true },
        priceTable: mergePriceTable(overrideJson),
        maxTokens,
        configured: isUsableKey(apiKey)
    };
}

export async function pingModels(deps) {
    const getSecret = deps.getSecret || defaultGetSecret;
    const getConfig = deps.getConfig || defaultGetConfig;
    const fetchFn = deps.fetch || global.fetch;
    const stored = await getSecret();
    const apiKey = resolveVerifyApiKey(deps.apiKey, stored);
    if (!apiKey) {
        return { configured: false, valid: false, message: 'Anthropic API key is not configured.' };
    }
    const config = await getConfig();
    const endpoint = (typeof deps.endpoint === 'string' && deps.endpoint.trim())
        ? String(deps.endpoint).replace(/\/+$/, '')
        : endpointOf(config);
    const url = endpoint + '/v1/models';
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15000);
    try {
        const res = await fetchFn(url, {
            method: 'GET',
            headers: headerMap(apiKey),
            signal: ctrl.signal
        });
        if (res.ok) {
            return { configured: true, valid: true, message: 'Anthropic API key is valid.' };
        }
        if (res.status === 401 || res.status === 403) {
            return { configured: true, valid: false, message: 'Anthropic rejected the API key.' };
        }
        return {
            configured: true,
            valid: false,
            message: sanitizeError('Anthropic verify failed (' + res.status + ').')
        };
    } catch (error) {
        if (error && error.name === 'AbortError') {
            return { configured: true, valid: false, message: 'Anthropic verify timed out.' };
        }
        return { configured: true, valid: false, message: sanitizeError(error && error.message) };
    } finally {
        clearTimeout(t);
    }
}

async function readSse(body, onEvent, signal) {
    if (!body || typeof body.getReader !== 'function') {
        const text = typeof body === 'string' ? body
            : (body && typeof body.text === 'function' ? await body.text() : '');
        const parsed = consumeSse(text + '\n\n');
        parsed.events.forEach(onEvent);
        return;
    }
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    while (true) {
        if (signal && signal.aborted) {
            try { await reader.cancel(); } catch (_err) { /* ignore */ }
            return;
        }
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parsed = consumeSse(buf);
        buf = parsed.rest;
        parsed.events.forEach(onEvent);
    }
    if (buf.trim()) {
        consumeSse(buf + '\n\n').events.forEach(onEvent);
    }
}

function parseToolArgs(tb) {
    if (!tb.stopped) {
        return { ok: false };
    }
    if (!tb.json) {
        return { ok: true, args: tb.input && typeof tb.input === 'object' ? tb.input : {} };
    }
    try {
        const parsed = JSON.parse(tb.json);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            return { ok: true, args: parsed };
        }
        return { ok: true, args: {} };
    } catch (_err) {
        return { ok: false };
    }
}

export async function completeAnthropic(context, deps) {
    deps = deps || {};
    const getSecret = deps.getSecret || defaultGetSecret;
    const getConfig = deps.getConfig || defaultGetConfig;
    const fetchFn = deps.fetch || global.fetch;
    const emit = typeof context.emit === 'function' ? context.emit : function() {};

    const apiKey = await getSecret();
    if (!isUsableKey(apiKey)) {
        emit({
            type: 'error',
            code: 'AI_NO_API_KEY',
            message: 'Anthropic API key is not configured.',
            retryable: false
        });
        return context;
    }

    const config = await getConfig();
    const model = context.model || config.model || DEFAULT_MODEL;
    const timeoutMs = parseInt(config.timeoutMs, 10) || DEFAULT_TIMEOUT_MS;
    const maxTokens = parseInt(config.maxTokens, 10) || DEFAULT_MAX_TOKENS;

    const systemText = typeof context.system === 'string' ? context.system.trim() : '';
    const body = {
        model,
        max_tokens: maxTokens,
        stream: true,
        messages: toAnthropicMessages(context.messages)
    };
    if (systemText) {
        body.system = [{
            type: 'text',
            text: systemText,
            cache_control: { type: 'ephemeral' }
        }];
    }
    const tools = toAnthropicTools(context.tools);
    if (tools.length) body.tools = tools;

    const ctrl = new AbortController();
    const onAbort = function() { ctrl.abort(); };
    if (context.abortSignal) {
        if (context.abortSignal.aborted) {
            return context;
        }
        context.abortSignal.addEventListener('abort', onAbort, { once: true });
    }
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);

    try {
        const res = await fetchFn(endpointOf(config) + '/v1/messages', {
            method: 'POST',
            headers: headerMap(apiKey),
            body: JSON.stringify(body),
            signal: ctrl.signal
        });
        if (!res.ok) {
            let detail = res.statusText || '';
            try {
                const errBody = await res.json();
                if (errBody && errBody.error && errBody.error.message) detail = errBody.error.message;
            } catch (_err) { /* keep statusText */ }
            const retryable = res.status === 429 || res.status === 529;
            emit({
                type: 'error',
                code: retryable ? 'AI_RATE_LIMIT' : 'AI_PROVIDER_ERROR',
                message: sanitizeError(detail || ('HTTP ' + res.status)),
                retryable
            });
            return context;
        }

        const usage = { tokensIn: 0, tokensOut: 0, cacheWrite: 0, cacheRead: 0 };
        const toolBlocks = {};
        let stopReason = '';

        await readSse(res.body, function(ev) {
            if (!ev || !ev.type) return;
            if (ev.type === 'message_start' && ev.message && ev.message.usage) {
                const u = mapUsage(ev.message.usage);
                usage.tokensIn += u.tokensIn;
                usage.cacheWrite += u.cacheWrite;
                usage.cacheRead += u.cacheRead;
            }
            if (ev.type === 'content_block_start' && ev.content_block) {
                const block = ev.content_block;
                if (block.type === 'tool_use') {
                    toolBlocks[ev.index] = {
                        id: block.id,
                        name: block.name,
                        json: '',
                        input: block.input && typeof block.input === 'object' ? block.input : null,
                        stopped: false
                    };
                }
            }
            if (ev.type === 'content_block_delta' && ev.delta) {
                if (ev.delta.type === 'text_delta' && ev.delta.text) {
                    emit({ type: 'text_delta', text: ev.delta.text });
                }
                if (ev.delta.type === 'input_json_delta' && toolBlocks[ev.index]) {
                    toolBlocks[ev.index].json += ev.delta.partial_json || '';
                }
            }
            if (ev.type === 'content_block_stop' && toolBlocks[ev.index]) {
                toolBlocks[ev.index].stopped = true;
            }
            if (ev.type === 'message_delta') {
                if (ev.delta && ev.delta.stop_reason) stopReason = ev.delta.stop_reason;
                if (ev.usage) {
                    const u = mapUsage(ev.usage);
                    usage.tokensOut += u.tokensOut;
                    if (u.tokensIn) usage.tokensIn += u.tokensIn;
                    if (u.cacheWrite) usage.cacheWrite += u.cacheWrite;
                    if (u.cacheRead) usage.cacheRead += u.cacheRead;
                }
            }
        }, context.abortSignal);

        if (context.abortSignal && context.abortSignal.aborted) {
            return context;
        }

        const calls = [];
        const truncated = [];
        Object.keys(toolBlocks).forEach((key) => {
            const tb = toolBlocks[key];
            const parsed = parseToolArgs(tb);
            if (parsed.ok) {
                calls.push({ id: tb.id, name: tb.name, args: parsed.args });
                return;
            }
            truncated.push({
                type: 'tool_use_truncated',
                id: tb.id,
                name: tb.name,
                jsonLen: (tb.json || '').length
            });
        });
        if (calls.length) {
            emit({ type: 'tool_use', calls });
        }
        truncated.forEach((event) => emit(event));

        context.usage = usage;
        emit({ type: 'usage', ...usage });
        emit({ type: 'done', stopReason: mapStopReason(stopReason) });
        return context;
    } catch (error) {
        if (error && error.name === 'AbortError') {
            if (context.abortSignal && context.abortSignal.aborted) {
                return context;
            }
            emit({
                type: 'error',
                code: 'AI_TIMEOUT',
                message: 'Request timed out.',
                retryable: false
            });
            return context;
        }
        emit({
            type: 'error',
            code: 'AI_PROVIDER_ERROR',
            message: sanitizeError(error && error.message),
            retryable: false
        });
        return context;
    } finally {
        clearTimeout(timer);
        if (context.abortSignal) {
            context.abortSignal.removeEventListener('abort', onAbort);
        }
    }
}

class AiAnthropicController {
    static hooks = {
        onAiProviderRegister: { handler: 'onAiProviderRegister' },
        onAiComplete: { handler: 'onAiComplete' }
    };

    static routes = [
        { method: 'POST', path: '/api/1/aiAnthropic/verify-api-key', handler: 'apiVerifyApiKey', auth: 'admin' }
    ];

    static async onAiProviderRegister(context) {
        if (!Array.isArray(context.providers)) context.providers = [];
        context.providers.push(await buildProviderDescriptor());
        return context;
    }

    static async onAiComplete(context) {
        return completeAnthropic(context);
    }

    static async apiVerifyApiKey(req, res) {
        const startTime = Date.now();
        const LogController = global.LogController;
        const CommonUtils = global.CommonUtils;
        const AuthController = global.AuthController;
        const sendError = (status, message, code, extra) => {
            if (CommonUtils?.sendError) {
                return CommonUtils.sendError(req, res, status, message, code, extra);
            }
            return res.status(status).json({ success: false, error: message, code });
        };
        try {
            LogController?.logRequest(req, 'aiAnthropic.verifyApiKey', 'verify request');
            const Auth = AuthController || (await import('../../../../webapp/controller/auth.js')).default;
            if (!Auth || !Auth.isAdmin(req)) {
                LogController?.logError(req, 'aiAnthropic.verifyApiKey', 'error: admin role required');
                return sendError(403, 'Administrator access required', 'FORBIDDEN');
            }
            const body = req.body && typeof req.body === 'object' ? req.body : {};
            const result = await pingModels({
                apiKey: body.apiKey,
                endpoint: body.endpoint
            });
            const elapsed = Date.now() - startTime;
            LogController?.logInfo(req, 'aiAnthropic.verifyApiKey',
                `success: configured=${result.configured} valid=${result.valid} completed in ${elapsed}ms`);
            res.json({
                success: true,
                data: { configured: result.configured, valid: result.valid },
                message: result.message,
                elapsed
            });
        } catch (error) {
            LogController?.logError(req, 'aiAnthropic.verifyApiKey', 'error: ' + error.message);
            return sendError(500, 'Failed to verify Anthropic API key', 'INTERNAL_ERROR', error.message);
        }
    }
}

export default AiAnthropicController;

// EOF plugins/ai-anthropic/webapp/controller/aiAnthropic.js
