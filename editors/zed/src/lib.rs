//! Zed extension for SultanC: the tree-sitter grammar comes from
//! ../../tree-sitter-sultanc (see extension.toml); this crate only tells Zed
//! how to start sultanc-lsp.
//!
//! The server must run from the SultanC home (the compiler finds the standard
//! library as `library/Supax.toml` relative to its working directory), and
//! Zed's `Command` has no working-directory field. Resolution order:
//!
//! 1. `lsp.sultanc-lsp.binary` in Zed settings (path, arguments, env);
//! 2. `sultanc-lsp-editor` on PATH (sultanc-lsp/tools/sultanc-lsp-editor.sh);
//! 3. `SULTANC_HOME` in the worktree's shell environment, started through
//!    `/bin/sh` so the server runs from that directory (macOS and Linux).

use std::collections::HashMap;
use zed_extension_api::{self as zed, settings::LspSettings, LanguageServerId, Result};

const SERVER: &str = "sultanc-lsp";
const WRAPPER: &str = "sultanc-lsp-editor";

struct SultanC;

fn shell_start(home: &str, server: Option<&str>) -> (String, Vec<String>) {
    // The paths travel as positional parameters, never spliced into the script.
    let script = r#"cd "$1" && exec "${2:-$1/build/sultanc-lsp}""#;
    (
        "/bin/sh".to_string(),
        vec![
            "-c".to_string(),
            script.to_string(),
            "sultanc-lsp".to_string(),
            home.to_string(),
            server.unwrap_or("").to_string(),
        ],
    )
}

impl zed::Extension for SultanC {
    fn new() -> Self {
        SultanC
    }

    fn language_server_command(
        &mut self,
        _id: &LanguageServerId,
        worktree: &zed::Worktree,
    ) -> Result<zed::Command> {
        let shell: HashMap<String, String> = worktree.shell_env().into_iter().collect();
        let settings = LspSettings::for_worktree(SERVER, worktree).unwrap_or_default();
        let binary = settings.binary;
        let mut env: Vec<(String, String)> = shell.clone().into_iter().collect();
        if let Some(extra) = binary.as_ref().and_then(|b| b.env.clone()) {
            env.extend(extra);
        }
        let lookup = |key: &str| env.iter().rev().find(|(k, _)| k == key).map(|(_, v)| v.clone());

        if let Some(path) = binary.as_ref().and_then(|b| b.path.clone()) {
            let args = binary.as_ref().and_then(|b| b.arguments.clone()).unwrap_or_default();
            if let Some(home) = lookup("SULTANC_HOME") {
                let (command, mut sh_args) = shell_start(&home, Some(&path));
                sh_args.extend(args);
                return Ok(zed::Command { command, args: sh_args, env });
            }
            return Ok(zed::Command { command: path, args, env });
        }
        if let Some(wrapper) = worktree.which(WRAPPER) {
            return Ok(zed::Command { command: wrapper, args: vec![], env });
        }
        if let Some(home) = lookup("SULTANC_HOME") {
            let server = lookup("SULTANC_LSP");
            let (command, args) = shell_start(&home, server.as_deref());
            return Ok(zed::Command { command, args, env });
        }
        Err(format!(
            "SultanC: set SULTANC_HOME to your SultanC checkout, put {WRAPPER} on PATH, \
             or set lsp.{SERVER}.binary.path in Zed settings"
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
