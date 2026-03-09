# HUU Demo

Deterministic terminal demo using [VHS](https://github.com/charmbracelet/vhs).

## Prerequisites

Install VHS:

```bash
# macOS
brew install charmbracelet/tap/vhs

# Go
go install github.com/charmbracelet/vhs@latest
```

## Generate

```bash
vhs docs/demo/demo.tape
```

Output: `docs/demo/huu-e2e.gif`

## Alternative: asciinema

For interactive recording:

```bash
# Install
brew install asciinema

# Record
asciinema rec docs/demo/huu-demo.cast

# Play
asciinema play docs/demo/huu-demo.cast
```
