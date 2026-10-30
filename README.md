# ysk-throttle

A Claude Code mod that cuts the cost of the built-in **"You should know"** side agent by about 70%, without turning it off.

## Why

"You should know" (`cc-plugin-you-should-know`, off by default) watches your main conversation and occasionally
offers a note. To do that it checks at every 6th model call of a turn. Each check re-sends **your whole conversation on your
main model** (Opus, if that is what you run), plus an ~11,000-token prompt that is never cached, to get back a few
words, usually "nothing to say". These calls are not written to your session logs, so cost tools that read logs miss them.

Measured on one heavy user's machine (Claude Code 2.1.312, mostly Opus 5.5), replaying a week of sessions:

| | checks per week | API list-price equivalent |
|---|---|---|
| plugin as shipped | 2,385 | $341 (about 7% of all spend) |
| with this mod (defaults) | 679 | $93 |

## What it does

- Lets a routine check through only after **24 tool calls** in your main conversation since the last one it allowed.
  Every other check is answered "nothing to say", the plugin's own no-reply case, so nothing breaks.
- Skips a check that would land on an **expired prompt cache**, because such a check pays for your whole
  conversation at full input price (about $2 each on a long Opus session).
- Never touches **"explain"** requests, the ones you trigger by clicking a note.
- It counts tool calls, not minutes, so sessions left open for hours are throttled the same way.

Tested live: the same 27-call turn made **4 checks without the mod and 1 with it**, with no errors from either plugin.

## Install

In a Claude Code session, type:

```
/plugin install ysk-throttle --marketplace declanbx/you-should-know-throttle
```

Answer `y` to add the marketplace, then pick a scope. Restart sessions that were already open.

## Settings

Both are in the `/config` menu once installed, or in `settings.json` under `pluginConfigs`:

| setting | default | meaning |
|---|---|---|
| `minToolCalls` | 24 | main-conversation tool calls between two routine checks (12 ≈ 50% saved, 36 ≈ 80%) |
| `staleMinutes` | 55 | skip a check after a gap longer than this. Claude subscriptions typically write 1-hour cache entries; with an API key the default is 5 minutes, so set 4 |

## How it works

A user mod runs above Claude Code's built-in plugins. When "You should know" calls `$.model.fork`, this mod's
`model.fork` hook sees the call, checks `next.origin.plugin` and the prompt's opening line, and either passes it on
or answers it. Two other hooks count main-conversation tool calls (`tool.call`) and time each model request
(`turn.step`). The code is about 60 lines: [`hooks/register.ts`](hooks/register.ts).

## Limits

- It can only send fewer checks. Each check still uses your main model and the plugin's uncached prompt, because
  Claude Code fixes both.
- It recognises a routine check by its prompt's first sentence (written against Claude Code 2.1.312), so a renamed
  plugin is still caught. If an update rewords that sentence, the mod lets the checks through and **says so in your
  session** (a transcript line and a pop-up, once per session): *"the 'You should know' plugin changed its check
  prompt, so its checks are NOT being throttled"*. Tested by rewording it on purpose: the warning appeared, the checks
  went through. If an update renamed the plugin and reworded the prompt at once, the mod could not tell, and the
  plugin would run unthrottled.
- If the mod itself fails (an error in one of its hooks), Claude Code skips the hook and the call goes on, so the
  plugin runs unthrottled. The mod can never block a call; the debug log (`claude --debug`) names any failed hook.
- Notes arrive less often, by design.

MIT licence. Not affiliated with Anthropic.
