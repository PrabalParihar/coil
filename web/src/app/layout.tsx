import { deployment, selectedChain } from "@/lib/network";
import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import { Providers } from "./providers";
import "./globals.css";

const geist = Geist({
  variable: "--font-geist",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://coil.up.railway.app"),
  title: "Coil Labs: Leverage your BTC in one transaction.",
  description:
    "Deposit BTC. Coil borrows against it, buys more BTC, and posts that BTC back before the transaction ends. A keeper can only reduce risk. Mezo testnet. Not audited.",
  openGraph: {
    title: "Coil Labs: Leverage your BTC in one transaction.",
    description: `One-transaction BTC leverage on MUSD. A keeper can only reduce risk. ${selectedChain.name}: ${deployment.status} deployment. Not audited.`,
    url: "https://coil.up.railway.app",
    siteName: "Coil Labs",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Coil Labs: Leverage your BTC in one transaction.",
    description: `One-transaction BTC leverage on MUSD. A keeper can only reduce risk. ${selectedChain.name}: ${deployment.status} deployment. Not audited.`,
  },
};

export const viewport: Viewport = {
  themeColor: "#0b0a09",
  colorScheme: "dark",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`dark ${geist.variable}`}>
      <body className="min-h-screen antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
