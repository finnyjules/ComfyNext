/**
 * Reconstruct which local training-dataset folder produced a given LoRA.
 *
 * The trainer stages each run into `input/lora_dataset_<ms>/`, where <ms> is a
 * Date.now() taken at *session start*. The LoRA sidecar only records the training
 * *finish* time (`trained_on`). Nothing links the two, so we match by timestamp:
 * a run's folder starts a few minutes to a few hours before it finishes, so the
 * right folder is the one whose start is the nearest at/before `trained_on`,
 * within a sane window. Folders with no LoRA (retrains, abandoned sessions,
 * character sets) simply never get matched.
 *
 * Pure + dependency-free so it can be unit-tested without the filesystem.
 */

export interface DatasetFolder {
  name: string
  startMs: number
  imageCount: number
}

export interface DatasetMatch {
  folder: DatasetFolder
  gapMinutes: number
}

/** Parse the Date.now() ms a `lora_dataset_<ms>` folder name carries, or null. */
export function parseDatasetStartMs(folderName: string): number | null {
  const m = /^lora_dataset_(\d+)$/.exec(folderName)
  return m ? Number(m[1]) : null
}

/**
 * Nearest folder whose session started at/before `trainedOnIso`, within
 * `maxGapMinutes`. Returns null when the training time is unparseable or no
 * folder falls inside the window (the style's dataset is gone / never local).
 */
export function matchDatasetFolder(
  trainedOnIso: string | null | undefined,
  folders: DatasetFolder[],
  maxGapMinutes = 180,
): DatasetMatch | null {
  const finish = trainedOnIso ? Date.parse(trainedOnIso) : NaN
  if (!Number.isFinite(finish)) return null

  let best: DatasetMatch | null = null
  for (const folder of folders) {
    if (!Number.isFinite(folder.startMs) || folder.startMs <= 0) continue
    if (folder.startMs > finish) continue // session can't start after training finished
    const gapMinutes = (finish - folder.startMs) / 60_000
    if (gapMinutes > maxGapMinutes) continue
    // Nearest-before wins: the largest start still at/before the finish.
    if (!best || folder.startMs > best.folder.startMs) best = { folder, gapMinutes }
  }
  return best
}
