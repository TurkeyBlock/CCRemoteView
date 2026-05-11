import { z } from 'zod'

// ─── Browser → Server ────────────────────────────────────────────────────────

const InvokeCommand = z.object({
  type: z.literal('invokeCommand'),
  id: z.number().int(),
  command: z.string(),
  args: z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
})

const RunProgram = z.object({
  type: z.literal('runProgram'),
  id: z.number().int(),
  program: z.string(),
})

const SetCommand = z.object({
  type: z.literal('setCommand'),
  id: z.number().int(),
  cmd: z.string(),
  concurrent: z.boolean().optional(),
})

const SetStopSignal = z.object({
  type: z.literal('setStopSignal'),
  id: z.number().int(),
})

const ClearCommandQueue = z.object({
  type: z.literal('clearCommandQueue'),
  id: z.number().int(),
})

const SetGlassesScene = z.object({
  type: z.literal('setGlassesScene'),
  computerId: z.number().int(),
  scene: z.array(z.record(z.string(), z.unknown())),
})

const GlassesSceneOp = z.object({
  type: z.literal('glassesSceneOp'),
  computerId: z.number().int(),
  op: z.enum(['add', 'update', 'remove', 'clear', 'reorder']),
  object: z.record(z.string(), z.unknown()).optional(),
  objectId: z.string().optional(),
  fromIdx: z.number().int().optional(),
  toIdx: z.number().int().optional(),
})

const SetGlassesLiveMode = z.object({
  type: z.literal('setGlassesLiveMode'),
  computerId: z.number().int(),
  enabled: z.boolean(),
})

export const ClientMessage = z.discriminatedUnion('type', [
  InvokeCommand,
  RunProgram,
  SetCommand,
  SetStopSignal,
  ClearCommandQueue,
  SetGlassesScene,
  GlassesSceneOp,
  SetGlassesLiveMode,
])
export type ClientMessage = z.infer<typeof ClientMessage>

// ─── Server → Browser ────────────────────────────────────────────────────────
// These four variants don't share a common discriminant field, so we use
// z.union and narrow with `'key' in data` checks on the parsed result.

const ServerError = z.object({
  type: z.literal('error'),
  computerId: z.number(),
  message: z.string(),
})

const ServerCommandResult = z.object({
  commandResult: z.object({
    computerId: z.number(),
    result: z.object({
      succ: z.boolean(),
      ret: z.unknown(),
    }),
  }),
})

// Inner content (computers, blocks) is kept as unknown — the Zustand store
// owns the deep validation of those shapes.
const ServerState = z.object({
  state: z.object({
    computers: z.record(z.string(), z.unknown()),
    world: z.object({ blocks: z.record(z.string(), z.unknown()) }),
    lastTransactionId: z.number(),
  }),
})

const ServerTransactions = z.object({
  transactions: z.record(z.string(), z.object({
    id: z.number(),
    blocks: z.record(z.string(), z.unknown()),
    computers: z.record(z.string(), z.unknown()),
  })),
})

// Chunked full-state delivery: palette + flat blockData array, sent in
// CHUNK_BLOCKS-sized pieces.  palette and computers are only present on
// index 0; blockData is present on every chunk.
const ServerStateChunk = z.object({
  stateChunk: z.object({
    index: z.number(),
    total: z.number(),
    lastTransactionId: z.number(),
    blockData: z.unknown(),
    palette: z.array(z.string()).optional(),
    computers: z.record(z.string(), z.unknown()).optional(),
  }),
})

export const ServerMessage = z.union([
  ServerError,
  ServerCommandResult,
  ServerState,
  ServerStateChunk,
  ServerTransactions,
])
export type ServerMessage = z.infer<typeof ServerMessage>
