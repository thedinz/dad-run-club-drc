import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Dad Run Club",
  description: "Dad Run Club Plymouth"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
