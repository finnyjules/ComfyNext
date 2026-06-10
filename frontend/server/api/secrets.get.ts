// Masked status of server-held API tokens for the Settings UI.
// Never returns a full token — only whether one is set and its masked tail.
export default defineEventHandler(() => {
  const stored = readSecretsFile()
  const envReplicate = (useRuntimeConfig() as any).replicateToken as string | undefined

  return {
    replicateToken: {
      set: !!(stored.replicateToken || envReplicate),
      masked: maskToken(stored.replicateToken || envReplicate),
      source: stored.replicateToken ? 'settings' : (envReplicate ? 'env' : null),
    },
  }
})
