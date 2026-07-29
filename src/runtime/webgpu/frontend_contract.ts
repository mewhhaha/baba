export const GPU_FRONTEND_HEADER_WORDS = 40;
export const GPU_FRONTEND_TOKEN_WORDS = 4;
export const GPU_FRONTEND_NODE_WORDS = 8;
export const GPU_FRONTEND_EDGE_WORDS = 4;
export const GPU_FRONTEND_CANDIDATE_WORDS = 16;
export const GPU_FRONTEND_DIAGNOSTIC_WORDS = 8;

export const GPU_FRONTEND_STATUS_SUCCESS = 0;
export const GPU_FRONTEND_DIAGNOSTIC_LEXICAL = 1;
export const GPU_FRONTEND_DIAGNOSTIC_DELIMITER = 2;
export const GPU_FRONTEND_DIAGNOSTIC_SYNTAX = 3;
export const GPU_FRONTEND_DIAGNOSTIC_TOKEN_CAPACITY = 4;
export const GPU_FRONTEND_DIAGNOSTIC_NODE_CAPACITY = 5;
export const GPU_FRONTEND_DIAGNOSTIC_EDGE_CAPACITY = 6;
export const GPU_FRONTEND_DIAGNOSTIC_DUPLICATE_BINDING = 7;
export const GPU_FRONTEND_DIAGNOSTIC_UNKNOWN_REFERENCE = 8;
export const GPU_FRONTEND_DIAGNOSTIC_REFERENCE_CYCLE = 9;
export const GPU_FRONTEND_DIAGNOSTIC_INTEGER_BOUNDS = 10;
export const GPU_FRONTEND_DIAGNOSTIC_REPEAT_LIMIT = 11;
export const GPU_FRONTEND_DIAGNOSTIC_DEPTH_CAPACITY = 12;

export interface GpuFrontendDiagnosticRecord {
  readonly code: number;
  readonly start: number;
  readonly end: number;
  readonly subjectId: number;
  readonly parameter0: number;
  readonly parameter1: number;
}
