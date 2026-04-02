import './globals.css';
import Navbar from '@/components/Navbar';
import ErrorBoundary from '@/components/ErrorBoundary';
import AuthProvider from '@/components/AuthProvider';

export const metadata = {
  title: 'TrustReply — Questionnaire Response Automation',
  description:
    'TrustReply auto-fills questionnaire documents using a Q&A knowledge base with semantic matching. Upload .docx or .pdf files and get completed responses instantly.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <AuthProvider>
        <Navbar />
        <main><ErrorBoundary>{children}</ErrorBoundary></main>
        <footer className="app-footer">
          Built with TrustReply &mdash; Questionnaire Response Automation
        </footer>
        </AuthProvider>
      </body>
    </html>
  );
}
