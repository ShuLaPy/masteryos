import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import Providers from "@/components/providers";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "MasteryOS — AI-Powered Learning OS",
    template: "%s | MasteryOS",
  },
  description:
    "Your AI-powered personal learning operating system for AIML and DSA mastery. Track progress, review with spaced repetition, and reach expert level.",
  keywords: ["DSA", "AIML", "learning", "spaced repetition", "FSRS", "machine learning"],
  openGraph: {
    title: "MasteryOS",
    description: "From beginner to master — one day at a time.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${inter.variable} dark`} suppressHydrationWarning>
      <body suppressHydrationWarning>
        <Providers>
          {children}
          <Toaster richColors position="top-right" />
        </Providers>
      </body>
    </html>
  );
}
