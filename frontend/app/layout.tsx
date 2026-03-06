import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "VideoAI — Plateforme de montage",
  description: "Créez des vidéos professionnelles avec l'IA",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body className="min-h-screen bg-[#09090f] text-white">
        {children}
      </body>
    </html>
  );
}
