"use client";

import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface ReportViewerProps {
  title: string;
  report: string;
  downloadUrl?: string;
}

export function ReportViewer({ title, report, downloadUrl }: ReportViewerProps) {
  // Estimate word count for page count display
  const wordCount = report ? report.split(/\s+/).length : 0;
  const estPages = Math.max(1, Math.round(wordCount / 500));

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold text-white">{title}</h2>
          <p className="text-sm text-gray-400 mt-1">
            ~{wordCount.toLocaleString()} words · ~{estPages} pages
          </p>
        </div>
        {downloadUrl && (
          <a
            href={downloadUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-lg bg-[#006D77] px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#005a63] shadow-lg shadow-[#006D77]/20"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            Download DOCX
          </a>
        )}
      </div>

      {/* Report Body */}
      <div className="rounded-xl border border-white/10 bg-[#0d0d1a]/90 overflow-hidden">
        <div className="p-8 md:p-12 overflow-auto max-h-[80vh]">
          <div className="report-content max-w-none">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                // Headings
                h1: ({ children }) => (
                  <h1 className="text-3xl font-bold text-white mt-10 mb-6 pb-4 border-b border-white/10 first:mt-0">
                    {children}
                  </h1>
                ),
                h2: ({ children }) => (
                  <h2 className="text-2xl font-bold text-[#00d4aa] mt-10 mb-5">
                    {children}
                  </h2>
                ),
                h3: ({ children }) => (
                  <h3 className="text-xl font-semibold text-white mt-8 mb-4">
                    {children}
                  </h3>
                ),
                h4: ({ children }) => (
                  <h4 className="text-lg font-semibold text-[#FFD700] mt-6 mb-3">
                    {children}
                  </h4>
                ),

                // Paragraphs — detect callouts
                p: ({ children }) => {
                  const text = React.Children.toArray(children)
                    .map((c) => (typeof c === "string" ? c : ""))
                    .join("");

                  if (text.includes("⚡ Alpha Relevance") || text.includes("⚡")) {
                    return (
                      <div className="my-6 rounded-lg border border-[#FFD700]/30 bg-[#FFD700]/5 p-5">
                        <p className="text-[#FFD700] font-medium leading-relaxed m-0 text-[15px]">
                          {children}
                        </p>
                      </div>
                    );
                  }
                  if (text.includes("🎯 Strategic Priority") || text.includes("🎯")) {
                    return (
                      <div className="my-6 rounded-lg border border-[#00d4aa]/30 bg-[#00d4aa]/5 p-5">
                        <p className="text-[#00d4aa] font-medium leading-relaxed m-0 text-[15px]">
                          {children}
                        </p>
                      </div>
                    );
                  }

                  return (
                    <p className="text-gray-300 leading-[1.8] mb-5 text-[15px]">
                      {children}
                    </p>
                  );
                },

                // Bold
                strong: ({ children }) => (
                  <strong className="text-white font-semibold">{children}</strong>
                ),

                // Links
                a: ({ children, href }) => (
                  <a href={href} target="_blank" rel="noopener noreferrer" className="text-[#006D77] hover:text-[#00d4aa] underline underline-offset-2">
                    {children}
                  </a>
                ),

                // Lists
                ul: ({ children }) => (
                  <ul className="list-disc list-outside ml-6 mb-5 space-y-2">
                    {children}
                  </ul>
                ),
                ol: ({ children }) => (
                  <ol className="list-decimal list-outside ml-6 mb-5 space-y-2">
                    {children}
                  </ol>
                ),
                li: ({ children }) => (
                  <li className="text-gray-300 leading-relaxed text-[15px] pl-1">
                    {children}
                  </li>
                ),

                // Horizontal rule
                hr: () => <hr className="border-white/10 my-8" />,

                // Code
                code: ({ children }) => (
                  <code className="text-[#00d4aa] bg-white/5 px-1.5 py-0.5 rounded text-sm">
                    {children}
                  </code>
                ),

                // Blockquote
                blockquote: ({ children }) => (
                  <blockquote className="border-l-4 border-[#006D77] bg-[#006D77]/5 rounded-r-lg py-3 px-5 my-5 italic">
                    {children}
                  </blockquote>
                ),

                // Tables — the critical fix
                table: ({ children }) => (
                  <div className="my-6 overflow-x-auto rounded-lg border border-white/10">
                    <table className="w-full text-sm border-collapse">
                      {children}
                    </table>
                  </div>
                ),
                thead: ({ children }) => (
                  <thead className="bg-[#1a1a2e]">
                    {children}
                  </thead>
                ),
                tbody: ({ children }) => (
                  <tbody className="divide-y divide-white/5">
                    {children}
                  </tbody>
                ),
                tr: ({ children }) => (
                  <tr className="hover:bg-white/[0.03] transition-colors">
                    {children}
                  </tr>
                ),
                th: ({ children }) => (
                  <th className="px-4 py-3 text-left text-xs font-semibold text-white uppercase tracking-wider border-b border-white/20 whitespace-nowrap">
                    {children}
                  </th>
                ),
                td: ({ children }) => (
                  <td className="px-4 py-3 text-sm text-gray-300 border-b border-white/5">
                    {children}
                  </td>
                ),
              }}
            >
              {report}
            </ReactMarkdown>
          </div>
        </div>
      </div>
    </div>
  );
}
