#!/usr/bin/env node
'use strict';

// Builds the platform-specific packages of the extension, as VS Code
// distributes extensions that ship native executables
// (https://code.visualstudio.com/api/working-with-extensions/publishing-extension#platformspecific-extensions):
// one .vsix per platform with the language server bundled, plus one universal
// .vsix without it (for platforms that have no bundle; it uses a server the
// user builds or names in `sultanc.server.path`).
//
//   node tools/package-platforms.js DIST_DIR [VSCODE_TARGET...]
//
// DIST_DIR holds the bundles `sultanc-analyzer/tools/dist.sh` writes:
// sultanc-analyzer-<version>-<compiler target>.tar.gz. Each one is unpacked into
// ./sultanc/ (build/sultanc-analyzer, library/, and build/sultanc when bundled),
// where src/serverLocator.js finds it, then packaged with
// `vsce package --target`. Output: dist/sultanc-<version>-<target>.vsix and
// dist/SHA256SUMS.

const childProcess = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// VS Code target -> SultanC compiler target (`sultanc targets`).
const TARGETS = {
    'linux-x64': 'x86_64-linux',
    'linux-arm64': 'aarch64-linux-gnu',
    'darwin-x64': 'x86_64-darwin',
    'darwin-arm64': 'arm64-darwin',
    'win32-x64': 'x86_64-windows-msvc',
    'win32-arm64': 'aarch64-windows-msvc',
};

function run(command, args, options = {}) {
    const result = childProcess.spawnSync(command, args, { stdio: 'inherit', ...options });
    if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed (${result.status})`);
}

function sha256(file) {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function main() {
    const [distArg, ...wanted] = process.argv.slice(2);
    if (!distArg) {
        console.error('usage: node tools/package-platforms.js DIST_DIR [VSCODE_TARGET...]');
        process.exit(2);
    }
    const root = path.resolve(__dirname, '..');
    const bundles = path.resolve(distArg);
    const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    const out = path.join(root, 'dist');
    const staging = path.join(root, 'sultanc');
    fs.mkdirSync(out, { recursive: true });

    run('node', ['tools/sync-grammar.js'], { cwd: root });
    run('npm', ['run', 'bundle'], { cwd: root });

    const vsce = ['--yes', '@vscode/vsce@3', 'package', '--no-dependencies'];
    const made = [];
    const targets = wanted.length ? wanted : Object.keys(TARGETS);
    try {
        for (const target of targets) {
            const compilerTarget = TARGETS[target];
            if (!compilerTarget) throw new Error(`unknown VS Code target ${target}`);
            const archive = fs.readdirSync(bundles).find((name) => name.startsWith('sultanc-analyzer-') && name.endsWith(`-${compilerTarget}.tar.gz`));
            if (!archive) throw new Error(`no sultanc-analyzer bundle for ${compilerTarget} in ${bundles}`);
            fs.rmSync(staging, { recursive: true, force: true });
            fs.mkdirSync(staging);
            run('tar', ['-xzf', path.join(bundles, archive), '-C', staging, '--strip-components=1']);
            const server = path.join(staging, 'build', target.startsWith('win32') ? 'sultanc-analyzer.exe' : 'sultanc-analyzer');
            if (!fs.existsSync(server)) throw new Error(`${archive} has no ${path.relative(staging, server)}`);
            if (!fs.existsSync(path.join(staging, 'library', 'std'))) throw new Error(`${archive} has no library/std`);
            const file = path.join(out, `sultanc-${version}-${target}.vsix`);
            run('npx', [...vsce, '--target', target, '--out', file], { cwd: root });
            made.push(file);
        }
    } finally {
        fs.rmSync(staging, { recursive: true, force: true });
    }
    // The universal package: no bundled server.
    const universal = path.join(out, `sultanc-${version}.vsix`);
    run('npx', [...vsce, '--out', universal], { cwd: root });
    made.push(universal);

    const sums = made.map((file) => `${sha256(file)}  ${path.basename(file)}`).join('\n') + '\n';
    fs.writeFileSync(path.join(out, 'SHA256SUMS'), sums);
    process.stdout.write(sums);
}

main();
