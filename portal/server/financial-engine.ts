/**
 * Financial Engine — implements the rules from financial_rules_v1.md
 *
 * Two-prong model:
 *   Prong 1: Flagship Alphas (100% Alpha-owned, revenue-optimized)
 *   Prong 2: Counterparty Schools (100% country-owned, $25K fixed budget)
 */

import type {
  FinancialResearchData,
  MetroFinancialData,
  FinancialModel,
  FlagshipModel,
  FlagshipSchoolAllocation,
  CounterpartyModel,
  UpfrontInvestment,
  OngoingInvestment,
  ScholarshipGap,
} from "@shared/schema";

// ─── Constants from financial_rules_v1 ───────────────────────────────────────

const FLAGSHIP = {
  MIN_CAPACITY: 250,
  MAX_CAPACITY: 1000,
  CAPACITY_STEP: 50,
  MIN_TUITION: 40_000,
  MAX_TUITION: 100_000,
  TUITION_STEP: 5_000,
  PENETRATION_RATE: 0.20,
  OPERATING_MARGIN: 0.25,
  MAX_FLAGSHIPS_CAPITAL: 3,
  MAX_FLAGSHIPS_OTHER: 1,
  BACKSTOP_PCT: 0.50,
  BACKSTOP_YEARS: 5,
};

const COUNTERPARTY = {
  MIN_STUDENTS: 100_000,
  PER_STUDENT_BUDGET: 25_000,
  COST_BREAKDOWN: [
    { item: "Guides", amount: 4_500, note: "25:1 student-to-guide ratio" },
    { item: "Programs and Life Skills", amount: 4_250, note: "" },
    { item: "Other Headcount", amount: 1_750, note: "" },
    { item: "Facility / CapEx", amount: 3_000, note: "Rent paid by school; RE sourced by counterparty" },
    { item: "Miscellaneous Expenses", amount: 1_500, note: "" },
    { item: "Timeback", amount: 5_000, note: "20% of funding/tuition" },
    { item: "Operating Fee", amount: 2_500, note: "10% of funding/tuition" },
    { item: "Operating Margin / IP Amortization", amount: 2_500, note: "" },
  ],
};

const UPFRONT_FIXED = {
  ALPHACORE_LICENSE: 250_000_000,
  INCEPT_EDLLM: 250_000_000,
  PROGRAMS_LIFESKILLS: 250_000_000,
  EDTECH_APPS: 250_000_000,
};

const FEES = {
  TIMEBACK_PER_STUDENT: 5_000, // 20% of $25K, min $5,000
  OPERATING_FEE_PER_STUDENT: 2_500, // 10% of $25K, min $2,500
  PARENT_ED_ANNUAL: 50_000_000, // $50M / year
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Log-linear interpolation of wealthy children count at a given AGI threshold.
 * Uses the four data points provided by the LLM: $200K, $300K, $400K, $500K.
 */
function interpolateWealthyChildren(
  metro: MetroFinancialData,
  agiThresholdUsd: number,
): number {
  const points: [number, number][] = [
    [200_000, metro.childrenInFamiliesAbove200kUsd],
    [300_000, metro.childrenInFamiliesAbove300kUsd],
    [400_000, metro.childrenInFamiliesAbove400kUsd],
    [500_000, metro.childrenInFamiliesAbove500kUsd],
  ];

  // Below lowest threshold — return highest count
  if (agiThresholdUsd <= points[0][0]) return points[0][1];
  // Above highest threshold — return lowest count
  if (agiThresholdUsd >= points[points.length - 1][0]) return points[points.length - 1][1];

  // Find interval and interpolate
  for (let i = 0; i < points.length - 1; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[i + 1];
    if (agiThresholdUsd >= x1 && agiThresholdUsd <= x2) {
      // Use log-linear interpolation (income distributions are log-normal)
      if (y1 <= 0 || y2 <= 0) {
        const t = (agiThresholdUsd - x1) / (x2 - x1);
        return Math.max(0, Math.round(y1 + t * (y2 - y1)));
      }
      const t = (agiThresholdUsd - x1) / (x2 - x1);
      return Math.max(0, Math.round(Math.exp(Math.log(y1) + t * (Math.log(y2) - Math.log(y1)))));
    }
  }
  return 0;
}

/** Format a USD number compactly: 1500000000 → "$1.5B" */
export function fmtCompact(amount: number): string {
  if (amount >= 1_000_000_000) {
    const b = amount / 1_000_000_000;
    return `$${b % 1 === 0 ? b.toFixed(0) : b.toFixed(1)}B`;
  }
  if (amount >= 1_000_000) {
    const m = amount / 1_000_000;
    return `$${m % 1 === 0 ? m.toFixed(0) : m.toFixed(1)}M`;
  }
  if (amount >= 1_000) {
    const k = amount / 1_000;
    return `$${k % 1 === 0 ? k.toFixed(0) : k.toFixed(1)}K`;
  }
  return `$${amount.toLocaleString("en-US")}`;
}

/** Format a number with commas */
export function fmtNum(n: number): string {
  return n.toLocaleString("en-US");
}

/** Format USD with commas */
export function fmtUsd(n: number): string {
  return `$${n.toLocaleString("en-US")}`;
}

// ─── Flagship Optimization ───────────────────────────────────────────────────

function metroTuitionFloor(metro: MetroFinancialData): number {
  const localTop = metro.mostExpensiveNonBoardingSchoolTuition || 0;
  if (localTop > 0) {
    let floor = Math.ceil((localTop + 1) / FLAGSHIP.TUITION_STEP) * FLAGSHIP.TUITION_STEP;
    if (floor <= localTop) floor += FLAGSHIP.TUITION_STEP;
    return Math.max(floor, FLAGSHIP.MIN_TUITION);
  }
  return FLAGSHIP.MIN_TUITION;
}

function optimizeFlagships(data: FinancialResearchData): FlagshipModel {
  const metros = data.topMetros || [];

  // Qualify metros: each must support ≥ MIN_CAPACITY students at minimum tuition ($40K)
  const minAgiAtFloor = 5 * FLAGSHIP.MIN_TUITION;
  const qualifyingMetros = metros.filter((m) => {
    const eligible = interpolateWealthyChildren(m, minAgiAtFloor);
    return eligible * FLAGSHIP.PENETRATION_RATE >= FLAGSHIP.MIN_CAPACITY;
  });

  // Per-metro independent optimization: each metro gets its own tuition floor & capacity
  const allSchools: FlagshipSchoolAllocation[] = [];
  let totalRevenue = 0;

  for (const metro of qualifyingMetros) {
    const maxSchools = metro.isCapital ? FLAGSHIP.MAX_FLAGSHIPS_CAPITAL : FLAGSHIP.MAX_FLAGSHIPS_OTHER;
    const tuitionFloor = metroTuitionFloor(metro);
    let bestMetroRev = 0;
    let bestAlloc: FlagshipSchoolAllocation | null = null;

    for (let tuition = tuitionFloor; tuition <= FLAGSHIP.MAX_TUITION; tuition += FLAGSHIP.TUITION_STEP) {
      const agiThreshold = 5 * tuition;
      const eligible = interpolateWealthyChildren(metro, agiThreshold);
      const market = eligible * FLAGSHIP.PENETRATION_RATE;

      for (let capacity = FLAGSHIP.MIN_CAPACITY; capacity <= FLAGSHIP.MAX_CAPACITY; capacity += FLAGSHIP.CAPACITY_STEP) {
        const schools = Math.min(maxSchools, Math.floor(market / capacity));
        if (schools < 1) continue;

        const rev = schools * capacity * tuition;
        if (rev > bestMetroRev) {
          bestMetroRev = rev;
          bestAlloc = {
            metro: metro.name,
            isCapital: metro.isCapital,
            count: schools,
            tuitionPerYear: tuition,
            capacityPerSchool: capacity,
          };
        }
      }
    }

    if (bestAlloc) {
      allSchools.push(bestAlloc);
      totalRevenue += bestMetroRev;
    }
  }

  const totalSchoolCount = allSchools.reduce((s, a) => s + a.count, 0);
  const totalStudents = allSchools.reduce(
    (s, a) => s + a.count * a.capacityPerSchool, 0,
  );

  // Handle case where no metros support a flagship
  let scholarshipNote: string | null = null;
  if (totalSchoolCount === 0) {
    let largestName = metros[0]?.name || "Capital City";
    let largestChildren = 0;
    for (const m of metros) {
      if (m.childrenInFamiliesAbove200kUsd > largestChildren) {
        largestChildren = m.childrenInFamiliesAbove200kUsd;
        largestName = m.name;
      }
    }
    const marketAt200k = largestChildren * FLAGSHIP.PENETRATION_RATE;
    const gap = Math.max(0, FLAGSHIP.MIN_CAPACITY - Math.floor(marketAt200k));

    scholarshipNote =
      `No metro currently supports a minimum ${FLAGSHIP.MIN_CAPACITY}-student flagship at ` +
      `${fmtUsd(FLAGSHIP.MIN_TUITION)}/year tuition. The country/state would need to fund ` +
      `approximately ${fmtNum(gap)} scholarship places in ${largestName} to reach the minimum requirement.`;

    return {
      schools: [{
        metro: largestName, isCapital: true, count: 1,
        tuitionPerYear: FLAGSHIP.MIN_TUITION,
        capacityPerSchool: FLAGSHIP.MIN_CAPACITY,
      }],
      tuitionPerYear: FLAGSHIP.MIN_TUITION,
      capacityPerSchool: FLAGSHIP.MIN_CAPACITY,
      totalStudents: FLAGSHIP.MIN_CAPACITY,
      totalAnnualRevenue: FLAGSHIP.MIN_CAPACITY * FLAGSHIP.MIN_TUITION,
      operatingMarginPct: FLAGSHIP.OPERATING_MARGIN,
      totalSchoolCount: 1,
      scholarshipNote,
    };
  }

  // Summary-level tuition/capacity: revenue-weighted averages
  const weightedTuition = totalRevenue > 0
    ? allSchools.reduce((s, a) => {
        const rev = a.count * a.capacityPerSchool * a.tuitionPerYear;
        return s + a.tuitionPerYear * rev;
      }, 0) / totalRevenue
    : tuitionFloor;
  const weightedCapacity = totalRevenue > 0
    ? Math.round(allSchools.reduce((s, a) => {
        const rev = a.count * a.capacityPerSchool * a.tuitionPerYear;
        return s + a.capacityPerSchool * rev;
      }, 0) / totalRevenue)
    : FLAGSHIP.MIN_CAPACITY;

  return {
    schools: allSchools,
    tuitionPerYear: weightedTuition,
    capacityPerSchool: weightedCapacity,
    totalStudents,
    totalAnnualRevenue: totalRevenue,
    operatingMarginPct: FLAGSHIP.OPERATING_MARGIN,
    totalSchoolCount,
    scholarshipNote,
  };
}

// ─── Main Computation ────────────────────────────────────────────────────────

export function computeFinancialModel(
  data: FinancialResearchData,
  countryName: string,
): FinancialModel {
  // ── Prong 1: Flagship Alphas ──
  const flagship = optimizeFlagships(data);

  // ── Prong 2: Counterparty Schools ──
  const counterparty: CounterpartyModel = {
    minStudentsPerYear: COUNTERPARTY.MIN_STUDENTS,
    perStudentBudget: COUNTERPARTY.PER_STUDENT_BUDGET,
    costBreakdown: COUNTERPARTY.COST_BREAKDOWN.map((c) => ({ ...c })),
  };

  // ── Upfront Investment ──
  const fixedItems = [
    { item: "Alpha Core License", amountUsd: UPFRONT_FIXED.ALPHACORE_LICENSE, recipient: "Alpha Holdings" },
    { item: `${countryName}-Specific Incept EdLLM`, amountUsd: UPFRONT_FIXED.INCEPT_EDLLM, recipient: "Local expense" },
    { item: `${countryName}-Specific Programs & Life Skills`, amountUsd: UPFRONT_FIXED.PROGRAMS_LIFESKILLS, recipient: "Local expense" },
    { item: `${countryName}-Specific EdTech Apps`, amountUsd: UPFRONT_FIXED.EDTECH_APPS, recipient: "Local expense" },
  ];

  const timebackPrepay = COUNTERPARTY.MIN_STUDENTS * FEES.TIMEBACK_PER_STUDENT;
  const operatingFeePrepay = COUNTERPARTY.MIN_STUDENTS * FEES.OPERATING_FEE_PER_STUDENT;

  const variableItems = [
    {
      item: "Timeback License Prepay",
      amountUsd: timebackPrepay,
      recipient: "Alpha Holdings",
      note: `${fmtNum(COUNTERPARTY.MIN_STUDENTS)} students × ${fmtUsd(FEES.TIMEBACK_PER_STUDENT)}`,
    },
    {
      item: "Operating Fee Prepay",
      amountUsd: operatingFeePrepay,
      recipient: "Alpha Holdings",
      note: `${fmtNum(COUNTERPARTY.MIN_STUDENTS)} students × ${fmtUsd(FEES.OPERATING_FEE_PER_STUDENT)}`,
    },
  ];

  const totalUpfront =
    fixedItems.reduce((s, i) => s + i.amountUsd, 0) +
    variableItems.reduce((s, i) => s + i.amountUsd, 0);

  const upfront: UpfrontInvestment = { fixedItems, variableItems, totalUsd: totalUpfront };

  // ── Ongoing Investment ──
  const scholarshipPerStudent = Math.max(0, COUNTERPARTY.PER_STUDENT_BUDGET - data.currentPublicFundingPerStudent);
  const totalScholarshipAnnual = scholarshipPerStudent * COUNTERPARTY.MIN_STUDENTS;

  const ongoing: OngoingInvestment = {
    items: [
      {
        item: "Parent Education / Launch / Guide Training",
        amount: `${fmtCompact(FEES.PARENT_ED_ANNUAL)} / year`,
        recipient: "Local expense",
      },
      {
        item: "Scholarships or Increased Public Funding",
        amount: scholarshipPerStudent > 0
          ? `${fmtUsd(scholarshipPerStudent)} per student (${fmtCompact(totalScholarshipAnnual)} / year for ${fmtNum(COUNTERPARTY.MIN_STUDENTS)} students)`
          : "Fully funded by existing public spending",
        recipient: "Local expense",
      },
      {
        item: "Timeback License Fee",
        amount: `20% of funding/tuition, min ${fmtUsd(FEES.TIMEBACK_PER_STUDENT)} per student`,
        recipient: "Alpha Holdings (ongoing)",
      },
      {
        item: "Operating Fee",
        amount: `10% of funding/tuition, min ${fmtUsd(FEES.OPERATING_FEE_PER_STUDENT)} per student`,
        recipient: "Alpha Holdings (ongoing)",
      },
    ],
  };

  // ── Scholarship Gap ──
  const scholarshipGap: ScholarshipGap = {
    perStudentGap: scholarshipPerStudent,
    totalAnnual: totalScholarshipAnnual,
    currentFunding: data.currentPublicFundingPerStudent,
    note:
      scholarshipPerStudent > 0
        ? `${countryName} currently funds approximately ${fmtUsd(data.currentPublicFundingPerStudent)} per student annually. ` +
          `The gap of ${fmtUsd(scholarshipPerStudent)} per student (${fmtCompact(totalScholarshipAnnual)} annually ` +
          `for ${fmtNum(COUNTERPARTY.MIN_STUDENTS)} students) must be covered through scholarships or increased public funding.`
        : `${countryName}'s current per-student public funding meets or exceeds the $25,000 budget requirement.`,
  };

  return { flagship, counterparty, upfront, ongoing, scholarshipGap };
}
