import type { Register, ModelForkResult } from 'claude-code'

// Throttles Claude Code's built-in "You should know" side agent (cc-plugin-you-should-know). It checks at
// every 6th model call of a main-conversation turn, and each check re-sends the whole conversation on the
// main model plus a ~11,000-token prompt that is never cached. A user mod sits above a built-in plugin, sees
// which plugin made a `$.model.fork` call, and may answer it. This one answers a routine check "nothing to
// say" (the plugin's own no-reply case) unless
//   - at least `minToolCalls` main-conversation tool calls ran since the last check it let through, and
//   - the step before the check came within `staleMinutes` of the one before it; after a longer gap the
//     conversation's prompt cache has likely expired and the check would pay for all of it at full price.
// "Explain" requests (the person clicked) always go through. Checks are recognised by their prompt, so a renamed
// plugin is still caught; if the plugin rewords its check prompt, the mod lets its checks through and says so in the
// session, once. (If both change at once, it cannot tell, and the plugin runs unthrottled.)

const YSK = 'cc-plugin-you-should-know'
const ROUTINE_CHECK = 'You are a helpful observer whose goal is to help the human better understand their work'
const EXPLAIN = 'The person watching you work said yes to'

const NOTHING: ModelForkResult = {
  isAnswered: false,
  reason: 'empty-reply',
  usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
}

export const register: Register = (on, options) => {
  const minToolCalls = Number(options.minToolCalls ?? 24)
  const staleMs = Number(options.staleMinutes ?? 55) * 60_000
  const toolsSince = new Map<string, number>() // session -> main-conversation tool calls since the last check let through
  const lastStepAt = new Map<string, number>() // session -> when the main conversation's latest model request went out
  const gapBefore = new Map<string, number>() // session -> ms between that request and the one before it
  let hasWarned = false

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    try { // the tool has run: nothing after this may fail the hook
      if (e.agentId === undefined) {
        const s = await $.session.id()
        toolsSince.set(s, (toolsSince.get(s) ?? minToolCalls) + 1)
      }
    } catch {}
    return ran
  })

  on('turn.step', async function* ($, e, next) {
    if (e.agentId === undefined) {
      const s = await $.session.id()
      const now = Date.now()
      gapBefore.set(s, now - (lastStepAt.get(s) ?? now))
      lastStepAt.set(s, now)
    }
    return yield* next(e)
  })

  on('model.fork', async ($, e, next) => {
    if (!e.prompt.includes(ROUTINE_CHECK)) {
      if (next.origin.plugin === YSK && !e.prompt.includes(EXPLAIN) && !hasWarned) {
        hasWarned = true
        const msg = "the 'You should know' plugin changed its check prompt, so its checks are NOT being throttled. Update ysk-throttle."
        $.ui.log(msg)
        $.ui.toast(msg, { timeoutMs: 20_000 })
      }
      return next(e)
    }
    const s = await $.session.id()
    const isDue = (toolsSince.get(s) ?? minToolCalls) >= minToolCalls
    const isWarm = (gapBefore.get(s) ?? 0) <= staleMs
    if (!isDue || !isWarm) return { value: NOTHING }
    toolsSince.set(s, 0)
    return next(e)
  })
}
