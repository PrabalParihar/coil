import type { Metadata, Viewport } from "next";
import { Geist_Mono, Instrument_Sans, Instrument_Serif } from "next/font/google";
import { Providers } from "./providers";
import "./globals.css";

const instrument = Instrument_Sans({
  variable: "--font-instrument",
  subsets: ["latin"],
});

const instrumentSerif = Instrument_Serif({
  variable: "--font-instrument-serif",
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
});

const mono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Coil — BTC leverage on MUSD",
  description:
    "Loop Bitcoin on Mezo. One transaction borrows MUSD, swaps it to BTC, and posts that BTC back as collateral.",
};

export const viewport: Viewport = {
  themeColor: "#090807",
  colorScheme: "dark",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`dark ${instrument.variable} ${instrumentSerif.variable} ${mono.variable}`}
    >
      <body className="min-h-screen antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
