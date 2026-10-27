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
  title: "Coil Labs — BTC leverage on Mezo",
  description:
    "One-transaction BTC leverage on MUSD. Coil Labs borrows with a Mezo Pools flash swap and posts the BTC back at the ratio you pick. A keeper can only make the position safer, and earns MEZO when it does.",
  openGraph: {
    title: "Coil Labs — BTC leverage on Mezo",
    description: "Flash-swap leverage on MUSD. A keeper can only make the position safer, paid in MEZO. Live on Mezo testnet.",
    url: "https://coil.up.railway.app",
    siteName: "Coil Labs",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Coil Labs — BTC leverage on Mezo",
    description: "Flash-swap leverage on MUSD. A keeper can only make the position safer, paid in MEZO. Live on Mezo testnet.",
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
