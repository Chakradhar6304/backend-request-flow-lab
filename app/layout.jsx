import "./globals.css";

export const metadata = {
  title: "Backend Request Flow Lab",
  description: "Interactive request tracing and troubleshooting for the application backend flow."
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
