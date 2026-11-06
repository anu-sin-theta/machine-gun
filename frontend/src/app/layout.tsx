import type { Metadata } from "next";
import { Bricolage_Grotesque, DM_Sans } from "next/font/google";
import "./globals.css";

const bricolage = Bricolage_Grotesque({
  variable: "--font-bricolage",
  subsets: ["latin"],
  weight: ["700", "800"],
});

const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
});

export const metadata: Metadata = {
  title: "Kavach — Pay bills that actually stay safe",
  description:
    "The friendly payment agent that checks every bill, link, and invoice for scams before it pays.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${bricolage.variable} ${dmSans.variable} antialiased`}
    >
      <body
        suppressHydrationWarning
        className="min-h-screen overflow-x-hidden bg-[#f5efe2] text-[#17140d]"
      >
        {children}
      </body>
    </html>
  );
}
