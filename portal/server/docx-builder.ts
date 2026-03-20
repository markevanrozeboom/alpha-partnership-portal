import {
  Document,
  Packer,
  Paragraph,
  Table,
  TableRow,
  TableCell,
  TextRun,
  WidthType,
  AlignmentType,
  BorderStyle,
  HeadingLevel,
  ShadingType,
  TableLayoutType,
  VerticalAlign,
  PageOrientation,
  Header,
  Footer,
  TabStopPosition,
  TabStopType,
  convertInchesToTwip,
} from "docx";
import type { CountryContext, FinancialModel } from "@shared/schema";
import { fmtCompact, fmtNum, fmtUsd } from "./financial-engine";

// ─── Helper: create styled table cells ───────────────────────────────────────

const BORDER_LIGHT = { style: BorderStyle.SINGLE, size: 1, color: "E2E8F0" };
const BORDER_MEDIUM = { style: BorderStyle.SINGLE, size: 2, color: "0A1628" };
const BORDER_NONE = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };

function headerCell(text: string, widthPct: number, opts?: { highlight?: boolean }): TableCell {
  return new TableCell({
    width: { size: widthPct, type: WidthType.PERCENTAGE },
    shading: opts?.highlight
      ? { type: ShadingType.SOLID, color: "1A56DB", fill: "1A56DB" }
      : { type: ShadingType.SOLID, color: "F7FAFC", fill: "F7FAFC" },
    verticalAlign: VerticalAlign.CENTER,
    borders: {
      top: BORDER_LIGHT,
      bottom: { style: BorderStyle.SINGLE, size: 3, color: "E2E8F0" },
      left: BORDER_NONE,
      right: BORDER_NONE,
    },
    children: [
      new Paragraph({
        spacing: { before: 60, after: 60 },
        children: [
          new TextRun({
            text: text.toUpperCase(),
            bold: true,
            size: 16,
            font: "Calibri",
            color: opts?.highlight ? "FFFFFF" : "4A5568",
          }),
        ],
      }),
    ],
  });
}

function dataCell(
  text: string,
  widthPct: number,
  opts?: { bold?: boolean; highlight?: boolean; small?: boolean; color?: string },
): TableCell {
  return new TableCell({
    width: { size: widthPct, type: WidthType.PERCENTAGE },
    shading: opts?.highlight
      ? { type: ShadingType.SOLID, color: "EBF0FF", fill: "EBF0FF" }
      : undefined,
    verticalAlign: VerticalAlign.CENTER,
    borders: {
      top: BORDER_NONE,
      bottom: BORDER_LIGHT,
      left: BORDER_NONE,
      right: BORDER_NONE,
    },
    children: [
      new Paragraph({
        spacing: { before: 50, after: 50 },
        children: [
          new TextRun({
            text,
            bold: opts?.bold || false,
            size: opts?.small ? 16 : 18,
            font: "Calibri",
            color: opts?.color || (opts?.highlight ? "1A56DB" : "1A1A2E"),
          }),
        ],
      }),
    ],
  });
}

function totalCell(text: string, widthPct: number): TableCell {
  return new TableCell({
    width: { size: widthPct, type: WidthType.PERCENTAGE },
    shading: { type: ShadingType.SOLID, color: "F7FAFC", fill: "F7FAFC" },
    verticalAlign: VerticalAlign.CENTER,
    borders: {
      top: BORDER_MEDIUM,
      bottom: BORDER_MEDIUM,
      left: BORDER_NONE,
      right: BORDER_NONE,
    },
    children: [
      new Paragraph({
        spacing: { before: 60, after: 60 },
        children: [
          new TextRun({
            text,
            bold: true,
            size: 18,
            font: "Calibri",
            color: "0A1628",
          }),
        ],
      }),
    ],
  });
}

function sectionHeader(text: string, colSpan: number): TableRow {
  return new TableRow({
    cantSplit: true,
    children: [
      new TableCell({
        columnSpan: colSpan,
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: { top: BORDER_NONE, bottom: BORDER_NONE, left: BORDER_NONE, right: BORDER_NONE },
        children: [
          new Paragraph({
            spacing: { before: 100, after: 40 },
            children: [
              new TextRun({
                text,
                bold: true,
                size: 16,
                font: "Calibri",
                color: "718096",
                allCaps: true,
              }),
            ],
          }),
        ],
      }),
    ],
  });
}

// ─── Build the Document ──────────────────────────────────────────────────────

export function buildTermSheetDocx(ctx: CountryContext, model: FinancialModel): Promise<Buffer> {
  const programName = ctx.localizedProgramName || ctx.country;
  const now = new Date();
  const monthYear = now.toLocaleDateString("en-US", { year: "numeric", month: "long" });

  // ── Key Metrics Table ──
  const metricsTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    rows: [
      new TableRow({
        cantSplit: true,
        children: [
          new TableCell({
            width: { size: 25, type: WidthType.PERCENTAGE },
            shading: { type: ShadingType.SOLID, color: "F7FAFC", fill: "F7FAFC" },
            borders: { top: BORDER_LIGHT, bottom: BORDER_LIGHT, left: BORDER_LIGHT, right: BORDER_LIGHT },
            children: [
              new Paragraph({
                spacing: { before: 60, after: 20 },
                children: [new TextRun({ text: "FLAGSHIP SCHOOLS", bold: true, size: 14, font: "Calibri", color: "718096" })],
              }),
              new Paragraph({
                spacing: { before: 0, after: 60 },
                children: [
                  new TextRun({
                    text: `${model.flagship.totalSchoolCount} schools · ${fmtNum(model.flagship.totalStudents)} students`,
                    bold: true,
                    size: 20,
                    font: "Calibri",
                    color: "0A1628",
                  }),
                ],
              }),
            ],
          }),
          new TableCell({
            width: { size: 25, type: WidthType.PERCENTAGE },
            shading: { type: ShadingType.SOLID, color: "F7FAFC", fill: "F7FAFC" },
            borders: { top: BORDER_LIGHT, bottom: BORDER_LIGHT, left: BORDER_LIGHT, right: BORDER_LIGHT },
            children: [
              new Paragraph({
                spacing: { before: 60, after: 20 },
                children: [new TextRun({ text: "NATIONAL SCHOOLS", bold: true, size: 14, font: "Calibri", color: "718096" })],
              }),
              new Paragraph({
                spacing: { before: 0, after: 60 },
                children: [
                  new TextRun({
                    text: `${fmtNum(model.counterparty.minStudentsPerYear)} students / year`,
                    bold: true,
                    size: 20,
                    font: "Calibri",
                    color: "0A1628",
                  }),
                ],
              }),
            ],
          }),
          new TableCell({
            width: { size: 25, type: WidthType.PERCENTAGE },
            shading: { type: ShadingType.SOLID, color: "F7FAFC", fill: "F7FAFC" },
            borders: { top: BORDER_LIGHT, bottom: BORDER_LIGHT, left: BORDER_LIGHT, right: BORDER_LIGHT },
            children: [
              new Paragraph({
                spacing: { before: 60, after: 20 },
                children: [new TextRun({ text: "PER-STUDENT BUDGET", bold: true, size: 14, font: "Calibri", color: "718096" })],
              }),
              new Paragraph({
                spacing: { before: 0, after: 60 },
                children: [
                  new TextRun({
                    text: `${fmtUsd(model.counterparty.perStudentBudget)} / year`,
                    bold: true,
                    size: 20,
                    font: "Calibri",
                    color: "0A1628",
                  }),
                ],
              }),
            ],
          }),
          new TableCell({
            width: { size: 25, type: WidthType.PERCENTAGE },
            shading: { type: ShadingType.SOLID, color: "F7FAFC", fill: "F7FAFC" },
            borders: { top: BORDER_LIGHT, bottom: BORDER_LIGHT, left: BORDER_LIGHT, right: BORDER_LIGHT },
            children: [
              new Paragraph({
                spacing: { before: 60, after: 20 },
                children: [new TextRun({ text: "TOTAL UPFRONT", bold: true, size: 14, font: "Calibri", color: "718096" })],
              }),
              new Paragraph({
                spacing: { before: 0, after: 60 },
                children: [
                  new TextRun({
                    text: fmtCompact(model.upfront.totalUsd),
                    bold: true,
                    size: 20,
                    font: "Calibri",
                    color: "0A1628",
                  }),
                ],
              }),
            ],
          }),
        ],
      }),
    ],
  });

  // ── Flagship Schools Table ──
  const flagshipTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    rows: [
      new TableRow({
        tableHeader: true,
        cantSplit: true,
        children: [
          headerCell("Metro Area", 30),
          headerCell("Schools", 15),
          headerCell("Capacity / School", 20),
          headerCell("Tuition / Year", 15),
          headerCell("Annual Revenue", 20),
        ],
      }),
      ...model.flagship.schools.map(
        (s) =>
          new TableRow({
            cantSplit: true,
            children: [
              dataCell(`${s.metro}${s.isCapital ? " (Capital)" : ""}`, 30),
              dataCell(String(s.count), 15, { bold: true }),
              dataCell(fmtNum(s.capacityPerSchool), 20),
              dataCell(fmtUsd(s.tuitionPerYear), 15, { bold: true }),
              dataCell(fmtCompact(s.count * s.capacityPerSchool * s.tuitionPerYear), 20, {
                bold: true,
              }),
            ],
          }),
      ),
      new TableRow({
        cantSplit: true,
        children: [
          totalCell("Total", 30),
          totalCell(String(model.flagship.totalSchoolCount), 15),
          totalCell(fmtNum(model.flagship.totalStudents) + " total", 20),
          totalCell("", 15),
          totalCell(fmtCompact(model.flagship.totalAnnualRevenue), 20),
        ],
      }),
    ],
  });

  // ── Per-Student Cost Breakdown Table ──
  const costTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    rows: [
      new TableRow({
        tableHeader: true,
        cantSplit: true,
        children: [
          headerCell("Cost Item (Per Student)", 40),
          headerCell("Amount", 20, { highlight: true }),
          headerCell("Notes", 40),
        ],
      }),
      ...model.counterparty.costBreakdown.map(
        (c) =>
          new TableRow({
            cantSplit: true,
            children: [
              dataCell(c.item, 40),
              dataCell(fmtUsd(c.amount), 20, { bold: true, highlight: true }),
              dataCell(c.note, 40, { small: true, color: "718096" }),
            ],
          }),
      ),
      new TableRow({
        cantSplit: true,
        children: [
          totalCell("Total Per Student", 40),
          totalCell(fmtUsd(model.counterparty.perStudentBudget), 20),
          totalCell("", 40),
        ],
      }),
    ],
  });

  // ── Upfront Investment Table ──
  const upfrontTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    rows: [
      new TableRow({
        tableHeader: true,
        cantSplit: true,
        children: [
          headerCell("Item", 35),
          headerCell("Amount", 20),
          headerCell("Recipient", 25),
          headerCell("Notes", 20),
        ],
      }),
      sectionHeader("FIXED DEVELOPMENT COSTS", 4),
      ...model.upfront.fixedItems.map(
        (r) =>
          new TableRow({
            cantSplit: true,
            children: [
              dataCell(r.item, 35),
              dataCell(fmtCompact(r.amountUsd), 20, { bold: true }),
              dataCell(r.recipient, 25),
              dataCell("Paid upfront", 20, { small: true, color: "718096" }),
            ],
          }),
      ),
      sectionHeader("PREPAID FEES (VARIABLE WITH STUDENT COUNT)", 4),
      ...model.upfront.variableItems.map(
        (r) =>
          new TableRow({
            cantSplit: true,
            children: [
              dataCell(r.item, 35),
              dataCell(fmtCompact(r.amountUsd), 20, { bold: true }),
              dataCell(r.recipient, 25),
              dataCell(r.note || "", 20, { small: true, color: "718096" }),
            ],
          }),
      ),
      new TableRow({
        cantSplit: true,
        children: [
          totalCell("Total Upfront", 35),
          totalCell(fmtCompact(model.upfront.totalUsd), 20),
          totalCell("", 25),
          totalCell("", 20),
        ],
      }),
    ],
  });

  // ── Ongoing Investment Table ──
  const ongoingTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    rows: [
      new TableRow({
        tableHeader: true,
        cantSplit: true,
        children: [
          headerCell("Item", 35),
          headerCell("Amount", 35),
          headerCell("Recipient", 30),
        ],
      }),
      ...model.ongoing.items.map(
        (r) =>
          new TableRow({
            cantSplit: true,
            children: [
              dataCell(r.item, 35),
              dataCell(r.amount, 35, { bold: true }),
              dataCell(r.recipient, 30),
            ],
          }),
      ),
    ],
  });

  // ── Deal Structure Comparison Table ──
  const dealTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    rows: [
      new TableRow({
        tableHeader: true,
        cantSplit: true,
        children: [
          headerCell("Parameter", 30),
          headerCell("Halo Alpha (Flagship)", 35),
          headerCell("National", 35),
        ],
      }),
      ...[
        ["Ownership", "100% Alpha", `100% ${ctx.country} / 0% Alpha`],
        ["Operated By", "Alpha", `Alpha (on behalf of ${ctx.country})`],
        ["Students", fmtNum(model.flagship.totalStudents), `${fmtNum(model.counterparty.minStudentsPerYear)} minimum`],
        ["Tuition / Funding", `${fmtUsd(model.flagship.tuitionPerYear)} / year`, `${fmtUsd(model.counterparty.perStudentBudget)} / year (fixed)`],
        ["Operating Margin", "25%", "Per cost structure"],
        ["Operating Fee", "N/A (Alpha-owned)", `10% of funding (min ${fmtUsd(2500)}/student)`],
        ["Timeback License", "N/A (Alpha-owned)", `20% of funding (min ${fmtUsd(5000)}/student)`],
        ["Backstop", "50% capacity, 5 years", "N/A"],
        ["Real Estate", "Sourced by counterparty", "Sourced by counterparty"],
      ].map(
        ([param, prong1, prong2]) =>
          new TableRow({
            cantSplit: true,
            children: [
              dataCell(param, 30, { bold: true }),
              dataCell(prong1, 35),
              dataCell(prong2, 35),
            ],
          }),
      ),
    ],
  });

  // ── Build the document ──
  const doc = new Document({
    styles: {
      default: {
        document: {
          run: { font: "Calibri", size: 20 },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            size: {
              orientation: PageOrientation.LANDSCAPE,
              width: convertInchesToTwip(11),
              height: convertInchesToTwip(8.5),
            },
            margin: {
              top: convertInchesToTwip(0.6),
              bottom: convertInchesToTwip(0.5),
              left: convertInchesToTwip(0.75),
              right: convertInchesToTwip(0.75),
            },
          },
        },
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                children: [
                  new TextRun({ text: `${ctx.flagEmoji} ${programName} — Term Sheet`, bold: true, size: 36, font: "Calibri", color: "0A1628" }),
                  new TextRun({ text: "\t" }),
                  new TextRun({ text: "ALPHA HOLDINGS, INC.", bold: true, size: 22, font: "Calibri", color: "1A56DB" }),
                ],
                tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
                spacing: { after: 40 },
              }),
              new Paragraph({
                children: [
                  new TextRun({ text: `${ctx.formalName} National Education Transformation Program`, size: 20, font: "Calibri", color: "4A5568" }),
                  new TextRun({ text: "\t" }),
                  new TextRun({ text: `Confidential & Proprietary · ${monthYear}`, size: 16, font: "Calibri", color: "718096" }),
                ],
                tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
                border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "0A1628" } },
                spacing: { after: 200 },
              }),
            ],
          }),
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                children: [
                  new TextRun({ text: `© ${now.getFullYear()} Alpha Holdings, Inc. Confidential & Proprietary.`, size: 14, font: "Calibri", color: "A0AEC0" }),
                  new TextRun({ text: "\t" }),
                  new TextRun({ text: `${programName} Term Sheet — ${ctx.formalName}`, size: 14, font: "Calibri", color: "A0AEC0" }),
                ],
                tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
              }),
            ],
          }),
        },
        children: [
          // ── Country info callout ──
          new Paragraph({
            shading: { type: ShadingType.SOLID, color: "F0F4FF", fill: "F0F4FF" },
            border: { left: { style: BorderStyle.SINGLE, size: 8, color: "1A56DB" } },
            spacing: { before: 0, after: 200 },
            indent: { left: 100 },
            children: [
              new TextRun({ text: `${ctx.headOfStateTitle}: `, bold: true, size: 18, font: "Calibri", color: "2D3748" }),
              new TextRun({ text: `${ctx.headOfState}  ·  `, size: 18, font: "Calibri", color: "2D3748" }),
              new TextRun({ text: "Population: ", bold: true, size: 18, font: "Calibri", color: "2D3748" }),
              new TextRun({ text: `${ctx.population}  ·  `, size: 18, font: "Calibri", color: "2D3748" }),
              new TextRun({ text: "GDP per Capita: ", bold: true, size: 18, font: "Calibri", color: "2D3748" }),
              new TextRun({ text: `${ctx.gdpPerCapita}  ·  `, size: 18, font: "Calibri", color: "2D3748" }),
              new TextRun({ text: "School-Age Population: ", bold: true, size: 18, font: "Calibri", color: "2D3748" }),
              new TextRun({ text: ctx.schoolAgePopulation, size: 18, font: "Calibri", color: "2D3748" }),
              ...(ctx.addressableStudentPopulation ? [
                new TextRun({ text: "  ·  ", size: 18, font: "Calibri", color: "2D3748" }),
                new TextRun({ text: "Addressable (AGI > $250k): ", bold: true, size: 18, font: "Calibri", color: "1A56DB" }),
                new TextRun({ text: ctx.addressableStudentPopulation, size: 18, font: "Calibri", color: "1A56DB" }),
              ] : []),
            ],
          }),

          // ── Key metrics ──
          metricsTable,
          new Paragraph({ spacing: { before: 200, after: 0 }, children: [] }),

          // ── Flagship: Halo Alpha schools ──
          new Paragraph({
            spacing: { before: 0, after: 40 },
            children: [
              new TextRun({ text: "FLAGSHIP", bold: true, size: 16, font: "Calibri", color: "FFFFFF" }),
            ],
            shading: { type: ShadingType.SOLID, color: "1A56DB", fill: "1A56DB" },
          }),
          new Paragraph({
            spacing: { before: 80, after: 80 },
            children: [new TextRun({ text: "Halo Alpha Schools", bold: true, size: 28, font: "Calibri", color: "0A1628" })],
          }),
          new Paragraph({
            spacing: { before: 0, after: 80 },
            children: [
              new TextRun({
                text: "Halo Alpha Schools are 100% owned by Alpha Holdings, Inc. and serve as the premium \"halo brand\" — flagship schools that demonstrate the full Alpha experience at the highest level of execution. " +
                  "They establish Alpha's reputation in each market, set the benchmark for academic and life-skills outcomes, and create aspirational demand that drives enrollment across the broader national school network.",
                size: 18,
                font: "Calibri",
                color: "4A5568",
              }),
            ],
          }),
          new Paragraph({
            spacing: { before: 0, after: 120 },
            children: [
              new TextRun({
                text: (() => {
                  const tuitions = model.flagship.schools.map(s => s.tuitionPerYear);
                  const capacities = model.flagship.schools.map(s => s.capacityPerSchool);
                  const tuitionStr = new Set(tuitions).size === 1
                    ? `Tuition: ${fmtUsd(tuitions[0])}/year.`
                    : `Tuition: ${fmtUsd(Math.min(...tuitions))} – ${fmtUsd(Math.max(...tuitions))}/year (varies by metro).`;
                  const capStr = new Set(capacities).size === 1
                    ? `${fmtNum(capacities[0])} students per school.`
                    : `${fmtNum(Math.min(...capacities))} – ${fmtNum(Math.max(...capacities))} students per school.`;
                  return `Sized as 250-, 500-, or 1,000-student schools in ${ctx.country}'s top metropolitan areas. ` +
                    `${tuitionStr} ${capStr} 25% operating margin. 50% capacity backstop required for 5 years.`;
                })(),
                size: 18,
                font: "Calibri",
                color: "4A5568",
              }),
            ],
          }),
          flagshipTable,

          // Scholarship note if applicable
          ...(model.flagship.scholarshipNote
            ? [
                new Paragraph({
                  shading: { type: ShadingType.SOLID, color: "FFFBEB", fill: "FFFBEB" },
                  border: { left: { style: BorderStyle.SINGLE, size: 8, color: "D97706" } },
                  spacing: { before: 80, after: 120 },
                  indent: { left: 100 },
                  children: [
                    new TextRun({ text: "⚠️ ", size: 18, font: "Calibri" }),
                    new TextRun({ text: model.flagship.scholarshipNote, size: 18, font: "Calibri", color: "78350F" }),
                  ],
                }),
              ]
            : []),

          new Paragraph({ spacing: { before: 120, after: 0 }, children: [] }),

          // ── National: Counterparty schools ──
          new Paragraph({
            spacing: { before: 0, after: 40 },
            children: [
              new TextRun({ text: "NATIONAL", bold: true, size: 16, font: "Calibri", color: "FFFFFF" }),
            ],
            shading: { type: ShadingType.SOLID, color: "0A1628", fill: "0A1628" },
          }),
          new Paragraph({
            spacing: { before: 80, after: 80 },
            children: [new TextRun({ text: `${ctx.country}-Owned Schools Operated by Alpha`, bold: true, size: 28, font: "Calibri", color: "0A1628" })],
          }),
          new Paragraph({
            spacing: { before: 0, after: 80 },
            children: [
              new TextRun({
                text: `100% owned by ${ctx.country}. 0% owned by Alpha. Alpha operates schools on behalf of the country/state. ` +
                  `Minimum commitment: ${fmtNum(model.counterparty.minStudentsPerYear)} students/year. ` +
                  `Per-student funding: ${fmtUsd(model.counterparty.perStudentBudget)}/year.`,
                size: 18,
                font: "Calibri",
                color: "4A5568",
              }),
            ],
          }),
          new Paragraph({
            shading: { type: ShadingType.SOLID, color: "F0F4FF", fill: "F0F4FF" },
            border: { left: { style: BorderStyle.SINGLE, size: 8, color: "1A56DB" } },
            spacing: { before: 0, after: 120 },
            indent: { left: 100 },
            children: [
              new TextRun({
                text: "We are proposing to implement through a national network of privately-operated, government-funded schools, but are equally open to other structures.",
                size: 18,
                font: "Calibri",
                color: "2D3748",
                italics: true,
              }),
            ],
          }),
          costTable,

          // ── Page break before investment ──
          new Paragraph({
            pageBreakBefore: true,
            spacing: { before: 0, after: 100 },
            children: [
              new TextRun({ text: "INVESTMENT REQUIRED", bold: true, size: 16, font: "Calibri", color: "1A56DB", allCaps: true }),
            ],
          }),
          new Paragraph({
            spacing: { before: 0, after: 80 },
            children: [new TextRun({ text: "Upfront Investment", bold: true, size: 28, font: "Calibri", color: "0A1628" })],
          }),
          new Paragraph({
            spacing: { before: 0, after: 120 },
            children: [
              new TextRun({
                text: `Indicative of ${fmtNum(model.counterparty.minStudentsPerYear)} students. Upfront development costs do not change; prepaid fees scale above ${fmtNum(model.counterparty.minStudentsPerYear)} students.`,
                size: 16,
                font: "Calibri",
                color: "718096",
              }),
            ],
          }),
          upfrontTable,

          new Paragraph({ spacing: { before: 200, after: 0 }, children: [] }),
          new Paragraph({
            spacing: { before: 0, after: 80 },
            children: [new TextRun({ text: "Ongoing Annual Investment", bold: true, size: 28, font: "Calibri", color: "0A1628" })],
          }),
          ongoingTable,

          // ── Funding gap callout ──
          new Paragraph({
            shading: { type: ShadingType.SOLID, color: "F0F4FF", fill: "F0F4FF" },
            border: { left: { style: BorderStyle.SINGLE, size: 8, color: "1A56DB" } },
            spacing: { before: 120, after: 200 },
            indent: { left: 100 },
            children: [
              new TextRun({
                text: model.scholarshipGap.perStudentGap > 0 ? "Funding Gap: " : "Funding: ",
                bold: true,
                size: 18,
                font: "Calibri",
                color: "2D3748",
              }),
              new TextRun({ text: model.scholarshipGap.note, size: 18, font: "Calibri", color: "2D3748" }),
            ],
          }),

          // ── Deal Structure Summary ──
          new Paragraph({
            spacing: { before: 0, after: 100 },
            children: [
              new TextRun({ text: "DEAL STRUCTURE SUMMARY", bold: true, size: 16, font: "Calibri", color: "1A56DB", allCaps: true }),
            ],
          }),
          dealTable,
        ],
      },
    ],
  });

  return Packer.toBuffer(doc) as Promise<Buffer>;
}
