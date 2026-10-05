// Collects uncaught page errors and console errors, ignoring the expected
// noise of an idle fake realtime socket.
const IGNORED = [
  /realtime/i,
  /websocket/i,
  /Download the React DevTools/i,
]

export function trackPageErrors(page) {
  const errors = []
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))
  page.on('console', (message) => {
    if (message.type() !== 'error') return
    const text = message.text()
    if (!IGNORED.some((pattern) => pattern.test(text))) errors.push(`console: ${text}`)
  })
  return () => errors
}
