import { describe, expect, it } from "vitest";
import { hasValidAtlasCacheContract } from "../scripts/atlas-cache-contract";

const validCases = [
  {
    name: "allows the cache relationship to be omitted",
    text: "Cold start latency fell from 420 milliseconds to 280 milliseconds.",
  },
  {
    name: "accepts the real Atlas output",
    text: [
      "Project Atlas reduced cold start latency from 420 milliseconds to 280 milliseconds after the team enabled the local model cache.",
      "• The target remains 250 milliseconds.",
      "• Maya Chen owns the follow-up, and the next review is November 12.",
    ].join("\n"),
  },
  {
    name: "accepts a direct cache reduction",
    text: "The local model cache reduced cold start latency from 420 milliseconds to 280 milliseconds.",
  },
  {
    name: "accepts a reversed causal statement",
    text: "Cold start latency fell from 420 milliseconds to 280 milliseconds because of the local model cache.",
  },
  {
    name: "accepts passive wording with by",
    text: "Cold start latency was reduced from 420 milliseconds to 280 milliseconds by the local model cache.",
  },
  {
    name: "accepts preposed after-enabling wording",
    text: "After enabling the local model cache, cold start latency fell from 420 milliseconds to 280 milliseconds.",
  },
  {
    name: "accepts postposed after-enabling wording",
    text: "Cold start latency fell from 420 milliseconds to 280 milliseconds after enabling the local model cache.",
  },
  {
    name: "accepts semicolon-separated wording",
    text: "The team enabled the local model cache; cold start latency fell from 420 milliseconds to 280 milliseconds.",
  },
  {
    name: "accepts coordinated wording",
    text: "The team enabled the local model cache, and cold start latency fell from 420 milliseconds to 280 milliseconds.",
  },
  {
    name: "accepts sentence-separated wording",
    text: "The team enabled the local model cache. Cold start latency fell from 420 milliseconds to 280 milliseconds.",
  },
  {
    name: "accepts an immediate truthful cache pronoun",
    text: "The local model cache was enabled. It reduced cold start latency from 420 milliseconds to 280 milliseconds.",
  },
  {
    name: "accepts response-latency wording",
    text: "Enabling the local model cache caused response latency to fall from 420 ms to 280 ms.",
  },
  {
    name: "accepts a passive causal phrase",
    text: "The reduction in cold start latency from 420 milliseconds to 280 milliseconds was caused by the local model cache.",
  },
  {
    name: "accepts an independent target statement",
    text: "The local model cache reduced cold start latency from 420 milliseconds to 280 milliseconds. The target remains 250 milliseconds.",
  },
  {
    name: "does not carry cache coreference across an unrelated claim",
    text: "The local model cache reduced cold start latency. The team documented the result. It archived the note.",
  },
] as const;

const invalidCases = [
  {
    name: "rejects the rejected-head inherited and-then target claim",
    text: "The local model cache reduced cold start latency from 420 milliseconds to 280 milliseconds and then caused the target to remain 250 milliseconds.",
  },
  {
    name: "rejects the rejected-head immediate pronoun target claim",
    text: "The local model cache reduced cold start latency from 420 milliseconds to 280 milliseconds. It also caused the target to remain 250 milliseconds.",
  },
  {
    name: "rejects a direct target cause",
    text: "The local model cache caused the target to remain 250 milliseconds.",
  },
  {
    name: "rejects a mixed true reduction and false target cause",
    text: "The local model cache reduced cold start latency from 420 milliseconds to 280 milliseconds and caused the target to remain 250 milliseconds.",
  },
  {
    name: "rejects an immediate then deadline claim",
    text: "The local model cache reduced cold start latency from 420 milliseconds to 280 milliseconds; then set the deadline to November 12.",
  },
  {
    name: "rejects an immediate pronoun review claim",
    text: "The local model cache reduced cold start latency from 420 milliseconds to 280 milliseconds. Then it scheduled the next review for November 12.",
  },
  {
    name: "rejects a reviewer change",
    text: "The local model cache changed the reviewer to Maya Chen.",
  },
  {
    name: "rejects an ownership determination",
    text: "The local model cache determined ownership of the follow-up.",
  },
  {
    name: "rejects a person assignment",
    text: "The local model cache assigned Maya Chen to the follow-up.",
  },
  {
    name: "rejects a date change",
    text: "The local model cache changed the date to November 12.",
  },
  {
    name: "rejects an assignment change",
    text: "The local model cache changed the follow-up assignment.",
  },
  {
    name: "rejects an unrelated Aurora fact",
    text: "The local model cache caused Battery Pack B capacity to fall.",
  },
  {
    name: "rejects an unrelated Cedar fact",
    text: "The local model cache caused Project Cedar to select 12 samples.",
  },
  {
    name: "rejects a passive target cause",
    text: "The target was caused to remain 250 milliseconds by the local model cache.",
  },
  {
    name: "rejects a passive review change",
    text: "The next review was set to November 12 by the local model cache.",
  },
  {
    name: "rejects a passive assignment determination",
    text: "Maya Chen's assignment was determined by the local model cache.",
  },
  {
    name: "rejects an inverted target cause",
    text: "The target remained 250 milliseconds because of the local model cache.",
  },
  {
    name: "rejects a preposed target relationship",
    text: "After enabling the local model cache, the target remained 250 milliseconds.",
  },
  {
    name: "rejects an adjacent pronoun back-reference",
    text: "The local model cache reduced cold start latency. The target was changed to 250 milliseconds by it.",
  },
  {
    name: "rejects a missing 280 endpoint",
    text: "The local model cache reduced cold start latency from 420 milliseconds to 250 milliseconds.",
  },
  {
    name: "rejects a missing 420 endpoint",
    text: "The local model cache reduced cold start latency from 250 milliseconds to 280 milliseconds.",
  },
  {
    name: "rejects altered endpoints",
    text: "The local model cache reduced cold start latency from 430 milliseconds to 300 milliseconds.",
  },
  {
    name: "rejects reversed endpoints",
    text: "The local model cache reduced cold start latency from 280 milliseconds to 420 milliseconds.",
  },
  {
    name: "rejects increase wording over the expected endpoints",
    text: "The local model cache increased cold start latency from 420 milliseconds to 280 milliseconds.",
  },
  {
    name: "rejects an explicit latency increase",
    text: "Cold start latency rose from 280 milliseconds to 420 milliseconds after enabling the local model cache.",
  },
] as const;

describe("Atlas cache causality contract", () => {
  it.each(validCases)("$name", ({ text }) => {
    expect(hasValidAtlasCacheContract(text)).toBe(true);
  });

  it.each(invalidCases)("$name", ({ text }) => {
    expect(hasValidAtlasCacheContract(text)).toBe(false);
  });
});
