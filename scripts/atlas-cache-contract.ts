const CACHE_REFERENCE_SOURCE = String.raw`(?:(?:(?:the|a|this|that)\s+)?(?:local\s+)?model\s+cache|(?:(?:the|a|this|that)\s+)?cache)`;
const LATENCY_REFERENCE_SOURCE = String.raw`(?:(?:cold[\s-]*start|response)\s+latency)`;
const FORBIDDEN_OBJECT_SOURCE = String.raw`(?:the\s+target|target|250\s*(?:milliseconds|ms)|deadline|reviewer|(?:next\s+)?review|owner(?:ship)?|owns?|follow[-\s]*up|assignment|assigned|person|date|Maya\s+Chen|November\s+12|Team\s+Aurora|Battery\s+Pack\s+B|capacity|high[-\s]*rate\s+charging|Priya|Project\s+Cedar|samples?|Lina|calibration|quiet\s+room|ordinary\s+differential\s+equation|initial\s+condition|decay)`;
const CACHE_EFFECT_SOURCE = String.raw`(?:caus(?:e|ed|es|ing)|determin(?:e|ed|es|ing)|chang(?:e|ed|es|ing)|alter(?:ed|s|ing)?|set|sets|setting|schedul(?:e|ed|es|ing)|assign(?:ed|s|ing)?|mak(?:e|es|ing)|made|keep|keeps|keeping|kept|leave|leaves|leaving|left|affect(?:ed|s|ing)?|enabl(?:e|ed|es|ing)|lead(?:s|ing)?\s+to|led\s+to|result(?:ed|s|ing)?\s+in|was\s+responsible\s+for|reduc(?:e|ed|es|ing)|lower(?:ed|s|ing)?|cut|cuts|cutting|improv(?:e|ed|es|ing)|decreas(?:e|ed|es|ing)|increas(?:e|ed|es|ing)|rais(?:e|ed|es|ing)|worsen(?:ed|s|ing)?|extend(?:ed|s|ing)?|shorten(?:ed|s|ing)?)`;
const RELATION_STATE_SOURCE = `(?:${CACHE_EFFECT_SOURCE}|am|is|are|was|were|be|been|being|remain(?:ed|s|ing)?|stay(?:ed|s|ing)?|became|become|becomes|fall(?:en|ing|s)?|fell|drop(?:ped|ping|s)?)`;

const CACHE_REFERENCE = new RegExp(`\\b${CACHE_REFERENCE_SOURCE}\\b`, "iu");
const CACHE_SUBJECT = new RegExp(String.raw`^(?:(?:enabling|using)\s+)?${CACHE_REFERENCE_SOURCE}\b`, "iu");
const CACHE_EFFECT = new RegExp(`\\b${CACHE_EFFECT_SOURCE}\\b`, "iu");
const LATENCY_REFERENCE = new RegExp(`\\b${LATENCY_REFERENCE_SOURCE}\\b`, "iu");
const RELATION_STATE = new RegExp(`\\b${RELATION_STATE_SOURCE}\\b`, "iu");
const CACHE_EFFECT_AT_START = new RegExp(`^(?:also\\s+)?${CACHE_EFFECT_SOURCE}\\b`, "iu");
const FORBIDDEN_OBJECT = new RegExp(`\\b${FORBIDDEN_OBJECT_SOURCE}\\b`, "iu");
const ADJACENT_PRONOUN_LINK =
  /\b(?:by|because\s+of|due\s+to|from)\s+it\b|\b(?:after|when)\s+it\s+was\s+(?:enabled|used)\b/iu;
const PREPOSED_CACHE_RELATION =
  /(?:\bafter\s+(?:(?:the\s+team)\s+)?(?:enabl\w*|us\w*)?|\bbecause\s+of|\bdue\s+to|\bfollowing|\bas\s+a\s+result\s+of|\b(?:enabl\w*|us\w*))\s*$/iu;
const RELATION_CONNECTOR =
  /\b(?:by|because\s+of|due\s+to|as\s+a\s+result\s+of|following|after(?:\s+(?:(?:the\s+team)\s+)?(?:enabl\w*|us\w*))?|result(?:ed|s|ing)?\s+from|stem(?:med|s|ming)?\s+from)\b/giu;
const DURATION = /\b(\d+)\s*(?:milliseconds|ms)\b/giu;
const CORRECT_REDUCTION_RANGE =
  /\b420\s*(?:milliseconds|ms)\b[\s\S]{0,40}\b(?:to|down\s+to)\s*280\s*(?:milliseconds|ms)\b|\bto\s+280\s*(?:milliseconds|ms)\b[\s\S]{0,40}\bfrom\s+420\s*(?:milliseconds|ms)\b/iu;
const INCREASE_LANGUAGE =
  /\b(?:increase(?:d|s|ing)?|rose|risen|rising|rise|grew|grown|growing|climb(?:ed|s|ing)?|worsen(?:ed|s|ing)?|higher)\b/iu;
const FORBIDDEN_SHARED_OBJECT = new RegExp(
  String.raw`^${FORBIDDEN_OBJECT_SOURCE}\b[\s\S]{0,40}(?:\bto\s+(?:remain|stay|be|become|move|change)|\bat\b|\bunchanged\b)`,
  "iu",
);

interface CacheContext {
  readonly effect: boolean;
  readonly mention: boolean;
  readonly subject: boolean;
}

interface TextSpan {
  readonly end: number;
  readonly index: number;
}

const EMPTY_CACHE_CONTEXT: CacheContext = {
  effect: false,
  mention: false,
  subject: false,
};

export function hasValidAtlasCacheContract(text: string): boolean {
  const claims = factualClaims(text);
  if (!claims.some((claim) => matches(CACHE_REFERENCE, claim))) {
    return true;
  }
  if (!hasValidCacheLatencyRanges(claims)) {
    return false;
  }

  let context = EMPTY_CACHE_CONTEXT;
  for (const claim of claims) {
    for (const clause of cacheClauses(claim)) {
      const explicitCacheMention = matches(CACHE_REFERENCE, clause);
      const explicitCacheSubject = explicitCacheMention && matches(CACHE_SUBJECT, clause);
      const inheritedEffect = inheritedCacheEffect(clause, context);

      if (explicitCacheMention && hasForbiddenCacheLink(clause)) {
        return false;
      }
      if (inheritedEffect !== undefined && cacheEffectTargetsForbidden(`cache ${inheritedEffect}`)) {
        return false;
      }
      if (context.mention && matches(FORBIDDEN_OBJECT, clause) && matches(ADJACENT_PRONOUN_LINK, clause)) {
        return false;
      }
      if (context.effect && matches(FORBIDDEN_SHARED_OBJECT, clause)) {
        return false;
      }

      if (explicitCacheMention) {
        context = {
          effect: explicitCacheSubject && cacheSubjectHasEffect(clause),
          mention: true,
          subject: explicitCacheSubject,
        };
      } else if (inheritedEffect !== undefined) {
        context = {
          effect: true,
          mention: true,
          subject: true,
        };
      } else {
        context = EMPTY_CACHE_CONTEXT;
      }
    }
  }
  return true;
}

function hasValidCacheLatencyRanges(claims: readonly string[]): boolean {
  for (const claim of claims) {
    if (!matches(LATENCY_REFERENCE, claim)) {
      continue;
    }
    const durations = [...claim.matchAll(DURATION)].map((match) => match[1]);
    if (durations.length === 0) {
      continue;
    }
    if (!durations.includes("420") || !durations.includes("280")) {
      return false;
    }
    if (!matches(CORRECT_REDUCTION_RANGE, claim) || matches(INCREASE_LANGUAGE, claim)) {
      return false;
    }
  }
  return true;
}

function hasForbiddenCacheLink(clause: string): boolean {
  return (
    cacheEffectTargetsForbidden(clause) ||
    forbiddenObjectLinksToCache(clause) ||
    preposedCacheRelationTargetsForbidden(clause)
  );
}

function cacheEffectTargetsForbidden(clause: string): boolean {
  const cacheReferences = spans(CACHE_REFERENCE, clause);
  const effects = spans(CACHE_EFFECT, clause);
  const forbiddenObjects = spans(FORBIDDEN_OBJECT, clause);
  const latencyReferences = spans(LATENCY_REFERENCE, clause);

  for (const cacheReference of cacheReferences) {
    for (const forbiddenObject of forbiddenObjects) {
      if (forbiddenObject.index < cacheReference.end) {
        continue;
      }
      const lastEffect = effects.findLast(
        (effect) => effect.index >= cacheReference.end && effect.end <= forbiddenObject.index,
      );
      if (lastEffect === undefined) {
        continue;
      }
      const effectTargetsLatency = latencyReferences.some(
        (latency) => latency.index >= lastEffect.end && latency.end <= forbiddenObject.index,
      );
      if (!effectTargetsLatency) {
        return true;
      }
    }
  }
  return false;
}

function forbiddenObjectLinksToCache(clause: string): boolean {
  const cacheReferences = spans(CACHE_REFERENCE, clause);
  const forbiddenObjects = spans(FORBIDDEN_OBJECT, clause);
  const relationStates = spans(RELATION_STATE, clause);

  for (const forbiddenObject of forbiddenObjects) {
    for (const cacheReference of cacheReferences) {
      if (cacheReference.index <= forbiddenObject.end) {
        continue;
      }
      const between = clause.slice(forbiddenObject.end, cacheReference.index);
      const connector = firstMatch(RELATION_CONNECTOR, between);
      if (connector === null) {
        continue;
      }
      const connectorIndex = forbiddenObject.end + connector.index;
      if (relationStates.some((state) => state.index >= forbiddenObject.end && state.end <= connectorIndex)) {
        return true;
      }
    }
  }
  return false;
}

function preposedCacheRelationTargetsForbidden(clause: string): boolean {
  const cacheReferences = spans(CACHE_REFERENCE, clause);
  const forbiddenObjects = spans(FORBIDDEN_OBJECT, clause);
  const latencyReferences = spans(LATENCY_REFERENCE, clause);

  for (const cacheReference of cacheReferences) {
    const prefix = clause.slice(0, cacheReference.index);
    if (!matches(PREPOSED_CACHE_RELATION, prefix)) {
      continue;
    }
    for (const forbiddenObject of forbiddenObjects) {
      if (forbiddenObject.index < cacheReference.end) {
        continue;
      }
      const latencyComesFirst = latencyReferences.some(
        (latency) => latency.index >= cacheReference.end && latency.end <= forbiddenObject.index,
      );
      if (!latencyComesFirst) {
        return true;
      }
    }
  }
  return false;
}

function inheritedCacheEffect(clause: string, context: CacheContext): string | undefined {
  if (context.mention) {
    const pronounContinuation = clause.match(/^(?:(?:and\s+)?then\s+)?it(?:\s+also)?\s+([\s\S]+)$/iu);
    const effect = pronounContinuation?.[1]?.trim();
    if (effect !== undefined && matches(CACHE_EFFECT_AT_START, effect)) {
      return effect;
    }
  }
  if (!context.subject) {
    return undefined;
  }
  const discourseContinuation = clause.replace(/^(?:(?:and\s+)?then|also)\s+/iu, "").trim();
  return matches(CACHE_EFFECT_AT_START, discourseContinuation) ? discourseContinuation : undefined;
}

function cacheSubjectHasEffect(clause: string): boolean {
  const cacheReference = firstMatch(CACHE_REFERENCE, clause);
  if (cacheReference === null) {
    return false;
  }
  return spans(CACHE_EFFECT, clause).some(
    (effect) => effect.index >= cacheReference.index + cacheReference[0].length,
  );
}

function cacheClauses(claim: string): string[] {
  return claim
    .split(
      /\s*(?:;|,\s*(?=(?:and(?:\s+then)?|but|while|whereas|yet|then)\b)|\b(?:and\s+then|and|but|while|whereas|yet|then)\b)\s*/iu,
    )
    .map((clause) => clause.trim())
    .filter(Boolean);
}

function factualClaims(value: string): string[] {
  return value
    .split(/\r?\n+/u)
    .flatMap((line) => line.split(/(?<=[.!?;])\s+(?=(?:[-*]\s*)?[\p{L}\d])/u))
    .map((claim) => claim.replace(/^\s*(?:[-*•]|\d+[.)])\s+/u, "").trim())
    .filter(Boolean);
}

function spans(pattern: RegExp, value: string): TextSpan[] {
  const globalPattern = new RegExp(
    pattern.source,
    pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`,
  );
  return [...value.matchAll(globalPattern)].map((match) => ({
    end: match.index + match[0].length,
    index: match.index,
  }));
}

function firstMatch(pattern: RegExp, value: string): RegExpExecArray | null {
  pattern.lastIndex = 0;
  return pattern.exec(value);
}

function matches(pattern: RegExp, value: string): boolean {
  pattern.lastIndex = 0;
  return pattern.test(value);
}
