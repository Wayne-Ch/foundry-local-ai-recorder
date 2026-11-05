export interface SummaryClaim {
  readonly id: string;
  readonly pattern: RegExp;
}

export interface SummaryFactContract {
  readonly id: "ode" | "atlas" | "aurora";
  readonly text: string;
  readonly claims: readonly SummaryClaim[];
  readonly forbidden: readonly RegExp[];
  readonly allowedNumbers?: readonly string[];
}

export const SUMMARY_FACT_CONTRACTS = [
  {
    id: "ode",
    text: "An ordinary differential equation relates a function to its derivatives. For the first order equation y prime equals negative two y, separate the variables. The solution is y of t equals c times e to the negative two t for decay over time. If y of 0 equals 3, then c equals 3.",
    claims: [
      { id: "subject", pattern: /\b(?:ordinary differential equation|ODE)\b/iu },
      { id: "relation", pattern: /\bfunction\b[\s\S]{0,80}\bderivatives?\b/iu },
      {
        id: "equation",
        pattern: /(?:y\s*[′']\s*=\s*[−-]2y|y prime equals negative two y)/iu,
      },
      { id: "separation", pattern: /\bseparat(?:e|ed|ion)\b/iu },
      {
        id: "general-solution",
        pattern:
          /(?:y\s*\(\s*t\s*\)\s*=\s*c\s*(?:[·*]?\s*)?e\^?\(?[−-]2t\)?|y of t equals c times e to the negative two t)/iu,
      },
      { id: "decay", pattern: /\bdecay\b/iu },
      {
        id: "initial-condition",
        pattern: /(?:y\s*\(\s*0\s*\)\s*=\s*3|y of 0 equals 3|initial condition[^.\n]*3)/iu,
      },
      { id: "resolved-constant", pattern: /\bc\s*(?:=|equals|is)\s*3\b/iu },
    ],
    forbidden: [
      /\b(?:Euler|homework|citation)\b/iu,
      /y\s*\(\s*t\s*\)\s*=\s*3\s*(?:[·*]?\s*)?e/iu,
      /final solution[^.\n]*\b3\s*e/iu,
    ],
    allowedNumbers: ["2"],
  },
  {
    id: "atlas",
    text: "Project Atlas reduced cold start latency from 420 milliseconds to 280 milliseconds after the team enabled the local model cache. The target remains 250 milliseconds. Maya Chen owns the follow-up, and the next review is November 12.",
    claims: [
      { id: "subject", pattern: /\bProject Atlas\b/u },
      {
        id: "latency-reduction",
        pattern: /420\s*(?:milliseconds|ms)[\s\S]{0,100}280\s*(?:milliseconds|ms)/iu,
      },
      { id: "cache", pattern: /\blocal model cache\b/iu },
      { id: "target", pattern: /250\s*(?:milliseconds|ms)/iu },
      { id: "owner", pattern: /\bMaya Chen\b[\s\S]{0,80}\b(?:owns?|owner|follow-up)\b/iu },
      { id: "review", pattern: /\bNovember\s+12\b/iu },
    ],
    forbidden: [
      /\b(?:Priya|battery|equation)\b/iu,
      /280\s*(?:milliseconds|ms)[\s\S]{0,100}420\s*(?:milliseconds|ms)/iu,
      /(?:cache[\s\S]{0,80}(?:increas|slow)|(?:increas|slow)[\s\S]{0,80}cache)/iu,
    ],
  },
  {
    id: "aurora",
    text: "Team Aurora measured Battery Pack B at 82 watt-hours at 25 degrees Celsius. After 100 cycles, capacity fell to 76 watt-hours, a decline of 6 watt-hours caused by repeated high-rate charging. Priya will rerun the test at 0.5 C on December 5.",
    claims: [
      { id: "subject", pattern: /\bTeam Aurora\b/u },
      { id: "battery", pattern: /\bBattery Pack B\b/u },
      { id: "initial-capacity", pattern: /82\s*(?:watt-hours|Wh)/iu },
      { id: "temperature", pattern: /25\s*(?:degrees Celsius|°C|C)\b/iu },
      { id: "cycles", pattern: /100\s*cycles\b/iu },
      { id: "final-capacity", pattern: /76\s*(?:watt-hours|Wh)/iu },
      { id: "decline", pattern: /6\s*(?:watt-hours|Wh)/iu },
      { id: "cause", pattern: /\brepeated high-rate charging\b/iu },
      { id: "owner", pattern: /\bPriya\b[\s\S]{0,80}\b(?:rerun|repeat)\b/iu },
      { id: "rate", pattern: /0\.5\s*C\b/iu },
      { id: "date", pattern: /\bDecember\s+5\b/iu },
    ],
    forbidden: [
      /\b(?:Maya Chen|Project Atlas|thermal runaway)\b/iu,
      /(?:decline[\s\S]{0,100}(?:low-rate|temperature)|(?:low-rate|temperature)[\s\S]{0,100}caus)/iu,
    ],
  },
] as const satisfies readonly SummaryFactContract[];

export function summaryFactViolations(contract: SummaryFactContract, summary: string): readonly string[] {
  const violations: string[] = [];
  for (const forbidden of contract.forbidden) {
    if (forbidden.test(summary)) {
      violations.push(`forbidden claim matched ${forbidden.source}`);
    }
  }

  const allowedNumbers = new Set([...numericTokens(contract.text), ...(contract.allowedNumbers ?? [])]);
  const unexpectedNumbers = [
    ...new Set(numericTokens(summary).filter((value) => !allowedNumbers.has(value))),
  ];
  if (unexpectedNumbers.length > 0) {
    violations.push(`invented numbers: ${unexpectedNumbers.join(", ")}`);
  }

  const lines = summary
    .split("\n")
    .map((line) => line.replace(/^•\s+/u, "").trim())
    .filter(Boolean);
  const bulletClaims = new Set<string>();
  for (const [index, line] of lines.entries()) {
    const matched = contract.claims.filter(({ pattern }) => pattern.test(line)).map(({ id }) => id);
    if (matched.length === 0) {
      violations.push(`line ${index + 1} is not traceable to an allowed transcript claim`);
      continue;
    }
    if (index === 0) {
      continue;
    }
    const newClaims = matched.filter((claim) => !bulletClaims.has(claim));
    if (newClaims.length === 0) {
      violations.push(`bullet ${index} repeats only previously used claims`);
    }
    for (const claim of newClaims) {
      bulletClaims.add(claim);
    }
  }
  return violations;
}

function numericTokens(value: string): readonly string[] {
  return [...value.matchAll(/\d+(?:\.\d+)?/gu)].map(([token]) => token);
}
