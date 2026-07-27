#![no_std]

use core::panic::PanicInfo;

const WASM_ABI_VERSION: i32 = 9;
const RUNTIME_IMPLEMENTATION_VERSION: i32 = 2;
const MAX_WASM_PAGES: i32 = 65_535;
const SOURCE_ENCODING_UTF16: i32 = 1;
const SPAN_UNIT_UTF16: i32 = 1;
const HOST_OWNERSHIP_CALLER_MANAGED: i32 = 1;
const RESULT_LIFETIME_CALLER_BUFFER: i32 = 1;

const PLAN_MAGIC: i32 = 0x3150_5742;
const PLAN_FORMAT_VERSION: i32 = 4;
const PLAN_HEADER_MAGIC: i32 = 0;
const PLAN_HEADER_FORMAT_VERSION: i32 = 1;
const PLAN_HEADER_PARSER_PLAN_VERSION: i32 = 2;
const PLAN_HEADER_DFA_STATE_COUNT: i32 = 3;
const PLAN_HEADER_PARSER_STATE_COUNT: i32 = 4;
const PLAN_HEADER_ASCII_TRANSITIONS: i32 = 6;
const PLAN_HEADER_TRANSITION_ROWS: i32 = 7;
const PLAN_HEADER_TRANSITIONS: i32 = 8;
const PLAN_HEADER_ACTION_ROWS: i32 = 9;
const PLAN_HEADER_ACTION_PAIRS: i32 = 10;
const PLAN_HEADER_GOTO_ROWS: i32 = 11;
const PLAN_HEADER_GOTO_PAIRS: i32 = 12;
const PLAN_HEADER_BYTE_LENGTH: i32 = 13;
const PLAN_HEADER_SPEC_COUNT: i32 = 14;
const PLAN_HEADER_EOF_TERMINAL: i32 = 15;
const PLAN_HEADER_SPEC_TERMINALS: i32 = 16;
const PLAN_HEADER_ACCEPT_CANDIDATE_ROWS: i32 = 17;
const PLAN_HEADER_ACCEPT_CANDIDATES: i32 = 18;
const PLAN_HEADER_PRODUCTION_COUNT: i32 = 19;
const PLAN_HEADER_PRODUCTIONS: i32 = 20;
const PLAN_HEADER_SPEC_FLAGS: i32 = 21;
const PLAN_HEADER_SPEC_FOLLOW_STARTS: i32 = 22;
const PLAN_HEADER_SPEC_NOT_FOLLOW_STARTS: i32 = 23;
const PLAN_HEADER_GUARD_STATE_COUNT: i32 = 24;
const PLAN_HEADER_GUARD_ACCEPTS: i32 = 25;
const PLAN_HEADER_GUARD_TRANSITION_ROWS: i32 = 26;
const PLAN_HEADER_GUARD_TRANSITIONS: i32 = 27;
const PLAN_HEADER_SPEC_WORD_ROWS: i32 = 28;
const PLAN_HEADER_WORD_ROWS: i32 = 29;
const PLAN_HEADER_WORD_CODE_POINTS: i32 = 30;
const PLAN_HEADER_DFA_START_STATE: i32 = 31;
const PLAN_HEADER_BYTES: i32 = 36 * 4;
const SPEC_FLAG_CONTEXTUAL: i32 = 1;
const SPEC_FLAG_FOLLOW_EOF: i32 = 2;
const SPEC_FLAG_HAS_FOLLOW: i32 = 4;
const COMPACT_I16_OFFSET_TAG: i32 = 2;
const COMPACT_U16_OFFSET_BASE: i32 = 0x4000_0000;

const LEX_RESULT_I32_COUNT: i32 = 2;
const TOKEN_RECORD_I32_COUNT: i32 = 4;
const PARSE_CURSOR_RESULT_I32_COUNT: i32 = 10;
const CURSOR_RULE_RECORD_I32_COUNT: i32 = 9;
const CURSOR_FIELD_RECORD_I32_COUNT: i32 = 2;
const CURSOR_VALUE_RECORD_I32_COUNT: i32 = 4;
const CURSOR_CHILD_RECORD_I32_COUNT: i32 = 2;
const CURSOR_VALUE_ITEM_RECORD_I32_COUNT: i32 = 2;

const ACTION_SHIFT: i32 = 0x0100_0000;
const ACTION_REDUCE: i32 = 0x0200_0000;
const ACTION_ACCEPT: i32 = 0x0300_0000;
const ACTION_KIND_MASK: i32 = ACTION_SHIFT | ACTION_REDUCE | ACTION_ACCEPT;
const ACTION_PAYLOAD_MASK: i32 = 0x00ff_ffff;

// `lex_all` returns a token count, so its failures are the negative values.
const LEX_STATUS_TOKEN_CAPACITY: i32 = -1;
const LEX_STATUS_MEMO_CAPACITY: i32 = -2;

const PARSE_STATUS_OK: i32 = 0;
const PARSE_STATUS_UNEXPECTED: i32 = 1;
const PARSE_STATUS_INTERNAL: i32 = 2;
const PARSE_CURSOR_STATUS_CAPACITY: i32 = 3;
const PARSE_STATUS_TRACE_LIMIT: i32 = 4;
const PARSE_STATUS_AMBIGUOUS: i32 = 5;

const CURSOR_RESULT_TOKEN_COUNT: i32 = 0;
const CURSOR_RESULT_RULE_COUNT: i32 = 1;
const CURSOR_RESULT_CHILD_COUNT: i32 = 2;
const CURSOR_RESULT_FIELD_COUNT: i32 = 3;
const CURSOR_RESULT_VALUE_COUNT: i32 = 4;
const CURSOR_RESULT_VALUE_ITEM_COUNT: i32 = 5;
const CURSOR_RESULT_ROOT_REF: i32 = 6;
const CURSOR_RESULT_ERROR_OFFSET: i32 = 7;
const CURSOR_RESULT_ERROR_STATE: i32 = 8;
const CURSOR_RESULT_TOKEN_READ: i32 = 9;

const CURSOR_VALUE_NULL: i32 = 0;
const CURSOR_VALUE_REF: i32 = 1;
const CURSOR_VALUE_ARRAY: i32 = 2;

const CURSOR_REDUCER_START: i32 = 0;
const CURSOR_REDUCER_RULE: i32 = 1;
const CURSOR_REDUCER_TERMINAL: i32 = 2;
const CURSOR_REDUCER_RULE_REF: i32 = 3;
const CURSOR_REDUCER_IDENTITY: i32 = 4;
const CURSOR_REDUCER_SEQUENCE: i32 = 5;
const CURSOR_REDUCER_OPTIONAL_EMPTY: i32 = 6;
const CURSOR_REDUCER_OPTIONAL_SOME: i32 = 7;
const CURSOR_REDUCER_REPEAT_EMPTY: i32 = 8;
const CURSOR_REDUCER_REPEAT_APPEND: i32 = 9;
const CURSOR_REDUCER_REPEAT1_FIRST: i32 = 10;
const CURSOR_REDUCER_REPEAT1_APPEND: i32 = 11;
const CURSOR_REDUCER_SEPARATED_FIRST: i32 = 12;
const CURSOR_REDUCER_SEPARATED_APPEND: i32 = 13;
const CURSOR_REDUCER_FIELD: i32 = 14;

const FRAGMENT_VALUE: i32 = 0;
const FRAGMENT_CHILD_START: i32 = 1;
const FRAGMENT_CHILD_COUNT: i32 = 2;
const FRAGMENT_FIELD_START: i32 = 3;
const FRAGMENT_FIELD_COUNT: i32 = 4;
const FRAGMENT_SPAN_START: i32 = 5;
const FRAGMENT_SPAN_END: i32 = 6;
const FRAGMENT_TOKEN_START: i32 = 7;
const FRAGMENT_TOKEN_END: i32 = 8;
const FRAGMENT_CHILD_TAIL: i32 = 9;
const FRAGMENT_I32_COUNT: i32 = 10;

extern "C" {
    static __heap_base: u8;
}

static mut PLAN_BASE: i32 = -1;
static mut PLAN_LENGTH: i32 = 0;

#[inline]
unsafe fn load_i32(addr: i32) -> i32 {
    core::ptr::read_unaligned(addr as usize as *const i32)
}

#[inline]
unsafe fn store_i32(addr: i32, value: i32) {
    core::ptr::write_unaligned(addr as usize as *mut i32, value);
}

#[inline]
unsafe fn load_u16(addr: i32) -> u32 {
    core::ptr::read_unaligned(addr as usize as *const u16) as u32
}

#[inline]
unsafe fn load_i16(addr: i32) -> i32 {
    core::ptr::read_unaligned(addr as usize as *const i16) as i32
}

#[inline]
unsafe fn load_u16_i32(addr: i32) -> i32 {
    core::ptr::read_unaligned(addr as usize as *const u16) as i32
}

#[inline]
fn loaded_plan_base() -> i32 {
    unsafe { PLAN_BASE }
}

#[inline]
fn header_at(base: i32, field: i32) -> i32 {
    unsafe { load_i32(base + field * 4) }
}

#[inline]
fn header(field: i32) -> i32 {
    let base = loaded_plan_base();
    if base < 0 {
        return 0;
    }
    header_at(base, field)
}

#[inline]
fn plan_addr(offset: i32) -> i32 {
    loaded_plan_base() + offset
}

#[inline]
fn compact_u16_offset(encoded: i32) -> i32 {
    -encoded - COMPACT_U16_OFFSET_BASE
}

#[inline]
fn compact_i16_offset(encoded: i32) -> i32 {
    -encoded - COMPACT_I16_OFFSET_TAG
}

#[inline]
fn is_compact_u16_offset(encoded: i32) -> bool {
    encoded <= -COMPACT_U16_OFFSET_BASE
}

#[inline]
fn is_compact_i16_offset(encoded: i32) -> bool {
    encoded < -1 && !is_compact_u16_offset(encoded)
}

#[inline]
fn table_value(encoded_base: i32, index: i32) -> i32 {
    if is_compact_u16_offset(encoded_base) {
        return unsafe { load_u16_i32(plan_addr(compact_u16_offset(encoded_base)) + index * 2) };
    }
    if is_compact_i16_offset(encoded_base) {
        return unsafe { load_i16(plan_addr(compact_i16_offset(encoded_base)) + index * 2) };
    }
    unsafe { load_i32(plan_addr(encoded_base) + index * 4) }
}

#[inline]
fn header_table_value(field: i32, index: i32) -> i32 {
    table_value(header(field), index)
}

#[inline]
fn align8(value: i32) -> i32 {
    (value + 7) & !7
}

#[no_mangle]
pub extern "C" fn abi_version() -> i32 {
    WASM_ABI_VERSION
}

#[no_mangle]
pub extern "C" fn plan_version() -> i32 {
    header(PLAN_HEADER_PARSER_PLAN_VERSION)
}

#[no_mangle]
pub extern "C" fn semantics_version() -> i32 {
    RUNTIME_IMPLEMENTATION_VERSION
}

#[no_mangle]
pub extern "C" fn reset() {}

#[no_mangle]
pub extern "C" fn plan_buffer_base() -> i32 {
    unsafe { (&__heap_base as *const u8 as usize) as i32 }
}

#[no_mangle]
pub extern "C" fn input_base() -> i32 {
    let base = loaded_plan_base();
    if base < 0 {
        return 0;
    }
    align8(base + header(PLAN_HEADER_BYTE_LENGTH))
}

#[no_mangle]
pub extern "C" fn max_pages() -> i32 {
    MAX_WASM_PAGES
}

#[no_mangle]
pub extern "C" fn source_encoding() -> i32 {
    SOURCE_ENCODING_UTF16
}

#[no_mangle]
pub extern "C" fn span_unit() -> i32 {
    SPAN_UNIT_UTF16
}

#[no_mangle]
pub extern "C" fn lex_result_i32_count() -> i32 {
    LEX_RESULT_I32_COUNT
}

#[no_mangle]
pub extern "C" fn token_record_i32_count() -> i32 {
    TOKEN_RECORD_I32_COUNT
}

#[no_mangle]
pub extern "C" fn host_ownership_model() -> i32 {
    HOST_OWNERSHIP_CALLER_MANAGED
}

#[no_mangle]
pub extern "C" fn result_lifetime_model() -> i32 {
    RESULT_LIFETIME_CALLER_BUFFER
}

#[no_mangle]
pub extern "C" fn load_plan(ptr: i32, len: i32) -> i32 {
    if ptr <= 0 {
        return 0;
    }
    if ptr & 3 != 0 {
        return 0;
    }
    if len < PLAN_HEADER_BYTES {
        return 0;
    }
    if header_at(ptr, PLAN_HEADER_MAGIC) != PLAN_MAGIC {
        return 0;
    }
    if header_at(ptr, PLAN_HEADER_FORMAT_VERSION) != PLAN_FORMAT_VERSION {
        return 0;
    }
    let core_byte_length = header_at(ptr, PLAN_HEADER_BYTE_LENGTH);
    if core_byte_length < PLAN_HEADER_BYTES {
        return 0;
    }
    if core_byte_length > len {
        return 0;
    }
    // The DFA start state is an explicit header slot rather than an assumed 0.
    // Reject a plan whose start state is not a real state instead of walking
    // the transition table from an address that does not belong to a state.
    let start_state = header_at(ptr, PLAN_HEADER_DFA_START_STATE);
    if start_state < 0 || start_state >= header_at(ptr, PLAN_HEADER_DFA_STATE_COUNT) {
        return 0;
    }
    unsafe {
        PLAN_BASE = ptr;
        PLAN_LENGTH = len;
    }
    1
}

#[no_mangle]
pub extern "C" fn lex_one(src: i32, len: i32, offset: i32, result: i32) -> i32 {
    let start_state = header(PLAN_HEADER_DFA_START_STATE);
    let mut state = start_state;
    let mut index = offset;
    let mut best_spec = -1;
    let mut best_end = offset;

    while index < len {
        let decoded = decode_code_point(src, index, len);
        let target = transition(state, decoded.code_point);
        if target < 0 {
            break;
        }
        index += decoded.width;
        state = target;
        let accept = selected_global_spec(src, len, index, state);
        if accept >= 0 {
            best_spec = accept;
            best_end = index;
        }
    }

    if best_spec >= 0 {
        unsafe {
            store_i32(result, best_spec);
            store_i32(result + 4, best_end);
        }
        return 1;
    }
    0
}

/// i32 words of failure memo one source position needs: one bit per DFA state.
///
/// The memo is keyed by (position, state), NOT by position alone. A memo keyed
/// by position can hold only one state per position, so scans that reach the
/// same position in different states evict each other and no scan ever hits -
/// which is exactly what happens on any grammar with a repeated group that can
/// fail late (`/([0-9a-f][0-9a-f])+;/`, `/([A-Za-z0-9+\/]{4})+=/`, `/(aa)*b/`).
/// See `docs/performance.md`.
///
/// Hosts size the memo buffer with this rather than by reading the plan
/// header, so the bitset layout stays private to the engine.
#[no_mangle]
pub extern "C" fn lex_memo_i32_per_position() -> i32 {
    let states = header(PLAN_HEADER_DFA_STATE_COUNT);
    if states <= 0 {
        return 0;
    }
    (states + 31) / 32
}

/// i32 the memo buffer must hold for a source of `len` code units under the
/// currently loaded plan, or `-1` when that does not fit in an i32.
///
/// `len + 1` scan positions, because a scan can stop at end of input and that
/// configuration is worth memoising too.
fn memo_i32_count(len: i32) -> i32 {
    if len < 0 {
        return 0;
    }
    let words = lex_memo_i32_per_position();
    if words <= 0 {
        return 0;
    }
    let total = ((len as i64) + 1) * (words as i64);
    // Bounded by i32 BYTES rather than i32 words, so `memo_word_address` cannot
    // overflow the offset it computes.
    if total > (i32::MAX / 4) as i64 {
        return -1;
    }
    total as i32
}

/// Address of the memo word holding the bit for (`position`, `state`).
fn memo_word_address(memo: i32, words: i32, position: i32, state: i32) -> i32 {
    memo + (position * words + (state >> 5)) * 4
}

/// True when a previous scan in THIS call proved that arriving at `position` in
/// `state` cannot accept before the scan dies.
fn memo_is_set(memo: i32, words: i32, position: i32, state: i32) -> bool {
    // A plan whose transition table names a state outside the declared state
    // count would index past the bitset, so the width is enforced here rather
    // than assumed. Such a state is simply never memoised.
    if state < 0 || state >= words * 32 {
        return false;
    }
    let word = unsafe { load_i32(memo_word_address(memo, words, position, state)) };
    word & (1 << (state & 31)) != 0
}

fn memo_set(memo: i32, words: i32, position: i32, state: i32) {
    if state < 0 || state >= words * 32 {
        return;
    }
    let address = memo_word_address(memo, words, position, state);
    let word = unsafe { load_i32(address) };
    unsafe { store_i32(address, word | (1 << (state & 31))) };
}

fn memo_clear(memo: i32, word_count: i32) {
    let mut index = 0;
    while index < word_count {
        unsafe { store_i32(memo + index * 4, 0) };
        index += 1;
    }
}

/// Longest-match-with-restart tokenizer with a (position, state) failure memo.
///
/// Without the memo this is O(n^2): a scan that runs far past its last
/// accepting position throws that suffix away and the next token rescans it.
/// No dead-state or reachability prune can fire on the shapes that trigger it -
/// the parked states all have outgoing edges and can all still reach an accept.
/// See `docs/performance.md`.
///
/// The memo records, for source positions a scan visited AFTER its last accept,
/// the DFA state it was in. Arriving at the same position in the same state
/// again is the same deterministic future over the same input - `transition`
/// and `selected_global_spec` both depend only on `(src, len, position, state)`
/// - so it cannot accept either and the scan stops. Every tail step therefore
/// either lands on a (position, state) pair never seen before in this call or
/// ends the scan, which bounds total scan work at `O(len * stateCount)`.
///
/// The memo is exact in the direction that matters: a set bit is a true fact
/// about the input, so it can only stop a scan that was going to fail anyway,
/// and a bit that is never set only costs speed. Emitted records are unchanged,
/// `acceptingState` included, because the memo is consulted only strictly past
/// `best_end`, which is after `best_spec`, `best_end` and `best_state` are
/// settled for the token being cut.
///
/// It is switched on lazily. Until a call has thrown away more scan steps than
/// the source has code units the memo is neither read nor written and not even
/// zeroed, so ordinary source - which does run past its last accept whenever a
/// token is a proper prefix of a longer one - pays one compare per DFA step and
/// nothing else. That bounds the pre-memo waste at `O(len)`.
#[no_mangle]
pub extern "C" fn lex_all(
    src: i32,
    len: i32,
    _mode: i32,
    tokens: i32,
    token_capacity: i32,
    memo: i32,
    memo_capacity: i32,
) -> i32 {
    // One record per code point is the worst case - an unrecognisable code
    // point becomes its own error token - so `len` records is the requirement.
    if token_capacity < len {
        return LEX_STATUS_TOKEN_CAPACITY;
    }
    let memo_required = memo_i32_count(len);
    if memo_required < 0 {
        return LEX_STATUS_MEMO_CAPACITY;
    }
    if memo_capacity < memo_required {
        return LEX_STATUS_MEMO_CAPACITY;
    }

    let memo_words = lex_memo_i32_per_position();
    let mut memo_enabled = false;
    let mut wasted: i64 = 0;

    let mut offset = 0;
    let mut count = 0;

    let start_state = header(PLAN_HEADER_DFA_START_STATE);
    while offset < len {
        let mut state = start_state;
        let mut index = offset;
        let mut best_spec = -1;
        let mut best_end = offset;
        let mut best_state = -1;

        // Positions at or below `memo_floor` are never consulted. While the
        // memo is off it sits at `len`, which no `index` can exceed, so the
        // whole memo path costs one never-taken compare per DFA step. While it
        // is on it tracks `best_end`: a pair at or below the last accept cannot
        // be in the memo, because the memo only holds pairs that fail.
        let mut memo_floor = len;
        if memo_enabled {
            memo_floor = offset;
        }

        while index < len {
            let decoded = decode_code_point(src, index, len);
            let target = transition(state, decoded.code_point);
            if target < 0 {
                break;
            }
            index += decoded.width;
            state = target;
            if index > memo_floor && memo_is_set(memo, memo_words, index, state) {
                break;
            }
            let accept = selected_global_spec(src, len, index, state);
            if accept >= 0 {
                best_spec = accept;
                best_end = index;
                best_state = state;
                if memo_enabled {
                    memo_floor = index;
                }
            }
        }

        // `index` is now where the scan stopped: dead transition, memo hit or
        // end of input. Everything in `(best_end, index]` was visited without
        // accepting and cannot accept later, so it is memo-able.
        let scan_end = index;
        if memo_enabled {
            let mut memo_index = best_end;
            let mut memo_state = start_state;
            if best_spec >= 0 {
                memo_state = best_state;
            }
            while memo_index < scan_end {
                let decoded = decode_code_point(src, memo_index, len);
                let target = transition(memo_state, decoded.code_point);
                if target < 0 {
                    break;
                }
                memo_index += decoded.width;
                memo_state = target;
                memo_set(memo, memo_words, memo_index, memo_state);
            }
        } else {
            wasted += (scan_end - best_end) as i64;
            if memo_words > 0 && wasted > len as i64 {
                memo_clear(memo, memo_required);
                memo_enabled = true;
            }
        }

        let spec;
        let end;
        if best_spec >= 0 {
            spec = best_spec;
            end = best_end;
        } else {
            let decoded = decode_code_point(src, offset, len);
            spec = -1;
            end = offset + decoded.width;
        }

        store_token_record(tokens, count, spec, offset, end, best_state);
        offset = end;
        count += 1;
    }

    count
}

struct DecodedCodePoint {
    code_point: i32,
    width: i32,
}

fn decode_code_point(src: i32, index: i32, len: i32) -> DecodedCodePoint {
    let unit = unsafe { load_u16(src + index * 2) };
    let mut code_point = unit;
    let mut width = 1;
    if unit >= 0xd800 && unit <= 0xdbff && index + 1 < len {
        let next = unsafe { load_u16(src + (index + 1) * 2) };
        if next >= 0xdc00 && next <= 0xdfff {
            code_point = ((unit - 0xd800) << 10) + (next - 0xdc00) + 0x1_0000;
            width = 2;
        }
    }
    DecodedCodePoint {
        code_point: code_point as i32,
        width,
    }
}

fn transition(state: i32, code_point: i32) -> i32 {
    if state < 0 || state >= header(PLAN_HEADER_DFA_STATE_COUNT) {
        return -1;
    }

    // INVARIANT: when the plan carries a dense ASCII transition table it is
    // COMPLETE and AUTHORITATIVE for code points 0..127, so a negative cell
    // means "no transition" and the sparse CSR rows cannot add an answer.
    // `buildAsciiTransitions` (src/targets/runtime/wasm_core_runtime.ts)
    // materialises every ASCII code point of every transition of every state,
    // so an unset cell is exactly the range scan's own -1. Returning early here
    // skips a scan that provably cannot succeed; it is one wasted scan per
    // token on ASCII input (the maximal-munch failure step) and is worth
    // 6-11% of lex time. If that table is ever made partial while keeping this
    // header field, this early return silently produces wrong tokens - the
    // equivalence is pinned by "dense ASCII transitions agree with the sparse
    // CSR rows" in tests/wasm_lexer_ascii_table_test.ts.
    if code_point >= 0 && code_point < 128 {
        let ascii_offset = header(PLAN_HEADER_ASCII_TRANSITIONS);
        if ascii_offset >= 0 {
            let value = table_value(ascii_offset, state * 128 + code_point);
            if value >= 0 {
                return value;
            }
            return -1;
        }
        if is_compact_i16_offset(ascii_offset) {
            let compact_offset = compact_i16_offset(ascii_offset);
            let value =
                unsafe { load_i16(plan_addr(compact_offset) + (state * 128 + code_point) * 2) };
            if value >= 0 {
                return value;
            }
            return -1;
        }
    }

    let rows = header(PLAN_HEADER_TRANSITION_ROWS);
    let mut index = table_value(rows, state);
    let end = table_value(rows, state + 1);
    while index < end {
        let base = plan_addr(header(PLAN_HEADER_TRANSITIONS)) + index * 12;
        let start = unsafe { load_i32(base) };
        let stop = unsafe { load_i32(base + 4) };
        if code_point >= start && code_point <= stop {
            return unsafe { load_i32(base + 8) };
        }
        index += 1;
    }
    -1
}

fn selected_global_spec(src: i32, len: i32, end: i32, accepting_state: i32) -> i32 {
    let rows = header(PLAN_HEADER_ACCEPT_CANDIDATE_ROWS);
    let mut index = table_value(rows, accepting_state);
    let stop = table_value(rows, accepting_state + 1);
    while index < stop {
        let spec = table_value(header(PLAN_HEADER_ACCEPT_CANDIDATES), index);
        if spec_guard_matches(spec, src, len, end) {
            return spec;
        }
        index += 1;
    }
    -1
}

fn spec_guard_matches(spec: i32, src: i32, len: i32, offset: i32) -> bool {
    if spec < 0 || spec >= header(PLAN_HEADER_SPEC_COUNT) {
        return false;
    }
    let flags = header_table_value(PLAN_HEADER_SPEC_FLAGS, spec);
    let follow_start = header_table_value(PLAN_HEADER_SPEC_FOLLOW_STARTS, spec);
    let not_follow_start = header_table_value(PLAN_HEADER_SPEC_NOT_FOLLOW_STARTS, spec);
    let spec_word_rows = header(PLAN_HEADER_SPEC_WORD_ROWS);
    let word_start = table_value(spec_word_rows, spec);
    let word_end = table_value(spec_word_rows, spec + 1);
    if src < 0 {
        return flags & (SPEC_FLAG_HAS_FOLLOW | SPEC_FLAG_FOLLOW_EOF) == 0
            && not_follow_start < 0
            && word_start == word_end;
    }
    if flags & SPEC_FLAG_HAS_FOLLOW != 0 || flags & SPEC_FLAG_FOLLOW_EOF != 0 {
        let followed = offset == len && flags & SPEC_FLAG_FOLLOW_EOF != 0
            || guard_dfa_matches(follow_start, src, len, offset);
        if !followed {
            return false;
        }
    }
    if not_follow_start >= 0 && guard_dfa_matches(not_follow_start, src, len, offset) {
        return false;
    }
    !excluded_word_matches(spec, src, len, offset)
}

fn guard_dfa_matches(start: i32, src: i32, len: i32, offset: i32) -> bool {
    if start < 0 || start >= header(PLAN_HEADER_GUARD_STATE_COUNT) {
        return false;
    }
    let mut state = start;
    if header_table_value(PLAN_HEADER_GUARD_ACCEPTS, state) != 0 {
        return true;
    }
    let mut index = offset;
    while index < len {
        let decoded = decode_code_point(src, index, len);
        state = guard_transition(state, decoded.code_point);
        if state < 0 {
            return false;
        }
        index += decoded.width;
        if header_table_value(PLAN_HEADER_GUARD_ACCEPTS, state) != 0 {
            return true;
        }
    }
    false
}

fn guard_transition(state: i32, code_point: i32) -> i32 {
    if state < 0 || state >= header(PLAN_HEADER_GUARD_STATE_COUNT) {
        return -1;
    }
    let rows = header(PLAN_HEADER_GUARD_TRANSITION_ROWS);
    let mut index = table_value(rows, state);
    let end = table_value(rows, state + 1);
    while index < end {
        let base = plan_addr(header(PLAN_HEADER_GUARD_TRANSITIONS)) + index * 12;
        let start = unsafe { load_i32(base) };
        let stop = unsafe { load_i32(base + 4) };
        if code_point >= start && code_point <= stop {
            return unsafe { load_i32(base + 8) };
        }
        index += 1;
    }
    -1
}

fn excluded_word_matches(spec: i32, src: i32, len: i32, offset: i32) -> bool {
    let spec_rows = header(PLAN_HEADER_SPEC_WORD_ROWS);
    let mut word = table_value(spec_rows, spec);
    let word_end = table_value(spec_rows, spec + 1);
    while word < word_end {
        let rows = header(PLAN_HEADER_WORD_ROWS);
        let mut character = table_value(rows, word);
        let character_end = table_value(rows, word + 1);
        let mut source_offset = offset;
        let mut matches = true;
        while character < character_end {
            if source_offset >= len {
                matches = false;
                break;
            }
            let decoded = decode_code_point(src, source_offset, len);
            let expected = table_value(header(PLAN_HEADER_WORD_CODE_POINTS), character);
            if decoded.code_point != expected {
                matches = false;
                break;
            }
            source_offset += decoded.width;
            character += 1;
        }
        if matches {
            if source_offset >= len {
                return true;
            }
            let next = decode_code_point(src, source_offset, len).code_point;
            if !is_word_code_point(next) {
                return true;
            }
        }
        word += 1;
    }
    false
}

fn is_word_code_point(code_point: i32) -> bool {
    (code_point >= 'A' as i32 && code_point <= 'Z' as i32)
        || (code_point >= 'a' as i32 && code_point <= 'z' as i32)
        || (code_point >= '0' as i32 && code_point <= '9' as i32)
        || code_point == '_' as i32
}

#[no_mangle]
pub extern "C" fn parser_action(state: i32, terminal: i32) -> i32 {
    table_lookup(
        state,
        terminal,
        PLAN_HEADER_ACTION_ROWS,
        PLAN_HEADER_ACTION_PAIRS,
        PLAN_HEADER_PARSER_STATE_COUNT,
        0,
        true,
    )
}

#[no_mangle]
pub extern "C" fn parser_goto(state: i32, nonterminal: i32) -> i32 {
    table_lookup(
        state,
        nonterminal,
        PLAN_HEADER_GOTO_ROWS,
        PLAN_HEADER_GOTO_PAIRS,
        PLAN_HEADER_PARSER_STATE_COUNT,
        -1,
        false,
    )
}

fn table_lookup(
    state: i32,
    key: i32,
    rows_header: i32,
    pairs_header: i32,
    state_count_header: i32,
    missing: i32,
    decode_action: bool,
) -> i32 {
    if state < 0 || state >= header(state_count_header) {
        return missing;
    }
    let rows = header(rows_header);
    let mut index = table_value(rows, state);
    let end = table_value(rows, state + 1);
    let pairs = header(pairs_header);
    while index < end {
        if pair_key(pairs, index) == key {
            return pair_value(pairs, index, decode_action);
        }
        index += 1;
    }
    missing
}

#[no_mangle]
pub extern "C" fn parser_actions(state: i32, terminal: i32, output: i32, capacity: i32) -> i32 {
    if state < 0 || state >= header(PLAN_HEADER_PARSER_STATE_COUNT) {
        return -1;
    }
    let rows = header(PLAN_HEADER_ACTION_ROWS);
    let mut index = table_value(rows, state);
    let end = table_value(rows, state + 1);
    let pairs = header(PLAN_HEADER_ACTION_PAIRS);
    let mut count = 0;
    while index < end {
        if pair_key(pairs, index) == terminal {
            if count < capacity {
                unsafe { store_i32(output + count * 4, pair_value(pairs, index, true)) };
            }
            count += 1;
        }
        index += 1;
    }
    count
}

fn pair_key(encoded_pairs: i32, index: i32) -> i32 {
    if is_compact_u16_offset(encoded_pairs) {
        return unsafe { load_u16_i32(plan_addr(compact_u16_offset(encoded_pairs)) + index * 4) };
    }
    unsafe { load_i32(plan_addr(encoded_pairs) + index * 8) }
}

fn pair_value(encoded_pairs: i32, index: i32, decode_action: bool) -> i32 {
    if is_compact_u16_offset(encoded_pairs) {
        let raw =
            unsafe { load_u16_i32(plan_addr(compact_u16_offset(encoded_pairs)) + index * 4 + 2) };
        if decode_action {
            return decode_compact_action(raw);
        }
        return raw;
    }
    unsafe { load_i32(plan_addr(encoded_pairs) + index * 8 + 4) }
}

fn decode_compact_action(raw: i32) -> i32 {
    let kind = raw >> 14;
    let payload = raw & 0x3fff;
    if kind == 1 {
        return ACTION_SHIFT | payload;
    }
    if kind == 2 {
        return ACTION_REDUCE | payload;
    }
    if kind == 3 {
        return ACTION_ACCEPT;
    }
    0
}

#[no_mangle]
pub extern "C" fn parser_select_action(
    state: i32,
    accepting_state: i32,
    _fallback_spec: i32,
    result: i32,
) -> i32 {
    if accepting_state < 0 || accepting_state >= header(PLAN_HEADER_DFA_STATE_COUNT) {
        return -1;
    }

    let selection = select_action(state, accepting_state, false, -1, 0, 0);
    unsafe {
        store_i32(result, selection.checked_count);
    }
    if selection.selected_action == 0 {
        return 0;
    }
    unsafe {
        store_i32(result + 4, selection.selected_spec);
        store_i32(result + 8, selection.selected_terminal);
        store_i32(result + 12, selection.selected_action);
    }
    1
}

struct Selection {
    checked_count: i32,
    choice_count: i32,
    selected_spec: i32,
    selected_terminal: i32,
    selected_action: i32,
    trivia_spec: i32,
    ordinary_main_candidate_count: i32,
}

fn select_action(
    state: i32,
    accepting_state: i32,
    include_trivia: bool,
    src: i32,
    len: i32,
    end_offset: i32,
) -> Selection {
    let mut selection = Selection {
        checked_count: 0,
        choice_count: 0,
        selected_spec: -1,
        selected_terminal: -1,
        selected_action: 0,
        trivia_spec: -1,
        ordinary_main_candidate_count: 0,
    };

    let rows = header(PLAN_HEADER_ACCEPT_CANDIDATE_ROWS);
    let mut index = table_value(rows, accepting_state);
    let end = table_value(rows, accepting_state + 1);
    while index < end {
        let spec = table_value(header(PLAN_HEADER_ACCEPT_CANDIDATES), index);
        selection.checked_count += 1;
        if spec >= 0 && spec < header(PLAN_HEADER_SPEC_COUNT) {
            if !spec_guard_matches(spec, src, len, end_offset) {
                index += 1;
                continue;
            }
            let terminal = header_table_value(PLAN_HEADER_SPEC_TERMINALS, spec);
            if include_trivia && terminal < 0 {
                if selection.trivia_spec < 0 {
                    selection.trivia_spec = spec;
                }
            } else if terminal >= 0 {
                let flags = header_table_value(PLAN_HEADER_SPEC_FLAGS, spec);
                if flags & SPEC_FLAG_CONTEXTUAL == 0 {
                    selection.ordinary_main_candidate_count += 1;
                }
                let action = parser_action(state, terminal);
                if action != 0 {
                    selection.choice_count += 1;
                    if selection.selected_action == 0 {
                        selection.selected_spec = spec;
                        selection.selected_terminal = terminal;
                        selection.selected_action = action;
                    }
                }
            }
        }
        index += 1;
    }
    selection
}

fn select_trace_action(
    state: i32,
    accepting_state: i32,
    _fallback_spec: i32,
    src: i32,
    len: i32,
    end_offset: i32,
    result: i32,
) -> i32 {
    if accepting_state < 0 || accepting_state >= header(PLAN_HEADER_DFA_STATE_COUNT) {
        return -1;
    }
    let selection = select_action(state, accepting_state, true, src, len, end_offset);
    unsafe {
        store_i32(result, selection.checked_count);
        store_i32(result + 16, selection.trivia_spec);
        store_i32(result + 20, selection.ordinary_main_candidate_count);
    }
    if selection.choice_count == 0 {
        return 0;
    }
    unsafe {
        store_i32(result + 4, selection.selected_spec);
        store_i32(result + 8, selection.selected_terminal);
        store_i32(result + 12, selection.selected_action);
    }
    1
}

#[no_mangle]
pub extern "C" fn parse_trace(
    src: i32,
    len: i32,
    token_ptr: i32,
    token_capacity: i32,
    trace_ptr: i32,
    trace_capacity: i32,
    result: i32,
    stack_ptr: i32,
    stack_capacity: i32,
    memo_ptr: i32,
    memo_capacity: i32,
    preserve_trivia: i32,
    max_trace_actions: i32,
) -> i32 {
    let mut token_read = 0;
    let mut token_write = 0;
    let mut trace_count = 0;
    let mut current_state = 0;

    if token_capacity < len {
        return return_parse_trace_status(
            PARSE_STATUS_INTERNAL,
            result,
            token_write,
            trace_count,
            len,
            current_state,
            token_read,
        );
    }
    if stack_capacity < 1 {
        return return_parse_trace_status(
            PARSE_STATUS_INTERNAL,
            result,
            token_write,
            trace_count,
            len,
            current_state,
            token_read,
        );
    }
    let memo_required = memo_i32_count(len);
    if memo_required < 0 || memo_capacity < memo_required {
        return return_parse_trace_status(
            PARSE_STATUS_INTERNAL,
            result,
            token_write,
            trace_count,
            len,
            current_state,
            token_read,
        );
    }

    let raw_token_count = lex_all(
        src,
        len,
        0,
        token_ptr,
        token_capacity,
        memo_ptr,
        memo_capacity,
    );
    if raw_token_count < 0 || raw_token_count > token_capacity {
        return return_parse_trace_status(
            PARSE_STATUS_INTERNAL,
            result,
            token_write,
            trace_count,
            len,
            current_state,
            token_read,
        );
    }

    unsafe { store_i32(stack_ptr, 0) };
    let mut state_count = 1;

    loop {
        if state_count < 1 {
            return return_parse_trace_status(
                PARSE_STATUS_INTERNAL,
                result,
                token_write,
                trace_count,
                len,
                current_state,
                token_read,
            );
        }
        current_state = load_stack_value(stack_ptr, state_count);
        let action: i32;
        let start: i32;
        let accepting_state;
        let mut selected_spec = -1;

        if token_read < raw_token_count {
            let record = token_record_address(token_ptr, token_read);
            let spec = unsafe { load_i32(record) };
            start = unsafe { load_i32(record + 4) };
            let end = unsafe { load_i32(record + 8) };
            accepting_state = unsafe { load_i32(record + 12) };
            if spec < 0 {
                return return_parse_trace_status(
                    PARSE_STATUS_UNEXPECTED,
                    result,
                    token_write,
                    trace_count,
                    start,
                    current_state,
                    token_read,
                );
            }

            let status =
                select_trace_action(current_state, accepting_state, spec, src, len, end, result);
            if status == 1 {
                selected_spec = unsafe { load_i32(result + 4) };
                action = unsafe { load_i32(result + 12) };
            } else if status == 2 {
                return return_parse_trace_status(
                    PARSE_STATUS_AMBIGUOUS,
                    result,
                    token_write,
                    trace_count,
                    start,
                    current_state,
                    token_read,
                );
            } else if status == 0 {
                let trivia_spec = unsafe { load_i32(result + 16) };
                let ordinary_main_candidate_count = unsafe { load_i32(result + 20) };
                if ordinary_main_candidate_count == 0 {
                    if trivia_spec >= 0 {
                        if preserve_trivia != 0 {
                            store_token_record(
                                token_ptr,
                                token_write,
                                trivia_spec,
                                start,
                                end,
                                accepting_state,
                            );
                            token_write += 1;
                        }
                        token_read += 1;
                        continue;
                    }
                    return return_parse_trace_status(
                        PARSE_STATUS_UNEXPECTED,
                        result,
                        token_write,
                        trace_count,
                        start,
                        current_state,
                        token_read,
                    );
                }
                return return_parse_trace_status(
                    PARSE_STATUS_UNEXPECTED,
                    result,
                    token_write,
                    trace_count,
                    start,
                    current_state,
                    token_read,
                );
            } else {
                return return_parse_trace_status(
                    PARSE_STATUS_INTERNAL,
                    result,
                    token_write,
                    trace_count,
                    start,
                    current_state,
                    token_read,
                );
            }
        } else {
            start = len;
            accepting_state = -1;
            action = parser_action(current_state, header(PLAN_HEADER_EOF_TERMINAL));
            if action <= 0 {
                return return_parse_trace_status(
                    PARSE_STATUS_UNEXPECTED,
                    result,
                    token_write,
                    trace_count,
                    start,
                    current_state,
                    token_read,
                );
            }
        }

        if action == 0 {
            break;
        }
        if trace_count >= trace_capacity || trace_count >= max_trace_actions {
            return return_parse_trace_status(
                PARSE_STATUS_TRACE_LIMIT,
                result,
                token_write,
                trace_count,
                start,
                current_state,
                token_read,
            );
        }
        unsafe { store_i32(trace_ptr + trace_count * 4, action) };
        trace_count += 1;

        let kind = action & ACTION_KIND_MASK;
        let payload = action & ACTION_PAYLOAD_MASK;
        if kind == ACTION_SHIFT {
            if token_read >= raw_token_count {
                return return_parse_trace_status(
                    PARSE_STATUS_INTERNAL,
                    result,
                    token_write,
                    trace_count,
                    start,
                    current_state,
                    token_read,
                );
            }
            let record = token_record_address(token_ptr, token_read);
            let end = unsafe { load_i32(record + 8) };
            store_token_record(
                token_ptr,
                token_write,
                selected_spec,
                start,
                end,
                accepting_state,
            );
            token_write += 1;
            token_read += 1;
            if state_count >= stack_capacity {
                return return_parse_trace_status(
                    PARSE_STATUS_INTERNAL,
                    result,
                    token_write,
                    trace_count,
                    start,
                    current_state,
                    token_read,
                );
            }
            store_stack_value(stack_ptr, state_count, payload);
            state_count += 1;
            continue;
        }

        if kind == ACTION_REDUCE {
            if payload < 0 || payload >= header(PLAN_HEADER_PRODUCTION_COUNT) {
                return return_parse_trace_status(
                    PARSE_STATUS_INTERNAL,
                    result,
                    token_write,
                    trace_count,
                    start,
                    current_state,
                    token_read,
                );
            }
            let production = plan_addr(header(PLAN_HEADER_PRODUCTIONS)) + payload * 16;
            let lhs = unsafe { load_i32(production) };
            let rhs_length = unsafe { load_i32(production + 4) };
            if state_count < rhs_length {
                return return_parse_trace_status(
                    PARSE_STATUS_INTERNAL,
                    result,
                    token_write,
                    trace_count,
                    start,
                    current_state,
                    token_read,
                );
            }
            state_count -= rhs_length;
            let goto_source_state = load_stack_value(stack_ptr, state_count);
            let goto_state = parser_goto(goto_source_state, lhs);
            if goto_state < 0 || state_count >= stack_capacity {
                return return_parse_trace_status(
                    PARSE_STATUS_INTERNAL,
                    result,
                    token_write,
                    trace_count,
                    start,
                    current_state,
                    token_read,
                );
            }
            store_stack_value(stack_ptr, state_count, goto_state);
            state_count += 1;
            continue;
        }

        if kind == ACTION_ACCEPT {
            return return_parse_trace_status(
                PARSE_STATUS_OK,
                result,
                token_write,
                trace_count,
                start,
                current_state,
                token_read,
            );
        }

        return return_parse_trace_status(
            PARSE_STATUS_INTERNAL,
            result,
            token_write,
            trace_count,
            start,
            current_state,
            token_read,
        );
    }

    return_parse_trace_status(
        PARSE_STATUS_INTERNAL,
        result,
        token_write,
        trace_count,
        len,
        current_state,
        token_read,
    )
}

fn return_parse_trace_status(
    status: i32,
    result: i32,
    token_count: i32,
    trace_count: i32,
    offset: i32,
    state: i32,
    token_read: i32,
) -> i32 {
    unsafe {
        store_i32(result, token_count);
        store_i32(result + 4, trace_count);
        store_i32(result + 8, offset);
        store_i32(result + 12, state);
        store_i32(result + 16, token_read);
        store_i32(result + 20, 0);
    }
    status
}

#[inline]
fn token_record_address(token_ptr: i32, index: i32) -> i32 {
    token_ptr + index * TOKEN_RECORD_I32_COUNT * 4
}

fn store_token_record(
    token_ptr: i32,
    index: i32,
    spec: i32,
    start: i32,
    end: i32,
    accepting_state: i32,
) {
    let record = token_record_address(token_ptr, index);
    unsafe {
        store_i32(record, spec);
        store_i32(record + 4, start);
        store_i32(record + 8, end);
        store_i32(record + 12, accepting_state);
    }
}

#[inline]
fn load_stack_value(stack_ptr: i32, state_count: i32) -> i32 {
    unsafe { load_i32(stack_ptr + (state_count - 1) * 4) }
}

#[inline]
fn store_stack_value(stack_ptr: i32, index: i32, value: i32) {
    unsafe { store_i32(stack_ptr + index * 4, value) }
}

#[no_mangle]
pub extern "C" fn parse_cursor(
    src: i32,
    len: i32,
    token_ptr: i32,
    token_capacity: i32,
    rule_ptr: i32,
    rule_capacity: i32,
    child_ptr: i32,
    child_capacity: i32,
    field_ptr: i32,
    field_capacity: i32,
    value_ptr: i32,
    value_capacity: i32,
    value_item_ptr: i32,
    value_item_capacity: i32,
    result: i32,
    stack_ptr: i32,
    fragment_ptr: i32,
    fragment_capacity: i32,
    memo_ptr: i32,
    memo_capacity: i32,
    preserve_trivia: i32,
    max_trace_actions: i32,
) -> i32 {
    let ctx = CursorCtx {
        token_ptr,
        token_capacity,
        rule_ptr,
        rule_capacity,
        child_ptr,
        child_capacity,
        field_ptr,
        field_capacity,
        value_ptr,
        value_capacity,
        value_item_ptr,
        value_item_capacity,
        result,
        fragment_ptr,
    };
    ctx.initialize_result();

    let mut token_read = 0;
    let mut token_write = 0;
    let mut action_count = 0;
    let mut current_state = 0;
    let mut fragment_count = 0;

    if token_capacity < len {
        return return_parse_cursor_status(
            PARSE_CURSOR_STATUS_CAPACITY,
            result,
            token_write,
            len,
            current_state,
            token_read,
        );
    }
    if fragment_capacity < 1 {
        return return_parse_cursor_status(
            PARSE_CURSOR_STATUS_CAPACITY,
            result,
            token_write,
            len,
            current_state,
            token_read,
        );
    }
    // Reported as a capacity failure here rather than as the internal error a
    // negative `lex_all` return would otherwise become.
    let memo_required = memo_i32_count(len);
    if memo_required < 0 || memo_capacity < memo_required {
        return return_parse_cursor_status(
            PARSE_CURSOR_STATUS_CAPACITY,
            result,
            token_write,
            len,
            current_state,
            token_read,
        );
    }

    let raw_token_count = lex_all(
        src,
        len,
        0,
        token_ptr,
        token_capacity,
        memo_ptr,
        memo_capacity,
    );
    if raw_token_count < 0 {
        return return_parse_cursor_status(
            PARSE_STATUS_INTERNAL,
            result,
            token_write,
            len,
            current_state,
            token_read,
        );
    }
    if raw_token_count > token_capacity {
        return return_parse_cursor_status(
            PARSE_CURSOR_STATUS_CAPACITY,
            result,
            token_write,
            len,
            current_state,
            token_read,
        );
    }

    unsafe { store_i32(stack_ptr, 0) };
    let mut state_count = 1;

    loop {
        if state_count < 1 {
            return return_parse_cursor_status(
                PARSE_STATUS_INTERNAL,
                result,
                token_write,
                len,
                current_state,
                token_read,
            );
        }
        current_state = load_stack_value(stack_ptr, state_count);
        let action: i32;
        let start: i32;
        let end: i32;
        let accepting_state: i32;
        let mut selected_spec = -1;

        if token_read < raw_token_count {
            let record = token_record_address(token_ptr, token_read);
            let spec = unsafe { load_i32(record) };
            start = unsafe { load_i32(record + 4) };
            end = unsafe { load_i32(record + 8) };
            accepting_state = unsafe { load_i32(record + 12) };
            if spec < 0 {
                return return_parse_cursor_status(
                    PARSE_STATUS_UNEXPECTED,
                    result,
                    token_write,
                    start,
                    current_state,
                    token_read,
                );
            }

            let selection = select_action(current_state, accepting_state, true, src, len, end);
            if selection.choice_count == 0 {
                if selection.ordinary_main_candidate_count == 0 {
                    if selection.trivia_spec >= 0 {
                        if preserve_trivia != 0 {
                            store_token_record(
                                token_ptr,
                                token_write,
                                selection.trivia_spec,
                                start,
                                end,
                                accepting_state,
                            );
                            token_write += 1;
                        }
                        token_read += 1;
                        action = 0;
                    } else {
                        return return_parse_cursor_status(
                            PARSE_STATUS_UNEXPECTED,
                            result,
                            token_write,
                            start,
                            current_state,
                            token_read,
                        );
                    }
                } else {
                    return return_parse_cursor_status(
                        PARSE_STATUS_UNEXPECTED,
                        result,
                        token_write,
                        start,
                        current_state,
                        token_read,
                    );
                }
            } else {
                selected_spec = selection.selected_spec;
                action = selection.selected_action;
            }
        } else {
            start = len;
            end = len;
            accepting_state = -1;
            action = parser_action(current_state, header(PLAN_HEADER_EOF_TERMINAL));
            if action <= 0 {
                return return_parse_cursor_status(
                    PARSE_STATUS_UNEXPECTED,
                    result,
                    token_write,
                    start,
                    current_state,
                    token_read,
                );
            }
        }

        if action == 0 {
            continue;
        }
        if action_count >= max_trace_actions {
            return return_parse_cursor_status(
                PARSE_STATUS_TRACE_LIMIT,
                result,
                token_write,
                start,
                current_state,
                token_read,
            );
        }
        action_count += 1;

        let kind = action & ACTION_KIND_MASK;
        let payload = action & ACTION_PAYLOAD_MASK;
        if kind == ACTION_SHIFT {
            let status = append_shift_cursor_fragment(
                &ctx,
                token_write,
                selected_spec,
                start,
                end,
                accepting_state,
                fragment_count,
                token_read,
            );
            if status != PARSE_STATUS_OK {
                return return_parse_cursor_status(
                    status,
                    result,
                    token_write,
                    start,
                    accepting_state,
                    token_read,
                );
            }
            token_write += 1;
            token_read += 1;
            fragment_count += 1;
            if state_count >= fragment_capacity {
                return return_parse_cursor_status(
                    PARSE_CURSOR_STATUS_CAPACITY,
                    result,
                    token_write,
                    start,
                    current_state,
                    token_read,
                );
            }
            store_stack_value(stack_ptr, state_count, payload);
            state_count += 1;
            continue;
        }

        if kind == ACTION_REDUCE {
            if payload < 0 || payload >= header(PLAN_HEADER_PRODUCTION_COUNT) {
                return return_parse_cursor_status(
                    PARSE_STATUS_INTERNAL,
                    result,
                    token_write,
                    start,
                    current_state,
                    token_read,
                );
            }
            let production = plan_addr(header(PLAN_HEADER_PRODUCTIONS)) + payload * 16;
            let lhs = unsafe { load_i32(production) };
            let rhs_length = unsafe { load_i32(production + 4) };
            let reducer_kind = unsafe { load_i32(production + 8) };
            let reducer_arg = unsafe { load_i32(production + 12) };
            if state_count < rhs_length || fragment_count < rhs_length {
                return return_parse_cursor_status(
                    PARSE_STATUS_INTERNAL,
                    result,
                    token_write,
                    start,
                    current_state,
                    token_read,
                );
            }
            let rhs_start = fragment_count - rhs_length;
            state_count -= rhs_length;
            let goto_source_state = load_stack_value(stack_ptr, state_count);
            let reduced = reduce_cursor_production(
                &ctx,
                reducer_kind,
                reducer_arg,
                rhs_start,
                rhs_length,
                start,
                token_write,
                token_read,
            );
            if reduced.status != PARSE_STATUS_OK {
                return return_parse_cursor_status(
                    reduced.status,
                    result,
                    token_write,
                    start,
                    current_state,
                    token_read,
                );
            }
            fragment_count = reduced.fragment_count;

            let goto_state = parser_goto(goto_source_state, lhs);
            if goto_state < 0 {
                return return_parse_cursor_status(
                    PARSE_STATUS_INTERNAL,
                    result,
                    token_write,
                    start,
                    current_state,
                    token_read,
                );
            }
            if state_count >= fragment_capacity {
                return return_parse_cursor_status(
                    PARSE_CURSOR_STATUS_CAPACITY,
                    result,
                    token_write,
                    start,
                    current_state,
                    token_read,
                );
            }
            store_stack_value(stack_ptr, state_count, goto_state);
            state_count += 1;
            continue;
        }

        if kind == ACTION_ACCEPT {
            return accept_cursor_result(
                &ctx,
                fragment_count,
                token_write,
                start,
                current_state,
                token_read,
            );
        }

        return return_parse_cursor_status(
            PARSE_STATUS_INTERNAL,
            result,
            token_write,
            start,
            current_state,
            token_read,
        );
    }
}

/// A singly linked run of child edges or array items.
///
/// `head` and `tail` are node indices in the matching arena, `count` is the
/// number of nodes reachable from `head` that belong to this run. A `count`
/// below zero marks an exhausted arena. Runs may share a prefix: consumers only
/// ever walk `count` nodes, and a run is only extended in place when its tail
/// still has no successor, so a shared prefix can never be observed as longer
/// than it was when it was captured.
#[derive(Clone, Copy)]
struct CursorList {
    head: i32,
    tail: i32,
    count: i32,
}

const EMPTY_CURSOR_LIST: CursorList = CursorList {
    head: -1,
    tail: -1,
    count: 0,
};

const EXHAUSTED_CURSOR_LIST: CursorList = CursorList {
    head: -1,
    tail: -1,
    count: -1,
};

struct CursorCtx {
    token_ptr: i32,
    token_capacity: i32,
    rule_ptr: i32,
    rule_capacity: i32,
    child_ptr: i32,
    child_capacity: i32,
    field_ptr: i32,
    field_capacity: i32,
    value_ptr: i32,
    value_capacity: i32,
    value_item_ptr: i32,
    value_item_capacity: i32,
    result: i32,
    fragment_ptr: i32,
}

impl CursorCtx {
    fn initialize_result(&self) {
        let mut field = 0;
        while field < PARSE_CURSOR_RESULT_I32_COUNT {
            let mut value = 0;
            if field == CURSOR_RESULT_ROOT_REF {
                value = -1;
            }
            self.store_result(field, value);
            field += 1;
        }
    }

    #[inline]
    fn result_value(&self, field: i32) -> i32 {
        unsafe { load_i32(self.result + field * 4) }
    }

    #[inline]
    fn store_result(&self, field: i32, value: i32) {
        unsafe { store_i32(self.result + field * 4, value) }
    }

    fn append_value(&self, kind: i32, number: i32, item_start: i32, item_count: i32) -> i32 {
        let value_count = self.result_value(CURSOR_RESULT_VALUE_COUNT);
        if value_count >= self.value_capacity {
            return -1;
        }
        let record = cursor_value_record_address(self.value_ptr, value_count);
        unsafe {
            store_i32(record, kind);
            store_i32(record + 4, number);
            store_i32(record + 8, item_start);
            store_i32(record + 12, item_count);
        }
        self.store_result(CURSOR_RESULT_VALUE_COUNT, value_count + 1);
        value_count
    }

    #[inline]
    fn child_node_address(&self, node: i32) -> i32 {
        self.child_ptr + node * CURSOR_CHILD_RECORD_I32_COUNT * 4
    }

    fn append_child(&self, reference: i32) -> i32 {
        let count = self.result_value(CURSOR_RESULT_CHILD_COUNT);
        if count >= self.child_capacity {
            return -1;
        }
        let record = self.child_node_address(count);
        unsafe {
            store_i32(record, reference);
            store_i32(record + 4, -1);
        }
        self.store_result(CURSOR_RESULT_CHILD_COUNT, count + 1);
        count
    }

    fn single_child_list(&self, reference: i32) -> CursorList {
        let node = self.append_child(reference);
        if node < 0 {
            return EXHAUSTED_CURSOR_LIST;
        }
        CursorList {
            head: node,
            tail: node,
            count: 1,
        }
    }

    fn copy_child_list(&self, list: CursorList) -> CursorList {
        let mut copied = EMPTY_CURSOR_LIST;
        let mut node = list.head;
        let mut index = 0;
        while index < list.count {
            if node < 0 {
                return EXHAUSTED_CURSOR_LIST;
            }
            let reference = unsafe { load_i32(self.child_node_address(node)) };
            let next = unsafe { load_i32(self.child_node_address(node) + 4) };
            let appended = self.append_child(reference);
            if appended < 0 {
                return EXHAUSTED_CURSOR_LIST;
            }
            if copied.count == 0 {
                copied.head = appended;
            } else {
                unsafe { store_i32(self.child_node_address(copied.tail) + 4, appended) };
            }
            copied.tail = appended;
            copied.count += 1;
            node = next;
            index += 1;
        }
        copied
    }

    fn concat_child_lists(&self, left: CursorList, right: CursorList) -> CursorList {
        if left.count < 0 || right.count < 0 {
            return EXHAUSTED_CURSOR_LIST;
        }
        if right.count == 0 {
            return left;
        }
        if left.count == 0 {
            return right;
        }
        let mut prefix = left;
        if unsafe { load_i32(self.child_node_address(left.tail) + 4) } != -1 {
            prefix = self.copy_child_list(left);
            if prefix.count < 0 {
                return EXHAUSTED_CURSOR_LIST;
            }
        }
        unsafe { store_i32(self.child_node_address(prefix.tail) + 4, right.head) };
        CursorList {
            head: prefix.head,
            tail: right.tail,
            count: prefix.count + right.count,
        }
    }

    fn append_field(&self, field_id: i32, value_id: i32) -> i32 {
        let count = self.result_value(CURSOR_RESULT_FIELD_COUNT);
        if count >= self.field_capacity {
            return -1;
        }
        let record = cursor_field_record_address(self.field_ptr, count);
        unsafe {
            store_i32(record, field_id);
            store_i32(record + 4, value_id);
        }
        self.store_result(CURSOR_RESULT_FIELD_COUNT, count + 1);
        count
    }

    fn copy_fields(&self, source_start: i32, source_count: i32) -> i32 {
        let output_start = self.result_value(CURSOR_RESULT_FIELD_COUNT);
        let mut index = 0;
        while index < source_count {
            let record = cursor_field_record_address(self.field_ptr, source_start + index);
            let field_id = unsafe { load_i32(record) };
            let value_id = unsafe { load_i32(record + 4) };
            if self.append_field(field_id, value_id) < 0 {
                return -1;
            }
            index += 1;
        }
        output_start
    }

    #[inline]
    fn value_item_node_address(&self, node: i32) -> i32 {
        self.value_item_ptr + node * CURSOR_VALUE_ITEM_RECORD_I32_COUNT * 4
    }

    fn append_value_item(&self, value_id: i32) -> i32 {
        let count = self.result_value(CURSOR_RESULT_VALUE_ITEM_COUNT);
        if count >= self.value_item_capacity {
            return -1;
        }
        let record = self.value_item_node_address(count);
        unsafe {
            store_i32(record, value_id);
            store_i32(record + 4, -1);
        }
        self.store_result(CURSOR_RESULT_VALUE_ITEM_COUNT, count + 1);
        count
    }

    fn copy_value_item_list(&self, list: CursorList) -> CursorList {
        let mut copied = EMPTY_CURSOR_LIST;
        let mut node = list.head;
        let mut index = 0;
        while index < list.count {
            if node < 0 {
                return EXHAUSTED_CURSOR_LIST;
            }
            let value_id = unsafe { load_i32(self.value_item_node_address(node)) };
            let next = unsafe { load_i32(self.value_item_node_address(node) + 4) };
            let appended = self.append_value_item(value_id);
            if appended < 0 {
                return EXHAUSTED_CURSOR_LIST;
            }
            if copied.count == 0 {
                copied.head = appended;
            } else {
                unsafe { store_i32(self.value_item_node_address(copied.tail) + 4, appended) };
            }
            copied.tail = appended;
            copied.count += 1;
            node = next;
            index += 1;
        }
        copied
    }

    fn concat_value_item_lists(&self, left: CursorList, right: CursorList) -> CursorList {
        if left.count < 0 || right.count < 0 {
            return EXHAUSTED_CURSOR_LIST;
        }
        if right.count == 0 {
            return left;
        }
        if left.count == 0 {
            return right;
        }
        let mut prefix = left;
        if unsafe { load_i32(self.value_item_node_address(left.tail) + 4) } != -1 {
            prefix = self.copy_value_item_list(left);
            if prefix.count < 0 {
                return EXHAUSTED_CURSOR_LIST;
            }
        }
        unsafe { store_i32(self.value_item_node_address(prefix.tail) + 4, right.head) };
        CursorList {
            head: prefix.head,
            tail: right.tail,
            count: prefix.count + right.count,
        }
    }

    fn array_value_list(&self, value_id: i32) -> CursorList {
        let record = cursor_value_record_address(self.value_ptr, value_id);
        if unsafe { load_i32(record) } != CURSOR_VALUE_ARRAY {
            return EXHAUSTED_CURSOR_LIST;
        }
        CursorList {
            head: unsafe { load_i32(record + 8) },
            tail: unsafe { load_i32(record + 4) },
            count: unsafe { load_i32(record + 12) },
        }
    }

    fn append_array_value(&self, list: CursorList) -> i32 {
        self.append_value(CURSOR_VALUE_ARRAY, list.tail, list.head, list.count)
    }

    fn append_array_copy_plus(&self, old_value_id: i32, add_value_id: i32, flatten: i32) -> i32 {
        let old_list = self.array_value_list(old_value_id);
        if old_list.count < 0 {
            return -2;
        }
        let mut addition = EXHAUSTED_CURSOR_LIST;
        if flatten != 0 {
            addition = self.array_value_list(add_value_id);
        }
        if addition.count < 0 {
            let node = self.append_value_item(add_value_id);
            if node < 0 {
                return -1;
            }
            addition = CursorList {
                head: node,
                tail: node,
                count: 1,
            };
        }
        let combined = self.concat_value_item_lists(old_list, addition);
        if combined.count < 0 {
            return -1;
        }
        self.append_array_value(combined)
    }

    fn create_single_value_array(&self, item_value: i32) -> i32 {
        let node = self.append_value_item(item_value);
        if node < 0 {
            return -1;
        }
        self.append_array_value(CursorList {
            head: node,
            tail: node,
            count: 1,
        })
    }

    fn append_repeated_fields(
        &self,
        target_start: i32,
        source_start: i32,
        source_count: i32,
    ) -> i32 {
        let mut source_index = 0;
        while source_index < source_count {
            let source_record =
                cursor_field_record_address(self.field_ptr, source_start + source_index);
            let source_field_id = unsafe { load_i32(source_record) };
            let source_value_id = unsafe { load_i32(source_record + 4) };
            let search_end = self.result_value(CURSOR_RESULT_FIELD_COUNT);
            let mut search_index = target_start;
            let mut found = 0;
            while search_index < search_end {
                let target_record = cursor_field_record_address(self.field_ptr, search_index);
                if unsafe { load_i32(target_record) } == source_field_id {
                    let target_value_id = unsafe { load_i32(target_record + 4) };
                    let target_value_record =
                        cursor_value_record_address(self.value_ptr, target_value_id);
                    if unsafe { load_i32(target_value_record) } == CURSOR_VALUE_ARRAY {
                        let new_value_id =
                            self.append_array_copy_plus(target_value_id, source_value_id, 1);
                        if new_value_id < 0 {
                            return new_value_id;
                        }
                        unsafe { store_i32(target_record + 4, new_value_id) };
                        found = 1;
                        break;
                    }
                }
                search_index += 1;
            }
            if found == 0 {
                let new_value_id = self.create_single_value_array(source_value_id);
                if new_value_id < 0 {
                    return new_value_id;
                }
                if self.append_field(source_field_id, new_value_id) < 0 {
                    return -1;
                }
            }
            source_index += 1;
        }
        0
    }

    fn append_rule(
        &self,
        rule_id: i32,
        span_start: i32,
        span_end: i32,
        token_start: i32,
        token_end: i32,
        child_start: i32,
        child_count: i32,
        field_start: i32,
        field_count: i32,
    ) -> i32 {
        let rule_count = self.result_value(CURSOR_RESULT_RULE_COUNT);
        if rule_count >= self.rule_capacity {
            return -1;
        }
        let record = self.rule_ptr + rule_count * CURSOR_RULE_RECORD_I32_COUNT * 4;
        unsafe {
            store_i32(record, rule_id);
            store_i32(record + 4, span_start);
            store_i32(record + 8, span_end);
            store_i32(record + 12, token_start);
            store_i32(record + 16, token_end);
            store_i32(record + 20, child_start);
            store_i32(record + 24, child_count);
            store_i32(record + 28, field_start);
            store_i32(record + 32, field_count);
        }
        self.store_result(CURSOR_RESULT_RULE_COUNT, rule_count + 1);
        rule_count << 1
    }
}

struct ReduceResult {
    status: i32,
    fragment_count: i32,
}

fn return_parse_cursor_status(
    status: i32,
    result: i32,
    token_count: i32,
    offset: i32,
    state: i32,
    token_read: i32,
) -> i32 {
    unsafe {
        store_i32(result + CURSOR_RESULT_TOKEN_COUNT * 4, token_count);
        store_i32(result + CURSOR_RESULT_ERROR_OFFSET * 4, offset);
        store_i32(result + CURSOR_RESULT_ERROR_STATE * 4, state);
        store_i32(result + CURSOR_RESULT_TOKEN_READ * 4, token_read);
    }
    status
}

#[inline]
fn cursor_value_record_address(value_ptr: i32, index: i32) -> i32 {
    value_ptr + index * CURSOR_VALUE_RECORD_I32_COUNT * 4
}

#[inline]
fn cursor_field_record_address(field_ptr: i32, index: i32) -> i32 {
    field_ptr + index * CURSOR_FIELD_RECORD_I32_COUNT * 4
}

#[inline]
fn fragment_address(ctx: &CursorCtx, index: i32) -> i32 {
    ctx.fragment_ptr + index * FRAGMENT_I32_COUNT * 4
}

#[inline]
fn fragment_field(ctx: &CursorCtx, index: i32, field: i32) -> i32 {
    unsafe { load_i32(fragment_address(ctx, index) + field * 4) }
}

#[inline]
fn store_fragment_field(ctx: &CursorCtx, index: i32, field: i32, value: i32) {
    unsafe { store_i32(fragment_address(ctx, index) + field * 4, value) }
}

#[inline]
fn fragment_child_list(ctx: &CursorCtx, index: i32) -> CursorList {
    CursorList {
        head: fragment_field(ctx, index, FRAGMENT_CHILD_START),
        tail: fragment_field(ctx, index, FRAGMENT_CHILD_TAIL),
        count: fragment_field(ctx, index, FRAGMENT_CHILD_COUNT),
    }
}

fn store_result_fragment(
    ctx: &CursorCtx,
    index: i32,
    value: i32,
    children: CursorList,
    field_start: i32,
    field_count: i32,
    span_start: i32,
    span_end: i32,
    token_start: i32,
    token_end: i32,
) {
    store_fragment_field(ctx, index, FRAGMENT_VALUE, value);
    store_fragment_field(ctx, index, FRAGMENT_CHILD_START, children.head);
    store_fragment_field(ctx, index, FRAGMENT_CHILD_TAIL, children.tail);
    store_fragment_field(ctx, index, FRAGMENT_CHILD_COUNT, children.count);
    store_fragment_field(ctx, index, FRAGMENT_FIELD_START, field_start);
    store_fragment_field(ctx, index, FRAGMENT_FIELD_COUNT, field_count);
    store_fragment_field(ctx, index, FRAGMENT_SPAN_START, span_start);
    store_fragment_field(ctx, index, FRAGMENT_SPAN_END, span_end);
    store_fragment_field(ctx, index, FRAGMENT_TOKEN_START, token_start);
    store_fragment_field(ctx, index, FRAGMENT_TOKEN_END, token_end);
}

fn append_shift_cursor_fragment(
    ctx: &CursorCtx,
    token_write: i32,
    selected_spec: i32,
    start: i32,
    end: i32,
    accepting_state: i32,
    fragment_count: i32,
    token_read: i32,
) -> i32 {
    if token_write >= ctx.token_capacity {
        return PARSE_CURSOR_STATUS_CAPACITY;
    }
    store_token_record(
        ctx.token_ptr,
        token_write,
        selected_spec,
        start,
        end,
        accepting_state,
    );
    let token_ref = (token_write << 1) | 1;
    let value = ctx.append_value(CURSOR_VALUE_REF, token_ref, -1, 0);
    if value < 0 {
        return PARSE_CURSOR_STATUS_CAPACITY;
    }
    let children = ctx.single_child_list(token_ref);
    if children.count < 0 {
        return PARSE_CURSOR_STATUS_CAPACITY;
    }
    let field_start = ctx.result_value(CURSOR_RESULT_FIELD_COUNT);
    store_result_fragment(
        ctx,
        fragment_count,
        value,
        children,
        field_start,
        0,
        start,
        end,
        token_write,
        token_write + 1,
    );
    let _ = token_read;
    PARSE_STATUS_OK
}

fn reduce_cursor_production(
    ctx: &CursorCtx,
    reducer_kind: i32,
    reducer_arg: i32,
    rhs_start: i32,
    rhs_length: i32,
    offset: i32,
    token_write: i32,
    token_read: i32,
) -> ReduceResult {
    if reducer_kind == CURSOR_REDUCER_START
        || reducer_kind == CURSOR_REDUCER_TERMINAL
        || reducer_kind == CURSOR_REDUCER_RULE_REF
        || reducer_kind == CURSOR_REDUCER_IDENTITY
        || reducer_kind == CURSOR_REDUCER_OPTIONAL_SOME
    {
        return ReduceResult {
            status: PARSE_STATUS_OK,
            fragment_count: rhs_start + 1,
        };
    }

    if reducer_kind == CURSOR_REDUCER_RULE {
        return reduce_cursor_rule(ctx, reducer_arg, rhs_start, offset, token_write, token_read);
    }
    if reducer_kind == CURSOR_REDUCER_OPTIONAL_EMPTY {
        return reduce_cursor_empty(
            ctx,
            CURSOR_VALUE_NULL,
            rhs_start,
            offset,
            token_write,
            token_read,
        );
    }
    if reducer_kind == CURSOR_REDUCER_REPEAT_EMPTY {
        return reduce_cursor_empty(
            ctx,
            CURSOR_VALUE_ARRAY,
            rhs_start,
            offset,
            token_write,
            token_read,
        );
    }
    if reducer_kind == CURSOR_REDUCER_SEQUENCE {
        return reduce_cursor_sequence(ctx, rhs_start, rhs_length, offset, token_write, token_read);
    }
    if reducer_kind == CURSOR_REDUCER_REPEAT1_FIRST
        || reducer_kind == CURSOR_REDUCER_SEPARATED_FIRST
    {
        return reduce_cursor_first_repeated(ctx, rhs_start, offset, token_write, token_read);
    }
    if reducer_kind == CURSOR_REDUCER_REPEAT_APPEND || reducer_kind == CURSOR_REDUCER_REPEAT1_APPEND
    {
        return reduce_cursor_append(ctx, 0, rhs_start, offset, token_write, token_read);
    }
    if reducer_kind == CURSOR_REDUCER_SEPARATED_APPEND {
        return reduce_cursor_append(ctx, 1, rhs_start, offset, token_write, token_read);
    }
    if reducer_kind == CURSOR_REDUCER_FIELD {
        return reduce_cursor_field(ctx, reducer_arg, rhs_start, offset, token_write, token_read);
    }

    ReduceResult {
        status: PARSE_STATUS_INTERNAL,
        fragment_count: rhs_start,
    }
}

fn reduce_cursor_rule(
    ctx: &CursorCtx,
    rule_id: i32,
    rhs_start: i32,
    offset: i32,
    token_write: i32,
    token_read: i32,
) -> ReduceResult {
    let span_start = fragment_field(ctx, rhs_start, FRAGMENT_SPAN_START);
    let span_end = fragment_field(ctx, rhs_start, FRAGMENT_SPAN_END);
    let token_start = fragment_field(ctx, rhs_start, FRAGMENT_TOKEN_START);
    let token_end = fragment_field(ctx, rhs_start, FRAGMENT_TOKEN_END);
    let source_children = fragment_child_list(ctx, rhs_start);
    let source_field_start = fragment_field(ctx, rhs_start, FRAGMENT_FIELD_START);
    let source_field_count = fragment_field(ctx, rhs_start, FRAGMENT_FIELD_COUNT);
    let rule_ref = ctx.append_rule(
        rule_id,
        span_start,
        span_end,
        token_start,
        token_end,
        source_children.head,
        source_children.count,
        source_field_start,
        source_field_count,
    );
    if rule_ref < 0 {
        return capacity_result(rhs_start);
    }
    let value = ctx.append_value(CURSOR_VALUE_REF, rule_ref, -1, 0);
    if value < 0 {
        return capacity_result(rhs_start);
    }
    let children = ctx.single_child_list(rule_ref);
    if children.count < 0 {
        return capacity_result(rhs_start);
    }
    let field_start = ctx.result_value(CURSOR_RESULT_FIELD_COUNT);
    store_result_fragment(
        ctx,
        rhs_start,
        value,
        children,
        field_start,
        0,
        span_start,
        span_end,
        token_start,
        token_end,
    );
    let _ = (offset, token_write, token_read);
    ok_result(rhs_start + 1)
}

fn reduce_cursor_empty(
    ctx: &CursorCtx,
    value_kind: i32,
    rhs_start: i32,
    offset: i32,
    token_write: i32,
    token_read: i32,
) -> ReduceResult {
    let value = ctx.append_value(value_kind, -1, -1, 0);
    if value < 0 {
        return capacity_result(rhs_start);
    }
    let field_start = ctx.result_value(CURSOR_RESULT_FIELD_COUNT);
    store_result_fragment(
        ctx,
        rhs_start,
        value,
        EMPTY_CURSOR_LIST,
        field_start,
        0,
        offset,
        offset,
        token_write,
        token_write,
    );
    let _ = token_read;
    ok_result(rhs_start + 1)
}

fn reduce_cursor_sequence(
    ctx: &CursorCtx,
    rhs_start: i32,
    rhs_length: i32,
    offset: i32,
    token_write: i32,
    token_read: i32,
) -> ReduceResult {
    let mut value = ctx.append_value(CURSOR_VALUE_ARRAY, -1, -1, 0);
    if value < 0 {
        return capacity_result(rhs_start);
    }

    let mut index = 0;
    while index < rhs_length {
        let item_value = fragment_field(ctx, rhs_start + index, FRAGMENT_VALUE);
        value = ctx.append_array_copy_plus(value, item_value, 0);
        if value < 0 {
            return capacity_result(rhs_start);
        }
        index += 1;
    }

    let mut children = EMPTY_CURSOR_LIST;
    let field_start = ctx.result_value(CURSOR_RESULT_FIELD_COUNT);
    index = 0;
    while index < rhs_length {
        children = ctx.concat_child_lists(children, fragment_child_list(ctx, rhs_start + index));
        if children.count < 0 {
            return capacity_result(rhs_start);
        }
        let source_field_start = fragment_field(ctx, rhs_start + index, FRAGMENT_FIELD_START);
        let source_field_count = fragment_field(ctx, rhs_start + index, FRAGMENT_FIELD_COUNT);
        if ctx.copy_fields(source_field_start, source_field_count) < 0 {
            return capacity_result(rhs_start);
        }
        index += 1;
    }
    let field_count = ctx.result_value(CURSOR_RESULT_FIELD_COUNT) - field_start;

    let span_start;
    let span_end;
    let token_start;
    let token_end;
    if rhs_length == 0 {
        span_start = offset;
        span_end = offset;
        token_start = token_write;
        token_end = token_write;
    } else {
        let last = rhs_start + rhs_length - 1;
        span_start = fragment_field(ctx, rhs_start, FRAGMENT_SPAN_START);
        span_end = fragment_field(ctx, last, FRAGMENT_SPAN_END);
        token_start = fragment_field(ctx, rhs_start, FRAGMENT_TOKEN_START);
        token_end = fragment_field(ctx, last, FRAGMENT_TOKEN_END);
    }
    store_result_fragment(
        ctx,
        rhs_start,
        value,
        children,
        field_start,
        field_count,
        span_start,
        span_end,
        token_start,
        token_end,
    );
    let _ = token_read;
    ok_result(rhs_start + 1)
}

fn reduce_cursor_first_repeated(
    ctx: &CursorCtx,
    rhs_start: i32,
    offset: i32,
    token_write: i32,
    token_read: i32,
) -> ReduceResult {
    let item_value = fragment_field(ctx, rhs_start, FRAGMENT_VALUE);
    let item_children = fragment_child_list(ctx, rhs_start);
    let item_field_start = fragment_field(ctx, rhs_start, FRAGMENT_FIELD_START);
    let item_field_count = fragment_field(ctx, rhs_start, FRAGMENT_FIELD_COUNT);
    let item_span_start = fragment_field(ctx, rhs_start, FRAGMENT_SPAN_START);
    let item_span_end = fragment_field(ctx, rhs_start, FRAGMENT_SPAN_END);
    let item_token_start = fragment_field(ctx, rhs_start, FRAGMENT_TOKEN_START);
    let item_token_end = fragment_field(ctx, rhs_start, FRAGMENT_TOKEN_END);

    let mut value = ctx.append_value(CURSOR_VALUE_ARRAY, -1, -1, 0);
    if value < 0 {
        return capacity_result(rhs_start);
    }
    value = ctx.append_array_copy_plus(value, item_value, 0);
    if value < 0 {
        return capacity_result(rhs_start);
    }
    let field_start = ctx.result_value(CURSOR_RESULT_FIELD_COUNT);
    let appended = ctx.append_repeated_fields(field_start, item_field_start, item_field_count);
    if appended < 0 {
        return capacity_result(rhs_start);
    }
    let field_count = ctx.result_value(CURSOR_RESULT_FIELD_COUNT) - field_start;
    store_result_fragment(
        ctx,
        rhs_start,
        value,
        item_children,
        field_start,
        field_count,
        item_span_start,
        item_span_end,
        item_token_start,
        item_token_end,
    );
    let _ = (offset, token_write, token_read);
    ok_result(rhs_start + 1)
}

fn reduce_cursor_append(
    ctx: &CursorCtx,
    separated: i32,
    rhs_start: i32,
    offset: i32,
    token_write: i32,
    token_read: i32,
) -> ReduceResult {
    let item_index_offset = if separated == 1 { 2 } else { 1 };
    let mut value = fragment_field(ctx, rhs_start, FRAGMENT_VALUE);
    let item_value = fragment_field(ctx, rhs_start + item_index_offset, FRAGMENT_VALUE);
    value = ctx.append_array_copy_plus(value, item_value, 0);
    if value < 0 {
        return capacity_result(rhs_start);
    }

    let mut children = fragment_child_list(ctx, rhs_start);
    let field_start = ctx.result_value(CURSOR_RESULT_FIELD_COUNT);
    if copy_fragment_fields(ctx, rhs_start, 0) < 0 {
        return capacity_result(rhs_start);
    }
    if separated == 1 {
        children = ctx.concat_child_lists(children, fragment_child_list(ctx, rhs_start + 1));
        if children.count < 0 {
            return capacity_result(rhs_start);
        }
        if append_fragment_repeated_fields(ctx, rhs_start, 1, field_start) < 0 {
            return capacity_result(rhs_start);
        }
    }
    children = ctx.concat_child_lists(
        children,
        fragment_child_list(ctx, rhs_start + item_index_offset),
    );
    if children.count < 0 {
        return capacity_result(rhs_start);
    }
    if append_fragment_repeated_fields(ctx, rhs_start, item_index_offset, field_start) < 0 {
        return capacity_result(rhs_start);
    }

    let field_count = ctx.result_value(CURSOR_RESULT_FIELD_COUNT) - field_start;
    let span_start = fragment_field(ctx, rhs_start, FRAGMENT_SPAN_START);
    let span_end = fragment_field(ctx, rhs_start + item_index_offset, FRAGMENT_SPAN_END);
    let token_start = fragment_field(ctx, rhs_start, FRAGMENT_TOKEN_START);
    let token_end = fragment_field(ctx, rhs_start + item_index_offset, FRAGMENT_TOKEN_END);
    store_result_fragment(
        ctx,
        rhs_start,
        value,
        children,
        field_start,
        field_count,
        span_start,
        span_end,
        token_start,
        token_end,
    );
    let _ = (offset, token_write, token_read);
    ok_result(rhs_start + 1)
}

fn reduce_cursor_field(
    ctx: &CursorCtx,
    field_id: i32,
    rhs_start: i32,
    offset: i32,
    token_write: i32,
    token_read: i32,
) -> ReduceResult {
    let value = fragment_field(ctx, rhs_start, FRAGMENT_VALUE);
    let children = fragment_child_list(ctx, rhs_start);
    let field_start = ctx.result_value(CURSOR_RESULT_FIELD_COUNT);
    if ctx.append_field(field_id, value) < 0 {
        return capacity_result(rhs_start);
    }
    let span_start = fragment_field(ctx, rhs_start, FRAGMENT_SPAN_START);
    let span_end = fragment_field(ctx, rhs_start, FRAGMENT_SPAN_END);
    let token_start = fragment_field(ctx, rhs_start, FRAGMENT_TOKEN_START);
    let token_end = fragment_field(ctx, rhs_start, FRAGMENT_TOKEN_END);
    store_result_fragment(
        ctx,
        rhs_start,
        value,
        children,
        field_start,
        1,
        span_start,
        span_end,
        token_start,
        token_end,
    );
    let _ = (offset, token_write, token_read);
    ok_result(rhs_start + 1)
}

fn copy_fragment_fields(ctx: &CursorCtx, rhs_start: i32, offset: i32) -> i32 {
    let source_field_start = fragment_field(ctx, rhs_start + offset, FRAGMENT_FIELD_START);
    let source_field_count = fragment_field(ctx, rhs_start + offset, FRAGMENT_FIELD_COUNT);
    ctx.copy_fields(source_field_start, source_field_count)
}

fn append_fragment_repeated_fields(
    ctx: &CursorCtx,
    rhs_start: i32,
    offset: i32,
    field_start: i32,
) -> i32 {
    let source_field_start = fragment_field(ctx, rhs_start + offset, FRAGMENT_FIELD_START);
    let source_field_count = fragment_field(ctx, rhs_start + offset, FRAGMENT_FIELD_COUNT);
    ctx.append_repeated_fields(field_start, source_field_start, source_field_count)
}

fn accept_cursor_result(
    ctx: &CursorCtx,
    mut fragment_count: i32,
    token_write: i32,
    offset: i32,
    state: i32,
    token_read: i32,
) -> i32 {
    if fragment_count < 1 {
        return return_parse_cursor_status(
            PARSE_STATUS_INTERNAL,
            ctx.result,
            token_write,
            offset,
            state,
            token_read,
        );
    }
    fragment_count -= 1;
    let value_id = fragment_field(ctx, fragment_count, FRAGMENT_VALUE);
    let record = cursor_value_record_address(ctx.value_ptr, value_id);
    if unsafe { load_i32(record) } != CURSOR_VALUE_REF {
        return return_parse_cursor_status(
            PARSE_STATUS_INTERNAL,
            ctx.result,
            token_write,
            offset,
            state,
            token_read,
        );
    }
    let reference = unsafe { load_i32(record + 4) };
    if (reference & 1) != 0 {
        return return_parse_cursor_status(
            PARSE_STATUS_INTERNAL,
            ctx.result,
            token_write,
            offset,
            state,
            token_read,
        );
    }
    ctx.store_result(CURSOR_RESULT_ROOT_REF, reference);
    return_parse_cursor_status(
        PARSE_STATUS_OK,
        ctx.result,
        token_write,
        offset,
        state,
        token_read,
    )
}

#[inline]
fn ok_result(fragment_count: i32) -> ReduceResult {
    ReduceResult {
        status: PARSE_STATUS_OK,
        fragment_count,
    }
}

#[inline]
fn capacity_result(fragment_count: i32) -> ReduceResult {
    ReduceResult {
        status: PARSE_CURSOR_STATUS_CAPACITY,
        fragment_count,
    }
}

#[panic_handler]
fn panic(_info: &PanicInfo) -> ! {
    loop {}
}
