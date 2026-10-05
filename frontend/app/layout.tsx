import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Cloud Auto Scaling',
  description: 'Self-hosted AWS-compatible Auto Scaling simulator',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-900 dark:text-slate-100 antialiased">
        {children}
      </body>
    </html>
  );
}
