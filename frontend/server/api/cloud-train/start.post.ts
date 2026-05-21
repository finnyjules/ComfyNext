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
export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  const token = (config as any).replicateToken
  if (!token) {
    throw createError({ statusCode: 500, message: 'Replicate token not configured. Set NUXT_REPLICATE_TOKEN.' })
  }

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

  const predRes = await fetch('https://api.replicate.com/v1/predictions', {
    method: 'POST',
    headers: {
      Authorization: `Token ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ version, input }),
  })

  if (!predRes.ok) {
    const text = await predRes.text().catch(() => '')
    throw createError({ statusCode: predRes.status, message: text || predRes.statusText })
  }

  const pred = await predRes.json() as { id: string; status: string }
  return {
    id: pred.id,
    status: pred.status,
    family: body.family ?? 'flux',
    outputName: body.outputName,
    trainerModel,
    versionId: version,
  }
})
