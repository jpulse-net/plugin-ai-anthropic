/**
 * @name            jPulse Framework / Plugins / AI Anthropic / Tests / Unit / Complete
 * @tagline         Fake-fetch completions against the published event contract
 * @file            plugins/ai-anthropic/webapp/tests/unit/complete-anthropic.test.js
 * @version         1.0.0
 * @release         2026-09-17
 * @repository      https://github.com/jpulse-net/plugin-ai-anthropic
 * @author          Peter Thoeny, https://twiki.org & https://github.com/peterthoeny/
 * @copyright       2026 Peter Thoeny, https://twiki.org & https://github.com/peterthoeny/
 * @license         BSL 1.1 -- see LICENSE file; for commercial use: team@jpulse.net
 * @genai           80%, Cursor 3.20, Grok 4.6
 */

import { describe, expect, test } from '@jest/globals';
import { completeAnthropic } from '../../controller/aiAnthropic.js';

function sse(...events) {
    return events.map((ev) => `data: ${JSON.stringify(ev)}\n\n`).join('');
}

function okFetch(body) {
    return async function fetchFn() {
        return {
            ok: true,
            status: 200,
            body
        };
    };
}

function collect(context, deps) {
    const events = [];
    context.emit = (event) => events.push(event);
    return completeAnthropic(context, deps).then(() => events);
}

const storedKey = async () => 'sk-ant-testkey';
const emptyConfig = async () => ({});

describe('completeAnthropic', () => {
    test('text-only stream emits text, four-way usage, and done/end', async () => {
        const body = sse(
            {
                type: 'message_start',
                message: {
                    usage: {
                        input_tokens: 12,
                        cache_creation_input_tokens: 3,
                        cache_read_input_tokens: 5
                    }
                }
            },
            { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello' } },
            { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: ' world' } },
            { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 7 } }
        );
        const events = await collect({
            messages: [{ role: 'user', content: 'Hi' }]
        }, {
            getSecret: storedKey,
            getConfig: emptyConfig,
            fetch: okFetch(body)
        });
        expect(events.filter((e) => e.type === 'text_delta').map((e) => e.text)).toEqual(['Hello', ' world']);
        const usage = events.find((e) => e.type === 'usage');
        expect(usage).toEqual({
            type: 'usage',
            tokensIn: 12,
            tokensOut: 7,
            cacheWrite: 3,
            cacheRead: 5
        });
        expect(usage.cacheWriteTokens).toBeUndefined();
        expect(events.find((e) => e.type === 'done')).toEqual({ type: 'done', stopReason: 'end' });
    });

    test('two tool_use blocks emit one calls array', async () => {
        const body = sse(
            { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'c1', name: 'get_outline' } },
            { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"q":' } },
            { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '"a"}' } },
            { type: 'content_block_stop', index: 0 },
            { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'c2', name: 'get_title' } },
            { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{}' } },
            { type: 'content_block_stop', index: 1 },
            { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 4 } }
        );
        const events = await collect({
            messages: [{ role: 'user', content: 'outline' }],
            tools: [{ name: 'get_outline' }, { name: 'get_title' }]
        }, {
            getSecret: storedKey,
            getConfig: emptyConfig,
            fetch: okFetch(body)
        });
        const toolUse = events.filter((e) => e.type === 'tool_use');
        expect(toolUse).toHaveLength(1);
        expect(toolUse[0].id).toBeUndefined();
        expect(toolUse[0].calls).toEqual([
            { id: 'c1', name: 'get_outline', args: { q: 'a' } },
            { id: 'c2', name: 'get_title', args: {} }
        ]);
        expect(events.find((e) => e.type === 'done').stopReason).toBe('tool');
    });

    test('truncated tool JSON does not drop a valid sibling', async () => {
        const body = sse(
            { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'ok', name: 'get_outline' } },
            { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"ok":true}' } },
            { type: 'content_block_stop', index: 0 },
            { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'bad', name: 'get_title' } },
            { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"q":' } },
            { type: 'content_block_stop', index: 1 },
            { type: 'message_delta', delta: { stop_reason: 'tool_use' } }
        );
        const events = await collect({
            messages: [{ role: 'user', content: 'go' }]
        }, {
            getSecret: storedKey,
            getConfig: emptyConfig,
            fetch: okFetch(body)
        });
        expect(events.find((e) => e.type === 'tool_use').calls).toEqual([
            { id: 'ok', name: 'get_outline', args: { ok: true } }
        ]);
        expect(events.filter((e) => e.type === 'tool_use_truncated')).toEqual([{
            type: 'tool_use_truncated',
            id: 'bad',
            name: 'get_title',
            jsonLen: 5
        }]);
    });

    test('429 is retryable and the body key is redacted', async () => {
        const events = await collect({
            messages: [{ role: 'user', content: 'Hi' }]
        }, {
            getSecret: storedKey,
            getConfig: emptyConfig,
            fetch: async () => ({
                ok: false,
                status: 429,
                statusText: 'Too Many Requests',
                json: async () => ({
                    error: { message: 'rate limited for sk-ant-leakedKEY' }
                })
            })
        });
        expect(events).toEqual([{
            type: 'error',
            code: 'AI_RATE_LIMIT',
            message: 'rate limited for sk-ant-…',
            retryable: true
        }]);
    });

    test('missing key emits AI_NO_API_KEY without fetch', async () => {
        let fetched = false;
        const events = await collect({
            messages: [{ role: 'user', content: 'Hi' }]
        }, {
            getSecret: async () => '',
            getConfig: emptyConfig,
            fetch: async () => {
                fetched = true;
                throw new Error('should not fetch');
            }
        });
        expect(fetched).toBe(false);
        expect(events).toEqual([{
            type: 'error',
            code: 'AI_NO_API_KEY',
            message: 'Anthropic API key is not configured.',
            retryable: false
        }]);
    });

    test('abortSignal cancels the in-flight request', async () => {
        const abort = new AbortController();
        let sawSignal = false;
        const fetchFn = (url, opts) => {
            sawSignal = !!(opts && opts.signal);
            return new Promise((resolve, reject) => {
                opts.signal.addEventListener('abort', () => {
                    const err = new Error('Aborted');
                    err.name = 'AbortError';
                    reject(err);
                });
            });
        };
        const events = [];
        const pending = completeAnthropic({
            messages: [{ role: 'user', content: 'Hi' }],
            emit: (event) => events.push(event),
            abortSignal: abort.signal
        }, {
            getSecret: storedKey,
            getConfig: emptyConfig,
            fetch: fetchFn
        });
        await new Promise((resolve) => setImmediate(resolve));
        abort.abort();
        await pending;
        expect(sawSignal).toBe(true);
        expect(events).toEqual([]);
    });

    test('plugin timeout emits AI_TIMEOUT, not AI_CANCELED', async () => {
        const fetchFn = (url, opts) => new Promise((resolve, reject) => {
            opts.signal.addEventListener('abort', () => {
                const err = new Error('Aborted');
                err.name = 'AbortError';
                reject(err);
            });
        });
        const events = await collect({
            messages: [{ role: 'user', content: 'Hi' }]
        }, {
            getSecret: storedKey,
            getConfig: async () => ({ timeoutMs: 20 }),
            fetch: fetchFn
        });
        expect(events).toEqual([{
            type: 'error',
            code: 'AI_TIMEOUT',
            message: 'Request timed out.',
            retryable: false
        }]);
    });

    test('a tool block without content_block_stop is truncated', async () => {
        const body = sse(
            { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'cut', name: 'get_outline' } },
            { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{}' } },
            { type: 'message_delta', delta: { stop_reason: 'tool_use' } }
        );
        const events = await collect({
            messages: [{ role: 'user', content: 'go' }]
        }, {
            getSecret: storedKey,
            getConfig: emptyConfig,
            fetch: okFetch(body)
        });
        expect(events.find((e) => e.type === 'tool_use')).toBeUndefined();
        expect(events.filter((e) => e.type === 'tool_use_truncated')).toEqual([{
            type: 'tool_use_truncated',
            id: 'cut',
            name: 'get_outline',
            jsonLen: 2
        }]);
    });

    test('request uses Messages path, stream, header key, cache, and config model', async () => {
        let captured;
        const events = await collect({
            system: 'You are helpful.',
            messages: [{ role: 'user', content: 'Hi' }],
            tools: [
                { name: 'get_outline', schema: { type: 'object', properties: {} } },
                { name: 'get_title', schema: { type: 'object', properties: {} } }
            ]
        }, {
            getSecret: storedKey,
            getConfig: async () => ({
                model: 'claude-haiku-4-5',
                endpoint: 'https://api.example.com/'
            }),
            fetch: async (url, opts) => {
                captured = { url, opts };
                return { ok: true, status: 200, body: sse(
                    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ok' } },
                    { type: 'message_delta', delta: { stop_reason: 'end_turn' } }
                ) };
            }
        });
        expect(captured.url).toBe('https://api.example.com/v1/messages');
        expect(captured.opts.headers['x-api-key']).toBe('sk-ant-testkey');
        expect(JSON.stringify(captured.opts.body)).not.toContain('sk-ant-testkey');
        const body = JSON.parse(captured.opts.body);
        expect(body.stream).toBe(true);
        expect(body.model).toBe('claude-haiku-4-5');
        expect(body.system[0]).toEqual({
            type: 'text',
            text: 'You are helpful.',
            cache_control: { type: 'ephemeral' }
        });
        expect(body.tools[0].cache_control).toBeUndefined();
        expect(body.tools[1].cache_control).toEqual({ type: 'ephemeral' });
        expect(events.find((e) => e.type === 'text_delta').text).toBe('ok');
    });
});

// EOF plugins/ai-anthropic/webapp/tests/unit/complete-anthropic.test.js
