# Publishing the SultanC extension

The extension is published under the publisher / namespace `sultanc`
(`package.json` → `publisher`). Publishing is done by the project owner with
their own accounts; nothing here publishes automatically.

## Build the packages

The extension is published as platform-specific packages that bundle the
language server, as VS Code recommends for extensions with native executables,
plus one universal package without it.

```sh
cd editors/vscode
npm ci
npm test
# The server bundles, built by sultanc-analyzer's tools/dist.sh:
npm run package:platforms -- /path/to/sultanc-analyzer/dist
```

Output in `dist/`: `sultanc-<version>-{linux-x64,linux-arm64,darwin-x64,darwin-arm64,win32-x64,win32-arm64}.vsix`,
`sultanc-<version>.vsix` (universal, no server) and `SHA256SUMS`.
`npm run package` still builds the universal package alone.

## VS Code Marketplace

1. Create the publisher `sultanc` at https://marketplace.visualstudio.com/manage
   (sign in with a Microsoft account).
2. Create an Azure DevOps personal access token with the scope
   **Marketplace → Manage** (organization: All accessible organizations).
3. Publish:
   ```sh
   npx @vscode/vsce login sultanc        # paste the token
   npx @vscode/vsce publish --packagePath dist/sultanc-<version>-*.vsix dist/sultanc-<version>.vsix
   ```

## Open VSX (VSCodium, Cursor, Gitpod, Eclipse Theia)

1. Sign in at https://open-vsx.org with GitHub, sign the publisher agreement,
   and create an access token in your profile settings.
2. Create the namespace once, then publish:
   ```sh
   npx ovsx create-namespace sultanc -p <token>
   for f in dist/sultanc-<version>*.vsix; do npx ovsx publish "$f" -p <token>; done
   ```

## Before each release

- `version` in `package.json` raised, and a `CHANGELOG.md` entry for it.
- `npm test` and `npm run test:integration` pass against the current compiler.
- README images are referenced with relative paths (`images/...`); vsce turns
  them into links to this repository on GitHub, so they must be pushed to the
  `main` branch before publishing.
- The server bundles come from the same sultanc-analyzer release, built against
  the compiler checkout of that release; check one package with
  `SULTANC_BUNDLE=<bundle>.tar.gz SULTANC=<compiler> npm run test:integration`.
