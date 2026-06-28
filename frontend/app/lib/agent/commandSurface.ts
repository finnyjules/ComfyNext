/**
 * Shared types for the agent command/describe surface (foundation F1 of the
 * agentic north star — see docs/agentic-north-star.md).
 *
 * A surface lets a client read its current state via a snapshot (perception)
 * and change it via named, invertible commands (action). The agent is the first
 * client; the editor UI becomes a client later so manual and agent edits share
 * one path (and undo/redo come for free from the inverses).
 */

/** An addressable thing on a surface (a section, a layer, a node…). */
export interface DescribedObject {
  /** Stable id the agent addresses. */
  id: string
  /** Human-meaningful label — what the user would call it. */
  label: string
  /** Object kind, e.g. 'section'. */
  type: string
  /** Current value/state; surface-specific shape. */
  current: unknown
}

/** A command the agent may emit, plus the semantics that help it choose. */
export interface CommandSpec {
  /** Operation name the agent emits. */
  op: string
  /** Semantic guidance for mapping a natural-language intent to this command
   *  (foundation F3 — populated as hints are authored). */
  hint?: string
}

/** What a client reads to perceive a surface: its objects + its command menu. */
export interface SurfaceSnapshot {
  /** Surface id, e.g. 'smart-layout'. */
  surface: string
  /** Addressable objects currently on the surface. */
  objects: DescribedObject[]
  /** Commands the agent may apply to this surface. */
  commands: CommandSpec[]
}

/** A single edit the agent emits. `op` is one of the surface's CommandSpec ops;
 *  `target` names the object it acts on; `args` carries the operation payload. */
export interface Command {
  op: string
  target?: string
  args?: Record<string, unknown>
}

/** Why an apply was refused. Mirrors the intent-corpus failure modes. */
export type CommandFailure = 'out-of-vocabulary' | 'invalid' | 'postcondition-failed'

/** The result of applying a command. On success it carries the new state and an
 *  `inverse` command that undoes it (so propose/reject and undo are free). */
export type CommandResult<T> =
  | { ok: true; template: T; inverse: Command }
  | { ok: false; reason: CommandFailure; detail: string }
