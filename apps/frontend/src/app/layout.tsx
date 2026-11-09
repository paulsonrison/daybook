import type { Metadata } from 'next';
import '@daybook/ui/fonts.css';
import '@daybook/ui/styles.css';
import './globals.css';
export const metadata: Metadata = {
  title: 'Daybook | Agency workspace',
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
