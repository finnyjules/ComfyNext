/**
 * Training defaults shared by the trainer UI and the server-side job builders.
 *
 * These used to be repeated literals — the form default plus a `?? 16` in each
 * route — so changing one meant hunting the rest, and a miss trained at a
 * different capacity than the UI advertised.
 */

/**
 * Default LoRA rank, surfaced in the trainer as "LoRA size".
 *
 * Higher rank = more capacity and a bigger output file. 32 holds fine detail
 * and multi-feature subjects (faces, hair, body) that 16 tends to smear,
 * at roughly double the file size.
 */
export const DEFAULT_LORA_RANK = 32
