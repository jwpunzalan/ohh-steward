import type { Metadata } from "next";
import { Geist, Geist_Mono, Nunito, Work_Sans } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Story 10.1 — design-system typefaces. Self-hosted and inlined by Next.js's
// build step (no runtime request to Google's CDN, no layout shift).
const nunito = Nunito({
  variable: "--font-nunito",
  subsets: ["latin"],
  weight: ["700", "800"],
});

const workSans = Work_Sans({
  variable: "--font-work-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "OHh Steward",
  description: "Household budgeting that keeps families on the same page.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${nunito.variable} ${workSans.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
