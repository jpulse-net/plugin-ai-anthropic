/**
 * @name            jPulse Framework / Plugins / AI Anthropic / Tests / Unit / Helpers
 * @tagline         SSE parser, usage map, stop reason, sanitize, verify, prices
 * @file            plugins/ai-anthropic/webapp/tests/unit/helpers.test.js
 * @version         1.0.0
 * @release         2026-09-17
 * @repository      https://github.com/jpulse-net/plugin-ai-anthropic
 * @author          Peter Thoeny, https://twiki.org & https://github.com/peterthoeny/
 * @copyright       2026 Peter Thoeny, https://twiki.org & https://github.com/peterthoeny/
 * @license         BSL 1.1 -- see LICENSE file; for commercial use: team@jpulse.net
 * @genai           80%, Cursor 3.20, Grok 4.6
 */

import { describe, expect, test } from '@jest/globals';
import {
    consumeSse,
    mapStopReason,
    mapUsage,
    mergePriceTable,
    pingModels,
    PRICE_TABLE,
    ratesForModel,
    resolveVerifyApiKey,
    sanitizeError,
    toAnthropicMessages,
    toAnthropicTools
} from '../../controller/aiAnthropic.js';

describe('consumeSse', () => {
    test('split chunk leaves the incomplete event in the buffer', () => {
        const first = 'data: {"type":"a"}\n\ndata: {"type":';
        const parsed = consumeSse(first);
        expect(parsed.events).toEqual([{ type: 'a' }]);
        expect(parsed.rest).toBe('data: {"type":');
        const second = consumeSse(parsed.rest + '"b"}\n\n');
        expect(second.events).toEqual([{ type: 'b' }]);
        expect(second.rest).toBe('');
    });

    test('malformed data: line is skipped; rest stays in the buffer', () => {
        const parsed = consumeSse('data: {bad\n\ndata: {"type":"ok"}\n\ndata: {"type":');
        expect(parsed.events).toEqual([{ type: 'ok' }]);
        expect(parsed.rest).toBe('data: {"type":');
    });
});

describe('mapUsage', () => {
    test('maps four-way Anthropic usage fields', () => {
        expect(mapUsage({
            input_tokens: 10,
            output_tokens: 4,
            cache_creation_input_tokens: 2,
            cache_read_input_tokens: 8
        })).toEqual({
            tokensIn: 10,
            tokensOut: 4,
            cacheWrite: 2,
            cacheRead: 8
        });
    });

    test('missing fields are zero', () => {
        expect(mapUsage({})).toEqual({
            tokensIn: 0,
            tokensOut: 0,
            cacheWrite: 0,
            cacheRead: 0
        });
    });
});

describe('mapStopReason', () => {
    test('normalizes the published trio', () => {
        expect(mapStopReason('tool_use')).toBe('tool');
        expect(mapStopReason('max_tokens')).toBe('length');
        expect(mapStopReason('end_turn')).toBe('end');
        expect(mapStopReason('')).toBe('end');
    });
});

describe('sanitizeError', () => {
    test('redacts sk-ant- keys', () => {
        const out = sanitizeError('invalid key sk-ant-abc123XYZ_and-more');
        expect(out).toContain('sk-ant-…');
        expect(out).not.toContain('sk-ant-abc123XYZ_and-more');
    });

    test('never echoes a key from an HTTP error body', () => {
        const body = 'Authentication failed for sk-ant-secretKEY99';
        const out = sanitizeError(body);
        expect(out).not.toMatch(/sk-ant-secretKEY99/);
        expect(out).toContain('sk-ant-…');
    });
});

describe('price table', () => {
    test('built-in table is $/MTok, not per-token', () => {
        expect(PRICE_TABLE['claude-sonnet-5']).toEqual({
            input: 2,
            output: 10,
            cacheWrite: 2.5,
            cacheRead: 0.2
        });
        expect(PRICE_TABLE['claude-sonnet-5'].input).toBeGreaterThan(0.01);
        expect(PRICE_TABLE['claude-fable-5-1']).toEqual({
            input: 10,
            output: 50,
            cacheWrite: 12.5,
            cacheRead: 0.25
        });
        expect(PRICE_TABLE['claude-haiku-4-5-20251001']).toBeUndefined();
        expect(PRICE_TABLE['claude-fable-5']).toBeUndefined();
    });

    test('override JSON merges on top', () => {
        const merged = mergePriceTable(JSON.stringify({
            'claude-sonnet-5': { input: 9 }
        }));
        expect(merged['claude-sonnet-5'].input).toBe(9);
        expect(merged['claude-sonnet-5'].output).toBe(10);
        expect(merged['claude-haiku-4-5'].input).toBe(1);
    });

    test('invalid JSON keeps the built-in table', () => {
        expect(mergePriceTable('{')).toEqual(PRICE_TABLE);
        expect(mergePriceTable('not-json')).toEqual(PRICE_TABLE);
    });

    test('unknown model returns null rates', () => {
        expect(ratesForModel('claude-unknown')).toBeNull();
        expect(ratesForModel('')).toBeNull();
    });

    test('partial row for a new model is ignored', () => {
        const merged = mergePriceTable(JSON.stringify({
            'claude-next': { input: 5 }
        }));
        expect(merged['claude-next']).toBeUndefined();
        expect(ratesForModel('claude-next', JSON.stringify({
            'claude-next': { input: 5 }
        }))).toBeNull();
    });

    test('a complete new-model row merges', () => {
        const row = { input: 5, output: 15, cacheWrite: 6.25, cacheRead: 0.5 };
        const merged = mergePriceTable(JSON.stringify({ 'claude-next': row }));
        expect(merged['claude-next']).toEqual(row);
    });

    test('non-numeric override of a built-in row is ignored', () => {
        const merged = mergePriceTable(JSON.stringify({
            'claude-sonnet-5': { input: 'nope' }
        }));
        expect(merged['claude-sonnet-5']).toEqual(PRICE_TABLE['claude-sonnet-5']);
    });
});

describe('toAnthropicTools', () => {
    test('puts ephemeral cache on the last tool only', () => {
        const tools = toAnthropicTools([
            { name: 'get_outline', description: 'Outline', schema: { type: 'object', properties: {} } },
            { name: 'get_title', schema: { type: 'object', properties: { q: { type: 'string' } } } }
        ]);
        expect(tools).toHaveLength(2);
        expect(tools[0].cache_control).toBeUndefined();
        expect(tools[0].input_schema).toEqual({ type: 'object', properties: {} });
        expect(tools[1].cache_control).toEqual({ type: 'ephemeral' });
        expect(tools[1].input_schema.properties.q).toEqual({ type: 'string' });
    });
});

describe('toAnthropicMessages', () => {
    test('skips system, maps tool results, and assistant toolCalls', () => {
        const out = toAnthropicMessages([
            { role: 'system', content: 'ignore' },
            { role: 'user', content: 'hi' },
            {
                role: 'assistant',
                content: 'calling',
                toolCalls: [{ id: 'c1', name: 'get_outline', args: { q: 'a' } }]
            },
            { role: 'tool', toolCallId: 'c1', content: { ok: true } },
            { role: 'tool', id: 'c2', content: 'second' }
        ]);
        expect(out).toEqual([
            { role: 'user', content: 'hi' },
            {
                role: 'assistant',
                content: [
                    { type: 'text', text: 'calling' },
                    { type: 'tool_use', id: 'c1', name: 'get_outline', input: { q: 'a' } }
                ]
            },
            {
                role: 'user',
                content: [
                    { type: 'tool_result', tool_use_id: 'c1', content: JSON.stringify({ ok: true }) },
                    { type: 'tool_result', tool_use_id: 'c2', content: 'second' }
                ]
            }
        ]);
    });

    test('maps image parts', () => {
        const out = toAnthropicMessages([{
            role: 'user',
            content: [
                { type: 'text', text: 'see' },
                { type: 'image', mimeType: 'image/png', data: 'abc' }
            ]
        }]);
        expect(out[0].content[1]).toEqual({
            type: 'image',
            source: { type: 'base64', media_type: 'image/png', data: 'abc' }
        });
    });
});

describe('pingModels', () => {
    test('unsaved non-mask key is sent; empty both is not configured', async () => {
        const missing = await pingModels({
            apiKey: '',
            getSecret: async () => '',
            getConfig: async () => ({}),
            fetch: async () => { throw new Error('should not fetch'); }
        });
        expect(missing).toEqual({
            configured: false,
            valid: false,
            message: 'Anthropic API key is not configured.'
        });

        let captured;
        const ok = await pingModels({
            apiKey: 'sk-ant-unsaved',
            endpoint: 'https://api.example.com/',
            getSecret: async () => 'sk-ant-stored',
            getConfig: async () => ({}),
            fetch: async (url, opts) => {
                captured = { url, opts };
                return { ok: true, status: 200 };
            }
        });
        expect(ok.valid).toBe(true);
        expect(captured.url).toBe('https://api.example.com/v1/models');
        expect(captured.opts.headers['x-api-key']).toBe('sk-ant-unsaved');
    });

    test('401 is configured but invalid', async () => {
        const result = await pingModels({
            apiKey: 'sk-ant-bad',
            getSecret: async () => '',
            getConfig: async () => ({}),
            fetch: async () => ({ ok: false, status: 401 })
        });
        expect(result).toEqual({
            configured: true,
            valid: false,
            message: 'Anthropic rejected the API key.'
        });
    });
});

describe('resolveVerifyApiKey', () => {
    test('unsaved non-mask wins', () => {
        expect(resolveVerifyApiKey('sk-ant-new', 'sk-ant-stored')).toBe('sk-ant-new');
    });

    test('mask or empty falls back to getSecret', () => {
        expect(resolveVerifyApiKey('********', 'sk-ant-stored')).toBe('sk-ant-stored');
        expect(resolveVerifyApiKey('', 'sk-ant-stored')).toBe('sk-ant-stored');
    });

    test('empty both is not configured', () => {
        expect(resolveVerifyApiKey('', '')).toBe('');
        expect(resolveVerifyApiKey('********', '')).toBe('');
        expect(resolveVerifyApiKey('********', '********')).toBe('');
    });
});

// EOF plugins/ai-anthropic/webapp/tests/unit/helpers.test.js
