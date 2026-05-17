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

const GlassesObject = z.record(z.string(), z.unknown())

const _GlassesOpBase = { type: z.literal('glassesSceneOp'), computerId: z.number().int() }
const AddOp              = z.object({ ..._GlassesOpBase, op: z.literal('add'),              object: GlassesObject })
const UpdateOp           = z.object({ ..._GlassesOpBase, op: z.literal('update'),           objectId: z.string(), object: GlassesObject })
const RemoveOp           = z.object({ ..._GlassesOpBase, op: z.literal('remove'),           objectId: z.string() })
const ClearOp            = z.object({ ..._GlassesOpBase, op: z.literal('clear') })
const ReorderOp          = z.object({ ..._GlassesOpBase, op: z.literal('reorder'),          objectId: z.string(), fromIdx: z.number().int(), toIdx: z.number().int() })
const GroupOp            = z.object({ ..._GlassesOpBase, op: z.literal('group'),            objectIds: z.array(z.string()), groupObject: GlassesObject })
const UngroupOp          = z.object({ ..._GlassesOpBase, op: z.literal('ungroup'),          objectId: z.string() })
const GroupChildUpdateOp = z.object({ ..._GlassesOpBase, op: z.literal('groupChildUpdate'), groupId: z.string(), childId: z.string(), delta: GlassesObject })

const GlassesSceneOp = z.discriminatedUnion('op', [
  AddOp, UpdateOp, RemoveOp, ClearOp, ReorderOp, GroupOp, UngroupOp, GroupChildUpdateOp,
])

const SubscribeCanvas = z.object({
  type: z.literal('subscribeCanvas'),
  computerId: z.number().int(),
  subscribe: z.boolean(),
})

export const ClientMessage = z.discriminatedUnion('type', [
  InvokeCommand,
  RunProgram,
  SetCommand,
  SetStopSignal,
  ClearCommandQueue,
  SetGlassesScene,
  GlassesSceneOp,
  SubscribeCanvas,
])
export type ClientMessage = z.infer<typeof ClientMessage>

// ─── Server → Browser ────────────────────────────────────────────────────────
// These four variants don't share a common discriminant field, so we use
// z.union and narrow with `'key' in data` checks on the parsed result.

const ChatMessageSchema = z.object({
  player: z.string(),
  message: z.string(),
  uuid: z.string(),
  timestamp: z.number(),
  computerId: z.coerce.number().optional().default(0),
})

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
    chatLog: z.array(ChatMessageSchema).optional(),
  }),
})

const ServerTransactions = z.object({
  transactions: z.record(z.string(), z.object({
    id: z.number(),
    blocks: z.record(z.string(), z.unknown()),
    computers: z.record(z.string(), z.unknown()),
    chatLog: z.array(ChatMessageSchema).optional(),
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
    chatLog: z.array(ChatMessageSchema).optional(),
  }),
})

const ServerCanvasUpdate = z.object({
  canvasUpdate: z.object({
    computerId: z.number(),
    scene: z.array(z.record(z.string(), z.unknown())),
  }),
})

export const ServerMessage = z.union([
  ServerError,
  ServerCommandResult,
  ServerState,
  ServerStateChunk,
  ServerCanvasUpdate,
  ServerTransactions,
])
export type ServerMessage = z.infer<typeof ServerMessage>
