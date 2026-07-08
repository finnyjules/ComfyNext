// Lets the client know whether the server carries a shared Anthropic key —
// only a boolean ever leaves the server. Drives the prompt bar's setup notice.
export default defineEventHandler((event) => {
  return { configured: !!useRuntimeConfig(event).anthropicApiKey }
})
