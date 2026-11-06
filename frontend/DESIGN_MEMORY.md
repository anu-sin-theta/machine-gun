# Kavach402 Frontend Design & Component Memory
**Synthesized from:** [TasteSkill 2.5 (`tasteskill.dev`)](https://www.tasteskill.dev/docs) · [React Bits (`reactbits.dev`) & Terminal Dark](https://reactbits.dev/llms.txt) · [21st.dev (`21st-ui`)](https://21st.dev/mcp)

> **Purpose:** Load and follow this file before creating, restyling, or reviewing any UI in `machine-gun/frontend`. A prompt is a wish; this memory is a constraint.

---

## 1. The Kavach402 Brief & Inventory (TasteSkill Step 1)

Never build generic "AI crypto template" sections. Every section on the page must come from facts that belong **only to Kavach402**:

- **Name & Meaning:** **Kavach402** (*Kavach* = armor/shield in Sanskrit/Hindi + HTTP `402 Payment Required`).
- **Site Kind:** `page-type="software"`, `site-kind="software"`, style = **Terminal Dark / x.ai / Figma engineering grade**.
- **What It Does:** A payment agent and zero-trust firewall that checks a payment request before paying it.
- **The 8 Unique Facts (The Inventory):**
  1. **Untrusted Text vs. Probed 402 Header:** The agent never trusts the invoice text for who gets paid or how much—it probes the merchant's own HTTP `402 PAYMENT-REQUIRED` header first (`0.0.5001`, exact tinybars).
  2. **Confidential Reading on 0G TEE:** Sends `X-0G-Provider-Trust-Mode: private` to `router-api.0g.ai/v1` (`glm-5.3`) to extract payee, deadline, and psychological pressure tactics (`URGENT`, `OTP`, `do not tell anyone`).
  3. **Autonomous x402 Evidence Purchases:** Pays `0.05 HBAR` (`5,000,000 tinybars`) per check over Hedera `x402` (`exact` scheme, asset `0.0.0`) to two specialist checker endpoints: `/api/x402/checkers/link` and `/api/x402/checkers/reputation`, guarded by `SpendGuard` (`maxPerCheckerCall = 0.10 HBAR`).
  4. **The Evidence Floor (`applyEvidenceFloor`):** The 0G LLM is treated as untrusted—it can raise risk, but can *never* lower risk below deterministic evidence (`link-intel`, `reputation`, or `payee-check` mismatch).
  5. **Panic-Free Rust/WASM Core (`rust/kavach-core`):** Policy, RFC 8785 canonical JSON hashing, approval binding, and 18-brand Indian/global phishing detection (`SBI`, `HDFC`, `ICICI`, `Paytm`, `PhonePe`, `NPCI`, `UIDAI`) run in WebAssembly with `unwrap`/`expect`/`panic!` denied by Clippy and 394 JS + 80 Rust tests.
  6. **Spending Policy Caps:** `autoCap = 2.0 HBAR`, `dailyAutoBudget = 5.0 HBAR`, `hardCap = 50.0 HBAR`. Only `low` risk under `2.0 HBAR` auto-pays.
  7. **World ID Agent Pass Step-Up (`binding.rs`):** Risk-matched OIDC `acr` proof (`fresh` login for over-cap low risk, `orb` for medium risk, `orb-face` only for high-risk override) bound to the exact SHA-256 `BoundAction` hash (`checkId`, `payee`, `resource`, `amount`, `verdictHash`, `version`). Consumed at most once via atomic compare-and-set.
  8. **Hedera HCS Consensus Memory:** Every check step is anchored to `HEDERA_HCS_AUDIT_TOPIC_ID` (≤1024 bytes RFC 8785 JSON, hashes & IDs only) and payee outcomes (`paid-ok` / `flagged`) go to `HEDERA_HCS_REPUTATION_TOPIC_ID`.

---

## 2. TasteSkill 2.5 House Rules (`design-taste-frontend`)

### Layout & Framing (`layout-v4.md`)
1. **Equal Left & Right Edges:** Use one consistent `.wrap` container (`max-width: 1280px`, `padding-inline: 24px` mobile / `48px` tablet / `80px` desktop) on a 12-column grid with `24px` gaps.
2. **Rhythm & Screen Discipline:** The Hero fills the first screen (`100svh`) cleanly without slicing cards at the bottom fold. Each section below has one clear `h2` top-aligned and answers one specific question.
3. **No Slop Tells (Strictly Banned by TasteSkill):**
   - **NO purple/violet/lavender SaaS gradients** (`palette-purple` FAIL). Use **Obsidian (`#070708`)**, **Surface (`#121316`)**, **Elevated Fragment (`#1A1C20`)**, **Signal Emerald (`#10B981`)**, **Amber Warn (`#F59E0B`)**, **Crimson Block (`#EF4444`)**, and **Warm Sand/Slate ink (`#EDEFF2` / `#9BA1AB`)**.
   - **NO 3-level nested boxes** (`card > patterned box > inner white card`). Stick to **2 levels max**: `Card (#121316) > Lit/Contrast Stage > Live Product Fragment`.
   - **NO captions apologizing for or explaining visuals** under frames.
   - **NO scroll-jacking or cards flying/tilting on scroll.** Scroll motion belongs only inside dedicated sticky scene moments.

### Typography (`layout-v4.md` §5 & Terminal Dark §2)
- **Max 2 Font Families:** Display/Sans (`Geist Sans`) + Technical Monospace (`Geist Mono` for hashes, tinybars, `x402` headers, Rust signals, and HCS sequence numbers).
- **Weights & Contrast:**
  - Display headlines: weight `500` (never bloated `800`), tight tracking (`-0.03em`), max 2–3 lines.
  - Card body copy: `15px–16px` (`leading-relaxed`) in high-contrast ink (`#D6DAE1`), never unreadable dark grey.
  - Tertiary/comment text must pass WCAG AA on dark backgrounds: use `#7C8494` or lighter.

### Motion Tokens (`motion.md`)
- **Micro-interaction timings:**
  - `--m-in: 140ms` (hover enter)
  - `--m-out: 200ms` (hover exit)
  - `--m-press: 90ms` (button press: `translateY(1px) scale(0.985)`)
  - `--m-slide: 240ms` (tab indicator glide)
  - `--m-cycle: 3.2s` (card visual loop cycle)
  - `--m-ease: cubic-bezier(0.2, 0.8, 0.2, 1)`
- **Hover Layer Rules:**
  - Interactive cards lift `-2px` (`-translate-y-0.5`) and brighten border from `rgba(255,255,255,0.08)` to `rgba(255,255,255,0.18)`.
  - Buttons step `-1px` up on hover and sink `+1px` with `scale(0.985)` on active press.
- **GPU & WebGL Budget:**
  - Maximum **4 live WebGL contexts** on the page at once (e.g., 1 Hero Spline/Three.js canvas). Never mount a separate WebGL shader per card.

---

## 3. React Bits Catalog & CLI Cheatsheet (`reactbits.dev`)

When adding animated primitives from **React Bits**, install the **TypeScript + Tailwind (`-TS-TW`)** variant or use our local implementations in `src/components/bits/`:

### CLI Commands (Run in `machine-gun/frontend`)
```bash
# Text Animations
npx shadcn@latest add https://reactbits.dev/r/DecryptedText-TS-TW
npx shadcn@latest add https://reactbits.dev/r/SplitText-TS-TW
npx shadcn@latest add https://reactbits.dev/r/CountUp-TS-TW
npx shadcn@latest add https://reactbits.dev/r/ShinyText-TS-TW

# Cards & Surfaces
npx shadcn@latest add https://reactbits.dev/r/SpotlightCard-TS-TW
npx shadcn@latest add https://reactbits.dev/r/BorderGlow-TS-TW
npx shadcn@latest add https://reactbits.dev/r/MagicBento-TS-TW
npx shadcn@latest add https://reactbits.dev/r/Stepper-TS-TW
npx shadcn@latest add https://reactbits.dev/r/AnimatedList-TS-TW

# Agent & Security Micro-Interactions
npx shadcn@latest add https://reactbits.dev/r/StarBorder-TS-TW
npx shadcn@latest add https://reactbits.dev/r/ElectricBorder-TS-TW
npx shadcn@latest add https://reactbits.dev/r/ClickSpark-TS-TW
npx shadcn@latest add https://reactbits.dev/r/GlareHover-TS-TW

# Backgrounds (Use at most 1 per page per TasteSkill GPU budget)
npx shadcn@latest add https://reactbits.dev/r/Radar-TS-TW
npx shadcn@latest add https://reactbits.dev/r/GridScan-TS-TW
npx shadcn@latest add https://reactbits.dev/r/FaultyTerminal-TS-TW
npx shadcn@latest add https://reactbits.dev/r/DotGrid-TS-TW
```

### Best React Bits Primitives Mapped to Kavach402:
| Kavach402 Feature | React Bits Component | Why It Fits |
|---|---|---|
| **RFC 8785 SHA-256 `actionHash` & `verdictHash`** | `DecryptedText` | Reveals cryptographic hex digests by cycling cipher glyphs until locking into the verified SHA-256 hash. |
| **x402 Checker Calls (`0.05 HBAR` Link & Reputation)** | `CallChip` + `StatusMark` | Shows a live tool-call pill with a ticking millisecond stopwatch that fills green on `200 OK` or shakes red on `GUARD_REJECTED`. |
| **0G Private Computer Reasoning Trace** | `ThoughtLine` | Shows a reasoning trace header (`0G TEEglm-5.3 · req_88a1`) with a live clock that folds into a summary line when complete. |
| **Agent Inspection Cards & Policy Table** | `SpotlightCard` | Subtle radial cursor-following border & surface illumination on `#121316` dark cards without heavy 3D tilt. |
| **High-Risk World ID Override (`orb-face`)** | `HoldButton` / `SlideCommit` | Requires deliberate physical press-and-hold or slide commitment before redirecting to override a high-risk phishing block. |

---

## 4. 21st.dev Workflow (`21st-ui`)

When pulling or generating blocks via **21st.dev**:
1. **MCP Endpoint:** `https://21st.dev/api/mcp` (requires `x-api-key: $API_KEY_21ST` from `https://21st.dev/mcp`).
2. **Component Integration Rules:**
   - Place shared primitives in `src/components/ui/` or `src/components/bits/`.
   - Always adapt imported 21st.dev components to our **TasteSkill Terminal Dark tokens** (`#070708` background, `#121316` card, `1px` `white/10` border, zero purple slop, exact `140ms/200ms/90ms` interaction timings).
   - Ensure every interactive component displays **real Kavach402 data** (the 5 real scenarios from `src/agent/demo.ts`: Electricity `1.5 HBAR`, SBI Phishing Scam `sbi-secure-login.top`, Wrong Account `0.0.9999` vs `0.0.5001`, Rent `12 HBAR`, and Tuition `60 HBAR`).
