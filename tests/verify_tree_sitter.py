#!/usr/bin/env python3
"""Verify the tree-sitter grammar against its fixtures and a SultanC checkout.

usage: verify_tree_sitter.py [/path/to/sultanc]

1. generated parser and editor queries are up to date;
2. `tree-sitter test` passes (corpus trees and highlight assertions);
3. with a checkout: every .sn file under library/ compiler/ examples/ tests/
   tools/ parses without ERROR/MISSING nodes, unless the compiler itself
   rejects it with a SULTANC-PARSE-* or SULTANC-LEX-* diagnostic. The only
   documented exception is Kashida inside a keyword (KASHIDA_KEYWORDS).

Set TREE_SITTER to the CLI (default: tree-sitter-sultanc/node_modules/.bin/tree-sitter).
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
GRAMMAR = ROOT / "tree-sitter-sultanc"
CLI = os.environ.get("TREE_SITTER") or str(GRAMMAR / "node_modules" / ".bin" / "tree-sitter")
# The compiler accepts Kashida inside keywords (identifier identity ignores
# U+0640); a string keyword token cannot. Exact files, exact rows.
KASHIDA_KEYWORDS = {"tests/ar/diagnostics/deprecated/while_old_spelling.sn": [12]}


def run(*args: str, **kw) -> subprocess.CompletedProcess:
    return subprocess.run(args, capture_output=True, text=True, **kw)


EDITS = [
    # (description, find, replace): applied at the first occurrence.
    ("insert an Arabic statement", "    أرجع", "    ليكن مؤقت: عدد = 1;\n    أرجع"),
    ("delete a semicolon", ";\n}", "\n}"),
    ("type inside a raw string", "«", "«يتم "),
    ("rename an identifier", "main", "main_2"),
    ("break then close a block", "{\n", "{\n    إذا (صواب) {\n"),
]


def incremental(env: dict, config: str) -> None:
    """An edited reparse (old tree reused) must equal a fresh parse."""
    samples = sorted((ROOT / "linguist" / "samples").glob("*.sn")) + sorted((GRAMMAR / "test" / "highlight").glob("*.sn"))
    checked = 0
    for sample in samples:
        text = sample.read_text(encoding="utf-8")
        for name, find, replace in EDITS:
            at = text.find(find)
            if at < 0:
                continue
            byte = len(text[:at].encode("utf-8"))
            edited = text[:at] + replace + text[at + len(find):]
            fresh_path = Path(config, "fresh.sn")
            fresh_path.write_text(edited, encoding="utf-8")
            edit_arg = f"{byte} {len(find.encode('utf-8'))} {replace}"
            inc = run(CLI, "parse", str(sample), "--edits", edit_arg, cwd=GRAMMAR, env=env)
            fresh = run(CLI, "parse", str(fresh_path), cwd=GRAMMAR, env=env)
            tree = lambda out: "\n".join(l for l in out.splitlines() if l.startswith((" ", "(")) and "\t" not in l)
            if tree(inc.stdout) != tree(fresh.stdout) or not tree(fresh.stdout):
                sys.exit(f"FAIL: incremental reparse differs ({sample.name}: {name})")
            checked += 1
    print(f"PASS: {checked} incremental edits reparse to the same tree as a fresh parse")


def main() -> None:
    env = dict(os.environ)
    config = tempfile.mkdtemp(prefix="ts-config-")
    Path(config, "config.json").write_text(json.dumps({"parser-directories": [str(ROOT)]}))
    env["TREE_SITTER_DIR"] = config

    before = (GRAMMAR / "src" / "parser.c").read_bytes()
    gen = run(CLI, "generate", cwd=GRAMMAR, env=env)
    if gen.returncode != 0:
        sys.exit(gen.stderr)
    if (GRAMMAR / "src" / "parser.c").read_bytes() != before:
        sys.exit("FAIL: src/parser.c was stale (regenerated; commit it)")
    queries = run(sys.executable, str(ROOT / "tools" / "generate-tree-sitter-queries.py"), "--check")
    if queries.returncode != 0:
        sys.exit("FAIL: " + queries.stderr.strip())

    test = run(CLI, "test", cwd=GRAMMAR, env=env)
    out = re.sub(r"\x1b\[[0-9;]*m", "", test.stdout + test.stderr)
    if test.returncode != 0 or "✗" in out:
        sys.exit("FAIL: tree-sitter test\n" + out)
    corpus = len(re.findall(r"✓", out))
    print(f"PASS: tree-sitter test ({corpus} checks)")

    incremental(env, config)

    if len(sys.argv) < 2:
        return
    home = Path(sys.argv[1]).resolve()
    compiler = home / "build" / "sultanc"
    files = sorted(p for d in ("library", "compiler", "examples", "tests", "tools")
                   for p in (home / d).rglob("*.sn"))
    listing = Path(config, "files.txt")
    listing.write_text("\n".join(map(str, files)))
    parsed = run(CLI, "parse", "-q", "--stat", "--paths", str(listing), cwd=GRAMMAR, env=env)
    failures: dict[str, list[int]] = {}
    for line in parsed.stdout.splitlines():
        m = re.match(r"(\S+)\s.*\((?:ERROR|MISSING[^\[]*) \[(\d+), \d+\]", line)
        if m:
            failures[str(Path(m.group(1)).relative_to(home))] = [int(m.group(2)) + 1]
    unexpected = []
    for rel, rows in sorted(failures.items()):
        if KASHIDA_KEYWORDS.get(rel) == rows:
            continue
        check = run(str(compiler), "check", str(home / rel), "--diagnostic-format=short", cwd=home)
        if not re.search(r"SULTANC-(PARSE|LEX)-", check.stdout + check.stderr):
            unexpected.append(f"{rel}:{rows[0]}")
    if unexpected:
        sys.exit("FAIL: tree-sitter errors in files the compiler parses:\n  " + "\n  ".join(unexpected))
    rejected = len(failures) - sum(1 for k in failures if k in KASHIDA_KEYWORDS)
    print(f"PASS: {len(files)} files; {len(files) - len(failures)} parse cleanly; "
          f"{rejected} are rejected by the compiler too; {len(KASHIDA_KEYWORDS)} Kashida keyword exception")


if __name__ == "__main__":
    main()
