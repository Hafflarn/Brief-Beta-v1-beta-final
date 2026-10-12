import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Brief - Keep it brief, get it done.",
  description: "Keep it brief, get it done. Arbetsorder, företag och projekt.",
  other: {
    "brief-source": "Hafflarn/Brief-Beta-v1-beta-final",
    "brief-commit": process.env.NEXT_PUBLIC_APP_COMMIT || "local",
  },
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="sv" data-theme="dark" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem('brief-theme');document.documentElement.dataset.theme=t==='light'?'light':'dark';}catch(e){}`,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
