"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface ReportViewerProps {
  title: string;
  report: string;
  downloadUrl?: string;
}

export function ReportViewer({ title, report, downloadUrl }: ReportViewerProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-white">{title}</h2>
        {downloadUrl && (
          <a
            href={downloadUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-lg bg-[#006D77] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#005a63]"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            Download DOCX
          </a>
        )}
      </div>

      <div className="rounded-xl border border-white/10 bg-[#0d0d1a]/90 p-6 md:p-8 overflow-auto max-h-[70vh]">
        <article className="prose prose-invert prose-lg max-w-none
          prose-headings:text-white prose-headings:font-bold
          prose-h1:text-3xl prose-h1:border-b prose-h1:border-white/10 prose-h1:pb-4 prose-h1:mb-6
          prose-h2:text-2xl prose-h2:mt-8 prose-h2:mb-4 prose-h2:text-[#00d4aa]
          prose-h3:text-xl prose-h3:mt-6 prose-h3:mb-3
          prose-p:text-gray-300 prose-p:leading-relaxed
          prose-strong:text-white
          prose-a:text-[#006D77] prose-a:no-underline hover:prose-a:underline
          prose-li:text-gray-300
          prose-table:border-collapse
          prose-th:bg-[#1a1a2e] prose-th:text-white prose-th:px-4 prose-th:py-2 prose-th:text-left prose-th:border prose-th:border-white/20
          prose-td:px-4 prose-td:py-2 prose-td:border prose-td:border-white/10 prose-td:text-gray-300
          prose-code:text-[#00d4aa] prose-code:bg-white/5 prose-code:px-1 prose-code:rounded
          prose-blockquote:border-l-[#006D77] prose-blockquote:bg-[#006D77]/5 prose-blockquote:rounded-r-lg prose-blockquote:py-1 prose-blockquote:px-4
        ">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{report}</ReactMarkdown>
        </article>
      </div>
    </div>
  );
}
