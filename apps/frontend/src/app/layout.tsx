import type { Metadata } from 'next';
import '@daybook/ui/styles.css';
import './globals.css';
export const metadata: Metadata = {
  title: 'Daybook | Project Foundation',
  description: 'Newspaper agency management workspace',
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
