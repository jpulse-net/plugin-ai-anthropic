/**
 * @name            jPulse Framework / Plugins / AI Anthropic / Tests / Unit / Descriptor
 * @tagline         Published onAiProviderRegister shape and configured flag
 * @file            plugins/ai-anthropic/webapp/tests/unit/descriptor.test.js
 * @version         1.0.1
 * @release         2026-09-19
 * @repository      https://github.com/jpulse-net/plugin-ai-anthropic
 * @author          Peter Thoeny, https://twiki.org & https://github.com/peterthoeny/
 * @copyright       2026 Peter Thoeny, https://twiki.org & https://github.com/peterthoeny/
 * @license         BSL 1.1 -- see LICENSE file; for commercial use: team@jpulse.net
 * @genai           80%, Cursor 3.20, Grok 4.6
 */

import { describe, expect, test } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import AiAnthropicController, {
    buildProviderDescriptor,
    PRICE_TABLE
} from '../../controller/aiAnthropic.js';

describe('provider descriptor', () => {
    test('plugin, vision capability, and $/MTok prices', async () => {
        const desc = await buildProviderDescriptor({
            getSecret: async () => 'sk-ant-present',
            getConfig: async () => ({})
        });
        expect(desc.plugin).toBe('ai-anthropic');
        expect(desc.id).toBeUndefined();
        expect(desc.capabilities).toEqual({ vision: true });
        expect(desc.supportsVision).toBeUndefined();
        expect(desc.configured).toBe(true);
        expect(desc.priceTable['claude-sonnet-5']).toEqual(PRICE_TABLE['claude-sonnet-5']);
        expect(desc.priceTable['claude-sonnet-5'].input).toBe(2);
        expect(desc.models.map((m) => m.id)).toEqual([
            'claude-sonnet-5',
            'claude-haiku-4-5',
            'claude-opus-5',
            'claude-fable-5-1'
        ]);
    });

    test('configured follows the stored key', async () => {
        const withKey = await buildProviderDescriptor({
            getSecret: async () => 'sk-ant-present',
            getConfig: async () => ({})
        });
        const empty = await buildProviderDescriptor({
            getSecret: async () => '',
            getConfig: async () => ({})
        });
        const mask = await buildProviderDescriptor({
            getSecret: async () => '********',
            getConfig: async () => ({})
        });
        expect(withKey.configured).toBe(true);
        expect(empty.configured).toBe(false);
        expect(mask.configured).toBe(false);
    });

    test('override JSON is merged on the registered table', async () => {
        const desc = await buildProviderDescriptor({
            getSecret: async () => '',
            getConfig: async () => ({
                priceTableOverride: JSON.stringify({
                    'claude-sonnet-5': { output: 99 }
                })
            })
        });
        expect(desc.priceTable['claude-sonnet-5'].output).toBe(99);
        expect(desc.priceTable['claude-sonnet-5'].input).toBe(2);
    });

    test('maxTokens from config is on the descriptor', async () => {
        const desc = await buildProviderDescriptor({
            getSecret: async () => 'sk-ant-present',
            getConfig: async () => ({ maxTokens: 4096 })
        });
        expect(desc.maxTokens).toBe(4096);
    });

    test('onAiProviderRegister pushes one descriptor', async () => {
        const ctx = { providers: [] };
        await AiAnthropicController.onAiProviderRegister(ctx);
        expect(ctx.providers).toHaveLength(1);
        expect(ctx.providers[0].plugin).toBe('ai-anthropic');
        expect(ctx.providers[0].capabilities.vision).toBe(true);
    });

    test('imports PluginModel by path and never assigns global.PluginModel', () => {
        const src = fs.readFileSync(
            path.resolve(process.cwd(), 'plugins/ai-anthropic/webapp/controller/aiAnthropic.js'),
            'utf8'
        );
        expect(src).toMatch(/webapp\/model\/plugin\.js/);
        expect(src).not.toMatch(/global\.PluginModel\s*=/);
        expect(src).not.toMatch(/from ['"].*plugins\/ai-core/);
        const dest = path.resolve(
            process.cwd(),
            'plugins/ai-anthropic/webapp/controller',
            '../../../../webapp/model/plugin.js'
        );
        expect(fs.existsSync(dest)).toBe(true);
    });
});

// EOF plugins/ai-anthropic/webapp/tests/unit/descriptor.test.js
