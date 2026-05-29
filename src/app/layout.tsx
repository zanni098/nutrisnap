import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import "./globals.css";
import { BottomNav } from "@/components/BottomNav";
import { CaptureProvider } from "@/components/CaptureProvider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "NutriSnap — AI Calorie Tracker",
  description:
    "Snap a photo of any meal and instantly get calorie counts, macros, and a full nutritional breakdown powered by AI.",
  applicationName: "NutriSnap",
  appleWebApp: { capable: true, title: "NutriSnap", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: "#16a34a",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${geistSans.variable} h-full`}>
      <body className="min-h-full antialiased">
        <div className="min-h-dvh bg-gradient-to-b from-brand-soft/40 to-background">
          <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col bg-background shadow-xl shadow-black/5 sm:my-0 sm:min-h-dvh">
            <CaptureProvider>
              <main className="flex-1 pb-24">{children}</main>
              <BottomNav />
            </CaptureProvider>
          </div>
        </div>
      </body>
    </html>
  );
}
