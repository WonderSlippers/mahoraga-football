import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "边线 EDGE｜足球赛事实时决策台",
  description: "近实时比分、公开赔率、可审计模拟策略、逐日盈亏和资金曲线。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">{children}</body>
    </html>
  );
}
