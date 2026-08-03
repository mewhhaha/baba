#![no_std]

use core::arch::wasm32::{i32x4_splat, v128, v128_store};
use core::panic::PanicInfo;

const WASM_ABI_VERSION: i32 = 14;
const RUNTIME_IMPLEMENTATION_VERSION: i32 = 6;
const MAX_WASM_PAGES: i32 = 65_535;
const SOURCE_ENCODING_UTF16: i32 = 1;
const SPAN_UNIT_UTF16: i32 = 1;
const HOST_OWNERSHIP_CALLER_MANAGED: i32 = 1;
const RESULT_LIFETIME_CALLER_BUFFER: i32 = 1;

const PLAN_MAGIC: i32 = 0x3150_5742;
const PLAN_FORMAT_VERSION: i32 = 9;
const PLAN_HEADER_MAGIC: i32 = 0;
const PLAN_HEADER_FORMAT_VERSION: i32 = 1;
const PLAN_HEADER_PARSER_PLAN_VERSION: i32 = 2;
const PLAN_HEADER_DFA_STATE_COUNT: i32 = 3;
const PLAN_HEADER_ISLAND_STATE_COUNT: i32 = 4;
const PLAN_HEADER_FAST_SPECS: i32 = 5;
const PLAN_HEADER_ASCII_TRANSITIONS: i32 = 6;
const PLAN_HEADER_TRANSITION_ROWS: i32 = 7;
const PLAN_HEADER_TRANSITIONS: i32 = 8;
const PLAN_HEADER_ISLAND_PLAN: i32 = 9;
const PLAN_HEADER_BYTE_LENGTH: i32 = 13;
const PLAN_HEADER_SPEC_COUNT: i32 = 14;
const PLAN_HEADER_ACCEPT_CANDIDATE_ROWS: i32 = 17;
const PLAN_HEADER_ACCEPT_CANDIDATES: i32 = 18;
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
const SPEC_FLAG_FOLLOW_EOF: i32 = 2;
const SPEC_FLAG_HAS_FOLLOW: i32 = 4;
const COMPACT_I16_OFFSET_TAG: i32 = 2;
const COMPACT_U16_OFFSET_BASE: i32 = 0x4000_0000;

const LEX_RESULT_I32_COUNT: i32 = 2;
const TOKEN_RECORD_I32_COUNT: i32 = 4;
const INCREMENTAL_TOKEN_RECORD_I32_COUNT: i32 = 5;
const ISLAND_RESULT_I32_COUNT: i32 = 10;
const CURSOR_RULE_RECORD_I32_COUNT: i32 = 9;
const CURSOR_CHILD_RECORD_I32_COUNT: i32 = 2;
const CURSOR_FIELD_RECORD_I32_COUNT: i32 = 2;
const CURSOR_VALUE_RECORD_I32_COUNT: i32 = 4;
const CURSOR_VALUE_REF: i32 = 1;
const ISLAND_STATUS_UNEXPECTED: i32 = 0;
const ISLAND_STATUS_OK: i32 = 1;
const ISLAND_STATUS_INVALID: i32 = -1;
const ISLAND_STATUS_LEXICAL: i32 = -2;
const ISLAND_STATUS_TRACE_LIMIT: i32 = -3;
const ISLAND_STATUS_CAPACITY: i32 = -4;
const ISLAND_STATUS_TRAILING: i32 = -5;
const ISLAND_CONFIG_I32_COUNT: i32 = 8;
const ISLAND_CONFIG_TERMINAL_COUNT: i32 = 0;
const ISLAND_CONFIG_START_STATE: i32 = 1;
const ISLAND_CONFIG_ACCEPTING_MASK: i32 = 2;
const ISLAND_CONFIG_BOUNDARY_TERMINAL: i32 = 3;
const ISLAND_CONFIG_ROOT_RULE: i32 = 4;
const ISLAND_CONFIG_REGION_RULE: i32 = 5;
const ISLAND_CONFIG_ROOT_FIELD: i32 = 6;
const ISLAND_CONFIG_ROOT_ACCEPTS_EMPTY: i32 = 7;
// `lex_all` returns a token count, so its failures are the negative values.
const LEX_STATUS_TOKEN_CAPACITY: i32 = -1;
const LEX_STATUS_MEMO_REQUIRED: i32 = -2;

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
pub extern "C" fn incremental_token_record_i32_count() -> i32 {
    INCREMENTAL_TOKEN_RECORD_I32_COUNT
}

#[no_mangle]
pub extern "C" fn island_result_i32_count() -> i32 {
    ISLAND_RESULT_I32_COUNT
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
    let island_state_count = header_at(ptr, PLAN_HEADER_ISLAND_STATE_COUNT);
    let island_plan = header_at(ptr, PLAN_HEADER_ISLAND_PLAN);
    if island_state_count < 0 || island_state_count > 7 {
        return 0;
    }
    if island_state_count == 0 && island_plan != 0 {
        return 0;
    }
    if island_state_count > 0
        && !island_plan_is_valid(ptr, core_byte_length, island_plan, island_state_count)
    {
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

#[target_feature(enable = "simd128")]
unsafe fn memo_clear(memo: i32, word_count: i32) {
    if word_count < 4 {
        if word_count > 0 {
            store_i32(memo, 0);
        }
        if word_count > 1 {
            store_i32(memo + 4, 0);
        }
        if word_count > 2 {
            store_i32(memo + 8, 0);
        }
        return;
    }

    let mut index = 0;
    let zeroes = i32x4_splat(0);
    while index + 16 <= word_count {
        let address = memo + index * 4;
        v128_store(address as usize as *mut v128, zeroes);
        v128_store((address + 16) as usize as *mut v128, zeroes);
        v128_store((address + 32) as usize as *mut v128, zeroes);
        v128_store((address + 48) as usize as *mut v128, zeroes);
        index += 16;
    }
    while index + 4 <= word_count {
        let address = memo + index * 4;
        v128_store(address as usize as *mut v128, zeroes);
        index += 4;
    }
    if index < word_count {
        let address = memo + (word_count - 4) * 4;
        v128_store(address as usize as *mut v128, zeroes);
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
    if token_capacity < len {
        return LEX_STATUS_TOKEN_CAPACITY;
    }
    let mut cursor = RawLexerCursor::new(len, memo, memo_capacity);
    let mut count = 0;
    let mut token = EMPTY_RAW_TOKEN;
    loop {
        let status = next_raw_token(&mut cursor, src, len, &mut token);
        if status == 0 {
            return count;
        }
        if status == LEX_STATUS_MEMO_REQUIRED {
            return LEX_STATUS_MEMO_REQUIRED;
        }
        store_token_record(
            tokens,
            count,
            token.spec,
            token.start,
            token.end,
            token.accepting_state,
        );
        count += 1;
    }
}

#[derive(Clone, Copy)]
struct RawToken {
    spec: i32,
    start: i32,
    end: i32,
    accepting_state: i32,
    dependency_end: i32,
}

const EMPTY_RAW_TOKEN: RawToken = RawToken {
    spec: -2,
    start: 0,
    end: 0,
    accepting_state: -1,
    dependency_end: 0,
};

struct RawLexerCursor {
    offset: i32,
    memo: i32,
    memo_words: i32,
    memo_required: i32,
    memo_enabled: bool,
    wasted: i64,
}

impl RawLexerCursor {
    #[inline]
    fn new(len: i32, memo: i32, memo_capacity: i32) -> RawLexerCursor {
        RawLexerCursor::new_at(0, len, memo, memo_capacity)
    }

    #[inline]
    fn new_at(offset: i32, len: i32, memo: i32, memo_capacity: i32) -> RawLexerCursor {
        let memo_required = memo_i32_count(len);
        let memo_words = lex_memo_i32_per_position();
        let mut memo_enabled = false;
        if memo > 0 && memo_required > 0 && memo_capacity >= memo_required {
            unsafe { memo_clear(memo, memo_required) };
            memo_enabled = true;
        }
        RawLexerCursor {
            offset,
            memo,
            memo_words,
            memo_required,
            memo_enabled,
            wasted: 0,
        }
    }
}

#[inline]
fn next_raw_token(cursor: &mut RawLexerCursor, src: i32, len: i32, token: &mut RawToken) -> i32 {
    if cursor.offset >= len {
        return 0;
    }

    let start_state = header(PLAN_HEADER_DFA_START_STATE);
    let start = cursor.offset;
    let mut state = start_state;
    let mut index = start;
    let mut best_spec = -1;
    let mut best_end = start;
    let mut best_state = -1;
    let mut dependency_end = start;
    let mut memo_floor = len;
    if cursor.memo_enabled {
        memo_floor = start;
    }

    while index < len {
        let decoded = decode_code_point(src, index, len);
        dependency_end = dependency_end.max(index + decoded.width);
        let target = transition(state, decoded.code_point);
        if target < 0 {
            break;
        }
        index += decoded.width;
        state = target;
        if index > memo_floor && memo_is_set(cursor.memo, cursor.memo_words, index, state) {
            // The memo bit summarizes a failed scan over an unknown-length
            // suffix. Incremental callers need a conservative dependency
            // bound for this record, so retain the whole remaining source.
            dependency_end = len;
            break;
        }
        let accept = selected_global_spec_tracked(src, len, index, state, &mut dependency_end);
        if accept >= 0 {
            best_spec = accept;
            best_end = index;
            best_state = state;
            if cursor.memo_enabled {
                memo_floor = index;
            }
        }
    }

    let scan_end = index;
    if cursor.memo_enabled {
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
            memo_set(cursor.memo, cursor.memo_words, memo_index, memo_state);
        }
    } else {
        cursor.wasted += (scan_end - best_end) as i64;
        if cursor.memo_required < 0 || cursor.memo_words > 0 && cursor.wasted > len as i64 {
            return LEX_STATUS_MEMO_REQUIRED;
        }
    }

    let mut spec = best_spec;
    let mut end = best_end;
    if best_spec < 0 {
        let decoded = decode_code_point(src, start, len);
        spec = -1;
        end = start + decoded.width;
    }
    *token = RawToken {
        spec,
        start,
        end,
        accepting_state: best_state,
        dependency_end,
    };
    cursor.offset = end;
    1
}

#[no_mangle]
pub extern "C" fn lex_incremental(
    src: i32,
    len: i32,
    start: i32,
    minimum_end: i32,
    tokens: i32,
    token_capacity: i32,
    memo: i32,
    memo_capacity: i32,
) -> i32 {
    if start < 0 || start > len || minimum_end < start || minimum_end > len {
        return LEX_STATUS_TOKEN_CAPACITY;
    }
    if token_capacity < len - start {
        return LEX_STATUS_TOKEN_CAPACITY;
    }
    let mut cursor = RawLexerCursor::new_at(start, len, memo, memo_capacity);
    let mut count = 0;
    let mut token = EMPTY_RAW_TOKEN;
    while cursor.offset < minimum_end {
        let status = next_raw_token(&mut cursor, src, len, &mut token);
        if status == 0 {
            return count;
        }
        if status == LEX_STATUS_MEMO_REQUIRED {
            return LEX_STATUS_MEMO_REQUIRED;
        }
        let record = tokens + count * INCREMENTAL_TOKEN_RECORD_I32_COUNT * 4;
        unsafe {
            store_i32(record, token.spec);
            store_i32(record + 4, token.start);
            store_i32(record + 8, token.end);
            store_i32(record + 12, token.accepting_state);
            store_i32(record + 16, token.dependency_end);
        }
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
    // COMPLETE and AUTHORITATIVE for code points 0..127. Core plan format 7
    // removes ASCII ranges from the CSR rows in that case, so falling through
    // cannot add an answer. Plans above the dense-table size limit carry -1 in
    // this header slot and retain complete CSR rows.
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
    let mut dependency_end = end;
    selected_global_spec_tracked(src, len, end, accepting_state, &mut dependency_end)
}

fn selected_global_spec_tracked(
    src: i32,
    len: i32,
    end: i32,
    accepting_state: i32,
    dependency_end: &mut i32,
) -> i32 {
    let fast_spec = header_table_value(PLAN_HEADER_FAST_SPECS, accepting_state);
    if fast_spec >= 0 {
        return fast_spec;
    }
    let rows = header(PLAN_HEADER_ACCEPT_CANDIDATE_ROWS);
    let mut index = table_value(rows, accepting_state);
    let stop = table_value(rows, accepting_state + 1);
    while index < stop {
        let spec = table_value(header(PLAN_HEADER_ACCEPT_CANDIDATES), index);
        if spec_guard_matches_tracked(spec, src, len, end, dependency_end) {
            return spec;
        }
        index += 1;
    }
    -1
}

fn spec_guard_matches_tracked(
    spec: i32,
    src: i32,
    len: i32,
    offset: i32,
    dependency_end: &mut i32,
) -> bool {
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
            || guard_dfa_matches_tracked(follow_start, src, len, offset, dependency_end);
        if !followed {
            return false;
        }
    }
    if not_follow_start >= 0
        && guard_dfa_matches_tracked(not_follow_start, src, len, offset, dependency_end)
    {
        return false;
    }
    !excluded_word_matches_tracked(spec, src, len, offset, dependency_end)
}

fn guard_dfa_matches_tracked(
    start: i32,
    src: i32,
    len: i32,
    offset: i32,
    dependency_end: &mut i32,
) -> bool {
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
        *dependency_end = (*dependency_end).max(index + decoded.width);
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

fn excluded_word_matches_tracked(
    spec: i32,
    src: i32,
    len: i32,
    offset: i32,
    dependency_end: &mut i32,
) -> bool {
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
            *dependency_end = (*dependency_end).max(source_offset + decoded.width);
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
            let decoded = decode_code_point(src, source_offset, len);
            let next = decoded.code_point;
            *dependency_end = (*dependency_end).max(source_offset + decoded.width);
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

fn island_plan_is_valid(base: i32, core_length: i32, offset: i32, state_count: i32) -> bool {
    if offset < PLAN_HEADER_BYTES || offset & 3 != 0 {
        return false;
    }
    if offset > core_length - ISLAND_CONFIG_I32_COUNT * 4 {
        return false;
    }
    let address = base + offset;
    let terminal_count = unsafe { load_i32(address + ISLAND_CONFIG_TERMINAL_COUNT * 4) };
    let start_state = unsafe { load_i32(address + ISLAND_CONFIG_START_STATE * 4) };
    let accepting_mask = unsafe { load_i32(address + ISLAND_CONFIG_ACCEPTING_MASK * 4) };
    let boundary_terminal = unsafe { load_i32(address + ISLAND_CONFIG_BOUNDARY_TERMINAL * 4) };
    let root_rule = unsafe { load_i32(address + ISLAND_CONFIG_ROOT_RULE * 4) };
    let region_rule = unsafe { load_i32(address + ISLAND_CONFIG_REGION_RULE * 4) };
    let root_field = unsafe { load_i32(address + ISLAND_CONFIG_ROOT_FIELD * 4) };
    let root_accepts_empty = unsafe { load_i32(address + ISLAND_CONFIG_ROOT_ACCEPTS_EMPTY * 4) };
    if terminal_count < 1
        || start_state != 0
        || accepting_mask < 0
        || accepting_mask & !((1 << state_count) - 1) != 0
        || boundary_terminal < 0
        || boundary_terminal >= terminal_count
        || root_rule < 0
        || region_rule < 0
        || root_field < -1
        || root_accepts_empty < 0
        || root_accepts_empty > 1
    {
        return false;
    }
    let spec_count = header_at(base, PLAN_HEADER_SPEC_COUNT);
    if spec_count < 0 {
        return false;
    }
    let transition_count = (state_count as i64) * (terminal_count as i64);
    let section_i32_count =
        (ISLAND_CONFIG_I32_COUNT as i64) + (spec_count as i64) + transition_count * 2;
    let section_end = (offset as i64) + section_i32_count * 4;
    if section_end > core_length as i64 {
        return false;
    }
    let mut spec = 0;
    while spec < spec_count {
        let terminal = unsafe { load_i32(address + (ISLAND_CONFIG_I32_COUNT + spec) * 4) };
        if terminal < -1 || terminal >= terminal_count {
            return false;
        }
        spec += 1;
    }
    let transitions = address + (ISLAND_CONFIG_I32_COUNT + spec_count) * 4;
    let fields = transitions + (transition_count as i32) * 4;
    let mut index = 0;
    while index < transition_count as i32 {
        let target = unsafe { load_i32(transitions + index * 4) };
        let field = unsafe { load_i32(fields + index * 4) };
        if target < 0 || target > state_count || field < -1 {
            return false;
        }
        index += 1;
    }
    true
}

#[inline]
fn island_plan_address() -> i32 {
    plan_addr(header(PLAN_HEADER_ISLAND_PLAN))
}

#[inline]
fn island_config(field: i32) -> i32 {
    unsafe { load_i32(island_plan_address() + field * 4) }
}

#[inline]
fn island_spec_terminal(spec: i32) -> i32 {
    unsafe { load_i32(island_plan_address() + (ISLAND_CONFIG_I32_COUNT + spec) * 4) }
}

#[inline]
fn island_transition_index(terminal: i32, state: i32) -> i32 {
    terminal * header(PLAN_HEADER_ISLAND_STATE_COUNT) + state
}

#[inline]
fn island_transition_target(terminal: i32, state: i32) -> i32 {
    let spec_count = header(PLAN_HEADER_SPEC_COUNT);
    let index = island_transition_index(terminal, state);
    unsafe { load_i32(island_plan_address() + (ISLAND_CONFIG_I32_COUNT + spec_count + index) * 4) }
}

#[inline]
fn island_transition_field(terminal: i32, state: i32) -> i32 {
    let spec_count = header(PLAN_HEADER_SPEC_COUNT);
    let transition_count =
        island_config(ISLAND_CONFIG_TERMINAL_COUNT) * header(PLAN_HEADER_ISLAND_STATE_COUNT);
    let index = island_transition_index(terminal, state);
    unsafe {
        load_i32(
            island_plan_address()
                + (ISLAND_CONFIG_I32_COUNT + spec_count + transition_count + index) * 4,
        )
    }
}

#[inline]
fn island_accepts(state: i32) -> bool {
    island_config(ISLAND_CONFIG_ACCEPTING_MASK) & (1 << state) != 0
}

fn initialize_island_result(result: i32) {
    let mut index = 0;
    while index < ISLAND_RESULT_I32_COUNT {
        unsafe { store_i32(result + index * 4, 0) };
        index += 1;
    }
}

fn return_island_failure(status: i32, result: i32, record: i32, state: i32) -> i32 {
    unsafe {
        store_i32(result + 6 * 4, record);
        store_i32(result + 7 * 4, state);
    }
    status
}

fn island_runtime_is_available() -> bool {
    header(PLAN_HEADER_ISLAND_STATE_COUNT) > 0 && header(PLAN_HEADER_ISLAND_PLAN) > 0
}

fn next_structural_record(tokens: i32, raw_count: i32, start: i32) -> i32 {
    let spec_count = header(PLAN_HEADER_SPEC_COUNT);
    let mut record_index = start;
    while record_index < raw_count {
        let record = token_record_address(tokens, record_index);
        let spec = unsafe { load_i32(record) };
        if spec < 0 || spec >= spec_count {
            return record_index;
        }
        if island_spec_terminal(spec) >= 0 {
            return record_index;
        }
        record_index += 1;
    }
    raw_count
}

#[no_mangle]
pub extern "C" fn analyze_island_records(
    tokens: i32,
    raw_count: i32,
    max_actions: i32,
    result: i32,
) -> i32 {
    initialize_island_result(result);
    if !island_runtime_is_available() || tokens <= 0 || raw_count < 0 || max_actions < 1 {
        return ISLAND_STATUS_INVALID;
    }
    let spec_count = header(PLAN_HEADER_SPEC_COUNT);
    let terminal_count = island_config(ISLAND_CONFIG_TERMINAL_COUNT);
    let mut structural_count = 0;
    let mut limit_record = -1;
    let mut record_index = 0;
    while record_index < raw_count {
        let record = token_record_address(tokens, record_index);
        let spec = unsafe { load_i32(record) };
        if spec < 0 {
            return return_island_failure(
                ISLAND_STATUS_LEXICAL,
                result,
                record_index,
                island_config(ISLAND_CONFIG_START_STATE),
            );
        }
        if spec >= spec_count {
            return ISLAND_STATUS_INVALID;
        }
        let terminal = island_spec_terminal(spec);
        if terminal >= 0 {
            if terminal >= terminal_count {
                return ISLAND_STATUS_INVALID;
            }
            if structural_count == max_actions && limit_record < 0 {
                limit_record = record_index;
            }
            structural_count += 1;
        }
        record_index += 1;
    }
    unsafe {
        store_i32(result, structural_count);
        store_i32(result + 8 * 4, structural_count);
    }
    if limit_record >= 0 {
        return return_island_failure(
            ISLAND_STATUS_TRACE_LIMIT,
            result,
            limit_record,
            island_config(ISLAND_CONFIG_START_STATE),
        );
    }

    let start_state = island_config(ISLAND_CONFIG_START_STATE);
    let boundary_terminal = island_config(ISLAND_CONFIG_BOUNDARY_TERMINAL);
    let state_count = header(PLAN_HEADER_ISLAND_STATE_COUNT);
    let mut state = start_state;
    let mut region_count = 0;
    let mut transition_field_count = 0;
    let mut region_token_count = 0;
    record_index = 0;
    while record_index < raw_count {
        let record = token_record_address(tokens, record_index);
        let spec = unsafe { load_i32(record) };
        let terminal = island_spec_terminal(spec);
        if terminal < 0 {
            record_index += 1;
            continue;
        }
        let target = island_transition_target(terminal, state);
        if target == state_count {
            let mut status = ISLAND_STATUS_UNEXPECTED;
            if state == start_state && region_count > 0 {
                status = ISLAND_STATUS_TRAILING;
            }
            return return_island_failure(status, result, record_index, state);
        }
        if target < 0 || target >= state_count {
            return ISLAND_STATUS_INVALID;
        }
        if island_transition_field(terminal, state) >= 0 {
            transition_field_count += 1;
        }
        state = target;
        region_token_count += 1;
        if terminal == boundary_terminal {
            if !island_accepts(state) {
                let unexpected = next_structural_record(tokens, raw_count, record_index + 1);
                return return_island_failure(ISLAND_STATUS_UNEXPECTED, result, unexpected, state);
            }
            region_count += 1;
            region_token_count = 0;
            state = start_state;
        }
        record_index += 1;
    }
    if structural_count == 0 && island_config(ISLAND_CONFIG_ROOT_ACCEPTS_EMPTY) == 0 {
        return return_island_failure(ISLAND_STATUS_UNEXPECTED, result, raw_count, start_state);
    }
    if region_token_count > 0 {
        return return_island_failure(ISLAND_STATUS_UNEXPECTED, result, raw_count, state);
    }
    unsafe {
        store_i32(result + 1 * 4, region_count);
        store_i32(result + 2 * 4, transition_field_count);
        store_i32(result + 6 * 4, raw_count);
        store_i32(result + 7 * 4, state);
        store_i32(result + 9 * 4, region_count);
    }
    ISLAND_STATUS_OK
}

#[inline]
fn cursor_rule_address(rules: i32, index: i32) -> i32 {
    rules + index * CURSOR_RULE_RECORD_I32_COUNT * 4
}

#[inline]
fn cursor_child_address(children: i32, index: i32) -> i32 {
    children + index * CURSOR_CHILD_RECORD_I32_COUNT * 4
}

#[inline]
fn cursor_field_address(fields: i32, index: i32) -> i32 {
    fields + index * CURSOR_FIELD_RECORD_I32_COUNT * 4
}

#[inline]
fn cursor_value_address(values: i32, index: i32) -> i32 {
    values + index * CURSOR_VALUE_RECORD_I32_COUNT * 4
}

fn store_cursor_rule(
    rules: i32,
    index: i32,
    rule: i32,
    span_start: i32,
    span_end: i32,
    token_start: i32,
    token_end: i32,
    child_start: i32,
    child_count: i32,
    field_start: i32,
    field_count: i32,
) {
    let record = cursor_rule_address(rules, index);
    unsafe {
        store_i32(record, rule);
        store_i32(record + 4, span_start);
        store_i32(record + 8, span_end);
        store_i32(record + 12, token_start);
        store_i32(record + 16, token_end);
        store_i32(record + 20, child_start);
        store_i32(record + 24, child_count);
        store_i32(record + 28, field_start);
        store_i32(record + 32, field_count);
    }
}

fn append_cursor_child(
    children: i32,
    child_capacity: i32,
    child_count: &mut i32,
    previous: i32,
    reference: i32,
) -> i32 {
    if *child_count >= child_capacity {
        return -1;
    }
    let node = *child_count;
    let record = cursor_child_address(children, node);
    unsafe {
        store_i32(record, reference);
        store_i32(record + 4, -1);
        if previous >= 0 {
            store_i32(cursor_child_address(children, previous) + 4, node);
        }
    }
    *child_count += 1;
    node
}

fn append_cursor_field(
    fields: i32,
    field_capacity: i32,
    field_count: &mut i32,
    values: i32,
    value_capacity: i32,
    value_count: &mut i32,
    field: i32,
    reference: i32,
) -> bool {
    if *field_count >= field_capacity || *value_count >= value_capacity {
        return false;
    }
    let value_id = *value_count;
    let value_record = cursor_value_address(values, value_id);
    unsafe {
        store_i32(value_record, CURSOR_VALUE_REF);
        store_i32(value_record + 4, reference);
        store_i32(value_record + 8, 0);
        store_i32(value_record + 12, 0);
    }
    let field_record = cursor_field_address(fields, *field_count);
    unsafe {
        store_i32(field_record, field);
        store_i32(field_record + 4, value_id);
    }
    *field_count += 1;
    *value_count += 1;
    true
}

fn finalize_cursor_region(
    tokens: i32,
    rules: i32,
    rule_index: i32,
    record_start: i32,
    record_end: i32,
    child_start: i32,
    child_count: i32,
    field_start: i32,
    field_count: i32,
) -> bool {
    if record_end <= record_start {
        return false;
    }
    let start_record = token_record_address(tokens, record_start);
    let end_record = token_record_address(tokens, record_end - 1);
    let span_start = unsafe { load_i32(start_record + 4) };
    let span_end = unsafe { load_i32(end_record + 8) };
    store_cursor_rule(
        rules,
        rule_index,
        island_config(ISLAND_CONFIG_REGION_RULE),
        span_start,
        span_end,
        record_start,
        record_end,
        child_start,
        child_count,
        field_start,
        field_count,
    );
    true
}

#[no_mangle]
pub extern "C" fn materialize_island_records(
    source_length: i32,
    tokens: i32,
    raw_count: i32,
    preserve_trivia: i32,
    rules: i32,
    rule_capacity: i32,
    children: i32,
    child_capacity: i32,
    fields: i32,
    field_capacity: i32,
    values: i32,
    value_capacity: i32,
    result: i32,
) -> i32 {
    initialize_island_result(result);
    if !island_runtime_is_available()
        || source_length < 0
        || tokens <= 0
        || raw_count < 0
        || (preserve_trivia != 0 && preserve_trivia != 1)
        || rules <= 0
        || rule_capacity < 1
        || children <= 0
        || child_capacity < 0
        || fields <= 0
        || field_capacity < 0
        || values <= 0
        || value_capacity < 0
    {
        return ISLAND_STATUS_INVALID;
    }
    let state_count = header(PLAN_HEADER_ISLAND_STATE_COUNT);
    let start_state = island_config(ISLAND_CONFIG_START_STATE);
    let boundary_terminal = island_config(ISLAND_CONFIG_BOUNDARY_TERMINAL);
    let mut state = start_state;
    let mut cursor_token_count = 0;
    let mut rule_count = 1;
    let mut child_count = 0;
    let mut field_count = 0;
    let mut value_count = 0;
    let mut region_count = 0;
    let mut region_token_count = 0;
    let mut region_rule = -1;
    let mut region_record_start = 0;
    let mut region_child_start = 0;
    let mut region_child_count = 0;
    let mut region_field_start = 0;
    let mut region_field_count = 0;
    let mut previous_region_child = -1;
    let mut pending_region = false;
    let mut root_child_start = -1;
    let mut previous_root_child = -1;
    let mut record_index = 0;
    while record_index < raw_count {
        let raw_record = token_record_address(tokens, record_index);
        let spec = unsafe { load_i32(raw_record) };
        if spec < 0 || spec >= header(PLAN_HEADER_SPEC_COUNT) {
            return ISLAND_STATUS_INVALID;
        }
        let terminal = island_spec_terminal(spec);
        if terminal < 0 {
            record_index += 1;
            continue;
        }
        if pending_region {
            let record_end = if preserve_trivia == 1 {
                record_index
            } else {
                cursor_token_count
            };
            if !finalize_cursor_region(
                tokens,
                rules,
                region_rule,
                region_record_start,
                record_end,
                region_child_start,
                region_child_count,
                region_field_start,
                region_field_count,
            ) {
                return ISLAND_STATUS_INVALID;
            }
            pending_region = false;
        }
        if region_token_count == 0 {
            if rule_count >= rule_capacity {
                return ISLAND_STATUS_CAPACITY;
            }
            region_rule = rule_count;
            rule_count += 1;
            region_record_start = if preserve_trivia == 1 {
                if region_count == 0 {
                    0
                } else {
                    record_index
                }
            } else {
                cursor_token_count
            };
            region_child_start = child_count;
            region_child_count = 0;
            region_field_start = field_count;
            region_field_count = 0;
            previous_region_child = -1;
        }
        let cursor_token_index = if preserve_trivia == 1 {
            record_index
        } else {
            if cursor_token_count != record_index {
                unsafe {
                    core::ptr::copy_nonoverlapping(
                        raw_record as usize as *const i32,
                        token_record_address(tokens, cursor_token_count) as usize as *mut i32,
                        TOKEN_RECORD_I32_COUNT as usize,
                    );
                }
            }
            cursor_token_count
        };
        cursor_token_count += 1;
        let child = append_cursor_child(
            children,
            child_capacity,
            &mut child_count,
            previous_region_child,
            cursor_token_index * 2 + 1,
        );
        if child < 0 {
            return ISLAND_STATUS_CAPACITY;
        }
        previous_region_child = child;
        region_child_count += 1;
        let target = island_transition_target(terminal, state);
        if target < 0 || target >= state_count {
            return ISLAND_STATUS_INVALID;
        }
        let field = island_transition_field(terminal, state);
        if field >= 0 {
            if !append_cursor_field(
                fields,
                field_capacity,
                &mut field_count,
                values,
                value_capacity,
                &mut value_count,
                field,
                cursor_token_index * 2 + 1,
            ) {
                return ISLAND_STATUS_CAPACITY;
            }
            region_field_count += 1;
        }
        state = target;
        region_token_count += 1;
        if terminal == boundary_terminal {
            if !island_accepts(state) {
                return ISLAND_STATUS_INVALID;
            }
            let root_child = append_cursor_child(
                children,
                child_capacity,
                &mut child_count,
                previous_root_child,
                region_rule * 2,
            );
            if root_child < 0 {
                return ISLAND_STATUS_CAPACITY;
            }
            if root_child_start < 0 {
                root_child_start = root_child;
            }
            previous_root_child = root_child;
            region_count += 1;
            region_token_count = 0;
            state = start_state;
            pending_region = true;
        }
        record_index += 1;
    }
    if pending_region {
        let record_end = if preserve_trivia == 1 {
            raw_count
        } else {
            cursor_token_count
        };
        if !finalize_cursor_region(
            tokens,
            rules,
            region_rule,
            region_record_start,
            record_end,
            region_child_start,
            region_child_count,
            region_field_start,
            region_field_count,
        ) {
            return ISLAND_STATUS_INVALID;
        }
    }
    if region_token_count != 0 || rule_count != region_count + 1 {
        return ISLAND_STATUS_INVALID;
    }
    if preserve_trivia == 1 {
        cursor_token_count = raw_count;
    }
    let root_field_start = field_count;
    let root_field = island_config(ISLAND_CONFIG_ROOT_FIELD);
    if root_field >= 0 {
        let mut region = 0;
        while region < region_count {
            if !append_cursor_field(
                fields,
                field_capacity,
                &mut field_count,
                values,
                value_capacity,
                &mut value_count,
                root_field,
                (region + 1) * 2,
            ) {
                return ISLAND_STATUS_CAPACITY;
            }
            region += 1;
        }
    }
    let mut root_field_count = 0;
    if root_field >= 0 {
        root_field_count = region_count;
    }
    if root_child_start < 0 {
        root_child_start = 0;
    }
    store_cursor_rule(
        rules,
        0,
        island_config(ISLAND_CONFIG_ROOT_RULE),
        0,
        source_length,
        0,
        cursor_token_count,
        root_child_start,
        region_count,
        root_field_start,
        root_field_count,
    );
    unsafe {
        store_i32(result, cursor_token_count);
        store_i32(result + 1 * 4, rule_count);
        store_i32(result + 2 * 4, child_count);
        store_i32(result + 3 * 4, field_count);
        store_i32(result + 4 * 4, value_count);
        store_i32(result + 5 * 4, 0);
        store_i32(result + 6 * 4, raw_count);
        store_i32(result + 7 * 4, state);
        store_i32(result + 8 * 4, cursor_token_count);
        store_i32(result + 9 * 4, region_count);
    }
    ISLAND_STATUS_OK
}

#[panic_handler]
fn panic(_info: &PanicInfo) -> ! {
    loop {}
}
