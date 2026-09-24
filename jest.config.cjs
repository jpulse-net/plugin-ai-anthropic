/**
 * @name            jPulse Framework / Plugins / AI Anthropic / Jest Configuration
 * @tagline         Delegate Jest to the parent jPulse framework checkout
 * @description     Unit tests need that repo's Babel transform, globalSetup, and .jpulse/app.json
 * @file            plugins/ai-anthropic/jest.config.cjs
 * @version         1.0.2
 * @release         2026-09-24
 * @repository      https://github.com/jpulse-net/plugin-ai-anthropic
 * @author          Peter Thoeny, https://twiki.org & https://github.com/peterthoeny/
 * @copyright       2026 Peter Thoeny, https://twiki.org & https://github.com/peterthoeny/
 * @license         BSL 1.1 -- see LICENSE file; for commercial use: team@jpulse.net
 * @genai           80%, Cursor 3.20, Grok 4.6
 */

const fs = require('fs');
const path = require('path');

const frameworkRoot = path.resolve(__dirname, '../..');
const frameworkSetup = path.join(frameworkRoot, 'webapp/tests/setup/global-setup.mjs');
const frameworkPkg = path.join(frameworkRoot, 'package.json');

if (!fs.existsSync(frameworkSetup) || !fs.existsSync(frameworkPkg)) {
    throw new Error(
        'ai-anthropic unit tests need the jPulse framework as ../..\n' +
        'From this directory: npm test\n' +
        'From the framework root: npx jest plugins/ai-anthropic/webapp/tests/unit --runInBand'
    );
}

process.chdir(frameworkRoot);

module.exports = {
    rootDir: frameworkRoot,
    transform: {
        '^.+\\.js$': [
            'babel-jest',
            { configFile: path.join(frameworkRoot, 'babel.config.cjs') }
        ]
    },
    testMatch: [
        '<rootDir>/plugins/ai-anthropic/webapp/tests/**/*.test.js'
    ],
    testEnvironment: 'node',
    setupFiles: [
        '<rootDir>/webapp/tests/setup/env-setup.js'
    ],
    globalSetup: '<rootDir>/webapp/tests/setup/global-setup.mjs',
    globalTeardown: '<rootDir>/webapp/tests/setup/global-teardown.mjs'
};

// EOF plugins/ai-anthropic/jest.config.cjs
