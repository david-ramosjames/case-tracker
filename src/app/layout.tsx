import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Ramos James Law Case Tracker",
  description: "Ramos James Law case pipeline, forecasting, goals, and data quality tracker.",
  // Client names are often Spanish; ask Chrome/Google not to auto-translate the app UI.
  other: {
    google: "notranslate",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" translate="no" className="notranslate">
      <body className={`${inter.className} notranslate`}>{children}</body>
    </html>
  );
}
