import type { Metadata } from "next";
import "./globals.css";
import { Provider } from "jotai";

export const metadata: Metadata = {
  title: "Thoughtful",
  description: "An AI writing assistant that helps you think, not write for you.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full">
        <Provider>{children}</Provider>
      </body>
    </html>
  );
}
