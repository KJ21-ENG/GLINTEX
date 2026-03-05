# Codex Slash Commands Setup (Project -> Global)

## Why `/` commands were missing
Codex app registers custom slash commands from the global prompts directory:
- `~/.codex/prompts`

This project had prompt files in:
- `/Volumes/MacSSD/Development/CursorAI_Project/GLINTEX/.codex/prompts`

Because `~/.codex/prompts` was empty, slash commands were not visible in the app.

## What was done
Copied all project prompt markdown files into the global Codex prompts directory:

```bash
mkdir -p "$HOME/.codex/prompts"
cp -f /Volumes/MacSSD/Development/CursorAI_Project/GLINTEX/.codex/prompts/*.md "$HOME/.codex/prompts/"
```

Result:
- `~/.codex/prompts` now contains 41 command prompt files.

## How to verify
1. Restart or reload the Codex app.
2. In chat input, type `/` and check command suggestions.
3. Try a known command such as:
   - `/bmad-help`

## Notes
- If project prompt files change later, re-run the copy command.
- Command names are typically derived from the prompt filenames (without `.md`).
