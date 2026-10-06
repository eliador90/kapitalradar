import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans, Source_Serif_4 } from "next/font/google";
import type { ReactNode } from "react";
import { Footer } from "./_components/footer";
import "./globals.css";

const sans = IBM_Plex_Sans({ subsets: ["latin", "latin-ext"], weight: ["400", "600"], variable: "--font-plex-sans", display: "swap" });
const mono = IBM_Plex_Mono({ subsets: ["latin", "latin-ext"], weight: ["400"], variable: "--font-plex-mono", display: "swap" });
const serif = Source_Serif_4({ subsets: ["latin", "latin-ext"], weight: ["400"], variable: "--font-source-serif", display: "swap" });

export const metadata: Metadata = {
  title: "Kapitalradar",
  description: "Swiss capital increases, classified with evidence from the official gazette.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable} ${serif.variable}`}>
      <body>
        <a className="skip" href="#record">
          Skip to the record
        </a>
        <div className="page">
          {children}
          <Footer />
        </div>
      </body>
    </html>
  );
}
