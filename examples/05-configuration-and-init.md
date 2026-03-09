# Configuration and Initialization

Set up HUU in an existing project and customize its behavior.

## Objective

Initialize HUU, configure agent concurrency, model tiers, and MCP servers.

## Pre-conditions

- Git repository with at least one commit
- Node.js 22+ installed
- `ANTHROPIC_API_KEY` set

## Commands

### Initialize HUU

```bash
# Interactive setup
huu init

# Accept defaults (non-interactive)
huu init --yes

# Preview without making changes
huu init --dry-run
```

### Expected Output (Interactive)

```
[huu] Initializing HUU in /path/to/project...
[huu] ─────────────────────────────────────
[huu] Creating .huu/ directory...
[huu] Creating .huu/config.json with defaults...
[huu] Adding .huu/ to .gitignore...
[huu] ─────────────────────────────────────
[huu] HUU initialized. Run `huu config` to customize.
```

### View Configuration

```bash
# Human-readable output
huu config

# JSON output (for scripting)
huu config --json
```

### Modify Configuration

```bash
# Set individual values
huu config --set maxConcurrentAgents=3
huu config --set stuckTimeoutMs=120000

# Reset to defaults
huu config --reset
```

## Configuration Options

| Key | Default | Description |
|-----|---------|-------------|
| `maxConcurrentAgents` | 5 | Maximum agents running in parallel |
| `pollIntervalActiveMs` | 1000 | Polling interval during active work |
| `pollIntervalIdleMs` | 5000 | Polling interval when idle |
| `stuckTimeoutMs` | 90000 | Timeout before agent is considered stuck |
| `maxRetries` | 3 | Maximum retry attempts per task |

## MCP Server Configuration

MCP servers are configured in `.huu/mcp.json`:

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/allowed"],
      "lifecycle": "lazy"
    }
  }
}
```

Global configuration lives at `~/.huu/mcp.json` and is merged with project-level config.

| Lifecycle | Behavior |
|-----------|----------|
| `lazy` | Connect on first tool use, disconnect after idle timeout |
| `eager` | Connect immediately on HUU startup |

## Verbosity Levels

```bash
huu run "task" -v       # Info level (default + info messages)
huu run "task" -vv      # Debug level (+ debug details)
huu run "task" -vvv     # Trace level (+ all internal state)
huu run "task" -q       # Quiet mode (errors only)
```

## Result

- `.huu/` directory created with default configuration
- `.gitignore` updated to exclude `.huu/`
- Configuration persisted in `.huu/config.json`

## Common Failures

| Symptom | Cause | Fix |
|---------|-------|-----|
| `Not a git repository` | No git init | `git init && git commit --allow-empty -m "init"` |
| `Config already exists` | Running init twice | Use `huu init --force` to overwrite |
| `--quiet and --verbose conflict` | Both flags passed | Use one or the other |
| MCP server fails to connect | Wrong command/args | Check `.huu/mcp.json` and test command manually |
