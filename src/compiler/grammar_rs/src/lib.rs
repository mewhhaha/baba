use std::boxed::Box;
use std::string::{String, ToString};
use std::vec;
use std::vec::Vec;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct SourceSpan {
    pub start: usize,
    pub end: usize,
    pub line: usize,
    pub column: usize,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Diagnostic {
    pub code: &'static str,
    pub message: String,
    pub span: SourceSpan,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ParseResult {
    pub grammar: Option<GrammarDocument>,
    pub diagnostics: Vec<Diagnostic>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GrammarDocument {
    pub name: Option<String>,
    pub declarations: Vec<Declaration>,
    pub span: SourceSpan,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum Declaration {
    Token(TokenDeclaration),
    Mode(ModeDeclaration),
    Layout(LayoutDeclaration),
    Export(NamedDeclaration),
    Import(ImportDeclaration),
    Module(NamedDeclaration),
    Extend(ExtensionDeclaration),
    Rule(RuleDeclaration),
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TokenDeclaration {
    pub kind: TokenDeclarationKind,
    pub name: String,
    pub pattern: TerminalPattern,
    pub priority: Option<u32>,
    pub channel: Option<String>,
    pub mode: Option<String>,
    pub transition: Option<ModeTransition>,
    pub span: SourceSpan,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum TokenDeclarationKind {
    Token,
    Skip,
    Contextual,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ModeTransition {
    Push { mode: String, span: SourceSpan },
    Mode { mode: String, span: SourceSpan },
    Pop { span: SourceSpan },
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ModeDeclaration {
    pub name: String,
    pub declarations: Vec<TokenDeclaration>,
    pub span: SourceSpan,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LayoutDeclaration {
    pub name: String,
    pub expression: Expression,
    pub span: SourceSpan,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct NamedDeclaration {
    pub name: String,
    pub span: SourceSpan,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ImportDeclaration {
    pub source: String,
    pub span: SourceSpan,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ExtensionDeclaration {
    pub target: String,
    pub expression: Expression,
    pub span: SourceSpan,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RuleDeclaration {
    pub name: String,
    pub annotations: Vec<RuleAnnotation>,
    pub expression: Expression,
    pub span: SourceSpan,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum RuleAnnotation {
    Sync {
        expression: Expression,
        span: SourceSpan,
    },
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum TerminalPattern {
    Regex { pattern: String, span: SourceSpan },
    Literal { value: String, span: SourceSpan },
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum Expression {
    Field {
        name: String,
        expression: Box<Expression>,
        span: SourceSpan,
    },
    Ref {
        name: String,
        span: SourceSpan,
    },
    Literal {
        value: String,
        span: SourceSpan,
    },
    Sequence {
        items: Vec<Expression>,
        span: SourceSpan,
    },
    Choice {
        options: Vec<Expression>,
        span: SourceSpan,
    },
    Optional {
        expression: Box<Expression>,
        span: SourceSpan,
    },
    Repeat {
        expression: Box<Expression>,
        span: SourceSpan,
    },
    Repeat1 {
        expression: Box<Expression>,
        span: SourceSpan,
    },
    Separated {
        item: Box<Expression>,
        separator: Box<Expression>,
        span: SourceSpan,
    },
    Constructor {
        expression: Box<Expression>,
        name: String,
        arguments: Vec<String>,
        span: SourceSpan,
    },
    ExpressionIsland {
        atom: Box<Expression>,
        operators: Vec<ExpressionOperator>,
        span: SourceSpan,
    },
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ExpressionOperator {
    pub kind: ExpressionOperatorKind,
    pub associativity: Option<Associativity>,
    pub precedence: u32,
    pub token: TerminalPattern,
    pub span: SourceSpan,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ExpressionOperatorKind {
    Infix,
    Prefix,
    Postfix,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Associativity {
    Left,
    Right,
    None,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum TokenKind {
    Identifier,
    Literal,
    Number,
    Regex,
    Symbol,
    Arrow,
    Eof,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct Token {
    kind: TokenKind,
    text: String,
    span: SourceSpan,
}

struct Lexer<'a> {
    source: &'a str,
    line_starts: Vec<usize>,
    tokens: Vec<Token>,
    diagnostics: Vec<Diagnostic>,
    index: usize,
}

struct Parser {
    tokens: Vec<Token>,
    line_starts: Vec<usize>,
    diagnostics: Vec<Diagnostic>,
    current: usize,
}

pub fn parse_grammar(source: &str) -> ParseResult {
    let lexed = Lexer::new(source).lex();
    Parser {
        tokens: lexed.tokens,
        line_starts: lexed.line_starts,
        diagnostics: lexed.diagnostics,
        current: 0,
    }
    .parse()
}

#[no_mangle]
pub extern "C" fn grammar_parser_alloc(len: usize) -> *mut u8 {
    let mut bytes = Vec::<u8>::with_capacity(len);
    let ptr = bytes.as_mut_ptr();
    std::mem::forget(bytes);
    ptr
}

#[no_mangle]
pub unsafe extern "C" fn grammar_parser_dealloc(ptr: *mut u8, len: usize) {
    if ptr.is_null() {
        return;
    }
    drop(Vec::from_raw_parts(ptr, 0, len));
}

#[no_mangle]
pub unsafe extern "C" fn grammar_parser_parse(ptr: *const u8, len: usize) -> u64 {
    if ptr.is_null() {
        return leaked_result_json(invalid_utf8_result());
    }
    let bytes = std::slice::from_raw_parts(ptr, len);
    let source = match std::str::from_utf8(bytes) {
        Ok(value) => value,
        Err(_) => return leaked_result_json(invalid_utf8_result()),
    };
    leaked_result_json(parse_grammar(source).to_json())
}

#[no_mangle]
pub unsafe extern "C" fn grammar_parser_free_result(ptr: *mut u8, len: usize) {
    if ptr.is_null() {
        return;
    }
    let slice = std::ptr::slice_from_raw_parts_mut(ptr, len);
    drop(Box::from_raw(slice));
}

struct LexerResult {
    tokens: Vec<Token>,
    diagnostics: Vec<Diagnostic>,
    line_starts: Vec<usize>,
}

impl<'a> Lexer<'a> {
    fn new(source: &'a str) -> Self {
        Self {
            source,
            line_starts: create_line_starts(source),
            tokens: Vec::new(),
            diagnostics: Vec::new(),
            index: 0,
        }
    }

    fn lex(mut self) -> LexerResult {
        while self.index < self.source.len() {
            let current = self.byte_at(self.index);
            if is_whitespace(current) {
                self.index += 1;
                continue;
            }

            if current == b'#' {
                self.skip_line_comment(1);
                continue;
            }

            if current == b'/' && self.byte_at_optional(self.index + 1) == Some(b'/') {
                self.skip_line_comment(2);
                continue;
            }

            let start = self.index;
            if current == b'-' && self.byte_at_optional(self.index + 1) == Some(b'>') {
                self.index += 2;
                self.push_token(TokenKind::Arrow, "->".to_string(), start, self.index);
                continue;
            }

            if current == b'"' {
                self.read_string(start);
                continue;
            }

            if current == b'/' {
                self.read_regex(start);
                continue;
            }

            if is_ident_start(current) {
                self.index += 1;
                while self.index < self.source.len() && is_ident_part(self.byte_at(self.index)) {
                    self.index += 1;
                }
                self.push_token(
                    TokenKind::Identifier,
                    self.source[start..self.index].to_string(),
                    start,
                    self.index,
                );
                continue;
            }

            if current.is_ascii_digit() {
                self.index += 1;
                while self.index < self.source.len() && self.byte_at(self.index).is_ascii_digit() {
                    self.index += 1;
                }
                self.push_token(
                    TokenKind::Number,
                    self.source[start..self.index].to_string(),
                    start,
                    self.index,
                );
                continue;
            }

            if is_symbol(current) {
                self.index += 1;
                self.push_token(
                    TokenKind::Symbol,
                    self.source[start..self.index].to_string(),
                    start,
                    self.index,
                );
                continue;
            }

            self.diagnostics.push(Diagnostic {
                code: "GRAMMAR_PARSE_ERROR",
                message: format!("Unexpected character '{}'.", current as char),
                span: span_at(&self.line_starts, start, start + 1),
            });
            self.index += 1;
        }

        let eof = self.source.len();
        self.push_token(TokenKind::Eof, "<eof>".to_string(), eof, eof);
        LexerResult {
            tokens: self.tokens,
            diagnostics: self.diagnostics,
            line_starts: self.line_starts,
        }
    }

    fn read_string(&mut self, start: usize) {
        self.index += 1;
        let mut value = String::new();
        while self.index < self.source.len() && self.byte_at(self.index) != b'"' {
            if self.byte_at(self.index) == b'\\' {
                self.index += 1;
                if self.index >= self.source.len() {
                    break;
                }
            }
            value.push(self.byte_at(self.index) as char);
            self.index += 1;
        }
        if self.index >= self.source.len() {
            let span = span_at(&self.line_starts, start, self.index);
            self.tokens.push(Token {
                kind: TokenKind::Literal,
                text: value,
                span,
            });
            self.diagnostics.push(Diagnostic {
                code: "GRAMMAR_PARSE_ERROR",
                message: "Unterminated string literal.".to_string(),
                span,
            });
            return;
        }
        self.index += 1;
        self.tokens.push(Token {
            kind: TokenKind::Literal,
            text: value,
            span: span_at(&self.line_starts, start, self.index),
        });
    }

    fn read_regex(&mut self, start: usize) {
        self.index += 1;
        let mut pattern = String::new();
        let mut escaped = false;
        let mut in_class = false;
        while self.index < self.source.len() {
            let current = self.byte_at(self.index);
            if current == b'\n' || current == b'\r' {
                let span = span_at(&self.line_starts, start, self.index);
                self.tokens.push(Token {
                    kind: TokenKind::Regex,
                    text: pattern,
                    span,
                });
                self.diagnostics.push(Diagnostic {
                    code: "GRAMMAR_PARSE_ERROR",
                    message: "Unterminated regex literal.".to_string(),
                    span,
                });
                return;
            }
            if escaped {
                pattern.push(current as char);
                escaped = false;
                self.index += 1;
                continue;
            }
            if current == b'\\' {
                pattern.push(current as char);
                escaped = true;
                self.index += 1;
                continue;
            }
            if current == b'[' {
                in_class = true;
                pattern.push(current as char);
                self.index += 1;
                continue;
            }
            if current == b']' {
                in_class = false;
                pattern.push(current as char);
                self.index += 1;
                continue;
            }
            if current == b'/' && !in_class {
                self.index += 1;
                self.tokens.push(Token {
                    kind: TokenKind::Regex,
                    text: pattern,
                    span: span_at(&self.line_starts, start, self.index),
                });
                return;
            }
            pattern.push(current as char);
            self.index += 1;
        }

        let span = span_at(&self.line_starts, start, self.index);
        self.tokens.push(Token {
            kind: TokenKind::Regex,
            text: pattern,
            span,
        });
        self.diagnostics.push(Diagnostic {
            code: "GRAMMAR_PARSE_ERROR",
            message: "Unterminated regex literal.".to_string(),
            span,
        });
    }

    fn skip_line_comment(&mut self, prefix_len: usize) {
        self.index += prefix_len;
        while self.index < self.source.len() && self.byte_at(self.index) != b'\n' {
            self.index += 1;
        }
    }

    fn push_token(&mut self, kind: TokenKind, text: String, start: usize, end: usize) {
        self.tokens.push(Token {
            kind,
            text,
            span: span_at(&self.line_starts, start, end),
        });
    }

    fn byte_at(&self, index: usize) -> u8 {
        self.source.as_bytes()[index]
    }

    fn byte_at_optional(&self, index: usize) -> Option<u8> {
        if index < self.source.len() {
            return Some(self.source.as_bytes()[index]);
        }
        None
    }
}

impl Parser {
    fn parse(mut self) -> ParseResult {
        let start = self.peek().span.start;
        let mut name = None;
        if self.match_text("grammar") {
            if let Some(token) = self.expect_kind(TokenKind::Identifier, "Expected grammar name.") {
                name = Some(token.text);
            }
        }

        let mut declarations = Vec::new();
        while !self.check_kind(TokenKind::Eof) {
            let before = self.current;
            if let Some(declaration) = self.parse_declaration() {
                declarations.push(declaration);
            }
            if self.current == before {
                self.advance();
            }
        }

        let end = self.peek().span.end;
        ParseResult {
            grammar: Some(GrammarDocument {
                name,
                declarations,
                span: self.span(start, end),
            }),
            diagnostics: self.diagnostics,
        }
    }

    fn parse_declaration(&mut self) -> Option<Declaration> {
        if self.check_text("token") || self.check_text("skip") || self.check_text("contextual") {
            return self.parse_token_declaration(None).map(Declaration::Token);
        }
        if self.check_text("mode") && self.next_starts_mode_declaration() {
            return self.parse_mode_declaration().map(Declaration::Mode);
        }
        if self.check_text("layout") && self.next_starts_named_declaration() {
            return self.parse_layout_declaration().map(Declaration::Layout);
        }
        if self.check_text("export") {
            return self.parse_export_declaration().map(Declaration::Export);
        }
        if self.check_text("import") {
            return self.parse_import_declaration().map(Declaration::Import);
        }
        if self.check_text("module") && self.next_starts_named_declaration() {
            return self.parse_module_declaration().map(Declaration::Module);
        }
        if self.check_text("extend") && self.next_starts_named_declaration() {
            return self.parse_extension_declaration().map(Declaration::Extend);
        }
        if self.check_kind(TokenKind::Identifier) {
            return self.parse_rule().map(Declaration::Rule);
        }

        self.report_here("Expected grammar declaration.");
        self.synchronize_top_level();
        None
    }

    fn parse_token_declaration(&mut self, mode_name: Option<String>) -> Option<TokenDeclaration> {
        let kind_token = self.advance();
        let name_token = self.expect_kind(TokenKind::Identifier, "Expected token name.");
        let mut priority = None;
        let mut channel = None;
        let mut local_mode_name = mode_name;
        let mut transition = None;

        if self.match_text("priority") {
            let priority_token = self.expect_kind(TokenKind::Number, "Expected priority value.");
            if let Some(token) = priority_token {
                let parsed = parse_u32(&token.text);
                if parsed.is_none() {
                    self.report_at(&token, "Invalid priority value.");
                }
                priority = parsed;
            }
        }

        if self.match_text("channel") {
            if let Some(channel_token) =
                self.expect_kind(TokenKind::Identifier, "Expected channel name.")
            {
                channel = Some(channel_token.text);
            }
        }

        if self.match_text("in") {
            if let Some(mode_token) =
                self.expect_kind(TokenKind::Identifier, "Expected lexer mode name.")
            {
                local_mode_name = Some(mode_token.text);
            }
        }

        if self.check_text("push") || self.check_text("mode") || self.check_text("pop") {
            transition = self.parse_mode_transition();
        }

        if !self.expect_text("=").is_some() {
            self.synchronize_top_level();
            return None;
        }
        let pattern = self.parse_terminal_pattern("Expected token pattern.");
        let semicolon = self.expect_text(";");
        if name_token.is_none() || pattern.is_none() || semicolon.is_none() {
            self.synchronize_top_level();
            return None;
        }

        let kind = if kind_token.text == "token" {
            TokenDeclarationKind::Token
        } else if kind_token.text == "skip" {
            TokenDeclarationKind::Skip
        } else {
            TokenDeclarationKind::Contextual
        };

        let name = name_token.unwrap().text;
        let pattern = pattern.unwrap();
        let semicolon = semicolon.unwrap();
        Some(TokenDeclaration {
            kind,
            name,
            pattern,
            priority,
            channel,
            mode: local_mode_name,
            transition,
            span: self.span(kind_token.span.start, semicolon.span.end),
        })
    }

    fn parse_mode_declaration(&mut self) -> Option<ModeDeclaration> {
        let mode_token = self.advance();
        let name_token = self.expect_kind(TokenKind::Identifier, "Expected lexer mode name.");
        if name_token.is_none() {
            self.synchronize_top_level();
            return None;
        }
        if !self.expect_text("{").is_some() {
            self.synchronize_top_level();
            return None;
        }
        let name = name_token.unwrap().text;
        let mut declarations = Vec::new();
        while !self.check_text("}") && !self.check_kind(TokenKind::Eof) {
            if self.check_text("token") || self.check_text("skip") || self.check_text("contextual")
            {
                if let Some(declaration) = self.parse_token_declaration(Some(name.clone())) {
                    declarations.push(declaration);
                }
            } else {
                self.report_here("Expected terminal declaration in lexer mode.");
                self.synchronize_mode_declaration();
            }
        }
        let close = self.expect_text("}");
        if close.is_none() {
            self.synchronize_top_level();
            return None;
        }
        Some(ModeDeclaration {
            name,
            declarations,
            span: self.span(mode_token.span.start, close.unwrap().span.end),
        })
    }

    fn parse_layout_declaration(&mut self) -> Option<LayoutDeclaration> {
        let layout_token = self.advance();
        let name_token = self.expect_kind(TokenKind::Identifier, "Expected layout name.");
        if name_token.is_none() {
            self.synchronize_top_level();
            return None;
        }
        if !self.expect_text("=").is_some() {
            self.synchronize_top_level();
            return None;
        }
        let expression = self.parse_choice();
        let semicolon = self.expect_text(";");
        if expression.is_none() || semicolon.is_none() {
            self.synchronize_top_level();
            return None;
        }
        Some(LayoutDeclaration {
            name: name_token.unwrap().text,
            expression: expression.unwrap(),
            span: self.span(layout_token.span.start, semicolon.unwrap().span.end),
        })
    }

    fn parse_export_declaration(&mut self) -> Option<NamedDeclaration> {
        let export_token = self.advance();
        let name = self.parse_qualified_name("Expected exported name.");
        if name.is_none() {
            self.synchronize_top_level();
            return None;
        }
        let name = name.unwrap();
        Some(NamedDeclaration {
            name: name.text,
            span: self.span(export_token.span.start, name.span.end),
        })
    }

    fn parse_import_declaration(&mut self) -> Option<ImportDeclaration> {
        let import_token = self.advance();
        let mut source = None;
        let mut source_span = None;
        if self.check_kind(TokenKind::Literal) {
            let token = self.advance();
            source = Some(token.text);
            source_span = Some(token.span);
        } else if self.check_kind(TokenKind::Identifier) {
            if let Some(name) = self.parse_qualified_name("Expected imported module name.") {
                source = Some(name.text);
                source_span = Some(name.span);
            }
        } else {
            self.report_here("Expected imported module name.");
        }
        let semicolon = self.expect_text(";");
        if source.is_none() || source_span.is_none() || semicolon.is_none() {
            self.synchronize_top_level();
            return None;
        }
        Some(ImportDeclaration {
            source: source.unwrap(),
            span: self.span(import_token.span.start, semicolon.unwrap().span.end),
        })
    }

    fn parse_module_declaration(&mut self) -> Option<NamedDeclaration> {
        let module_token = self.advance();
        let name = self.parse_qualified_name("Expected module name.");
        if name.is_none() {
            self.synchronize_top_level();
            return None;
        }
        let name = name.unwrap();
        Some(NamedDeclaration {
            name: name.text,
            span: self.span(module_token.span.start, name.span.end),
        })
    }

    fn parse_extension_declaration(&mut self) -> Option<ExtensionDeclaration> {
        let extend_token = self.advance();
        let target = self.parse_qualified_name("Expected extension target.");
        if target.is_none() {
            self.synchronize_top_level();
            return None;
        }
        if !self.expect_text("=").is_some() {
            self.synchronize_top_level();
            return None;
        }
        let expression = self.parse_choice();
        let semicolon = self.expect_text(";");
        if expression.is_none() || semicolon.is_none() {
            self.synchronize_top_level();
            return None;
        }
        let target = target.unwrap();
        Some(ExtensionDeclaration {
            target: target.text,
            expression: expression.unwrap(),
            span: self.span(extend_token.span.start, semicolon.unwrap().span.end),
        })
    }

    fn parse_mode_transition(&mut self) -> Option<ModeTransition> {
        let transition_token = self.advance();
        if transition_token.text == "pop" {
            return Some(ModeTransition::Pop {
                span: transition_token.span,
            });
        }
        if transition_token.text == "push" || transition_token.text == "mode" {
            let mode_token = self.expect_kind(TokenKind::Identifier, "Expected lexer mode name.");
            if mode_token.is_none() {
                return None;
            }
            let mode_token = mode_token.unwrap();
            let span = self.span(transition_token.span.start, mode_token.span.end);
            if transition_token.text == "push" {
                return Some(ModeTransition::Push {
                    mode: mode_token.text,
                    span,
                });
            }
            return Some(ModeTransition::Mode {
                mode: mode_token.text,
                span,
            });
        }
        self.report_at(&transition_token, "Expected lexer mode transition.");
        None
    }

    fn parse_qualified_name(&mut self, message: &str) -> Option<QualifiedName> {
        let first = self.expect_kind(TokenKind::Identifier, message);
        if first.is_none() {
            return None;
        }
        let first = first.unwrap();
        let mut text = first.text;
        let mut end = first.span.end;
        while self.match_text(".") {
            let part = self.expect_kind(TokenKind::Identifier, "Expected name after '.'.");
            if part.is_none() {
                return None;
            }
            let part = part.unwrap();
            text.push('.');
            text.push_str(&part.text);
            end = part.span.end;
        }
        Some(QualifiedName {
            text,
            span: self.span(first.span.start, end),
        })
    }

    fn parse_rule(&mut self) -> Option<RuleDeclaration> {
        let name_token = self.advance();
        let mut annotations = Vec::new();
        if self.match_text("sync") {
            let sync_token = self.previous();
            if !self.expect_text("=").is_some() {
                self.synchronize_top_level();
                return None;
            }
            let expression = self.parse_choice();
            if expression.is_none() {
                self.synchronize_top_level();
                return None;
            }
            let semicolon = self.expect_text(";");
            if semicolon.is_none() {
                self.synchronize_top_level();
                return None;
            }
            let semicolon = semicolon.unwrap();
            annotations.push(RuleAnnotation::Sync {
                expression: expression.unwrap(),
                span: self.span(sync_token.span.start, semicolon.span.end),
            });
            let empty_span = self.span(name_token.span.end, name_token.span.end);
            return Some(RuleDeclaration {
                name: name_token.text,
                annotations,
                expression: Expression::Sequence {
                    items: Vec::new(),
                    span: empty_span,
                },
                span: self.span(name_token.span.start, semicolon.span.end),
            });
        }

        if !self.expect_text("=").is_some() {
            self.synchronize_top_level();
            return None;
        }
        let expression = self.parse_rule_expression();
        let mut semicolon = None;
        if matches!(&expression, Some(Expression::ExpressionIsland { .. })) {
            if self.check_text(";") {
                semicolon = Some(self.advance());
            }
        } else {
            semicolon = self.expect_text(";");
        }
        if expression.is_none() {
            self.synchronize_top_level();
            return None;
        }
        let expression = expression.unwrap();
        let mut end = expression_span(&expression).end;
        if let Some(token) = semicolon {
            end = token.span.end;
        }
        Some(RuleDeclaration {
            name: name_token.text,
            annotations,
            expression,
            span: self.span(name_token.span.start, end),
        })
    }

    fn parse_rule_expression(&mut self) -> Option<Expression> {
        if self.rule_starts_expression_island() {
            let atom = self.parse_constructed_field();
            if atom.is_none() {
                return None;
            }
            return self.parse_expression_island(atom.unwrap());
        }
        let first = self.parse_choice();
        if first.is_none() {
            return None;
        }
        let first = first.unwrap();
        if self.check_text("{") && self.next_starts_expression_operator() {
            return self.parse_expression_island(first);
        }
        Some(first)
    }

    fn parse_expression_island(&mut self, atom: Expression) -> Option<Expression> {
        self.expect_text("{");
        let mut operators = Vec::new();
        while !self.check_text("}") && !self.check_kind(TokenKind::Eof) {
            if let Some(operator) = self.parse_expression_operator() {
                operators.push(operator);
            } else {
                self.advance();
            }
        }
        let close = self.expect_text("}");
        if close.is_none() {
            return None;
        }
        let span = self.span(expression_span(&atom).start, close.unwrap().span.end);
        Some(Expression::ExpressionIsland {
            atom: Box::new(atom),
            operators,
            span,
        })
    }

    fn parse_expression_operator(&mut self) -> Option<ExpressionOperator> {
        let kind_token = self.expect_one_of_text(
            &["infix", "prefix", "postfix"],
            "Expected expression operator kind.",
        );
        if kind_token.is_none() {
            return None;
        }
        let kind_token = kind_token.unwrap();
        let mut associativity = None;
        if kind_token.text == "infix" {
            let assoc_token =
                self.expect_one_of_text(&["left", "right", "none"], "Expected associativity.");
            if assoc_token.is_none() {
                return None;
            }
            let assoc_token = assoc_token.unwrap();
            associativity = Some(if assoc_token.text == "left" {
                Associativity::Left
            } else if assoc_token.text == "right" {
                Associativity::Right
            } else {
                Associativity::None
            });
        }
        let precedence_token = self.expect_kind(TokenKind::Number, "Expected precedence.");
        let token = self.parse_terminal_pattern("Expected expression operator token.");
        if precedence_token.is_none() || token.is_none() {
            return None;
        }
        let precedence_token = precedence_token.unwrap();
        let precedence = parse_u32(&precedence_token.text);
        if precedence.is_none() {
            self.report_at(&precedence_token, "Invalid expression precedence.");
            return None;
        }
        let token = token.unwrap();
        let kind = if kind_token.text == "infix" {
            ExpressionOperatorKind::Infix
        } else if kind_token.text == "prefix" {
            ExpressionOperatorKind::Prefix
        } else {
            ExpressionOperatorKind::Postfix
        };
        let span = self.span(kind_token.span.start, terminal_pattern_span(&token).end);
        Some(ExpressionOperator {
            kind,
            associativity,
            precedence: precedence.unwrap(),
            token,
            span,
        })
    }

    fn parse_choice(&mut self) -> Option<Expression> {
        let first = self.parse_sequence();
        if first.is_none() {
            return None;
        }
        let mut options = vec![first.unwrap()];
        while self.match_text("|") {
            if let Some(next) = self.parse_sequence() {
                options.push(next);
            } else {
                self.report_here("Expected expression after '|'.");
            }
        }
        if options.len() == 1 {
            return Some(options.remove(0));
        }
        let span = expression_span_between(&options[0], &options[options.len() - 1], self);
        Some(Expression::Choice { options, span })
    }

    fn parse_sequence(&mut self) -> Option<Expression> {
        let mut items = Vec::new();
        while self.is_expression_start() {
            if let Some(expression) = self.parse_constructed_field() {
                items.push(expression);
            } else {
                break;
            }
        }
        if items.is_empty() {
            self.report_here("Expected expression.");
            return None;
        }
        let mut expression = if items.len() == 1 {
            items.remove(0)
        } else {
            let span = expression_span_between(&items[0], &items[items.len() - 1], self);
            Expression::Sequence { items, span }
        };
        if self.match_kind(TokenKind::Arrow) {
            let arrow = self.previous();
            if let Some(constructor) = self.parse_constructor(expression.clone(), arrow) {
                expression = constructor;
            }
        }
        Some(expression)
    }

    fn parse_constructed_field(&mut self) -> Option<Expression> {
        self.parse_field()
    }

    fn parse_field(&mut self) -> Option<Expression> {
        if self.check_kind(TokenKind::Identifier) && self.check_next_text(":") {
            let name = self.advance();
            self.expect_text(":");
            let expression = self.parse_separator();
            if expression.is_none() {
                return None;
            }
            let expression = expression.unwrap();
            let span = self.span(name.span.start, expression_span(&expression).end);
            return Some(Expression::Field {
                name: name.text,
                expression: Box::new(expression),
                span,
            });
        }
        self.parse_separator()
    }

    fn parse_separator(&mut self) -> Option<Expression> {
        let mut expression = self.parse_postfix();
        if expression.is_none() {
            return None;
        }
        if self.match_text("%") {
            let separator = self.parse_postfix();
            if separator.is_none() {
                return None;
            }
            let item = expression.unwrap();
            let separator = separator.unwrap();
            let span = expression_span_between(&item, &separator, self);
            expression = Some(Expression::Separated {
                item: Box::new(item),
                separator: Box::new(separator),
                span,
            });
        }
        expression
    }

    fn parse_postfix(&mut self) -> Option<Expression> {
        let mut expression = self.parse_primary();
        if expression.is_none() {
            return None;
        }
        loop {
            if self.match_text("?") {
                let operator = self.previous();
                let inner = expression.unwrap();
                expression = Some(Expression::Optional {
                    span: self.span(expression_span(&inner).start, operator.span.end),
                    expression: Box::new(inner),
                });
                continue;
            }
            if self.match_text("*") {
                let operator = self.previous();
                let inner = expression.unwrap();
                expression = Some(Expression::Repeat {
                    span: self.span(expression_span(&inner).start, operator.span.end),
                    expression: Box::new(inner),
                });
                continue;
            }
            if self.match_text("+") {
                let operator = self.previous();
                let inner = expression.unwrap();
                expression = Some(Expression::Repeat1 {
                    span: self.span(expression_span(&inner).start, operator.span.end),
                    expression: Box::new(inner),
                });
                continue;
            }
            return expression;
        }
    }

    fn parse_primary(&mut self) -> Option<Expression> {
        if self.match_kind(TokenKind::Identifier) {
            let token = self.previous();
            return Some(Expression::Ref {
                name: token.text,
                span: token.span,
            });
        }
        if self.match_kind(TokenKind::Literal) {
            let token = self.previous();
            return Some(Expression::Literal {
                value: token.text,
                span: token.span,
            });
        }
        if self.match_text("(") {
            return self.parse_delimited_expression(")");
        }
        if self.match_text("[") {
            let start = self.previous().span.start;
            let expression = self.parse_choice();
            let close = self.expect_text("]");
            if expression.is_none() || close.is_none() {
                return None;
            }
            return Some(Expression::Optional {
                expression: Box::new(expression.unwrap()),
                span: self.span(start, close.unwrap().span.end),
            });
        }
        if self.match_text("{") {
            let start = self.previous().span.start;
            let expression = self.parse_choice();
            let close = self.expect_text("}");
            if expression.is_none() || close.is_none() {
                return None;
            }
            return Some(Expression::Repeat {
                expression: Box::new(expression.unwrap()),
                span: self.span(start, close.unwrap().span.end),
            });
        }
        self.report_here("Expected expression.");
        None
    }

    fn parse_delimited_expression(&mut self, close_text: &str) -> Option<Expression> {
        let start = self.previous().span.start;
        let expression = self.parse_choice();
        let close = self.expect_text(close_text);
        if expression.is_none() || close.is_none() {
            return None;
        }
        Some(with_expression_span(
            expression.unwrap(),
            self.span(start, close.unwrap().span.end),
        ))
    }

    fn parse_constructor(&mut self, expression: Expression, arrow: Token) -> Option<Expression> {
        let name = self.expect_kind(TokenKind::Identifier, "Expected constructor name.");
        if name.is_none() {
            return None;
        }
        if !self.expect_text("(").is_some() {
            return None;
        }
        let mut arguments = Vec::new();
        if !self.check_text(")") {
            while !self.check_kind(TokenKind::Eof) {
                let arg = self.expect_kind(TokenKind::Identifier, "Expected constructor argument.");
                if arg.is_none() {
                    return None;
                }
                arguments.push(arg.unwrap().text);
                if !self.match_text(",") {
                    break;
                }
            }
        }
        let close = self.expect_text(")");
        if close.is_none() {
            return None;
        }
        Some(Expression::Constructor {
            expression: Box::new(expression),
            name: name.unwrap().text,
            arguments,
            span: self.span(arrow.span.start, close.unwrap().span.end),
        })
    }

    fn parse_terminal_pattern(&mut self, message: &str) -> Option<TerminalPattern> {
        if self.match_kind(TokenKind::Regex) {
            let token = self.previous();
            return Some(TerminalPattern::Regex {
                pattern: token.text,
                span: token.span,
            });
        }
        if self.match_kind(TokenKind::Literal) {
            let token = self.previous();
            return Some(TerminalPattern::Literal {
                value: token.text,
                span: token.span,
            });
        }
        self.report_here(message);
        None
    }

    fn next_starts_expression_operator(&self) -> bool {
        let next = self.tokens.get(self.current + 1);
        if let Some(token) = next {
            return token.text == "infix" || token.text == "prefix" || token.text == "postfix";
        }
        false
    }

    fn next_starts_named_declaration(&self) -> bool {
        if let Some(next) = self.tokens.get(self.current + 1) {
            return next.kind == TokenKind::Identifier;
        }
        false
    }

    fn next_starts_mode_declaration(&self) -> bool {
        let name = self.tokens.get(self.current + 1);
        let open = self.tokens.get(self.current + 2);
        if name.is_none() || open.is_none() {
            return false;
        }
        name.unwrap().kind == TokenKind::Identifier && open.unwrap().text == "{"
    }

    fn rule_starts_expression_island(&self) -> bool {
        if !self.is_expression_start() {
            return false;
        }
        let mut offset = 1;
        loop {
            let token = self.tokens.get(self.current + offset);
            if token.is_none() {
                return false;
            }
            let token = token.unwrap();
            if token.text == "?" || token.text == "*" || token.text == "+" {
                offset += 1;
                continue;
            }
            if token.text != "{" {
                return false;
            }
            let operator = self.tokens.get(self.current + offset + 1);
            if operator.is_none() {
                return false;
            }
            let operator = operator.unwrap();
            return operator.text == "infix"
                || operator.text == "prefix"
                || operator.text == "postfix";
        }
    }

    fn is_expression_start(&self) -> bool {
        self.check_kind(TokenKind::Identifier)
            || self.check_kind(TokenKind::Literal)
            || self.check_text("(")
            || self.check_text("[")
            || self.check_text("{")
    }

    fn synchronize_top_level(&mut self) {
        while !self.check_kind(TokenKind::Eof) {
            if self.match_text(";") {
                return;
            }
            if self.check_text("token")
                || self.check_text("skip")
                || self.check_text("contextual")
                || self.check_text("mode")
                || self.check_text("layout")
                || self.check_text("export")
                || self.check_text("import")
                || self.check_text("module")
                || self.check_text("extend")
            {
                return;
            }
            if self.check_kind(TokenKind::Identifier) && self.check_next_text("=") {
                return;
            }
            if self.check_kind(TokenKind::Identifier) && self.check_next_text("sync") {
                return;
            }
            self.advance();
        }
    }

    fn synchronize_mode_declaration(&mut self) {
        while !self.check_kind(TokenKind::Eof) && !self.check_text("}") {
            if self.match_text(";") {
                return;
            }
            if self.check_text("token") || self.check_text("skip") || self.check_text("contextual")
            {
                return;
            }
            self.advance();
        }
    }

    fn expect_kind(&mut self, kind: TokenKind, message: &str) -> Option<Token> {
        if self.check_kind(kind) {
            return Some(self.advance());
        }
        self.report_here(message);
        None
    }

    fn expect_text(&mut self, text: &str) -> Option<Token> {
        if self.check_text(text) {
            return Some(self.advance());
        }
        self.report_here(&format!("Expected '{}'.", text));
        None
    }

    fn expect_one_of_text(&mut self, texts: &[&str], message: &str) -> Option<Token> {
        for text in texts {
            if self.check_text(text) {
                return Some(self.advance());
            }
        }
        self.report_here(message);
        None
    }

    fn match_kind(&mut self, kind: TokenKind) -> bool {
        if !self.check_kind(kind) {
            return false;
        }
        self.advance();
        true
    }

    fn match_text(&mut self, text: &str) -> bool {
        if !self.check_text(text) {
            return false;
        }
        self.advance();
        true
    }

    fn check_kind(&self, kind: TokenKind) -> bool {
        self.peek().kind == kind
    }

    fn check_text(&self, text: &str) -> bool {
        self.peek().text == text
    }

    fn check_next_text(&self, text: &str) -> bool {
        if let Some(next) = self.tokens.get(self.current + 1) {
            return next.text == text;
        }
        false
    }

    fn advance(&mut self) -> Token {
        let token = self.peek().clone();
        if !self.check_kind(TokenKind::Eof) {
            self.current += 1;
        }
        token
    }

    fn previous(&self) -> Token {
        self.tokens[self.current - 1].clone()
    }

    fn peek(&self) -> &Token {
        &self.tokens[self.current]
    }

    fn report_here(&mut self, message: &str) {
        let token = self.peek().clone();
        self.report_at(&token, message);
    }

    fn report_at(&mut self, token: &Token, message: &str) {
        self.diagnostics.push(Diagnostic {
            code: "GRAMMAR_PARSE_ERROR",
            message: message.to_string(),
            span: token.span,
        });
    }

    fn span(&self, start: usize, end: usize) -> SourceSpan {
        span_at(&self.line_starts, start, end)
    }
}

#[derive(Clone)]
struct QualifiedName {
    text: String,
    span: SourceSpan,
}

fn with_expression_span(expression: Expression, span: SourceSpan) -> Expression {
    match expression {
        Expression::Field {
            name, expression, ..
        } => Expression::Field {
            name,
            expression,
            span,
        },
        Expression::Ref { name, .. } => Expression::Ref { name, span },
        Expression::Literal { value, .. } => Expression::Literal { value, span },
        Expression::Sequence { items, .. } => Expression::Sequence { items, span },
        Expression::Choice { options, .. } => Expression::Choice { options, span },
        Expression::Optional { expression, .. } => Expression::Optional { expression, span },
        Expression::Repeat { expression, .. } => Expression::Repeat { expression, span },
        Expression::Repeat1 { expression, .. } => Expression::Repeat1 { expression, span },
        Expression::Separated {
            item, separator, ..
        } => Expression::Separated {
            item,
            separator,
            span,
        },
        Expression::Constructor {
            expression,
            name,
            arguments,
            ..
        } => Expression::Constructor {
            expression,
            name,
            arguments,
            span,
        },
        Expression::ExpressionIsland {
            atom, operators, ..
        } => Expression::ExpressionIsland {
            atom,
            operators,
            span,
        },
    }
}

fn expression_span_between(left: &Expression, right: &Expression, parser: &Parser) -> SourceSpan {
    parser.span(expression_span(left).start, expression_span(right).end)
}

fn expression_span(expression: &Expression) -> SourceSpan {
    match expression {
        Expression::Field { span, .. } => *span,
        Expression::Ref { span, .. } => *span,
        Expression::Literal { span, .. } => *span,
        Expression::Sequence { span, .. } => *span,
        Expression::Choice { span, .. } => *span,
        Expression::Optional { span, .. } => *span,
        Expression::Repeat { span, .. } => *span,
        Expression::Repeat1 { span, .. } => *span,
        Expression::Separated { span, .. } => *span,
        Expression::Constructor { span, .. } => *span,
        Expression::ExpressionIsland { span, .. } => *span,
    }
}

fn terminal_pattern_span(pattern: &TerminalPattern) -> SourceSpan {
    match pattern {
        TerminalPattern::Regex { span, .. } => *span,
        TerminalPattern::Literal { span, .. } => *span,
    }
}

fn create_line_starts(source: &str) -> Vec<usize> {
    let mut starts = vec![0];
    for (index, byte) in source.as_bytes().iter().enumerate() {
        if *byte == b'\n' {
            starts.push(index + 1);
        }
    }
    starts
}

fn span_at(line_starts: &[usize], start: usize, end: usize) -> SourceSpan {
    let mut line_index = 0;
    for (index, line_start) in line_starts.iter().enumerate() {
        if *line_start > start {
            break;
        }
        line_index = index;
    }
    SourceSpan {
        start,
        end,
        line: line_index + 1,
        column: start - line_starts[line_index] + 1,
    }
}

fn parse_u32(text: &str) -> Option<u32> {
    let mut value: u32 = 0;
    for byte in text.as_bytes() {
        if !byte.is_ascii_digit() {
            return None;
        }
        let digit = (*byte - b'0') as u32;
        if let Some(next) = value
            .checked_mul(10)
            .and_then(|base| base.checked_add(digit))
        {
            value = next;
        } else {
            return None;
        }
    }
    Some(value)
}

fn is_whitespace(byte: u8) -> bool {
    byte == b' ' || byte == b'\t' || byte == b'\r' || byte == b'\n'
}

fn is_ident_start(byte: u8) -> bool {
    byte.is_ascii_alphabetic() || byte == b'_'
}

fn is_ident_part(byte: u8) -> bool {
    is_ident_start(byte) || byte.is_ascii_digit()
}

fn is_symbol(byte: u8) -> bool {
    matches!(
        byte,
        b'=' | b';'
            | b'|'
            | b'{'
            | b'}'
            | b'['
            | b']'
            | b'('
            | b')'
            | b'?'
            | b'*'
            | b'+'
            | b'%'
            | b':'
            | b','
            | b'.'
    )
}

trait JsonSerializable {
    fn push_json(&self, output: &mut String);

    fn to_json(&self) -> String {
        let mut output = String::new();
        self.push_json(&mut output);
        output
    }
}

impl JsonSerializable for ParseResult {
    fn push_json(&self, output: &mut String) {
        output.push('{');
        output.push_str("\"grammar\":");
        if let Some(grammar) = &self.grammar {
            grammar.push_json(output);
        } else {
            output.push_str("null");
        }
        output.push_str(",\"diagnostics\":");
        push_json_array(output, &self.diagnostics);
        output.push('}');
    }
}

impl JsonSerializable for GrammarDocument {
    fn push_json(&self, output: &mut String) {
        output.push('{');
        if let Some(name) = &self.name {
            output.push_str("\"name\":");
            push_json_string(output, name);
            output.push(',');
        }
        output.push_str("\"declarations\":");
        push_json_array(output, &self.declarations);
        output.push_str(",\"span\":");
        self.span.push_json(output);
        output.push('}');
    }
}

impl JsonSerializable for Declaration {
    fn push_json(&self, output: &mut String) {
        match self {
            Declaration::Token(value) => value.push_json(output),
            Declaration::Mode(value) => value.push_json(output),
            Declaration::Layout(value) => value.push_json(output),
            Declaration::Export(value) => {
                output.push_str("{\"kind\":\"export\",\"name\":");
                push_json_string(output, &value.name);
                output.push_str(",\"span\":");
                value.span.push_json(output);
                output.push('}');
            }
            Declaration::Import(value) => value.push_json(output),
            Declaration::Module(value) => {
                output.push_str("{\"kind\":\"module\",\"name\":");
                push_json_string(output, &value.name);
                output.push_str(",\"span\":");
                value.span.push_json(output);
                output.push('}');
            }
            Declaration::Extend(value) => value.push_json(output),
            Declaration::Rule(value) => value.push_json(output),
        }
    }
}

impl JsonSerializable for TokenDeclaration {
    fn push_json(&self, output: &mut String) {
        output.push_str("{\"kind\":");
        push_json_string(output, self.kind.as_str());
        output.push_str(",\"name\":");
        push_json_string(output, &self.name);
        output.push_str(",\"pattern\":");
        self.pattern.push_json(output);
        if let Some(priority) = self.priority {
            output.push_str(",\"priority\":");
            push_json_u32(output, priority);
        }
        if let Some(channel) = &self.channel {
            output.push_str(",\"channel\":");
            push_json_string(output, channel);
        }
        if let Some(mode) = &self.mode {
            output.push_str(",\"mode\":");
            push_json_string(output, mode);
        }
        if let Some(transition) = &self.transition {
            output.push_str(",\"transition\":");
            transition.push_json(output);
        }
        output.push_str(",\"span\":");
        self.span.push_json(output);
        output.push('}');
    }
}

impl TokenDeclarationKind {
    fn as_str(&self) -> &'static str {
        match self {
            TokenDeclarationKind::Token => "token",
            TokenDeclarationKind::Skip => "skip",
            TokenDeclarationKind::Contextual => "contextual",
        }
    }
}

impl JsonSerializable for ModeTransition {
    fn push_json(&self, output: &mut String) {
        match self {
            ModeTransition::Push { mode, span } => {
                output.push_str("{\"kind\":\"push\",\"mode\":");
                push_json_string(output, mode);
                output.push_str(",\"span\":");
                span.push_json(output);
                output.push('}');
            }
            ModeTransition::Mode { mode, span } => {
                output.push_str("{\"kind\":\"mode\",\"mode\":");
                push_json_string(output, mode);
                output.push_str(",\"span\":");
                span.push_json(output);
                output.push('}');
            }
            ModeTransition::Pop { span } => {
                output.push_str("{\"kind\":\"pop\",\"span\":");
                span.push_json(output);
                output.push('}');
            }
        }
    }
}

impl JsonSerializable for ModeDeclaration {
    fn push_json(&self, output: &mut String) {
        output.push_str("{\"kind\":\"mode\",\"name\":");
        push_json_string(output, &self.name);
        output.push_str(",\"declarations\":");
        push_json_array(output, &self.declarations);
        output.push_str(",\"span\":");
        self.span.push_json(output);
        output.push('}');
    }
}

impl JsonSerializable for LayoutDeclaration {
    fn push_json(&self, output: &mut String) {
        output.push_str("{\"kind\":\"layout\",\"name\":");
        push_json_string(output, &self.name);
        output.push_str(",\"expression\":");
        self.expression.push_json(output);
        output.push_str(",\"span\":");
        self.span.push_json(output);
        output.push('}');
    }
}

impl JsonSerializable for ImportDeclaration {
    fn push_json(&self, output: &mut String) {
        output.push_str("{\"kind\":\"import\",\"source\":");
        push_json_string(output, &self.source);
        output.push_str(",\"span\":");
        self.span.push_json(output);
        output.push('}');
    }
}

impl JsonSerializable for ExtensionDeclaration {
    fn push_json(&self, output: &mut String) {
        output.push_str("{\"kind\":\"extend\",\"target\":");
        push_json_string(output, &self.target);
        output.push_str(",\"expression\":");
        self.expression.push_json(output);
        output.push_str(",\"span\":");
        self.span.push_json(output);
        output.push('}');
    }
}

impl JsonSerializable for RuleDeclaration {
    fn push_json(&self, output: &mut String) {
        output.push_str("{\"kind\":\"rule\",\"name\":");
        push_json_string(output, &self.name);
        output.push_str(",\"annotations\":");
        push_json_array(output, &self.annotations);
        output.push_str(",\"expression\":");
        self.expression.push_json(output);
        output.push_str(",\"span\":");
        self.span.push_json(output);
        output.push('}');
    }
}

impl JsonSerializable for RuleAnnotation {
    fn push_json(&self, output: &mut String) {
        match self {
            RuleAnnotation::Sync { expression, span } => {
                output.push_str("{\"kind\":\"sync\",\"expression\":");
                expression.push_json(output);
                output.push_str(",\"span\":");
                span.push_json(output);
                output.push('}');
            }
        }
    }
}

impl JsonSerializable for TerminalPattern {
    fn push_json(&self, output: &mut String) {
        match self {
            TerminalPattern::Regex { pattern, span } => {
                output.push_str("{\"kind\":\"regex\",\"pattern\":");
                push_json_string(output, pattern);
                output.push_str(",\"span\":");
                span.push_json(output);
                output.push('}');
            }
            TerminalPattern::Literal { value, span } => {
                output.push_str("{\"kind\":\"literal\",\"value\":");
                push_json_string(output, value);
                output.push_str(",\"span\":");
                span.push_json(output);
                output.push('}');
            }
        }
    }
}

impl JsonSerializable for Expression {
    fn push_json(&self, output: &mut String) {
        match self {
            Expression::Field {
                name,
                expression,
                span,
            } => {
                output.push_str("{\"kind\":\"field\",\"name\":");
                push_json_string(output, name);
                output.push_str(",\"expression\":");
                expression.push_json(output);
                output.push_str(",\"span\":");
                span.push_json(output);
                output.push('}');
            }
            Expression::Ref { name, span } => {
                output.push_str("{\"kind\":\"ref\",\"name\":");
                push_json_string(output, name);
                output.push_str(",\"span\":");
                span.push_json(output);
                output.push('}');
            }
            Expression::Literal { value, span } => {
                output.push_str("{\"kind\":\"literal\",\"value\":");
                push_json_string(output, value);
                output.push_str(",\"span\":");
                span.push_json(output);
                output.push('}');
            }
            Expression::Sequence { items, span } => {
                output.push_str("{\"kind\":\"sequence\",\"items\":");
                push_json_array(output, items);
                output.push_str(",\"span\":");
                span.push_json(output);
                output.push('}');
            }
            Expression::Choice { options, span } => {
                output.push_str("{\"kind\":\"choice\",\"options\":");
                push_json_array(output, options);
                output.push_str(",\"span\":");
                span.push_json(output);
                output.push('}');
            }
            Expression::Optional { expression, span } => {
                output.push_str("{\"kind\":\"optional\",\"expression\":");
                expression.push_json(output);
                output.push_str(",\"span\":");
                span.push_json(output);
                output.push('}');
            }
            Expression::Repeat { expression, span } => {
                output.push_str("{\"kind\":\"repeat\",\"expression\":");
                expression.push_json(output);
                output.push_str(",\"span\":");
                span.push_json(output);
                output.push('}');
            }
            Expression::Repeat1 { expression, span } => {
                output.push_str("{\"kind\":\"repeat1\",\"expression\":");
                expression.push_json(output);
                output.push_str(",\"span\":");
                span.push_json(output);
                output.push('}');
            }
            Expression::Separated {
                item,
                separator,
                span,
            } => {
                output.push_str("{\"kind\":\"separated\",\"item\":");
                item.push_json(output);
                output.push_str(",\"separator\":");
                separator.push_json(output);
                output.push_str(",\"span\":");
                span.push_json(output);
                output.push('}');
            }
            Expression::Constructor {
                expression,
                name,
                arguments,
                span,
            } => {
                output.push_str("{\"kind\":\"constructor\",\"expression\":");
                expression.push_json(output);
                output.push_str(",\"name\":");
                push_json_string(output, name);
                output.push_str(",\"arguments\":");
                push_json_string_array(output, arguments);
                output.push_str(",\"span\":");
                span.push_json(output);
                output.push('}');
            }
            Expression::ExpressionIsland {
                atom,
                operators,
                span,
            } => {
                output.push_str("{\"kind\":\"expressionIsland\",\"atom\":");
                atom.push_json(output);
                output.push_str(",\"operators\":");
                push_json_array(output, operators);
                output.push_str(",\"span\":");
                span.push_json(output);
                output.push('}');
            }
        }
    }
}

impl JsonSerializable for ExpressionOperator {
    fn push_json(&self, output: &mut String) {
        output.push_str("{\"kind\":");
        push_json_string(output, self.kind.as_str());
        output.push_str(",\"precedence\":");
        push_json_u32(output, self.precedence);
        output.push_str(",\"token\":");
        self.token.push_json(output);
        if let Some(associativity) = self.associativity {
            output.push_str(",\"associativity\":");
            push_json_string(output, associativity.as_str());
        }
        output.push_str(",\"span\":");
        self.span.push_json(output);
        output.push('}');
    }
}

impl ExpressionOperatorKind {
    fn as_str(&self) -> &'static str {
        match self {
            ExpressionOperatorKind::Infix => "infix",
            ExpressionOperatorKind::Prefix => "prefix",
            ExpressionOperatorKind::Postfix => "postfix",
        }
    }
}

impl Associativity {
    fn as_str(&self) -> &'static str {
        match self {
            Associativity::Left => "left",
            Associativity::Right => "right",
            Associativity::None => "none",
        }
    }
}

impl JsonSerializable for Diagnostic {
    fn push_json(&self, output: &mut String) {
        output.push_str("{\"code\":");
        push_json_string(output, self.code);
        output.push_str(",\"severity\":\"error\",\"message\":");
        push_json_string(output, &self.message);
        output.push_str(",\"span\":");
        self.span.push_json(output);
        output.push('}');
    }
}

impl JsonSerializable for SourceSpan {
    fn push_json(&self, output: &mut String) {
        output.push_str("{\"start\":");
        push_json_usize(output, self.start);
        output.push_str(",\"end\":");
        push_json_usize(output, self.end);
        output.push_str(",\"line\":");
        push_json_usize(output, self.line);
        output.push_str(",\"column\":");
        push_json_usize(output, self.column);
        output.push('}');
    }
}

fn invalid_utf8_result() -> String {
    "{\"diagnostics\":[{\"code\":\"GRAMMAR_PARSE_ERROR\",\"severity\":\"error\",\"message\":\"Grammar source is not valid UTF-8.\",\"span\":{\"start\":0,\"end\":0,\"line\":1,\"column\":1}}]}".to_string()
}

fn leaked_result_json(json: String) -> u64 {
    let bytes = json.into_bytes().into_boxed_slice();
    let len = bytes.len() as u64;
    let ptr = Box::into_raw(bytes) as *mut u8 as u64;
    (ptr << 32) | len
}

fn push_json_array<T: JsonSerializable>(output: &mut String, values: &[T]) {
    output.push('[');
    for (index, value) in values.iter().enumerate() {
        if index > 0 {
            output.push(',');
        }
        value.push_json(output);
    }
    output.push(']');
}

fn push_json_string_array(output: &mut String, values: &[String]) {
    output.push('[');
    for (index, value) in values.iter().enumerate() {
        if index > 0 {
            output.push(',');
        }
        push_json_string(output, value);
    }
    output.push(']');
}

fn push_json_string(output: &mut String, value: &str) {
    output.push('"');
    for char in value.chars() {
        match char {
            '"' => output.push_str("\\\""),
            '\\' => output.push_str("\\\\"),
            '\n' => output.push_str("\\n"),
            '\r' => output.push_str("\\r"),
            '\t' => output.push_str("\\t"),
            '\u{08}' => output.push_str("\\b"),
            '\u{0c}' => output.push_str("\\f"),
            char if char < '\u{20}' => {
                output.push_str("\\u");
                let code = char as u32;
                output.push(hex_digit((code >> 12) & 0xf));
                output.push(hex_digit((code >> 8) & 0xf));
                output.push(hex_digit((code >> 4) & 0xf));
                output.push(hex_digit(code & 0xf));
            }
            char => output.push(char),
        }
    }
    output.push('"');
}

fn push_json_usize(output: &mut String, value: usize) {
    output.push_str(&value.to_string());
}

fn push_json_u32(output: &mut String, value: u32) {
    output.push_str(&value.to_string());
}

fn hex_digit(value: u32) -> char {
    match value {
        0..=9 => (b'0' + value as u8) as char,
        _ => (b'a' + (value as u8 - 10)) as char,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_header_tokens_rules_and_constructors() {
        let result = parse_grammar(
            r#"
            grammar Tiny
            token IDENT priority 10 = /[A-Za-z_][A-Za-z0-9_]*/ ;
            skip WS = /[ \t\r\n]+/ ;
            module = item:IDENT -> Name(item) ;
            "#,
        );
        assert_eq!(result.diagnostics, Vec::new());
        let grammar = result.grammar.expect("expected grammar");
        assert_eq!(grammar.name.as_deref(), Some("Tiny"));
        assert_eq!(grammar.declarations.len(), 3);
        let token = match &grammar.declarations[0] {
            Declaration::Token(token) => token,
            _ => panic!("expected token"),
        };
        assert_eq!(token.priority, Some(10));
        let rule = match &grammar.declarations[2] {
            Declaration::Rule(rule) => rule,
            _ => panic!("expected rule"),
        };
        assert_eq!(rule.name, "module");
        match &rule.expression {
            Expression::Constructor {
                name, arguments, ..
            } => {
                assert_eq!(name, "Name");
                assert_eq!(arguments, &vec!["item".to_string()]);
            }
            _ => panic!("expected constructor"),
        }
    }

    #[test]
    fn parses_pratt_expression_island() {
        let result = parse_grammar(
            r#"
            grammar Expr
            token INT = /[0-9]+/ ;
            expr = INT {
              infix left 10 "+"
              prefix 20 "-"
            } ;
            "#,
        );
        assert_eq!(result.diagnostics, Vec::new());
        let grammar = result.grammar.expect("expected grammar");
        let rule = match &grammar.declarations[1] {
            Declaration::Rule(rule) => rule,
            _ => panic!("expected rule"),
        };
        match &rule.expression {
            Expression::ExpressionIsland { operators, .. } => {
                assert_eq!(operators.len(), 2);
                assert_eq!(operators[0].associativity, Some(Associativity::Left));
            }
            _ => panic!("expected expression island"),
        }
    }

    #[test]
    fn reports_syntax_diagnostics() {
        let result = parse_grammar("token = /unterminated");
        assert!(!result.diagnostics.is_empty());
        assert_eq!(result.diagnostics[0].code, "GRAMMAR_PARSE_ERROR");
    }
}
