import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import { Providers } from "./providers";
import "./globals.css";

const geist = Geist({
  variable: "--font-geist",
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
  metadataBase: new URL("https://coil.up.railway.app"),
  title: "Coil — one-click BTC leverage on Mezo",
  description:
    "Loop Bitcoin on Mezo in one transaction. Coil borrows MUSD against your BTC, buys more BTC on Mezo Pools, and posts it back as collateral at the ratio you pick.",
  openGraph: {
    title: "Coil — one-click BTC leverage on Mezo",
    description: "Borrow MUSD, buy BTC on Mezo Pools, post it back. One transaction, at the collateral ratio you pick. Live on Mezo testnet.",
    url: "https://coil.up.railway.app",
    siteName: "Coil",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Coil — one-click BTC leverage on Mezo",
    description: "Borrow MUSD, buy BTC on Mezo Pools, post it back. One transaction. Live on Mezo testnet.",
  },
};

export const viewport: Viewport = {
  themeColor: "#0b0a09",
  colorScheme: "dark",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`dark ${geist.variable} ${instrumentSerif.variable} ${mono.variable}`}>
      <body className="min-h-screen antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
