import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { product } from "@/web/copy";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: product.name, template: `%s - ${product.name}` },
  description: product.description,
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
