export function printUsage(): void {
  console.info(`
hijackclaw — Route Claude Code through your ChatGPT subscription

COMMANDS
  login        Sign in to ChatGPT via browser OAuth
  serve        Run the translation proxy (foreground)
  status       Show proxy and auth status

QUICK START
  1. claude-codex --login   # authenticate with ChatGPT
  2. claude-codex           # run Claude Code with Codex backend

SAFETY
  - All state lives in ~/.hijackclaw/
`.trimStart());
}
