import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "2hr Learning — Partnership Portal",
  description: "Generate your customized term sheet and partnership proposal",
};

export default function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
