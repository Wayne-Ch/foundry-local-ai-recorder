import { canonicalSummarySemanticText, summarySemanticTokens } from "./summary-canonical";

export const GENERIC_SUMMARY_OVERVIEW = "The recording covers four key points.";

const SUMMARY_VISUAL_LIST_MARKER = /^(?:•\s+|[-*]\s+)/u;
const SUMMARY_TERMINAL_PUNCTUATION = /[.!?](?:["'”’)\]}]*)$/u;
const SUMMARY_INCOMPLETE_TRAILING_WORDS = new Set([
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
  "for",
  "from",
  "had",
  "has",
  "have",
  "in",
  "is",
  "of",
  "on",
  "or",
  "the",
  "to",
  "was",
  "were",
  "with",
]);
const SUMMARY_CLAUSE_PREDICATE =
  /\b(?:am|are|became|become|becomes|can|changed|changes|clears?|contains?|covers?|did|does|enabled|equals?|fell|falls?|has|have|includes?|is|keeps?|may|measured|must|needs?|owns?|records?|reduced|relates?|remains?|reruns?|reports?|requires?|runs?|should|states?|uses?|was|were|will|would)\b|\b\p{L}{3,}(?:ed|ing)\b/iu;
const SUMMARY_OVERLAP_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "in",
  "is",
  "of",
  "on",
  "or",
  "the",
  "to",
  "was",
  "were",
  "with",
]);
const SUMMARY_STRUCTURED_TOKEN = /^(?:[=<>+\-±'*]|-?\d+(?:\.\d+)?)$/u;

export function isCompleteSummaryUnit(value: string): boolean {
  const content = value.trim().replace(SUMMARY_VISUAL_LIST_MARKER, "").trim();
  if (!content || !SUMMARY_TERMINAL_PUNCTUATION.test(content)) {
    return false;
  }
  const body = content.replace(/[.!?]+(?:["'”’)\]}]*)$/u, "").trim();
  const tokens = body.toLowerCase().match(/\p{L}+|\p{N}+(?:\.\p{N}+)?/gu) ?? [];
  const trailingWord = tokens.at(-1);
  if (trailingWord !== undefined && SUMMARY_INCOMPLETE_TRAILING_WORDS.has(trailingWord)) {
    return false;
  }
  if (/^(?:although|because|unless|whereas)\b/iu.test(body)) {
    return false;
  }
  const leadingDependentPhrase = body.match(/^(?:after|before|when|where|while|with|without)\s+(.+)$/iu)?.[1];
  if (leadingDependentPhrase !== undefined && !SUMMARY_CLAUSE_PREDICATE.test(body)) {
    return false;
  }
  const leadingCoordination = body.match(/^(?:and|but|or)\s+(.+)$/iu)?.[1];
  if (leadingCoordination !== undefined && !SUMMARY_CLAUSE_PREDICATE.test(leadingCoordination)) {
    return false;
  }
  const coordinatedTail = body.match(/(?<![,;])\s+\b(?:and|but|or)\s+([^,;]+)$/iu)?.[1];
  return (
    coordinatedTail === undefined ||
    SUMMARY_CLAUSE_PREDICATE.test(coordinatedTail) ||
    !/^(?:[\p{Lu}][\p{L}'-]*)(?:\s+[\p{Lu}][\p{L}'-]*){0,2}$/u.test(coordinatedTail)
  );
}

export function areDuplicateSummaryUnits(left: string, right: string): boolean {
  const leftCanonical = canonicalSummarySemanticText(left);
  return leftCanonical.length > 0 && leftCanonical === canonicalSummarySemanticText(right);
}

export function hasDuplicateSummaryUnits(units: readonly string[]): boolean {
  return units.some((unit, index) =>
    units.slice(0, index).some((candidate) => areDuplicateSummaryUnits(candidate, unit)),
  );
}

export function hasOverlappingSummaryUnits(units: readonly string[]): boolean {
  return units.some((unit, index) =>
    units.slice(0, index).some((candidate) => areOverlappingSummaryUnits(candidate, unit)),
  );
}

function areOverlappingSummaryUnits(left: string, right: string): boolean {
  if (areDuplicateSummaryUnits(left, right)) {
    return true;
  }
  const genericOverview = canonicalSummarySemanticText(GENERIC_SUMMARY_OVERVIEW);
  const leftCanonical = canonicalSummarySemanticText(left);
  const rightCanonical = canonicalSummarySemanticText(right);
  if (leftCanonical === genericOverview || rightCanonical === genericOverview) {
    return false;
  }
  const [smallerCanonical, largerCanonical] =
    leftCanonical.length <= rightCanonical.length
      ? [leftCanonical, rightCanonical]
      : [rightCanonical, leftCanonical];
  if (smallerCanonical.split(" ").length >= 4 && ` ${largerCanonical} `.includes(` ${smallerCanonical} `)) {
    return true;
  }
  const leftTokens = substantiveSummaryTokens(left);
  const rightTokens = substantiveSummaryTokens(right);
  const [smaller, larger] =
    leftTokens.length <= rightTokens.length ? [leftTokens, rightTokens] : [rightTokens, leftTokens];
  if (smaller.length < 4 || smaller.some((token) => SUMMARY_STRUCTURED_TOKEN.test(token))) {
    return false;
  }
  const largerSet = new Set(larger);
  const overlap = new Set(smaller.filter((token) => largerSet.has(token))).size;
  return overlap >= 4 && overlap / new Set(smaller).size >= 0.8;
}

function substantiveSummaryTokens(value: string): readonly string[] {
  return summarySemanticTokens(value).filter((token) => !SUMMARY_OVERLAP_STOP_WORDS.has(token));
}
