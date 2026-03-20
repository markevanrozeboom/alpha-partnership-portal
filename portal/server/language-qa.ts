/**
 * Language QA — enforces US English spelling and USD currency in generated output.
 *
 * Regex-based scan that catches known British spellings and non-USD currency.
 * Applied as a post-processing step on all generated HTML before delivery.
 */

const BRITISH_TO_AMERICAN: Record<string, string> = {
  localised: "localized",
  localise: "localize",
  localises: "localizes",
  localising: "localizing",
  localisation: "localization",
  personalised: "personalized",
  personalise: "personalize",
  personalises: "personalizes",
  personalising: "personalizing",
  personalisation: "personalization",
  standardised: "standardized",
  standardise: "standardize",
  standardisation: "standardization",
  optimised: "optimized",
  optimise: "optimize",
  optimisation: "optimization",
  maximised: "maximized",
  maximise: "maximize",
  maximisation: "maximization",
  minimised: "minimized",
  minimise: "minimize",
  minimisation: "minimization",
  recognised: "recognized",
  recognise: "recognize",
  organised: "organized",
  organise: "organize",
  organisation: "organization",
  realised: "realized",
  realise: "realize",
  analysed: "analyzed",
  analyse: "analyze",
  analysing: "analyzing",
  centralised: "centralized",
  centralise: "centralize",
  decentralised: "decentralized",
  decentralise: "decentralize",
  characterised: "characterized",
  characterise: "characterize",
  summarised: "summarized",
  summarise: "summarize",
  emphasised: "emphasized",
  emphasise: "emphasize",
  prioritised: "prioritized",
  prioritise: "prioritize",
  subsidised: "subsidized",
  subsidise: "subsidize",
  modernised: "modernized",
  modernise: "modernize",
  specialised: "specialized",
  specialise: "specialize",
  specialisation: "specialization",
  customised: "customized",
  customise: "customize",
  customisation: "customization",
  globalised: "globalized",
  globalisation: "globalization",
  normalised: "normalized",
  normalise: "normalize",
  stabilised: "stabilized",
  stabilise: "stabilize",
  authorised: "authorized",
  authorise: "authorize",
  authorisation: "authorization",
  utilised: "utilized",
  utilise: "utilize",
  amortisation: "amortization",
  capitalisation: "capitalization",
  colour: "color",
  colours: "colors",
  coloured: "colored",
  favour: "favor",
  favourable: "favorable",
  favourite: "favorite",
  honour: "honor",
  honourable: "honorable",
  labour: "labor",
  neighbour: "neighbor",
  neighbourhood: "neighborhood",
  behaviour: "behavior",
  behavioural: "behavioral",
  centre: "center",
  centres: "centers",
  metre: "meter",
  metres: "meters",
  fibre: "fiber",
  theatre: "theater",
  defence: "defense",
  offence: "offense",
  licence: "license",
  practise: "practice",
  programme: "program",
  programmes: "programs",
  enrolment: "enrollment",
  enrolments: "enrollments",
  fulfilment: "fulfillment",
  judgement: "judgment",
  cancelled: "canceled",
  cancelling: "canceling",
  modelling: "modeling",
  travelling: "traveling",
  counsellor: "counselor",
  counselling: "counseling",
  grey: "gray",
  ageing: "aging",
  manoeuvre: "maneuver",
};

const britishPattern = new RegExp(
  "\\b(" + Object.keys(BRITISH_TO_AMERICAN).join("|") + ")\\b",
  "gi",
);

function replacePreservingCase(match: string): string {
  const replacement = BRITISH_TO_AMERICAN[match.toLowerCase()];
  if (!replacement) return match;
  if (match === match.toUpperCase()) return replacement.toUpperCase();
  if (match[0] === match[0].toUpperCase()) {
    return replacement[0].toUpperCase() + replacement.slice(1);
  }
  return replacement;
}

export interface LanguageQAReport {
  spellingFixes: string[];
  currencyWarnings: string[];
  totalIssues: number;
}

export function runLanguageQA(text: string): { text: string; report: LanguageQAReport } {
  const spellingFixes: string[] = [];

  const fixed = text.replace(britishPattern, (match) => {
    const replacement = replacePreservingCase(match);
    if (match !== replacement) {
      spellingFixes.push(`${match} → ${replacement}`);
    }
    return replacement;
  });

  const currencyWarnings: string[] = [];
  const currencyPattern = /[£€¥₹₩₪₱₫₴₸₺₼₽]|(?<!\w)(?:GBP|EUR|JPY|INR|CNY|AUD|CAD|CHF)\s*\d/g;
  let currMatch;
  while ((currMatch = currencyPattern.exec(fixed)) !== null) {
    const start = Math.max(0, currMatch.index - 20);
    const end = Math.min(fixed.length, currMatch.index + currMatch[0].length + 20);
    currencyWarnings.push(`Non-USD currency: ...${fixed.slice(start, end).replace(/\n/g, " ")}...`);
  }

  return {
    text: fixed,
    report: {
      spellingFixes,
      currencyWarnings,
      totalIssues: spellingFixes.length + currencyWarnings.length,
    },
  };
}
