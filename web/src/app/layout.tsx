import type { Metadata } from "next";
import { Fraunces, Outfit } from "next/font/google";
import { Providers } from "./providers";
import "./globals.css";

const outfit = Outfit({
  variable: "--font-outfit",
  subsets: ["latin"],
});

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Coil — BTC leverage on MUSD",
  description:
    "Loop Bitcoin on Mezo. One transaction borrows MUSD, swaps it to BTC, and posts that BTC back as collateral.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`dark ${outfit.variable} ${fraunces.variable}`}>
      <body className="min-h-screen antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
