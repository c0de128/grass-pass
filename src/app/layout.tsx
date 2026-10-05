import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Grass Pass: your ticket to get outside",
  description:
    "Pick a park, print a pass, put the phone away. A printable scavenger pass built from real, dated data about that park.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
