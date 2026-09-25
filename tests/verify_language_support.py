#!/usr/bin/env python3
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
GRAMMAR = ROOT / "grammars" / "sultanc.tmLanguage.json"
SURFACE = ROOT / "metadata" / "syntax-surface.json"
LANGUAGE = ROOT / "metadata" / "language.json"
SAMPLES = ROOT / "linguist" / "samples"


def fail(message: str) -> None:
    raise SystemExit(message)


def main() -> None:
    grammar = json.loads(GRAMMAR.read_text(encoding="utf-8"))
    surface = json.loads(SURFACE.read_text(encoding="utf-8"))
    language = json.loads(LANGUAGE.read_text(encoding="utf-8"))

    if grammar.get("scopeName") != "source.sultanc":
        fail("TextMate scope must be source.sultanc")
    if grammar.get("fileTypes") != ["sn"]:
        fail("TextMate grammar must own .sn")
    if language.get("scopeName") != grammar.get("scopeName"):
        fail("language metadata and TextMate scope disagree")
    if language.get("extensions") != [".sn"]:
        fail("language metadata must identify .sn")

    guillemet = (grammar.get("repository") or {}).get("guillemetStrings") or {}
    if guillemet.get("begin") != "«" or guillemet.get("end") != "»|$":
        fail("guillemet raw-string delimiters are incorrect")
    if guillemet.get("patterns") != [{"include": "#guillemetStrings"}]:
        fail("guillemet raw strings must recursively support balanced nesting")
    if "escape" in json.dumps(guillemet, ensure_ascii=False).lower():
        fail("guillemet raw strings must not apply escape-string rules")
    generated = surface.get("generatedFrom") or {}
    if not generated.get("tokenRegistrySha256") or not generated.get("identifierPolicySha256"):
        fail("syntax surface is missing compiler-registry provenance")
    if not surface.get("keywords") or not surface.get("operators"):
        fail("syntax surface is incomplete")

    samples = sorted(SAMPLES.glob("*.sn"))
    if len(samples) < 3:
        fail("Linguist samples must cover Arabic, English, and bilingual SultanC")
    for sample in samples:
        text = sample.read_text(encoding="utf-8")
        if "\u202a" in text or "\u202b" in text or "\u202c" in text or "\u202d" in text or "\u202e" in text:
            fail(f"bidi embedding/override control found in {sample.name}")

    print(f"PASS: grammar={grammar['scopeName']} samples={len(samples)} keywords={len(surface['keywords'])} operators={len(surface['operators'])}")


if __name__ == "__main__":
    main()
