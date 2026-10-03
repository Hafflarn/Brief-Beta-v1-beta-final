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
    <html lang="sv" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem('brief-theme')||'auto';document.documentElement.dataset.theme=t==='auto'?(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):t;}catch(e){}`,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
