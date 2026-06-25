# Learnings — writing-project-docs

Append-only log consumed by meta-skill-evolution and meta-skill-consolidate.
Entry format: `- [YYYY-MM-DD][source:user|inference][task:<slug>][probation] <fact>`
States: probation (default) -> promoted (distilled into SKILL.md by meta-skill-consolidate after dual-buffer check) | superseded (kept for history, never deleted).
Learnings are routed here when THIS skill owns the domain of the fact — regardless of which skill ran the task.

<!-- entries below this line -->
- [2026-06-24][source:inference][task:readme-competitor-rewrite][probation] The README version badge (`img.shields.io/badge/version-X.Y.Z`) is hand-maintained and drifts from `package.json` — found at 1.3.0 while package.json was 1.4.0. When editing either README twin, reconcile the badge against `node -p "require('./package.json').version"`.
- [2026-06-24][source:inference][task:readme-competitor-rewrite][probation] The README "Backends" table + mermaid drift from `src/orchestrator/backends/registry.ts` — both READMEs listed only pi/copilot/stub while the registry ships 4 (azure was production-ready but undocumented). Reconcile the backend list against the registry's `case '<kind>'` arms when touching that section.
- [2026-06-24][source:inference][task:readme-competitor-rewrite][probation] Competitor/positioning claims in the README age fast (star counts, project status, license, vendor mergers). Keep hard numbers (GitHub stars) OUT of committed docs — state ecosystem size qualitatively — and prefer the two-axis framing (who decides scope · how work is merged) which is stable as the landscape churns.
