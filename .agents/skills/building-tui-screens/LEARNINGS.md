# Learnings — building-tui-screens

Append-only log consumed by meta-skill-evolution and meta-skill-consolidate.
Entry format: `- [YYYY-MM-DD][source:user|inference][task:<slug>][probation] <fact>`
States: probation (default) -> promoted (distilled into SKILL.md by meta-skill-consolidate after dual-buffer check) | superseded (kept for history, never deleted).
Learnings are routed here when THIS skill owns the domain of the fact — regardless of which skill ran the task.

<!-- entries below this line -->
- [2026-06-12][source:inference][task:tui-ux-redesign][probation] $EDITOR hand-off under Ink works: useStdin().setRawMode(false) → spawnSync(editor, [tmpfile], {stdio:'inherit'}) → setRawMode(true) → stdout.write('\x1b[3J') to force a clean repaint. Split $EDITOR/$VISUAL on spaces (supports "code --wait"). Guard with stdout.isTTY and surface a notice instead of crashing.
- [2026-06-12][source:inference][task:tui-ux-redesign][probation] Full-screen pick panels with their OWN useInput (ListPick pattern) need the parent's useInput to early-return while a panel is open (same gate as pickingFiles/pickingModel) — otherwise both handlers fire per keystroke.
