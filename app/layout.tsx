import type { Metadata } from "next";
import { Geist_Mono } from "next/font/google";
import "./globals.css";

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "how to get hired — the scout's thesis",
  description:
    "the scout's thesis on getting hired: evidence over promises, depth over breadth, proof over performance.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col font-mono bg-white text-zinc-900 selection:bg-zinc-200 selection:text-black">
        {children}
      </body>
    </html>
  );
}
