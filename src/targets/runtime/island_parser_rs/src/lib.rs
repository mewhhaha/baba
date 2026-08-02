#![no_std]

use core::arch::wasm32::{i8x16_swizzle, u8x16_extract_lane, v128, v128_load};
use core::panic::PanicInfo;

const MAX_SIMD_STATES: i32 = 7;
const STATUS_INVALID_PLAN: i32 = -1;
const STATUS_INVALID_TERMINAL: i32 = -2;

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
