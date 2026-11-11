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
    "Coil borrows MUSD against your bitcoin, buys more BTC on Mezo Pools and posts it back, all in one transaction, inside an account only you control. Mezo testnet. The contracts are not audited.",
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
