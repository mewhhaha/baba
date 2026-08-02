#![no_std]

use core::arch::wasm32::{i8x16_swizzle, u8x16_extract_lane, v128, v128_load};
use core::panic::PanicInfo;

const MAX_SIMD_STATES: i32 = 7;
const STATUS_INVALID_PLAN: i32 = -1;
const STATUS_INVALID_TERMINAL: i32 = -2;
const STATUS_STACK_CAPACITY: i32 = -3;
const STATUS_ACTION_LIMIT: i32 = -4;

const PLAN_MAGIC: i32 = 0x3150_5742;
const PLAN_HEADER_MAGIC: i32 = 0;
const PLAN_HEADER_PARSER_STATE_COUNT: i32 = 4;
const PLAN_HEADER_ACTION_ROWS: i32 = 9;
const PLAN_HEADER_ACTION_PAIRS: i32 = 10;
const PLAN_HEADER_GOTO_ROWS: i32 = 11;
const PLAN_HEADER_GOTO_PAIRS: i32 = 12;
const PLAN_HEADER_BYTE_LENGTH: i32 = 13;
const PLAN_HEADER_EOF_TERMINAL: i32 = 15;
const PLAN_HEADER_PRODUCTION_COUNT: i32 = 19;
const PLAN_HEADER_PRODUCTIONS: i32 = 20;
const PLAN_HEADER_BYTES: i32 = 36 * 4;
const COMPACT_I16_OFFSET_TAG: i32 = 2;
const COMPACT_U16_OFFSET_BASE: i32 = 0x4000_0000;

const ACTION_SHIFT: i32 = 0x0100_0000;
const ACTION_REDUCE: i32 = 0x0200_0000;
const ACTION_ACCEPT: i32 = 0x0300_0000;
const ACTION_KIND_MASK: i32 = ACTION_SHIFT | ACTION_REDUCE | ACTION_ACCEPT;
const ACTION_PAYLOAD_MASK: i32 = 0x00ff_ffff;

extern "C" {
    static __heap_base: u8;
}

#[panic_handler]
fn panic(_panic: &PanicInfo) -> ! {
    loop {}
}

#[no_mangle]
pub extern "C" fn buffer_base() -> i32 {
    unsafe { (&__heap_base as *const u8 as usize) as i32 }
}

#[inline]
fn plan_is_valid(
    token_count: i32,
    terminal_count: i32,
    state_count: i32,
    start_state: i32,
) -> bool {
    token_count >= 0
        && terminal_count > 0
        && state_count > 0
        && state_count <= MAX_SIMD_STATES
        && start_state == 0
}

#[inline]
unsafe fn load_token(tokens: i32, index: i32) -> i32 {
    core::ptr::read_unaligned((tokens + index * 2) as usize as *const u16) as i32
}

#[inline]
unsafe fn load_i32(address: i32) -> i32 {
    core::ptr::read_unaligned(address as usize as *const i32)
}

#[inline]
unsafe fn load_i16(address: i32) -> i32 {
    core::ptr::read_unaligned(address as usize as *const i16) as i32
}

#[inline]
unsafe fn load_u16(address: i32) -> i32 {
    core::ptr::read_unaligned(address as usize as *const u16) as i32
}

#[inline]
unsafe fn store_i32(address: i32, value: i32) {
    core::ptr::write_unaligned(address as usize as *mut i32, value);
}

#[inline]
fn header(plan: i32, field: i32) -> i32 {
    unsafe { load_i32(plan + field * 4) }
}

#[inline]
fn is_compact_u16_offset(encoded: i32) -> bool {
    encoded <= -COMPACT_U16_OFFSET_BASE
}

#[inline]
fn table_value(plan: i32, encoded_base: i32, index: i32) -> i32 {
    if is_compact_u16_offset(encoded_base) {
        let offset = -encoded_base - COMPACT_U16_OFFSET_BASE;
        return unsafe { load_u16(plan + offset + index * 2) };
    }
    if encoded_base < -1 {
        let offset = -encoded_base - COMPACT_I16_OFFSET_TAG;
        return unsafe { load_i16(plan + offset + index * 2) };
    }
    unsafe { load_i32(plan + encoded_base + index * 4) }
}

#[inline]
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

#[inline]
fn table_lookup(
    plan: i32,
    state: i32,
    key: i32,
    state_count: i32,
    rows: i32,
    pairs: i32,
    missing: i32,
    decode_action: bool,
) -> i32 {
    if state < 0 || state >= state_count {
        return missing;
    }
    let mut index = table_value(plan, rows, state);
    let end = table_value(plan, rows, state + 1);
    if is_compact_u16_offset(pairs) {
        let offset = -pairs - COMPACT_U16_OFFSET_BASE;
        let mut address = plan + offset + index * 4;
        while index < end {
            if unsafe { load_u16(address) } == key {
                let value = unsafe { load_u16(address + 2) };
                if decode_action {
                    return decode_compact_action(value);
                }
                return value;
            }
            address += 4;
            index += 1;
        }
        return missing;
    }
    let mut address = plan + pairs + index * 8;
    while index < end {
        if unsafe { load_i32(address) } == key {
            return unsafe { load_i32(address + 4) };
        }
        address += 8;
        index += 1;
    }
    missing
}

#[inline]
fn acceptance_status(state: i32, accepting_mask: i32) -> i32 {
    (accepting_mask >> state) & 1
}

#[no_mangle]
pub extern "C" fn validate_island_scalar(
    tokens: i32,
    token_count: i32,
    transitions: i32,
    terminal_count: i32,
    state_count: i32,
    start_state: i32,
    accepting_mask: i32,
) -> i32 {
    if !plan_is_valid(token_count, terminal_count, state_count, start_state) {
        return STATUS_INVALID_PLAN;
    }

    let failure_state = state_count;
    let mut state = start_state;
    let mut index = 0;
    while index + 4 <= token_count {
        let terminal0 = unsafe { load_token(tokens, index) };
        let terminal1 = unsafe { load_token(tokens, index + 1) };
        let terminal2 = unsafe { load_token(tokens, index + 2) };
        let terminal3 = unsafe { load_token(tokens, index + 3) };
        if terminal0 >= terminal_count
            || terminal1 >= terminal_count
            || terminal2 >= terminal_count
            || terminal3 >= terminal_count
        {
            return STATUS_INVALID_TERMINAL;
        }
        state = unsafe {
            core::ptr::read_unaligned((transitions + terminal0 * 16 + state) as usize as *const u8)
                as i32
        };
        state = unsafe {
            core::ptr::read_unaligned((transitions + terminal1 * 16 + state) as usize as *const u8)
                as i32
        };
        state = unsafe {
            core::ptr::read_unaligned((transitions + terminal2 * 16 + state) as usize as *const u8)
                as i32
        };
        state = unsafe {
            core::ptr::read_unaligned((transitions + terminal3 * 16 + state) as usize as *const u8)
                as i32
        };
        index += 4;
    }
    while index < token_count {
        let terminal = unsafe { load_token(tokens, index) };
        if terminal >= terminal_count {
            return STATUS_INVALID_TERMINAL;
        }
        let address = transitions + terminal * 16 + state;
        state = unsafe { core::ptr::read_unaligned(address as usize as *const u8) as i32 };
        index += 1;
    }

    if state == failure_state {
        return 0;
    }
    acceptance_status(state, accepting_mask)
}

#[no_mangle]
pub extern "C" fn validate_island_simd(
    tokens: i32,
    token_count: i32,
    transitions: i32,
    terminal_count: i32,
    state_count: i32,
    start_state: i32,
    accepting_mask: i32,
) -> i32 {
    if !plan_is_valid(token_count, terminal_count, state_count, start_state) {
        return STATUS_INVALID_PLAN;
    }

    // Lane n tracks the result for entry state n; the sentinel lane absorbs failures.
    let identity: [u8; 16] = [0, 1, 2, 3, 4, 5, 6, 7, 7, 7, 7, 7, 7, 7, 7, 7];
    let mut summary = unsafe { v128_load(identity.as_ptr() as *const v128) };
    let mut index = 0;
    while index < token_count {
        let terminal = unsafe { load_token(tokens, index) };
        if terminal >= terminal_count {
            return STATUS_INVALID_TERMINAL;
        }
        let transition =
            unsafe { v128_load((transitions + terminal * 16) as usize as *const v128) };
        summary = i8x16_swizzle(transition, summary);
        index += 1;
    }

    let state = u8x16_extract_lane::<0>(summary) as i32;
    if state == state_count {
        return 0;
    }
    acceptance_status(state, accepting_mask)
}

#[no_mangle]
pub extern "C" fn validate_lr(
    tokens: i32,
    token_count: i32,
    plan: i32,
    plan_length: i32,
    stack: i32,
    stack_capacity: i32,
    max_actions: i32,
) -> i32 {
    if token_count < 0
        || plan_length < PLAN_HEADER_BYTES
        || header(plan, PLAN_HEADER_MAGIC) != PLAN_MAGIC
        || header(plan, PLAN_HEADER_BYTE_LENGTH) > plan_length
    {
        return STATUS_INVALID_PLAN;
    }
    if stack_capacity < 1 {
        return STATUS_STACK_CAPACITY;
    }

    let parser_state_count = header(plan, PLAN_HEADER_PARSER_STATE_COUNT);
    let action_rows = header(plan, PLAN_HEADER_ACTION_ROWS);
    let action_pairs = header(plan, PLAN_HEADER_ACTION_PAIRS);
    let goto_rows = header(plan, PLAN_HEADER_GOTO_ROWS);
    let goto_pairs = header(plan, PLAN_HEADER_GOTO_PAIRS);
    let eof_terminal = header(plan, PLAN_HEADER_EOF_TERMINAL);
    let production_count = header(plan, PLAN_HEADER_PRODUCTION_COUNT);
    let productions = plan + header(plan, PLAN_HEADER_PRODUCTIONS);

    unsafe { store_i32(stack, 0) };
    let mut stack_count = 1;
    let mut token_index = 0;
    let mut action_count = 0;
    loop {
        if action_count >= max_actions {
            return STATUS_ACTION_LIMIT;
        }
        let state = unsafe { load_i32(stack + (stack_count - 1) * 4) };
        let terminal = if token_index < token_count {
            unsafe { load_token(tokens, token_index) }
        } else {
            eof_terminal
        };
        let action = table_lookup(
            plan,
            state,
            terminal,
            parser_state_count,
            action_rows,
            action_pairs,
            0,
            true,
        );
        if action == 0 {
            return 0;
        }
        action_count += 1;

        let kind = action & ACTION_KIND_MASK;
        let payload = action & ACTION_PAYLOAD_MASK;
        if kind == ACTION_SHIFT {
            if token_index >= token_count {
                return STATUS_INVALID_PLAN;
            }
            if stack_count >= stack_capacity {
                return STATUS_STACK_CAPACITY;
            }
            unsafe { store_i32(stack + stack_count * 4, payload) };
            stack_count += 1;
            token_index += 1;
            continue;
        }
        if kind == ACTION_REDUCE {
            if payload >= production_count {
                return STATUS_INVALID_PLAN;
            }
            let production = productions + payload * 16;
            let lhs = unsafe { load_i32(production) };
            let rhs_length = unsafe { load_i32(production + 4) };
            if rhs_length < 0 || stack_count <= rhs_length {
                return STATUS_INVALID_PLAN;
            }
            stack_count -= rhs_length;
            let source_state = unsafe { load_i32(stack + (stack_count - 1) * 4) };
            let goto_state = table_lookup(
                plan,
                source_state,
                lhs,
                parser_state_count,
                goto_rows,
                goto_pairs,
                -1,
                false,
            );
            if goto_state < 0 || stack_count >= stack_capacity {
                return STATUS_INVALID_PLAN;
            }
            unsafe { store_i32(stack + stack_count * 4, goto_state) };
            stack_count += 1;
            continue;
        }
        if kind == ACTION_ACCEPT {
            if token_index != token_count {
                return STATUS_INVALID_PLAN;
            }
            return 1;
        }
        return STATUS_INVALID_PLAN;
    }
}
