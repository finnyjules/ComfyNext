// Save server-held API tokens pasted in Settings → AI.
// An empty string clears the stored value (env-var fallback applies again).
export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const { replicateToken } = body || {}

  if (replicateToken === undefined) {
    throw createError({ statusCode: 400, message: 'Nothing to save' })
  }
  if (typeof replicateToken !== 'string') {
    throw createError({ statusCode: 400, message: 'replicateToken must be a string' })
  }

  const stored = writeSecretsFile({ replicateToken: replicateToken.trim() })
  const envReplicate = (useRuntimeConfig() as any).replicateToken as string | undefined

  return {
    replicateToken: {
      set: !!(stored.replicateToken || envReplicate),
      masked: maskToken(stored.replicateToken || envReplicate),
      source: stored.replicateToken ? 'settings' : (envReplicate ? 'env' : null),
    },
  }
})
