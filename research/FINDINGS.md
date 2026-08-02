# Pentest Tools Research — Consolidated Findings

**Date:** 2026-08-02
**Method:** surf-research-skill (deep mode, 2 waves, 7 sub-agents)
**Sources:** ~250 unique sources across all handoffs

## Wave 1: Foundation (4 agents)

### A: Network Scanning & Enumeration (11 tools)
nmap (gold standard, XML only), masscan (JSON, ultra-fast), subfinder (JSON, 45+ passive sources), httpx (JSON, HTTP probe), naabu (JSON, Go port scan), amass (JSON, 87+ sources), nuclei (JSON, 12k+ templates), testssl.sh (JSON via --jsonfile, ghcr.io), rustscan (partial JSON), findomain (JSON), bbot (JSON, modular).

Canonical pipeline: masscan → nmap → subfinder → httpx → nuclei.

### B: Web Application Testing (9 tools)
OWASP ZAP (Docker headless, Automation Framework YAML, traditional-json + SARIF), nuclei (12k+ templates, -jsonl), WPScan (43k+ WP vulns, --format json), ffuf (Go, -of json), SQLMap (apt, já integrado), Nikto (apt, já integrado), Wapiti (pip, -f json), testssl.sh (ghcr.io, --jsonfile), Burp Pro (headless possível mas licença paga — inviável).

### C: Vulnerability & Exploitation (8 tools)
nuclei (top-1), searchsploit (apt exploitdb, -j JSON, --cve), cve_searchsploit (CVE→exploit bridge), cve-bin-tool (Intel, pip, SQLite, -f json), cve-search (CIRCL, MongoDB — pesado), metasploit (resource scripts -q -r, sem JSON genérico), vulnx (PD, 2026), open-vuln-cli (OWASP).

### D: Password & Credential Testing (9 tools)
Hydra (50+ protocols, #1 online), CrackMapExec/NetExec (AD lateral, CME deprecated → use NetExec), John Jumbo (407 CPU formats, ghcr.io oficial, sem GPU), Hashcat (GPU-only, CPU ~11kH/s WPA2 — inviável), Medusa (anti-lockout), Ncrack (Nmap pedigree), Patator (Python scriptable), Crowbar (SSH/RDP niche).

## Wave 2: Deepening (3 agents)

### F: Post-Exploitation & Lateral Movement (12 tools)
Impacket (50+ scripts, não-interativos, de-facto AD toolkit), NetExec (sucessor ativo do CME), BloodHound.py (headless AD mapping → JSON), Chisel (SOCKS5 tunneling, single binary), Ligolo-ng (TUN L3 tunneling, Kali 2026.1), evil-winrm (Ruby, interativo), evil-winrm-py (Python 2025, -c single-command), bloodhound-cli (PyPI, queries headless), ADscan (2025+, all-in-one AD), Faraday CME Executor (JSON wrapper).

Core stack autônomo confirmado: BloodHound.py → NetExec → Impacket → evil-winrm-py -c → Chisel/Ligolo-ng.

### G: Container & Cloud Security (9 tools)
Trivy (all-in-one, docker run, --format json, 5/5 relevance, supply-chain compromise mar/2026), Grype+Syft (faster, SBOM-first, DB v5 EOL mar/2026), Docker Bench (CIS Docker, needs host mounts), Checkov (IaC audit, pip), Kubescape (CNCF, K8s), kube-bench (CIS K8s), Prowler (multi-cloud, active), kube-hunter (DEPRECATED may/2023), ScoutSuite (ABANDONED may/2024).

### Micro: Content Discovery + Packaging Strategy
gau (--json v2), waybackurls (-json), dalfox (--format json), katana (-jsonl). All go-install, pipe-friendly.

Packaging recommendation: Multi-stage Docker build with dedicated Go builder stage (golang:1.24-bookworm) → COPY --from to runtime. apt for non-Go tools. Reject Kali base (4.7GB). Pin all versions. Verify Cosign signatures.

## Key Insights for huu

1. **nmap has no JSON** — biggest friction point. Parse XML with python3-libnmap.
2. **CrackMapExec is dead** — use NetExec (nxc).
3. **Ligolo-ng needs NET_ADMIN in Docker** for TUN interface.
4. **Hashcat CPU-only is useless** (~11kH/s WPA2). John Jumbo for offline cracking.
5. **Trivy supply-chain compromised Mar/2026** — pin v0.69.3 + Cosign verify.
6. **Nuclei template supply-chain risk** (Jan/2025 bypass) — pin version, validate templates.
7. **ZAP Automation Framework** is the #1 DAST for agent control (YAML-driven).
8. **ProjectDiscovery ecosystem** (subfinder, httpx, nuclei, naabu, katana) has consistent JSON flags — ideal for agent parsing.
9. **Canonical pipeline** validated across multiple independent sources: masscan→nmap→subfinder→httpx→nuclei.
10. **No Kali base image** — 4.7GB. Multi-stage Go builder + apt is the right approach.
