export const metadata = {
  title: "Better Auth POC",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "sans-serif" }} suppressHydrationWarning>{children}</body>
    </html>
  );
}
