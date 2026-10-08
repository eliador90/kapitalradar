import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans, IBM_Plex_Sans_Condensed } from "next/font/google";
import type { ReactNode } from "react";
import { Footer } from "./_components/footer";
import "./globals.css";

const sans = IBM_Plex_Sans({ subsets: ["latin", "latin-ext"], weight: ["400", "500", "600"], variable: "--font-plex-sans", display: "swap" });
const mono = IBM_Plex_Mono({ subsets: ["latin", "latin-ext"], weight: ["400", "500", "600"], variable: "--font-plex-mono", display: "swap" });
const condensed = IBM_Plex_Sans_Condensed({ subsets: ["latin", "latin-ext"], weight: ["600", "700"], variable: "--font-plex-condensed", display: "swap" });

export const metadata: Metadata = {
  title: "Kapitalradar",
  description: "Swiss capital increases, classified with evidence from the official gazette.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable} ${condensed.variable}`}>
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
