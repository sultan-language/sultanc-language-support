'use strict';
// End-to-end test in a real VS Code (downloaded by @vscode/test-electron).
// Requires a built server: SULTANC_ANALYZER=/path/to/sultanc-analyzer SULTANC_HOME=/path/to/sultanc
const path = require('path');
const fs = require('fs');
const os = require('os');
const { runTests } = require('@vscode/test-electron');

async function main() {
    const server = process.env.SULTANC_ANALYZER;
    const home = process.env.SULTANC_HOME;
    if (!server || !home) throw new Error('Set SULTANC_ANALYZER and SULTANC_HOME.');
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'sultanc-vscode-'));
    fs.cpSync(path.join(__dirname, 'workspace'), workspace, { recursive: true });
    fs.mkdirSync(path.join(workspace, '.vscode'), { recursive: true });
    fs.writeFileSync(path.join(workspace, '.vscode', 'settings.json'), JSON.stringify({
        'sultanc.server.path': server,
        'sultanc.home': home,
        // The check on save checks this entry (flycheck/broken.sn is never opened).
        'sultanc.check.entries': ['flycheck/main.sn'],
        // The server's references lens (off by default, as in rust-analyzer).
        'sultanc.lens.references': true,
    }, null, 2));
    await runTests({
        version: process.env.VSCODE_VERSION || 'stable',
        extensionDevelopmentPath: path.resolve(__dirname, '..', '..'),
        extensionTestsPath: path.join(__dirname, 'suite.js'),
        launchArgs: [workspace, '--disable-extensions', '--disable-workspace-trust'],
    });
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
