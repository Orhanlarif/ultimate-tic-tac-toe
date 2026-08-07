import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import type { Metadata, Viewport } from "next";
import { Inter, Outfit } from "next/font/google";
import { ChallengeToast } from "@/components/ChallengeToast";
import { Providers } from "@/components/Providers";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import "./globals.css";

const bodyFont = Inter({
  subsets: ["latin", "latin-ext"],
  variable: "--font-body",
  display: "swap",
});

const displayFont = Outfit({
  subsets: ["latin", "latin-ext"],
  variable: "--font-display",
  display: "swap",
});

const siteUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
const description =
  "Competitive Ultimate Tic Tac Toe: ranked matchmaking, private rooms, bots and same-device play.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "Ultimate Tic Tac Toe",
    template: "%s · Ultimate Tic Tac Toe",
  },
  applicationName: "Ultimate Tic Tac Toe",
  description,
  icons: {
    icon: "/favicon.svg",
  },
  // Room invites are shared as links, so they need to unfurl properly.
  openGraph: {
    type: "website",
    siteName: "Ultimate Tic Tac Toe",
    title: "Ultimate Tic Tac Toe",
    description,
    url: siteUrl,
  },
  twitter: {
    card: "summary",
    title: "Ultimate Tic Tac Toe",
    description,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Lets the layout reach under the notch; the shell re-pads with safe areas.
  viewportFit: "cover",
  themeColor: "#eef2fa",
  colorScheme: "light",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = await getLocale();
  const messages = await getMessages();

  return (
    <html lang={locale} className={`${bodyFont.variable} ${displayFont.variable}`}>
      <body>
        <Providers>
          <NextIntlClientProvider messages={messages}>
            <div className="app-shell">
              <SiteHeader />
              <main className="main-content">{children}</main>
              <SiteFooter />
              <ChallengeToast />
            </div>
          </NextIntlClientProvider>
        </Providers>
      </body>
    </html>
  );
}
