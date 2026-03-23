import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BookPilot Internal Admin",
  description: "Internal admin panel for BookPilot operational testing.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
