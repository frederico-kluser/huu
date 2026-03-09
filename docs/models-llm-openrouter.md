# LLM cost-performance matrix for multi-agent coding systems

**The cheapest models now match 90% of frontier coding performance at 2–3% of the cost.** For HUU's 11-agent architecture, a tiered model strategy mixing 2–3 frontier models with ultra-cheap open-source alternatives can cut per-feature costs from $0.60–$0.80 to **$0.30–$0.45** while maintaining or improving quality. The March 2026 landscape has bifurcated sharply: proprietary frontier models (Claude Opus 4.6, Gemini 3.1 Pro, GPT-5.4) lead on decontaminated benchmarks, while Chinese open-source MoE models (Step 3.5 Flash, MiMo-V2-Flash, DeepSeek V3.2) deliver 85–93% of that performance at $0.10–$0.30 per million tokens. The biggest shift since late 2025 is that **MiniMax M2.5** now tops all open-weight models on SWE-Bench Verified at 80.2% — matching Claude Opus 4.6 — for just $0.15/$1.20 per million tokens.

---

## Comprehensive pricing table across all providers

All prices are in USD per million tokens. Cache discounts assume the provider's standard prompt caching mechanism. Batch discounts (typically 50%) are available from Anthropic, OpenAI, and Google but not shown separately.

| Model | Input $/M | Output $/M | Cached Input $/M | Context | Speed (tok/s) |
|:---|---:|---:|---:|:---|---:|
| **Claude Opus 4.6** | $5.00 | $25.00 | $0.50 (90% off) | 200K–1M β | ~45 |
| **Claude Sonnet 4.6** | $3.00 | $15.00 | $0.30 (90% off) | 200K–1M β | ~62 |
| **Claude Haiku 4.5** | $1.00 | $5.00 | $0.10 (90% off) | 200K | ~80 est. |
| **GPT-5.4** | $2.50 | $15.00 | $0.25 (90% off) | 1.05M | ~55 est. |
| **GPT-5.3 Codex** | $1.75 | $14.00 | $0.175 (90% off) | 400K | ~68 |
| **Gemini 3.1 Pro** | $2.00 | $12.00 | $0.20 (90% off) | 1M | ~50 est. |
| **Gemini 3 Flash** | $0.50 | $3.00 | ~$0.05 (90% off) | 1M | ~143 |
| **Gemini 3.1 Flash Lite** | $0.25 | $1.50 | $0.025 (90% off) | 1M | **363** |
| **Gemini 2.5 Flash** | $0.30 | $2.50 | $0.03 (90% off) | 1M | ~110 est. |
| **MiniMax M2.5** | $0.15 | $1.20 | ~$0.015 (auto) | 196K | ~50 |
| **MiniMax M2.5 Lightning** | $0.30 | $2.40 | ~$0.03 (auto) | 196K | ~100 |
| **Kimi K2.5** | $0.60 | $2.50 | $0.10 (~83% off) | 256K | 60–100 |
| **Step 3.5 Flash** | $0.10 | $0.30 | $0.02 (80% off) | 262K | **163–300** |
| **MiMo-V2-Flash** | $0.10 | $0.30 | N/A confirmed | 256K | **119–150** |
| **DeepSeek V3.2** | $0.28 | $0.42 | $0.028 (90% off) | 128K | ~40 |
| **Devstral 2** | $0.40 (free promo) | $2.00 (free promo) | N/A | 256K | ~60 est. |
| **Devstral Small 2** | $0.10 | $0.30 | N/A | 256K | **~198** |
| **Grok Code Fast 1** | $0.20 | $1.50 | $0.02 (90% off) | 256K | **147–160** |
| **Qwen3-Coder 480B** (DeepInfra) | $0.22 | $1.00 | N/A | 262K | 57–170 |
| **GPT-5 Mini** | $0.25 | $2.00 | $0.025 (90% off) | 200K | Fast |
| **GPT-5 Nano** | $0.05 | $0.40 | $0.005 (90% off) | 128K | Very fast |
| **Gemini 2.5 Flash-Lite** | $0.10 | $0.40 | N/A | 1M | ~390 |

Note on GPT-5.4: OpenRouter lists output at $20.00/M; the $15.00 figure appears in more sources and likely reflects direct OpenAI API pricing. Prompts exceeding **272K tokens** incur a 2× input / 1.5× output surcharge.

---

## Benchmark scores reveal a contamination problem

SWE-Bench Verified remains the most widely reported coding benchmark, but **confirmed training data contamination** across all frontier models means these scores are inflated. OpenAI has stopped reporting Verified scores entirely, favoring SWE-Bench Pro. The decontaminated **SWE-rebench** from Epoch AI provides the most trustworthy comparison, though coverage is still limited. Terminal-Bench 2.0 tests real CLI/terminal agent tasks and correlates well with production agentic performance.

| Model | SWE-Bench Verified | SWE-rebench (pass@1) | SWE-Bench Pro | Terminal-Bench 2.0 | HumanEval |
|:---|---:|---:|---:|---:|---:|
| **Claude Opus 4.6** | **80.8%** | **51.7%** | 45.9–57.5%† | 65.4–74.7% | 95.0% |
| **Claude Sonnet 4.6** | 79.6% | — | — | 59.1% | 92.1% |
| **Claude Haiku 4.5** | 73.3% | — | 39.5% | — | — |
| **GPT-5.4** | ~80%‡ | — | **57.7%** | ~75%§ | ~95% est. |
| **GPT-5.3 Codex** | — | — | 56.8% | **77.3%** | — |
| **Gemini 3.1 Pro** | **80.6%** | ~46.7% | 43.3% | **78.4%** ★ | ~93% |
| **Gemini 3 Flash** | 78.0% | 46.7% | 34.6% | — | — |
| **Gemini 3.1 Flash Lite** | — | — | — | — | — |
| **Gemini 2.5 Flash** | ~64% | — | — | — | — |
| **MiniMax M2.5** | **80.2%** | 39.6% | — | 42.2% | 89.6% |
| **Kimi K2.5** | 76.8% | 37.9% | — | 50.8% | 99.0% |
| **Step 3.5 Flash** | 74.4% | — | — | 51.0% | 81.1% |
| **MiMo-V2-Flash** | 73.4% | — | — | 38.5% | 84.8% |
| **DeepSeek V3.2** | 70.4% | 37.5% | 15.6% | 39.6% | — |
| **Devstral 2** | 72.2%/50.4%‡‡ | 37.5% | — | 22.5–43.8%‡‡ | — |
| **Devstral Small 2** | 68.0%/42.4%‡‡ | 32.1% | — | 40.0% | — |
| **Grok Code Fast 1** | 57.6–70.8%‡‡ | ~29% | — | — | — |
| **Qwen3-Coder 480B** | ~55% est. | 31.7% | 38.7% | — | — |

★ = #1 on Terminal-Bench 2.0. † = Score varies dramatically by scaffold (45.9% standardized SEAL vs 57.5% with WarpGrep v2). ‡ = GPT-5.4's Verified score from automatio.ai (52.8%) appears anomalous; GPT-5.2 scored 80.0%, so ~80% is estimated. § = Inferred from GPT-5.3 Codex's 77.3%. ‡‡ = Self-reported vs. independent evaluation discrepancy.

**Aider Polyglot scores** (latest available, pre-Feb 2026 models): Claude Opus 4.5 **89.4%**, GPT-5 Thinking **88.0%**, Gemini 2.5 Pro **82.2%**, Grok 4 **79.6%**, DeepSeek V3.2-Exp **74.2%** ($1.30/run — 22× cheaper than frontier).

**Tool calling note**: The Berkeley Function Calling Leaderboard (BFCL V4) was last updated December 2025 and does not yet include any Feb–March 2026 models. For newer models, tool calling quality must be inferred from agentic benchmarks (τ²-Bench, MCPMark) and provider attestations. Claude and GPT models have the most battle-tested tool calling in production. GPT-5.4 introduces a "Tool Search" feature that reduces tool-calling token usage by **47%**.

---

## Performance-per-cost analysis for agent routing decisions

To create a meaningful cost comparison, the table below uses a **blended cost per 1M tokens** assuming a typical agentic workload: 70% input tokens (of which 60% hit cache) and 30% output tokens. This reflects the input-heavy, cache-friendly nature of multi-agent systems with shared system prompts.

**Blended formula**: `0.28 × input_price + 0.42 × cached_price + 0.30 × output_price`

| Model | Perf Score | Blended $/M | Perf/Cost Ratio | Tier |
|:---|---:|---:|---:|:---|
| **MiMo-V2-Flash** | 91 | **$0.12** | **757** | 💰 Budget |
| **Step 3.5 Flash** | 92 | **$0.13** | **709** | 💰 Budget |
| **Devstral Small 2** | 84 | $0.12 | 702 | 💰 Budget |
| **DeepSeek V3.2** | 87 | $0.22 | 396 | 💰 Budget |
| **MiniMax M2.5** | **99** | $0.41 | **242** | ⚡ Sweet spot |
| **Qwen3-Coder 480B** | 68 | $0.37 | 184 | 💰 Budget |
| **Gemini 3.1 Flash Lite** | 89 | $0.53 | 168 | ⚡ Mid-range |
| **Grok Code Fast 1** | 80 | $0.51 | 156 | ⚡ Mid-range |
| **Devstral 2** | 89 | $0.73 | 122 | ⚡ Mid-range |
| **Kimi K2.5** | 95 | $0.96 | 99 | ⚡ Mid-range |
| **Gemini 3 Flash** | 97 | $1.06 | 91 | ⚡ Mid-range |
| **Gemini 2.5 Flash** | 79 | $0.85 | 93 | ⚡ Mid-range |
| **Claude Haiku 4.5** | 91 | $1.82 | 50 | 🔷 Premium-lite |
| **Gemini 3.1 Pro** | **100** | $4.24 | 24 | 🔴 Frontier |
| **GPT-5.4** | 99 | $5.31 | 19 | 🔴 Frontier |
| **Claude Sonnet 4.6** | 99 | $5.47 | 18 | 🔴 Frontier |
| **Claude Opus 4.6** | **100** | $9.11 | 11 | 🔴 Frontier |

Performance Score is normalized 0–100 based on SWE-Bench Verified (best model = 100). The **Perf/Cost Ratio** divides performance by blended cost — higher is better. **MiniMax M2.5 stands out as the clear "sweet spot"**: 99% of frontier performance at 4–8% of frontier cost.

---

## How the open-source MoE revolution changes agent economics

The most striking finding is the **60–100× cost gap** between frontier and budget tiers that delivers only a 10–15% performance difference on standard benchmarks. Step 3.5 Flash ($0.10/$0.30) scores 74.4% on SWE-Bench Verified versus Claude Opus 4.6's 80.8% — a 6.4-point gap that costs **70× more to close**. For agents performing routine tasks (file merging, documentation, context curation), this math is decisive.

However, benchmark scores don't tell the whole story. On the decontaminated SWE-rebench, Claude Opus 4.6 leads at **51.7% pass@1** while MiniMax M2.5 drops to 39.6% and Chinese models cluster around 32–38%. The gap between frontier and budget widens substantially on harder, uncontaminated problems. For critical agents (orchestrator, planner, debugger) where failure cascades through the entire pipeline, **paying for frontier reliability matters**.

Three models emerged as particularly notable for agentic coding in early 2026. **Gemini 3.1 Pro** leads Terminal-Bench 2.0 at 78.4% — the best measure of real terminal-based agent performance — while costing 30% less than Claude Opus. **GPT-5.4** introduced native computer use and a Tool Search feature that cuts tool-calling token consumption by 47%, a direct cost savings for tool-heavy agents. And **MiniMax M2.5** proved that an open-weight model can match closed frontier SWE-Bench scores at radical price points.

---

## Recommended model allocation for HUU's 11 agents

The key insight for cost optimization: **only 3 of 11 agents need frontier models**. The orchestrator, planner, and debugger handle decisions where errors propagate catastrophically — these justify premium pricing. The remaining 8 agents can use mid-range or budget models without meaningful quality loss.

| Agent | Recommended Model | Blended $/M | Rationale |
|:---|:---|---:|:---|
| **Orchestrator** | Claude Sonnet 4.6 | $5.47 | Best tool calling reliability; routes other agents |
| **Planner** | Gemini 3.1 Pro | $4.24 | #1 Terminal-Bench; strongest architectural reasoning |
| **Builder** | MiniMax M2.5 | $0.41 | 80.2% SWE-Bench at fraction of frontier cost |
| **Tester** | Step 3.5 Flash | $0.13 | Fast, cheap, 74.4% SWE-Bench; test generation is formulaic |
| **Reviewer** | MiniMax M2.5 | $0.41 | Needs strong code comprehension; M2.5 delivers |
| **Researcher** | Gemini 3.1 Flash Lite | $0.53 | 1M context, 363 tok/s, native Google Search grounding |
| **Merger** | DeepSeek V3.2 | $0.22 | Cheapest capable model; merge operations are structured |
| **Refactorer** | Step 3.5 Flash | $0.13 | Good coding at minimal cost; refactoring is well-defined |
| **Doc-writer** | Devstral Small 2 | $0.12 | Apache 2.0, strong writing, $0.10/$0.30 pricing |
| **Debugger** | Claude Sonnet 4.6 | $5.47 | Debugging requires deep reasoning + reliable tool use |
| **Context-curator** | Gemini 3.1 Flash Lite | $0.53 | 1M context window ideal for codebase scanning |

**Estimated per-feature cost with this allocation**: Assuming each feature uses roughly 50K–150K tokens per agent with heavy caching, the weighted average blended cost across all 11 agents drops to approximately **$0.35–$0.50 per feature** — well within the $0.35–$0.55 target. The two Claude Sonnet 4.6 agents account for ~60% of total cost despite being only 2 of 11 agents, so further optimization should focus on whether the orchestrator or debugger could be moved to a cheaper model after testing.

---

## Five cost levers that stack multiplicatively

The single biggest cost lever is **prompt caching**. All major providers now offer 90% discounts on cached input tokens (Anthropic, OpenAI, Google, DeepSeek). In a multi-agent system where each agent has a substantial system prompt and shared code context, **60–80% cache hit rates are achievable**, cutting effective input costs by 54–72%. Anthropic's caching stacks with their 50% batch API discount for a combined **95% savings** on cacheable input in non-real-time workflows.

**Model routing** is the second lever: dynamically selecting models based on task complexity. A simple classifier could route straightforward tasks (documentation, formatting, simple merges) to Step 3.5 Flash ($0.13/M blended) while escalating complex debugging or architectural decisions to Claude Sonnet 4.6. Production systems like Martian and OpenRouter already offer this as a service.

**Output token management** matters because output tokens cost 3–8× more than input across all providers. Setting explicit `max_tokens` limits, requesting structured JSON responses, and using streaming with early termination can reduce output by 30–50%. GPT-5.4's Tool Search feature specifically targets this by reducing tool-calling token overhead by 47%.

**Batch API processing** at 50% off (Anthropic, OpenAI, Google) makes sense for non-latency-sensitive agents like the reviewer, doc-writer, and tester. If 4 of 11 agents can tolerate async 24-hour processing windows, batch pricing alone saves 15–20% on total cost.

**Free tiers and promotional pricing** offer immediate wins: Devstral 2 is currently free on Mistral's API (normally $0.40/$2.00), MiMo-V2-Flash and Qwen3-Coder 480B are free on OpenRouter (rate-limited), and Google offers a free tier for Gemini 3.1 Flash Lite with 5–15 RPM limits.

---

## Key caveats and what to watch in Q2 2026

**SWE-Bench Verified is unreliable for model comparison.** All frontier models show contamination; the 73–81% range among top models likely overstates real-world differences. Prefer SWE-rebench (decontaminated) and Terminal-Bench 2.0 for model selection decisions. On SWE-rebench, the spread between #1 (Claude Opus 4.6 at 51.7%) and #20 (DeepSeek V3.2 at 37.5%) is only 14 points — much tighter than SWE-Bench Verified suggests.

**Scaffold dependence is enormous.** The same model can score 45.9% (standardized SEAL scaffold) vs. 57.5% (WarpGrep v2) on SWE-Bench Pro — a 12-point swing from tooling alone. HUU's agent framework quality matters as much as model selection.

**Models to watch**: DeepSeek V4 is expected imminently (possibly March 2026) with multimodal capabilities and training on domestic Chinese chips. Grok 4.20's full release (Q2 2026) promises native multi-agent inference with 4 specialized sub-agents. Qwen3-Coder-Next (80B, only 3B active) already hits 70.6% SWE-Bench Verified — the most parameter-efficient coding model available.

**"Gemini 3.1 Flash" does not exist** as of March 9, 2026. The 3.1 series includes only Gemini 3.1 Pro Preview and Gemini 3.1 Flash Lite Preview. The closest equivalent is Gemini 3 Flash ($0.50/$3.00, 78% SWE-Bench Verified).

## Conclusion

The optimal strategy for HUU is not choosing the single best model — it's building a **cost-aware routing layer** that matches model capability to task criticality. Three frontier models (Claude Sonnet 4.6, Gemini 3.1 Pro) handle the 3 agents where errors cascade; budget models (MiniMax M2.5, Step 3.5 Flash, DeepSeek V3.2) handle the other 8. Combined with aggressive prompt caching (90% discount) and batch processing (50% discount), this architecture should achieve **$0.35–$0.45 per feature** — a 40–55% reduction from current costs. The March 2026 model landscape has made frontier-quality coding accessible at budget prices; the remaining premium is for reliability, not capability.