import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Alpha | 2hr Learning Global Expansion",
  description:
    "Agentic system for generating country/state-specific education partnership proposals",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background`}
      >
        <div className="min-h-screen">
          <header className="sticky top-0 z-50 w-full border-b bg-[#0A1F3C] text-white">
            <div className="container mx-auto flex h-16 items-center px-6">
              <div className="flex items-center gap-3">
                <div className="h-8 w-8 rounded-lg bg-[#D4A537] flex items-center justify-center font-bold text-[#0A1F3C] text-sm">
                  A
                </div>
                <div>
                  <h1 className="text-sm font-semibold tracking-tight">
                    2hr Learning
                  </h1>
                  <p className="text-xs text-slate-300">
                    Global Expansion Pipeline
                  </p>
                </div>
              </div>
            </div>
          </header>
          <main>{children}</main>
        </div>
      </body>
    </html>
  );
}
