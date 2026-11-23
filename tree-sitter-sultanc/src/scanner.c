// External scanner for SultanC raw strings: «...» with balanced nesting.
// Backslashes and quotes inside have no special meaning
// (compiler/frontend/lexer/text.sn). The scanner is stateless: a raw string
// is always lexed from its opening «, so nothing needs serializing.

#include "tree_sitter/parser.h"

enum TokenType { RAW_STRING, RAW_STRING_ERROR };

#define OPEN 0x00AB   // «
#define CLOSE 0x00BB  // »

void *tree_sitter_sultanc_external_scanner_create(void) { return NULL; }
void tree_sitter_sultanc_external_scanner_destroy(void *payload) { (void)payload; }
unsigned tree_sitter_sultanc_external_scanner_serialize(void *payload, char *buffer) {
  (void)payload; (void)buffer;
  return 0;
}
void tree_sitter_sultanc_external_scanner_deserialize(void *payload, const char *buffer, unsigned length) {
  (void)payload; (void)buffer; (void)length;
}

bool tree_sitter_sultanc_external_scanner_scan(void *payload, TSLexer *lexer, const bool *valid_symbols) {
  (void)payload;
  if (!valid_symbols[RAW_STRING] || valid_symbols[RAW_STRING_ERROR]) return false;
  while (lexer->lookahead == ' ' || lexer->lookahead == '\t' || lexer->lookahead == '\n' ||
         lexer->lookahead == '\r') {
    lexer->advance(lexer, true);
  }
  if (lexer->lookahead != OPEN) return false;
  lexer->advance(lexer, false);
  unsigned depth = 1;
  while (depth > 0) {
    if (lexer->eof(lexer)) {
      // Unterminated: still a raw string, so the rest of the file is not
      // re-tokenized as code while the user is typing.
      lexer->result_symbol = RAW_STRING;
      lexer->mark_end(lexer);
      return true;
    }
    if (lexer->lookahead == OPEN) depth++;
    else if (lexer->lookahead == CLOSE) depth--;
    lexer->advance(lexer, false);
  }
  lexer->mark_end(lexer);
  lexer->result_symbol = RAW_STRING;
  return true;
}
