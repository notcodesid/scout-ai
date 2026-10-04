import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "how to get hired — the scout's thesis",
  description: "how to get hired — the scout's thesis",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
      </body>
    </html>
  );
}
