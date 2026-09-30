import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { AppProvider } from "@/components/AppContext";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "TrustDrive",
  description: "A document drive where every file carries a Jev trust score",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full bg-[#f8fafd] text-slate-800">
        <AppProvider>{children}</AppProvider>
      </body>
    </html>
  );
}
