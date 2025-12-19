import type { Metadata } from 'next';
import { Provider } from 'jotai';
import './globals.css';

export const metadata: Metadata = {
  title: 'Writing Tools - AI-Powered Writing Assistant',
  description: 'AI-powered writing assistance integrated with Microsoft Word',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <Provider>{children}</Provider>
      </body>
    </html>
  );
}
