import type { Metadata, Viewport } from "next";
import { SITE_NAME } from "../lib/site-branding";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://teacher-study-cards.seungbeen.chatgpt.site"),
  title: SITE_NAME,
  applicationName: SITE_NAME,
  description: "질문과 답을 만들고, 가리거나 직접 쓰며 복습하는 개인 임용 학습장",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    shortcut: "/favicon.svg",
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: {
    capable: true,
    title: SITE_NAME,
    statusBarStyle: "default",
  },
  openGraph: {
    type: "website",
    locale: "ko_KR",
    url: "/",
    siteName: SITE_NAME,
    title: SITE_NAME,
    description: "질문과 답을 만들고 복습하는 개인 임용 학습장",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "네잎클로버와 합격 임용 학습장" }],
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_NAME,
    description: "질문과 답을 만들고 복습하는 개인 임용 학습장",
    images: ["/og.png"],
  },
};

export const viewport: Viewport = {
  themeColor: "#185b47",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body className="antialiased">{children}</body>
    </html>
  );
}
