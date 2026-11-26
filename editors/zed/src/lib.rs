//! Zed extension for SultanC: the tree-sitter grammar comes from
//! ../../tree-sitter-sultanc (see extension.toml); this crate only tells Zed
//! how to start sultanc-analyzer.
//!
//! The server finds its standard library next to itself, as the compiler
//! does (`<bin>/../lib/sultanc/library` in the toolchain, `<bin>/../library`
//! in a checkout's build/), so it starts from any directory. Resolution order:
//!
//! 1. `lsp.sultanc-analyzer.binary` in Zed settings (path, arguments, env);
//! 2. `sultanc-analyzer` on PATH (the toolchain's ~/.supax/bin);
//! 3. `$SUPAX_HOME/bin/sultanc-analyzer`, else `~/.supax/bin/sultanc-analyzer`;
//! 4. `$SULTANC_HOME/build/sultanc-analyzer` (a checkout).

use zed_extension_api::{self as zed, settings::LspSettings, LanguageServerId, Result};

const SERVER: &str = "sultanc-analyzer";

struct SultanC;

impl zed::Extension for SultanC {
    fn new() -> Self {
        SultanC
    }

    fn language_server_command(
        &mut self,
        _id: &LanguageServerId,
        worktree: &zed::Worktree,
    ) -> Result<zed::Command> {
        let mut env: Vec<(String, String)> = worktree.shell_env();
        let settings = LspSettings::for_worktree(SERVER, worktree).unwrap_or_default();
        let binary = settings.binary;
        if let Some(extra) = binary.as_ref().and_then(|b| b.env.clone()) {
            env.extend(extra);
        }
        let lookup = |key: &str| env.iter().rev().find(|(k, _)| k == key).map(|(_, v)| v.clone());
        let args = binary.as_ref().and_then(|b| b.arguments.clone()).unwrap_or_default();

        if let Some(path) = binary.as_ref().and_then(|b| b.path.clone()) {
            return Ok(zed::Command { command: path, args, env });
        }
        if let Some(path) = worktree.which(SERVER) {
            return Ok(zed::Command { command: path, args, env });
        }
        let toolchain = lookup("SUPAX_HOME").or_else(|| lookup("HOME").map(|home| format!("{home}/.supax")));
        let mut candidates: Vec<String> = Vec::new();
        if let Some(prefix) = toolchain {
            candidates.push(format!("{prefix}/bin/{SERVER}"));
        }
        if let Some(home) = lookup("SULTANC_HOME") {
            candidates.push(format!("{home}/build/{SERVER}"));
        }
        // Zed's extension API cannot test a path outside the worktree, so the
        // first candidate is started; Zed reports it if it does not exist.
        if let Some(path) = candidates.into_iter().next() {
            return Ok(zed::Command { command: path, args, env });
        }
        Err(format!(
            "SultanC: install {SERVER} into the SultanC toolchain (sultanc-analyzer/tools/install.sh), \
             put it on PATH, or set lsp.{SERVER}.binary.path in Zed settings"
        ))
    }

    fn language_server_initialization_options(
        &mut self,
        _id: &LanguageServerId,
        worktree: &zed::Worktree,
    ) -> Result<Option<zed::serde_json::Value>> {
        Ok(LspSettings::for_worktree(SERVER, worktree).ok().and_then(|s| s.initialization_options))
    }

    fn language_server_workspace_configuration(
        &mut self,
        _id: &LanguageServerId,
        worktree: &zed::Worktree,
    ) -> Result<Option<zed::serde_json::Value>> {
        Ok(LspSettings::for_worktree(SERVER, worktree).ok().and_then(|s| s.settings))
    }
}

zed::register_extension!(SultanC);
