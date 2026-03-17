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
import type { CountryContext } from "@shared/schema";

// ─── Fixed Economics (same as routes.ts) ───────────────────────────────────

const FIXED_ECONOMICS = {
  upfront: [
    { item: "AlphaCore License", amount: "$250M", recipient: "Alpha Holdings" },
    { item: "EdTech App R&D", amount: "$250M", recipient: "Local expense" },
    { item: "Local Life-Skills R&D", amount: "$250M", recipient: "Local expense" },
    { item: "Management Fee Prepay", amount: "$250M", recipient: "Prepaid OpEx for 100k student-years" },
    { item: "TimeBack License Fee Prepay", amount: "$500M", recipient: "Prepaid OpEx for 100k student-years" },
  ],
  upfrontTotal: "$1.5B",
  ongoing: [
    { item: "Parent Edu / Launch / Guides", amount: "$25-50M / yr", recipient: "Local expense" },
    { item: "Additional School Funding", amount: "$1B / yr*", recipient: "Local expense" },
    { item: "Management Fee", amount: "10% budget", recipient: "OpEx to Alpha Holdings" },
    { item: "TimeBack License Fee", amount: "20% budget", recipient: "OpEx to Alpha Holdings" },
  ],
  costStructure: [
    { item: "Tuition", alpha: "$50,000", national: "$25,000", notes: "Budget for $25,000 school" },
    { item: "Guides", alpha: "$14,000", national: "$4,500", notes: "Alpha 11:1 ratio & higher comp; National 25:1 ratio & lower comp" },
    { item: "Timeback / Software", alpha: "$10,000", national: "$5,000", notes: "20% of Budget" },
    { item: "Programs and Life Skills", alpha: "$9,000", national: "$4,250", notes: "Alpha is 2x other National" },
    { item: "Other HC", alpha: "$1,750", national: "$1,750", notes: "-" },
    { item: "Facility / CapEx", alpha: "$8,750", national: "$3,000", notes: "Includes depreciated capex to convert locations" },
    { item: "Misc Expense", alpha: "$1,500", national: "$1,500", notes: "-" },
    { item: "Management Fee", alpha: "-", national: "$2,500", notes: "10% of Budget" },
    { item: "IP Amortization", alpha: "", national: "$2,072", notes: "Full amortization of IP costs over 5 year target" },
  ],
  scaleTargets: {
    yearOne: "2,000 students / 2 communities",
    fiveYear: "200k students / 50+ communities",
  },
};

// ─── Helper: create a styled table cell ─────────────────────────────────────

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
            size: 16, // 8pt
            font: "Calibri",
            color: opts?.highlight ? "FFFFFF" : "4A5568",
          }),
        ],
      }),
    ],
  });
}

function dataCell(text: string, widthPct: number, opts?: { bold?: boolean; highlight?: boolean; small?: boolean; color?: string }): TableCell {
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
            size: opts?.small ? 16 : 18, // 8pt or 9pt
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

// ─── Build the Document ──────────────────────────────────────────────────────

export function buildTermSheetDocx(ctx: CountryContext): Promise<Buffer> {
  const programName = ctx.localizedProgramName || ctx.country;
  const now = new Date();
  const monthYear = now.toLocaleDateString("en-US", { year: "numeric", month: "long" });

  // ── Upfront Table ──
  const upfrontTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    rows: [
      new TableRow({
        tableHeader: true,
        children: [
          headerCell("Item", 40),
          headerCell("Amount", 20),
          headerCell("Recipient", 40),
        ],
      }),
      ...FIXED_ECONOMICS.upfront.map(
        (r) =>
          new TableRow({
            children: [
              dataCell(
                r.item
                  .replace("EdTech App R&D", `${ctx.country} EdTech App R&D`)
                  .replace("Local Life-Skills R&D", `${programName} Life-Skills R&D`),
                40
              ),
              dataCell(r.amount, 20, { bold: true }),
              dataCell(r.recipient, 40),
            ],
          })
      ),
      new TableRow({
        children: [
          totalCell("Total", 40),
          totalCell(FIXED_ECONOMICS.upfrontTotal, 20),
          totalCell("", 40),
        ],
      }),
    ],
  });

  // ── Ongoing Table ──
  const ongoingTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    rows: [
      new TableRow({
        tableHeader: true,
        children: [
          headerCell("Item", 40),
          headerCell("Amount", 25),
          headerCell("Recipient", 35),
        ],
      }),
      ...FIXED_ECONOMICS.ongoing.map(
        (r) =>
          new TableRow({
            children: [
              dataCell(r.item, 40),
              dataCell(r.amount, 25, { bold: true }),
              dataCell(r.recipient, 35),
            ],
          })
      ),
      new TableRow({
        children: [
          totalCell("Total", 40),
          totalCell("Scale dependent", 25),
          totalCell("", 35),
        ],
      }),
    ],
  });

  // ── Cost Structure Table ──
  const costTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    rows: [
      new TableRow({
        tableHeader: true,
        children: [
          headerCell("Item (per student P&L)", 28),
          headerCell("Alpha @ $50k Tuition", 18),
          headerCell(`National @ $25k Budget`, 18, { highlight: true }),
          headerCell("Notes", 36),
        ],
      }),
      // Section header
      new TableRow({
        children: [
          new TableCell({
            columnSpan: 4,
            width: { size: 100, type: WidthType.PERCENTAGE },
            borders: { top: BORDER_NONE, bottom: BORDER_NONE, left: BORDER_NONE, right: BORDER_NONE },
            children: [
              new Paragraph({
                spacing: { before: 100, after: 40 },
                children: [
                  new TextRun({
                    text: "FUNDING",
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
      }),
      ...FIXED_ECONOMICS.costStructure.map(
        (r) =>
          new TableRow({
            children: [
              dataCell(r.item, 28),
              dataCell(r.alpha, 18, { bold: true }),
              dataCell(r.national, 18, { bold: true, highlight: true }),
              dataCell(r.notes, 36, { small: true, color: "718096" }),
            ],
          })
      ),
    ],
  });

  // ── Scale Targets Table (inline badges) ──
  const scaleTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: 25, type: WidthType.PERCENTAGE },
            shading: { type: ShadingType.SOLID, color: "F7FAFC", fill: "F7FAFC" },
            borders: { top: BORDER_LIGHT, bottom: BORDER_LIGHT, left: BORDER_LIGHT, right: BORDER_LIGHT },
            children: [
              new Paragraph({
                spacing: { before: 60, after: 20 },
                children: [new TextRun({ text: "YEAR ONE", bold: true, size: 14, font: "Calibri", color: "718096" })],
              }),
              new Paragraph({
                spacing: { before: 0, after: 60 },
                children: [new TextRun({ text: FIXED_ECONOMICS.scaleTargets.yearOne, bold: true, size: 20, font: "Calibri", color: "0A1628" })],
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
                children: [new TextRun({ text: "5-YEAR PLAN", bold: true, size: 14, font: "Calibri", color: "718096" })],
              }),
              new Paragraph({
                spacing: { before: 0, after: 60 },
                children: [new TextRun({ text: FIXED_ECONOMICS.scaleTargets.fiveYear, bold: true, size: 20, font: "Calibri", color: "0A1628" })],
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
                children: [new TextRun({ text: "$25,000 / year", bold: true, size: 20, font: "Calibri", color: "0A1628" })],
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
                children: [new TextRun({ text: "UP-FRONT INVESTMENT", bold: true, size: 14, font: "Calibri", color: "718096" })],
              }),
              new Paragraph({
                spacing: { before: 0, after: 60 },
                children: [new TextRun({ text: "$1.5B", bold: true, size: 20, font: "Calibri", color: "0A1628" })],
              }),
            ],
          }),
        ],
      }),
    ],
  });

  // Tables will be placed sequentially (stacked) for better Word/Google Docs rendering

  const doc = new Document({
    styles: {
      default: {
        document: {
          run: {
            font: "Calibri",
            size: 20,
          },
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
                  new TextRun({
                    text: `${ctx.flagEmoji} ${programName} — Term Sheet`,
                    bold: true,
                    size: 36,
                    font: "Calibri",
                    color: "0A1628",
                  }),
                  new TextRun({ text: "\t" }),
                  new TextRun({
                    text: "ALPHA",
                    bold: true,
                    size: 22,
                    font: "Calibri",
                    color: "1A56DB",
                  }),
                ],
                tabStops: [
                  {
                    type: TabStopType.RIGHT,
                    position: TabStopPosition.MAX,
                  },
                ],
                spacing: { after: 40 },
              }),
              new Paragraph({
                children: [
                  new TextRun({
                    text: `${ctx.formalName} National Education Transformation Program`,
                    size: 20,
                    font: "Calibri",
                    color: "4A5568",
                  }),
                  new TextRun({ text: "\t" }),
                  new TextRun({
                    text: `Confidential & Proprietary · ${monthYear}`,
                    size: 16,
                    font: "Calibri",
                    color: "718096",
                  }),
                ],
                tabStops: [
                  {
                    type: TabStopType.RIGHT,
                    position: TabStopPosition.MAX,
                  },
                ],
                border: {
                  bottom: { style: BorderStyle.SINGLE, size: 6, color: "0A1628" },
                },
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
                  new TextRun({
                    text: `© ${now.getFullYear()} Alpha Holdings. Confidential & Proprietary.`,
                    size: 14,
                    font: "Calibri",
                    color: "A0AEC0",
                  }),
                  new TextRun({ text: "\t" }),
                  new TextRun({
                    text: `${programName} Term Sheet — ${ctx.formalName}`,
                    size: 14,
                    font: "Calibri",
                    color: "A0AEC0",
                  }),
                ],
                tabStops: [
                  {
                    type: TabStopType.RIGHT,
                    position: TabStopPosition.MAX,
                  },
                ],
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
            ],
          }),

          // ── Scale targets ──
          scaleTable,

          // ── Spacer ──
          new Paragraph({ spacing: { before: 200, after: 0 }, children: [] }),

          // ── COMMERCIAL STRUCTURE label ──
          new Paragraph({
            spacing: { before: 0, after: 100 },
            children: [
              new TextRun({
                text: "COMMERCIAL STRUCTURE",
                bold: true,
                size: 16,
                font: "Calibri",
                color: "1A56DB",
                allCaps: true,
              }),
            ],
          }),

          // ── Upfront heading ──
          new Paragraph({
            spacing: { before: 0, after: 80 },
            children: [new TextRun({ text: "Upfront", bold: true, size: 28, font: "Calibri", color: "0A1628" })],
          }),
          upfrontTable,

          // ── Spacer ──
          new Paragraph({ spacing: { before: 200, after: 0 }, children: [] }),

          // ── Ongoing heading ──
          new Paragraph({
            spacing: { before: 0, after: 80 },
            children: [new TextRun({ text: "Ongoing", bold: true, size: 28, font: "Calibri", color: "0A1628" })],
          }),
          ongoingTable,

          // ── Page break before cost structure ──
          new Paragraph({
            pageBreakBefore: true,
            spacing: { before: 0, after: 100 },
            children: [
              new TextRun({
                text: `${programName.toUpperCase()} COST STRUCTURE`,
                bold: true,
                size: 16,
                font: "Calibri",
                color: "1A56DB",
                allCaps: true,
              }),
            ],
          }),

          new Paragraph({
            spacing: { before: 0, after: 200 },
            children: [
              new TextRun({
                text: "Budget like other $25k Alpha Holdings Schools",
                bold: true,
                size: 28,
                font: "Calibri",
                color: "0A1628",
              }),
            ],
          }),

          // ── Cost structure table ──
          costTable,
        ],
      },
    ],
  });

  return Packer.toBuffer(doc) as Promise<Buffer>;
}
