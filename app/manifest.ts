import type { MetadataRoute } from "next";
import { SITE_NAME } from "../lib/site-branding";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: SITE_NAME,
    short_name: SITE_NAME,
    description: "질문과 답을 만들고, 가리거나 직접 쓰며 복습하는 개인 임용 학습장",
    start_url: "/",
    display: "standalone",
    background_color: "#f4f1e8",
    theme_color: "#185b47",
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
