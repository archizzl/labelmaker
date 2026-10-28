import type { Metadata } from "next";
import { Atkinson_Hyperlegible_Next } from "next/font/google";
import "./globals.css";

// The Braille Institute's typeface, built so similar letters and numbers (1 l I, 0 O) can't be mixed up.
const atkinson = Atkinson_Hyperlegible_Next({
  subsets: ["latin", "latin-ext"],
  variable: "--font-atkinson",
  fallback: ["Helvetica Neue", "Arial", "sans-serif"],
});

export const metadata: Metadata = {
  // Each page names itself: "labelmaker - orders".
  title: { template: "labelmaker - %s", default: "labelmaker" },
  description: "Run your indie label: split earnings between bands and members, pay everyone out, and ship your merch.",
  // A private app: keep it out of search engines.
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`h-full antialiased ${atkinson.variable}`}>
      <body className="flex min-h-full flex-col font-sans text-[14px]">{children}</body>
    </html>
  );
}
