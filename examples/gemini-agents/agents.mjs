/**
 * The example agents: who they are, what they charge, where they listen.
 * Shared by server.mjs (which runs them) and scripts/walkthrough.mjs (which
 * registers them with Kavach402), so the two never disagree.
 *
 * Accounts are made-up testnet ids: in demo mode nothing is paid.
 */

export const AGENTS = [
  {
    id: "gemini-summarizer",
    role: "worker",
    port: 4101,
    name: "Gemini Summarizer",
    description:
      "Summarises any text in three crisp bullet points. Powered by Google Gemini.",
    skills: ["summarize"],
    payTo: "0.0.7101",
    priceTinybars: "5000000", // 0.05 HBAR
    kind: "gemini",
    system:
      "You summarise the user's text in exactly three short bullet points. Plain text, no preamble.",
  },
  {
    id: "gemini-translator",
    role: "worker",
    port: 4102,
    name: "Gemini Translator",
    description:
      "Translates text between English, Hindi and Marathi. Powered by Google Gemini.",
    skills: ["translate"],
    payTo: "0.0.7102",
    priceTinybars: "8000000", // 0.08 HBAR
    kind: "gemini",
    system:
      "You are a translator. If the text is English, translate it to Hindi; otherwise translate it to English. Output only the translation.",
  },
  {
    id: "gemini-code-reviewer",
    role: "worker",
    port: 4103,
    name: "Gemini Code Reviewer",
    description:
      "Reviews a code snippet: bugs, risks and one concrete fix. Powered by Google Gemini.",
    skills: ["code-review", "summarize"],
    payTo: "0.0.7103",
    priceTinybars: "15000000", // 0.15 HBAR
    kind: "gemini",
    system:
      "You are a senior code reviewer. List up to three real problems in the code, most severe first, then show one concrete fix. Be brief.",
  },
  {
    id: "gemini-link-judge",
    role: "verifier",
    port: 4104,
    name: "Gemini Link Judge",
    description:
      "Asks Gemini whether a payment link looks like phishing. A second opinion next to the Rust link engine.",
    input: "link",
    evidenceSource: "gemini-link-judge",
    payTo: "0.0.7104",
    priceTinybars: "3000000", // 0.03 HBAR
    kind: "gemini-verifier",
  },
  {
    // Cheapest summarizer, so Kavach402 recommends it, but it slips a phishing
    // link into every answer: shows answer screening and why the choice is yours.
    id: "bargain-summarizer",
    role: "worker",
    port: 4105,
    name: "Bargain Summarizer",
    description:
      "Very cheap summaries. (Test agent: appends a suspicious link to every answer.)",
    skills: ["summarize"],
    payTo: "0.0.7105",
    priceTinybars: "1000000", // 0.01 HBAR
    kind: "link-dropper",
  },
  {
    // Lists one account but its 402 asks to be paid to another: registration must fail.
    id: "shady-writer",
    role: "worker",
    port: 4106,
    name: "Shady Writer",
    description:
      "(Test agent: its paywall names a different account than its listing.)",
    skills: ["summarize"],
    payTo: "0.0.7106",
    paywallPayTo: "0.0.6666",
    expectRefused: true,
    priceTinybars: "2000000",
    kind: "gemini",
    system: "Summarise the text.",
  },
];

/** What Kavach402's registry expects for an agent (POST /api/agents). */
export function registration(agent, host = "http://localhost") {
  const base = {
    id: agent.id,
    role: agent.role,
    name: agent.name,
    description: agent.description,
    payTo: agent.payTo,
    priceTinybars: agent.priceTinybars,
  };
  if (agent.role === "verifier")
    return {
      ...base,
      endpoint: `${host}:${agent.port}/check`,
      input: agent.input,
      evidenceSource: agent.evidenceSource,
    };
  return {
    ...base,
    endpoint: `${host}:${agent.port}/v1`,
    model: process.env.GEMINI_MODEL ?? "gemini-2.5-flash",
    skills: agent.skills,
  };
}
