import { PwaRegistration } from '../features/field/registration';
import type { Metadata, Viewport } from 'next';
import '@daybook/ui/fonts.css';
import '@daybook/ui/styles.css';
import './globals.css';
export const viewport: Viewport = { themeColor: '#087f73' };
export const metadata: Metadata = {
  title: 'Daybook | Agency workspace',
  description: 'Newspaper agency management workspace',
  appleWebApp: { capable: true, title: 'Daybook', statusBarStyle: 'default' },
  icons: { apple: '/pwa/icon-192.png' },
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <PwaRegistration />
        {process.env.DAYBOOK_PREVIEW === 'true' ? (
          <p className="preview-notice" role="note">
            Daybook preview · Use test data. Some project features are still
            being completed.
          </p>
        ) : null}
        {children}
      </body>
    </html>
  );
}
