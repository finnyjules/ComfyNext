/**
 * POST /api/cloud-train/start
 *
 * Body: {
 *   family: 'flux' | 'sdxl_sd15',
 *   datasetUrl: string,         // from /upload
 *   outputName: string,
 *   triggerWord?: string,
 *   steps?: number,
 *   learningRate?: number,
 *   loraRank?: number,
 *   batchSize?: number,
 *   seed?: number,
 * }
 *
 * Fetches the latest version of the chosen Replicate trainer model, then
 * kicks off a prediction. Returns the prediction id; the frontend polls
 * /status with that id.
 */
function sanitize(name: string): string {
  return (name || '').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'my-lora'
}

export default defineEventHandler(async (event) => {
  const token = requireReplicateToken()

  const body = await readBody(event) as {
    family?: 'flux' | 'sdxl_sd15'
    datasetUrl?: string
    outputName?: string
    triggerWord?: string
    steps?: number
    learningRate?: number
    loraRank?: number
    batchSize?: number
    seed?: number
  }

  if (!body.datasetUrl) throw createError({ statusCode: 400, message: 'datasetUrl is required' })
  if (!body.outputName) throw createError({ statusCode: 400, message: 'outputName is required' })

  const trainerModel = body.family === 'flux'
    ? 'ostris/flux-dev-lora-trainer'
    : 'ostris/sdxl-lora-trainer'

  // Fetch the latest version hash for this trainer.
  const modelRes = await fetch(`https://api.replicate.com/v1/models/${trainerModel}`, {
    headers: { Authorization: `Token ${token}` },
  })
  if (!modelRes.ok) {
    const text = await modelRes.text().catch(() => '')
    throw createError({
      statusCode: 502,
      message: `Could not look up trainer model ${trainerModel}: ${text || modelRes.statusText}`,
    })
  }
  const modelInfo = await modelRes.json() as { latest_version?: { id?: string } }
  const version = modelInfo.latest_version?.id
  if (!version) {
    throw createError({ statusCode: 502, message: `Trainer model ${trainerModel} has no latest version` })
  }

  // Build the input dict. Hyperparameters are common to both trainers; only
  // a couple of names differ across the family. We send the union; Replicate
  // ignores unknown keys, and required ones are present in both schemas.
  const input: Record<string, any> = {
    input_images: body.datasetUrl,
    steps: body.steps ?? 500,
    learning_rate: body.learningRate ?? 0.0004,
    lora_rank: body.loraRank ?? 16,
    batch_size: body.batchSize ?? 1,
    seed: body.seed ?? Math.floor(Math.random() * 1_000_000_000),
    autocaption: false, // we ship our own captions via the zip
  }
  if (body.triggerWord) input.trigger_word = body.triggerWord

  // These are TRAINING models — they must be started via the trainings API, not
  // /v1/predictions (which would invoke the model's inference interface and
  // reject with "prompt is required"). A training pushes the resulting weights
  // to a `destination` model the token owner controls, so we resolve the
  // account username and ensure that destination exists first.
  const acctRes = await fetch('https://api.replicate.com/v1/account', {
    headers: { Authorization: `Token ${token}` },
  })
  if (!acctRes.ok) {
    const text = await acctRes.text().catch(() => '')
    throw createError({ statusCode: 502, message: `Could not resolve Replicate account: ${text || acctRes.statusText}` })
  }
  const account = await acctRes.json() as { username?: string }
  const username = account.username
  if (!username) {
    throw createError({ statusCode: 502, message: 'Replicate account returned no username' })
  }

  const destName = `jules-${sanitize(body.outputName)}`
  const destination = `${username}/${destName}`

  // Ensure the destination model exists (create on first use). A 409 / "already
  // exists" just means we've trained to this name before — that's fine.
  const createRes = await fetch('https://api.replicate.com/v1/models', {
    method: 'POST',
    headers: { Authorization: `Token ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      owner: username,
      name: destName,
      visibility: 'private',
      hardware: 'gpu-t4',
      description: 'LoRA trained from Sailor.',
    }),
  })
  if (!createRes.ok && createRes.status !== 409) {
    const text = await createRes.text().catch(() => '')
    if (!/already exists/i.test(text)) {
      throw createError({ statusCode: 502, message: `Could not create destination model ${destination}: ${text || createRes.statusText}` })
    }
  }

  // Start the training.
  const trainRes = await fetch(
    `https://api.replicate.com/v1/models/${trainerModel}/versions/${version}/trainings`,
    {
      method: 'POST',
      headers: { Authorization: `Token ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ destination, input }),
    },
  )
  if (!trainRes.ok) {
    const text = await trainRes.text().catch(() => '')
    throw createError({ statusCode: trainRes.status, message: text || trainRes.statusText })
  }

  const training = await trainRes.json() as { id: string; status: string }
  return {
    id: training.id,
    status: training.status,
    family: body.family ?? 'flux',
    outputName: body.outputName,
    trainerModel,
    versionId: version,
    destination,
  }
})
