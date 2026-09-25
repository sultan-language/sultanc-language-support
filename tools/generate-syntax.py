#!/usr/bin/env python3
"""Generate SultanC editor metadata from compiler-owned lexical registries.

The compiler remains the only syntax authority. This script intentionally
contains presentation classifications only; it never invents keyword/operator
spellings. Both the VS Code extension and GitHub TextMate grammar are generated
from the same registry input.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path
from typing import Iterable, Sequence

TOKEN_RE = re.compile(r'^SULTANC__TOKEN__\(\s*([A-Z0-9_]+)\s*,\s*"([^"]*)"\s*,\s*([A-Za-z_]+)\s*,\s*([A-Za-z_]+)\s*,\s*([A-Za-z_]+)\s*\)')
KEYWORD_RE = re.compile(r'^SULTANC__KEYWORD__\(\s*([A-Z0-9_]+)\s*,\s*"([^"]*)"\s*,\s*"([^"]*)"\s*\)')
BOOL_RE = re.compile(r'^SULTANC__BOOL_KEYWORD__\(\s*"([^"]*)"\s*,\s*"([^"]*)"\s*,\s*([01])\s*\)')
OPERATOR_RE = re.compile(r'^SULTANC__OPERATOR__\(\s*([A-Z0-9_]+)\s*,\s*"([^"]*)"\s*\)')
IGNORED_RE = re.compile(r'SULTANC__IDENTIFIER_IGNORED_SCALAR__\(0x([0-9A-Fa-f]+)\)')
START_RANGE_RE = re.compile(r'SULTANC__IDENTIFIER_START_RANGE__\(0x([0-9A-Fa-f]+),\s*0x([0-9A-Fa-f]+)\)')
START_SCALAR_RE = re.compile(r'SULTANC__IDENTIFIER_START_SCALAR__\(0x([0-9A-Fa-f]+)\)')
REST_RANGE_RE = re.compile(r'SULTANC__IDENTIFIER_REST_RANGE__\(0x([0-9A-Fa-f]+),\s*0x([0-9A-Fa-f]+)\)')
REST_SCALAR_RE = re.compile(r'SULTANC__IDENTIFIER_REST_SCALAR__\(0x([0-9A-Fa-f]+)\)')

# Editor-only semantic presentation groups. Spellings still come exclusively
# from token_registry.def.
CONTROL = {"IF", "ELSE", "RETURN", "WHILE", "MATCH", "WITH"}
DECLARATION = {"FUNCTION_DEF", "LET", "TYPE", "ALIAS"}
MODULE = {"FROM", "IMPORT"}
MODIFIER = {"EXTERN", "UNSAFE", "MUTABLE", "PUBLIC"}
TYPE_KEYWORDS = {
    "FUNCTION_TYPE", "ANY", "BOOL", "STRING", "CHAR",
    "INT", "UINT", "FLOAT", "VOID", "I8", "I16", "I32", "I64", "U8",
    "U16", "U32", "U64", "F32", "F64", "SLICE_OPERATOR", "BOX_OPERATOR",
}
WORD_OPERATORS = {"OF", "AS"}
LITERAL_KEYWORDS = {"LIT_UNDEF"}
SPECIAL = {"ASSEMBLY"}
DECLARATION_NAME_KIND = {"FUNCTION_DEF": "function", "TYPE": "type", "LET": "variable", "ALIAS": "type"}


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def classify(token: str) -> str:
    if token in CONTROL: return "control"
    if token in DECLARATION: return "declaration"
    if token in MODULE: return "module"
    if token in MODIFIER: return "modifier"
    if token in TYPE_KEYWORDS: return "type"
    if token in WORD_OPERATORS: return "wordOperator"
    if token in LITERAL_KEYWORDS: return "literal"
    if token in SPECIAL: return "special"
    return "keyword"


def parse_ranges(pattern: re.Pattern[str], source: str) -> list[tuple[int, int]]:
    return [(int(a, 16), int(b, 16)) for a, b in pattern.findall(source)]


def parse_scalars(pattern: re.Pattern[str], source: str) -> list[int]:
    return [int(value, 16) for value in pattern.findall(source)]


def parse_identifier_policy(path: Path) -> dict:
    source = path.read_text(encoding="utf-8")
    start_ranges = parse_ranges(START_RANGE_RE, source)
    start_scalars = parse_scalars(START_SCALAR_RE, source)
    if not start_ranges and not start_scalars:
        raise SystemExit("identifier policy has no identifier-start declarations")
    return {
        "source": source,
        "sha256": sha256_text(source),
        "ignored": parse_scalars(IGNORED_RE, source),
        "startRanges": start_ranges,
        "startScalars": start_scalars,
        "restRanges": parse_ranges(REST_RANGE_RE, source),
        "restScalars": parse_scalars(REST_SCALAR_RE, source),
    }


def parse_registry(path: Path, policy: dict) -> dict:
    source = path.read_text(encoding="utf-8")
    tokens: dict[str, dict] = {}
    keywords: list[dict] = []
    booleans: list[dict] = []
    operators: list[dict] = []

    for raw in source.splitlines():
        line = raw.strip()
        if match := TOKEN_RE.match(line):
            name, selfhost, lexical_class, lifecycle, payload = match.groups()
            tokens[name] = {
                "name": name,
                "selfhostName": selfhost,
                "lexicalClass": lexical_class,
                "lifecycle": lifecycle,
                "payload": payload,
            }
        elif match := KEYWORD_RE.match(line):
            name, english, arabic = match.groups()
            keywords.append({"token": name, "english": english, "arabic": arabic})
        elif match := BOOL_RE.match(line):
            english, arabic, value = match.groups()
            booleans.append({"english": english, "arabic": arabic, "value": int(value)})
        elif match := OPERATOR_RE.match(line):
            name, spelling = match.groups()
            operators.append({"token": name, "spelling": spelling})

    if not tokens or not keywords or not operators:
        raise SystemExit("token registry appears incomplete")
    missing = [entry["token"] for entry in keywords + operators if entry["token"] not in tokens]
    if missing:
        raise SystemExit(f"registry references unknown token(s): {missing}")

    groups = {name: [] for name in (
        "control", "declaration", "module", "modifier", "type", "wordOperator",
        "special", "keyword", "literal", "reserved",
    )}
    keyword_entries: list[dict] = []
    declaration_names: dict[str, str] = {}
    all_spellings: list[str] = []

    for entry in keywords:
        lifecycle = tokens[entry["token"]]["lifecycle"]
        group = "reserved" if lifecycle == "Future_Reserved" else classify(entry["token"])
        full = {**entry, "group": group, "lifecycle": lifecycle}
        keyword_entries.append(full)
        for spelling in (entry["english"], entry["arabic"]):
            groups[group].append(spelling)
            all_spellings.append(spelling)
            if entry["token"] in DECLARATION_NAME_KIND:
                declaration_names[spelling] = DECLARATION_NAME_KIND[entry["token"]]

    for entry in booleans:
        for spelling in (entry["english"], entry["arabic"]):
            groups["literal"].append(spelling)
            all_spellings.append(spelling)

    duplicates = sorted({value for value in all_spellings if all_spellings.count(value) > 1})
    if duplicates:
        raise SystemExit(f"duplicate canonical keyword spelling(s): {duplicates}")

    for values in groups.values():
        values[:] = sorted(dict.fromkeys(values), key=lambda item: (-len(item), item))

    range_objects = lambda ranges: [{"start": a, "end": b} for a, b in ranges]
    return {
        "schemaVersion": 1,
        "generatedFrom": {
            "tokenRegistry": str(path.name),
            "tokenRegistrySha256": sha256_text(source),
            "identifierPolicy": str("identifier_policy_registry.def"),
            "identifierPolicySha256": policy["sha256"],
        },
        "identifierPolicy": {
            "ignoredCodepoints": policy["ignored"],
            "startRanges": range_objects(policy["startRanges"]),
            "startScalars": policy["startScalars"],
            "restRanges": range_objects(policy["restRanges"]),
            "restScalars": policy["restScalars"],
        },
        "keywords": keyword_entries,
        "booleanLiterals": booleans,
        "groups": groups,
        "declarationNames": declaration_names,
        "operators": [entry["spelling"] for entry in operators],
        "operatorEntries": operators,
    }


def onig_scalar(value: int) -> str:
    return rf"\x{{{value:X}}}"


def onig_class(ranges: Sequence[tuple[int, int]], scalars: Sequence[int]) -> str:
    pieces = [rf"{onig_scalar(a)}-{onig_scalar(b)}" for a, b in ranges]
    pieces += [onig_scalar(value) for value in scalars]
    return "[" + "".join(pieces) + "]"


def flexible_spelling(word: str, ignored: Sequence[int]) -> str:
    """Match keyword spellings under compiler identifier identity (e.g. Kashida)."""
    if not ignored:
        return re.escape(word)
    gap = "(?:" + "|".join(onig_scalar(value) for value in ignored) + ")*"
    return gap + gap.join(re.escape(char) for char in word) + gap


def alternation(words: Iterable[str], ignored: Sequence[int]) -> str:
    parts = [flexible_spelling(word, ignored) for word in words]
    parts.sort(key=lambda item: (-len(item), item))
    return "(?:" + "|".join(parts) + ")"


def bounded(words: Iterable[str], ignored: Sequence[int], identifier_rest: str) -> str:
    return rf"(?<!{identifier_rest}){alternation(words, ignored)}(?!{identifier_rest})"


def operator_regex(operators: Iterable[str]) -> str:
    values = sorted(dict.fromkeys(operators), key=lambda item: (-len(item), item))
    return "(?:" + "|".join(re.escape(value) for value in values) + ")"


def declaration_pattern(surface: dict, tokens: set[str], keyword_scope: str, name_scope: str,
                        ignored: Sequence[int], start_class: str, rest_class: str) -> dict:
    words: list[str] = []
    for entry in surface["keywords"]:
        if entry["token"] in tokens:
            words.extend([entry["english"], entry["arabic"]])
    identifier = rf"{start_class}{rest_class}*"
    return {
        "match": rf"({bounded(words, ignored, rest_class)})\s+({identifier})",
        "captures": {"1": {"name": keyword_scope}, "2": {"name": name_scope}},
    }


def generate_grammar(surface: dict) -> dict:
    policy = surface["identifierPolicy"]
    ignored = policy["ignoredCodepoints"]
    start_ranges = [(x["start"], x["end"]) for x in policy["startRanges"]]
    rest_ranges = [(x["start"], x["end"]) for x in policy["restRanges"]]
    start_scalars = list(policy["startScalars"]) + list(ignored)
    rest_scalars = list(policy["restScalars"]) + start_scalars
    start_class = onig_class(start_ranges, start_scalars)
    rest_class = onig_class(start_ranges + rest_ranges, rest_scalars)

    patterns: list[dict] = [
        {"include": "#comments"},
        {"include": "#guillemetStrings"},
        {"include": "#doubleStrings"},
        {"include": "#characters"},
        declaration_pattern(surface, {"FUNCTION_DEF"}, "storage.type.function.sultanc", "entity.name.function.sultanc", ignored, start_class, rest_class),
        declaration_pattern(surface, {"TYPE", "ALIAS"}, "storage.type.type.sultanc", "entity.name.type.sultanc", ignored, start_class, rest_class),
        declaration_pattern(surface, {"LET"}, "storage.type.variable.sultanc", "variable.other.readwrite.sultanc", ignored, start_class, rest_class),
        {"name": "constant.numeric.hex.sultanc", "match": rf"(?<!{rest_class})0[xX][0-9A-Fa-f](?:_?[0-9A-Fa-f])*(?!{rest_class})"},
        {"name": "constant.numeric.binary.sultanc", "match": rf"(?<!{rest_class})0[bB][01](?:_?[01])*(?!{rest_class})"},
        {"name": "constant.numeric.float.sultanc", "match": rf"(?<!{rest_class})[0-9](?:_?[0-9])*\.[0-9](?:_?[0-9])*(?:[eE][+-]?[0-9](?:_?[0-9])*)?(?!{rest_class})"},
        {"name": "constant.numeric.integer.sultanc", "match": rf"(?<!{rest_class})[0-9](?:_?[0-9])*(?!{rest_class})"},
    ]

    scope_for_group = {
        "control": "keyword.control.sultanc",
        "declaration": "storage.type.declaration.sultanc",
        "module": "keyword.control.import.sultanc",
        "modifier": "storage.modifier.sultanc",
        "type": "support.type.sultanc",
        "wordOperator": "keyword.operator.word.sultanc",
        "special": "keyword.other.special.sultanc",
        "literal": "constant.language.sultanc",
        "reserved": "keyword.other.reserved.sultanc",
        "keyword": "keyword.other.sultanc",
    }
    for group, scope in scope_for_group.items():
        if surface["groups"][group]:
            patterns.append({"name": scope, "match": bounded(surface["groups"][group], ignored, rest_class)})
    patterns.append({"name": "keyword.operator.sultanc", "match": operator_regex(surface["operators"])})

    string_escape = r'\\(?:[nrt\\"]|x[0-9A-Fa-f]{2}|u[0-9A-Fa-f]{4}|U[0-9A-Fa-f]{8})'
    char_escape = r"\\(?:[nrt\\']|x[0-9A-Fa-f]{2}|u[0-9A-Fa-f]{4}|U[0-9A-Fa-f]{8})"
    return {
        "$schema": "https://raw.githubusercontent.com/martinring/tmlanguage/master/tmlanguage.json",
        "name": "SultanC",
        "scopeName": "source.sultanc",
        "fileTypes": ["sn"],
        "patterns": patterns,
        "repository": {
            "comments": {"patterns": [{
                "name": "comment.line.double-slash.sultanc",
                "begin": "//",
                "beginCaptures": {"0": {"name": "punctuation.definition.comment.sultanc"}},
                "end": "$",
            }]},
            "stringEscapes": {"patterns": [{"name": "constant.character.escape.sultanc", "match": string_escape}]},
            "characterEscapes": {"patterns": [{"name": "constant.character.escape.sultanc", "match": char_escape}]},
            "guillemetStrings": {
                "name": "string.quoted.other.guillemet.raw.sultanc",
                "begin": "«",
                "beginCaptures": {"0": {"name": "punctuation.definition.string.begin.sultanc"}},
                "end": "»|$",
                "endCaptures": {"0": {"name": "punctuation.definition.string.end.sultanc"}},
                # Recursive inclusion mirrors SultanC's balanced raw-string lexer:
                # nested «...» pairs are part of the same raw string and backslashes
                # have no escape meaning here.
                "patterns": [{"include": "#guillemetStrings"}],
            },
            "doubleStrings": {
                "name": "string.quoted.double.sultanc",
                "begin": '"',
                "beginCaptures": {"0": {"name": "punctuation.definition.string.begin.sultanc"}},
                "end": '"|$',
                "endCaptures": {"0": {"name": "punctuation.definition.string.end.sultanc"}},
                "patterns": [{"include": "#stringEscapes"}],
            },
            "characters": {
                "name": "constant.character.sultanc",
                "match": rf"'(?:{char_escape}|[^\\'\r\n])'",
            },
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("registry", type=Path, help="compiler token_registry.def")
    parser.add_argument("--identifier-policy", type=Path, required=True)
    parser.add_argument("--surface", type=Path, required=True)
    parser.add_argument("--grammar", type=Path, required=True)
    args = parser.parse_args()

    policy = parse_identifier_policy(args.identifier_policy)
    surface = parse_registry(args.registry, policy)
    grammar = generate_grammar(surface)
    args.surface.parent.mkdir(parents=True, exist_ok=True)
    args.grammar.parent.mkdir(parents=True, exist_ok=True)
    args.surface.write_text(json.dumps(surface, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    args.grammar.write_text(json.dumps(grammar, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"surface: {args.surface}")
    print(f"grammar: {args.grammar}")
    print(f"token registry sha256: {surface['generatedFrom']['tokenRegistrySha256']}")
    print(f"identifier policy sha256: {surface['generatedFrom']['identifierPolicySha256']}")


if __name__ == "__main__":
    main()
