export const metadata = {
  title: 'Translation Agent - API Doc Translator',
  description: 'Chinese to English API documentation translation with TM and Glossary',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: '#ffffff' }}>{children}</body>
    </html>
  );
}
