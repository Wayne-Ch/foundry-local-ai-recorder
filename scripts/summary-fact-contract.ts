import { canonicalSummarySemanticText, summarySemanticTokens } from "../src/summary/summary-canonical";

export interface SummaryClaim {
  readonly id: string;
  readonly pattern: RegExp;
}

export interface SummarySemanticGuard {
  readonly description: string;
  readonly cue: RegExp;
  readonly claimIds: readonly string[];
}

export interface SummaryFactContract {
  readonly id: string;
  readonly text: string;
  readonly claims: readonly SummaryClaim[];
  readonly forbidden: readonly RegExp[];
  readonly allowedNumbers?: readonly string[];
  readonly allowedVocabulary?: readonly string[];
  readonly semanticGuards?: readonly SummarySemanticGuard[];
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
      {
        id: "resolved-constant",
        pattern: /\bc\s*(?:=|equals|is(?:\s+determined\s+to\s+be)?)\s*3\b/iu,
      },
    ],
    forbidden: [
      /\b(?:Euler|homework|citation)\b/iu,
      /y\s*\(\s*t\s*\)\s*=\s*3\s*(?:[·*]?\s*)?e/iu,
      /final solution[^.\n]*\b3\s*e/iu,
      /y\s*[′']\s*(?:!=|≠|[<>]=?)\s*[−-]?2y/iu,
      /y\s*[′']\s*=\s*\+?2y/iu,
      /e\^?\(?\+?2t\)?/iu,
    ],
    allowedNumbers: ["-2"],
    allowedVocabulary: [
      "ODE",
      "first-order",
      "governing",
      "system",
      "specific",
      "value",
      "constant",
      "initial",
      "condition",
      "explicitly",
      "stated",
      "determining",
      "determined",
      "integrating",
      "exponential",
      "represents",
      "separation",
      "solved",
      "solve",
      "yield",
      "result",
      "relation",
      "derived",
      "separating",
      "obtain",
      "calculated",
      "described",
      "transcript",
      "describe",
      "general",
      "implies",
    ],
    semanticGuards: [
      {
        description: "derivative equation",
        cue: /(?:y\s*[′']|y\s+prime)/iu,
        claimIds: ["equation"],
      },
      {
        description: "general solution",
        cue: /(?:y\s*\(\s*t\s*\)|y\s+of\s+t)/iu,
        claimIds: ["general-solution"],
      },
      {
        description: "initial value",
        cue: /(?:y\s*\(\s*0\s*\)|y\s+of\s+0)/iu,
        claimIds: ["initial-condition"],
      },
    ],
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
      {
        id: "target",
        pattern:
          /(?:\b(?:target|goal)\b[^.\n]*250\s*(?:milliseconds|ms)|250\s*(?:milliseconds|ms)[^.\n]*\b(?:target|goal)\b)/iu,
      },
      { id: "owner", pattern: /\bMaya Chen\b[\s\S]{0,80}\b(?:owns?|owner|follow-up)\b/iu },
      {
        id: "review",
        pattern: /(?:\breview\b[^.\n]*\bNovember\s+12\b|\bNovember\s+12\b[^.\n]*\breview\b)/iu,
      },
    ],
    forbidden: [
      /\b(?:Priya|battery|equation)\b/iu,
      /280\s*(?:milliseconds|ms)[\s\S]{0,100}420\s*(?:milliseconds|ms)/iu,
      /(?:cache[\s\S]{0,80}(?:increas|slow)|(?:increas|slow)[\s\S]{0,80}cache)/iu,
    ],
    allowedVocabulary: [
      "explicit",
      "facts",
      "records",
      "changed",
      "change",
      "reduction",
      "achieve",
      "achieved",
      "updated",
      "new",
      "scheduled",
      "continue",
    ],
    semanticGuards: [
      {
        description: "latency direction",
        cue: /\b(?:420|280)\s*(?:milliseconds|ms)\b/iu,
        claimIds: ["latency-reduction"],
      },
      {
        description: "target value",
        cue: /\b250\s*(?:milliseconds|ms)\b/iu,
        claimIds: ["target"],
      },
      {
        description: "follow-up owner",
        cue: /\bMaya Chen\b/u,
        claimIds: ["owner"],
      },
      {
        description: "review date",
        cue: /\bNovember\s+12\b/iu,
        claimIds: ["review"],
      },
    ],
  },
  {
    id: "aurora",
    text: "Team Aurora measured Battery Pack B at 82 watt-hours at 25 degrees Celsius. After 100 cycles, capacity fell to 76 watt-hours, a decline of 6 watt-hours caused by repeated high-rate charging. Priya will rerun the test at 0.5 C on December 5.",
    claims: [
      { id: "subject", pattern: /\bTeam Aurora\b/u },
      { id: "battery", pattern: /\bBattery Pack B\b/u },
      {
        id: "initial-capacity",
        pattern:
          /(?:\b(?:measured|capacity|Battery Pack B)\b[^.\n]*82\s*(?:watt-hours|Wh)|82\s*(?:watt-hours|Wh)[^.\n]*\b(?:measured|capacity|Battery Pack B)\b)/iu,
      },
      {
        id: "temperature",
        pattern:
          /(?:\b(?:temperature|at)\b[^.\n]*25\s*(?:degrees Celsius|°C|C)\b|25\s*(?:degrees Celsius|°C|C)\b[^.\n]*\btemperature\b)/iu,
      },
      { id: "cycles", pattern: /100\s*cycles\b/iu },
      {
        id: "final-capacity",
        pattern:
          /(?:\bcapacity\b[^.\n]*(?:fell|declined|decreased|dropped)[^.\n]*76\s*(?:watt-hours|Wh)|76\s*(?:watt-hours|Wh)[^.\n]*\bcapacity\b)/iu,
      },
      {
        id: "decline",
        pattern:
          /(?:\b(?:decline|loss|decrease|drop)\b[^.\n]*6\s*(?:watt-hours|Wh)|6\s*(?:watt-hours|Wh)[^.\n]*\b(?:decline|loss|decrease|drop)\b)/iu,
      },
      { id: "cause", pattern: /\brepeated high-rate charging\b/iu },
      { id: "owner", pattern: /\bPriya\b[\s\S]{0,80}\b(?:rerun|repeat)\b/iu },
      {
        id: "rate",
        pattern: /(?:\b(?:rerun|repeat|test)\b[^.\n]*0\.5\s*C\b|0\.5\s*C\b[^.\n]*\btest\b)/iu,
      },
      {
        id: "date",
        pattern:
          /(?:\b(?:rerun|repeat|test)\b[\s\S]{0,120}\bDecember\s+5\b|\bDecember\s+5\b[\s\S]{0,120}\b(?:rerun|repeat|test)\b)/iu,
      },
    ],
    forbidden: [
      /\b(?:Maya Chen|Project Atlas|thermal runaway)\b/iu,
      /(?:decline[\s\S]{0,100}(?:low-rate|temperature)|(?:low-rate|temperature)[\s\S]{0,100}caus)/iu,
      /\b(?:initial|final) condition\b/iu,
    ],
    allowedVocabulary: [
      "explicit",
      "facts",
      "records",
      "capacity",
      "loss",
      "decrease",
      "decreased",
      "drop",
      "dropped",
      "scheduled",
      "temperature",
    ],
    semanticGuards: [
      {
        description: "initial capacity",
        cue: /\b82\s*(?:watt-hours|Wh)\b/iu,
        claimIds: ["initial-capacity"],
      },
      {
        description: "temperature",
        cue: /\b25\s*(?:degrees Celsius|°C|C)\b/iu,
        claimIds: ["temperature"],
      },
      { description: "cycle count", cue: /\b100\s*cycles\b/iu, claimIds: ["cycles"] },
      { description: "final capacity", cue: /\b76\s*(?:watt-hours|Wh)\b/iu, claimIds: ["final-capacity"] },
      { description: "capacity decline", cue: /\b6\s*(?:watt-hours|Wh)\b/iu, claimIds: ["decline"] },
      {
        description: "charging cause",
        cue: /\b(?:caus(?:e|ed|es|ing)|repeated high-rate charging)\b/iu,
        claimIds: ["cause"],
      },
      { description: "rerun owner", cue: /\bPriya\b/u, claimIds: ["owner"] },
      { description: "rerun rate", cue: /\b0\.5\s*C\b/iu, claimIds: ["rate"] },
      { description: "rerun date", cue: /\bDecember\s+5\b/iu, claimIds: ["date"] },
    ],
  },
] as const satisfies readonly SummaryFactContract[];

export const SUMMARY_ROLE_DISTINCTION_CONTRACT = {
  id: "atlas-role-distinction",
  text: "Project Atlas target is 250 milliseconds. Project Atlas result is 250 milliseconds. Maya Chen owns the follow-up. The next review is November 12.",
  claims: [
    { id: "subject", pattern: /\bProject Atlas\b/u },
    {
      id: "target",
      pattern: /\bProject Atlas\b[^.\n]*\btarget\b[^.\n]*250\s*(?:milliseconds|ms)/iu,
    },
    {
      id: "result",
      pattern: /\bProject Atlas\b[^.\n]*\bresult\b[^.\n]*250\s*(?:milliseconds|ms)/iu,
    },
    { id: "owner", pattern: /\bMaya Chen\b[^.\n]*\bowns?\b[^.\n]*\bfollow-up\b/iu },
    { id: "review", pattern: /\bNovember\s+12\b/iu },
  ],
  forbidden: [/\b(?:Project Aurora|Priya|420|280)\b/iu],
  allowedVocabulary: ["records", "separately", "stated", "values", "explicit", "facts"],
  semanticGuards: [
    {
      description: "target role",
      cue: /\btarget\b[^.\n]*250\s*(?:milliseconds|ms)/iu,
      claimIds: ["target"],
    },
    {
      description: "result role",
      cue: /\bresult\b[^.\n]*250\s*(?:milliseconds|ms)/iu,
      claimIds: ["result"],
    },
    { description: "follow-up owner", cue: /\bMaya Chen\b/u, claimIds: ["owner"] },
    { description: "review date", cue: /\bNovember\s+12\b/iu, claimIds: ["review"] },
  ],
} as const satisfies SummaryFactContract;

export function summaryFactViolations(contract: SummaryFactContract, summary: string): readonly string[] {
  const violations: string[] = [];
  const lines = summary
    .split("\n")
    .map((line) => line.replace(/^•\s+/u, "").trim())
    .filter(Boolean);
  for (const forbidden of contract.forbidden) {
    if (lines.some((line) => forbidden.test(line))) {
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

  const bulletFacts = new Set<string>();
  const bulletClaimOwners = new Map<string, number>();
  for (const [index, line] of lines.entries()) {
    const lineClaims = new Set<string>();
    for (const clause of splitSummaryClauses(line)) {
      const matched = contract.claims.filter(({ pattern }) => pattern.test(clause)).map(({ id }) => id);
      if (matched.length === 0) {
        violations.push(
          `line ${index + 1} clause is not traceable to an allowed transcript claim: ${clause}`,
        );
        continue;
      }
      for (const claimId of matched) {
        lineClaims.add(claimId);
      }
      for (const guard of contract.semanticGuards ?? []) {
        if (guard.cue.test(clause) && !guard.claimIds.some((claimId) => matched.includes(claimId))) {
          violations.push(
            `line ${index + 1} clause has an invalid ${guard.description} relationship: ${clause}`,
          );
        }
      }
      const unexpectedWords = untraceableWords(contract, clause);
      if (unexpectedWords.length > 0) {
        violations.push(
          `line ${index + 1} clause contains untraceable content: ${unexpectedWords.join(", ")}`,
        );
      }
    }
    if (index === 0) {
      continue;
    }
    for (const claimId of lineClaims) {
      if (claimId === "subject" || claimId === "battery") {
        continue;
      }
      const priorBullet = bulletClaimOwners.get(claimId);
      if (priorBullet !== undefined) {
        violations.push(`bullet ${index} repeats ${claimId} from bullet ${priorBullet}`);
      } else {
        bulletClaimOwners.set(claimId, index);
      }
    }
    const canonicalFact = canonicalFactText(line);
    if (bulletFacts.has(canonicalFact)) {
      violations.push(`bullet ${index} canonically duplicates a previous detail`);
    }
    bulletFacts.add(canonicalFact);
  }
  return violations;
}

function canonicalFactText(value: string): string {
  return canonicalSummarySemanticText(value);
}

function numericTokens(value: string): readonly string[] {
  const normalized = value
    .normalize("NFKC")
    .toLowerCase()
    .replaceAll(/[−﹣]/gu, "-")
    .replaceAll(/\b(?:negative|minus)\s+(\d+(?:\.\d+)?)/gu, "-$1")
    .replaceAll(/([+-])\s+(?=\d)/gu, "$1");
  return [...normalized.matchAll(/[+-]?\d+(?:\.\d+)?/gu)].map(([token]) => token);
}

const COMMON_TRACEABLE_WORDS = [
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "because",
  "been",
  "being",
  "but",
  "by",
  "explicit",
  "explicitly",
  "fact",
  "facts",
  "for",
  "from",
  "in",
  "is",
  "it",
  "named",
  "of",
  "on",
  "or",
  "over",
  "project",
  "record",
  "records",
  "report",
  "reports",
  "separate",
  "separately",
  "specific",
  "stated",
  "states",
  "system",
  "team",
  "the",
  "their",
  "then",
  "these",
  "this",
  "to",
  "value",
  "values",
  "was",
  "were",
  "where",
  "which",
  "while",
  "with",
] as const;

function splitSummaryClauses(line: string): readonly string[] {
  return line
    .split(/(?<=[.!?;])\s+|,\s+(?=(?:after|and|because|but|caused\s+by|then|where|which|while)\b)/iu)
    .flatMap((part) => part.split(/\s+(?=(?:after|because|but|caused\s+by|then|where|which|while)\b)/iu))
    .map((clause) => clause.trim())
    .filter(Boolean);
}

function untraceableWords(contract: SummaryFactContract, clause: string): readonly string[] {
  const allowed = new Set(
    [
      ...summarySemanticTokens(contract.text),
      ...COMMON_TRACEABLE_WORDS,
      ...(contract.allowedVocabulary ?? []),
    ]
      .filter((token) => /^\p{L}+$/u.test(token))
      .map(normalizeVocabularyToken),
  );
  return [
    ...new Set(
      summarySemanticTokens(clause)
        .filter((token) => /^\p{L}+$/u.test(token))
        .map(normalizeVocabularyToken)
        .filter((token) => !allowed.has(token)),
    ),
  ];
}

function normalizeVocabularyToken(value: string): string {
  const token = value.normalize("NFKC").toLowerCase();
  if (token.length > 4 && token.endsWith("ies")) {
    return `${token.slice(0, -3)}y`;
  }
  if (
    token.length > 4 &&
    token.endsWith("s") &&
    !token.endsWith("ss") &&
    !token.endsWith("is") &&
    !token.endsWith("us")
  ) {
    return token.slice(0, -1);
  }
  if (token.length > 5 && token.endsWith("ed")) {
    return token.slice(0, -2);
  }
  if (token.length > 6 && token.endsWith("ing")) {
    return token.slice(0, -3);
  }
  return token;
}
