# Publishing the SultanC extension

The extension is published under the publisher / namespace `sultanc`
(`package.json` → `publisher`). Publishing is done by the project owner with
their own accounts; nothing here publishes automatically.

## Build the package

One package for every platform: the extension has no native executables. It
uses the SultanC toolchain the user installed (the compiler and
sultanc-analyzer in `~/.supax/bin`).

```sh
cd editors/vscode
npm ci
npm test
npm run package          # dist/sultanc.vsix
```

## VS Code Marketplace

1. Create the publisher `sultanc` at https://marketplace.visualstudio.com/manage
   (sign in with a Microsoft account).
2. Create an Azure DevOps personal access token with the scope
   **Marketplace → Manage** (organization: All accessible organizations).
3. Publish:
   ```sh
   npx @vscode/vsce login sultanc        # paste the token
   npx @vscode/vsce publish --packagePath dist/sultanc.vsix
   ```

## Open VSX (VSCodium, Cursor, Gitpod, Eclipse Theia)

1. Sign in at https://open-vsx.org with GitHub, sign the publisher agreement,
   and create an access token in your profile settings.
2. Create the namespace once, then publish:
   ```sh
   npx ovsx create-namespace sultanc -p <token>
   npx ovsx publish dist/sultanc.vsix -p <token>
   ```

## Before each release

- `version` in `package.json` raised, and a `CHANGELOG.md` entry for it.
- `npm test` and `npm run test:integration` pass against the current compiler.
- README images are referenced with relative paths (`images/...`); vsce turns
  them into links to this repository on GitHub, so they must be pushed to the
  `main` branch before publishing.
- The extension carries no server: users install sultanc-analyzer into their
  SultanC toolchain (its README, "Install").
