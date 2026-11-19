/* v1.389.0 - line icons for the portfolio card, drawn on a canvas (Path2D, 24 x 24 grid).
   Path data from Lucide v0.469.0 (ISC licence, https://lucide.dev), already a dependency of the
   portal through lucide-react; copied here as path strings so the canvas can stroke them.
   19-11-2026 - every icon regenerated from lucide-react's own files: a piece that began with a
   relative "m" had been joined onto the previous piece, so it was drawn from where that piece ended
   (stray strokes on design, film, handshake, check, mail, YouTube). Each piece now starts absolute. */
export const CARD_ICONS = {
  "video": "M16 13l5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5 M4 6h10a2 2 0 0 1 2 2v8a2 2 0 0 1 -2 2h-10a2 2 0 0 1 -2 -2v-8a2 2 0 0 1 2 -2z",
  "camera": "M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z M9 13a3 3 0 1 0 6 0a3 3 0 1 0 -6 0",
  "layers": "M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12 M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17",
  "megaphone": "M3 11l18-5v12L3 14v-3z M11.6 16.8a3 3 0 1 1-5.8-1.6",
  "design": "M15.707 21.293a1 1 0 0 1-1.414 0l-1.586-1.586a1 1 0 0 1 0-1.414l5.586-5.586a1 1 0 0 1 1.414 0l1.586 1.586a1 1 0 0 1 0 1.414z M18 13l-1.375-6.874a1 1 0 0 0-.746-.776L3.235 2.028a1 1 0 0 0-1.207 1.207L5.35 15.879a1 1 0 0 0 .776.746L13 18 M2.3 2.3l7.286 7.286 M9 11a2 2 0 1 0 4 0a2 2 0 1 0 -4 0",
  "live": "M4.9 19.1C1 15.2 1 8.8 4.9 4.9 M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5 M10 12a2 2 0 1 0 4 0a2 2 0 1 0 -4 0 M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5 M19.1 4.9C23 8.8 23 15.1 19.1 19",
  "growth": "M22 7L13.5 15.5L8.5 10.5L2 17 M16 7L22 7L22 13",
  "team": "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M5 7a4 4 0 1 0 8 0a4 4 0 1 0 -8 0 M22 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75",
  "star": "M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z",
  "shop": "M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z M3 6h18 M16 10a4 4 0 0 1-8 0",
  "briefcase": "M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16 M4 6h16a2 2 0 0 1 2 2v10a2 2 0 0 1 -2 2h-16a2 2 0 0 1 -2 -2v-10a2 2 0 0 1 2 -2z",
  "building": "M6 2h12a2 2 0 0 1 2 2v16a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2v-16a2 2 0 0 1 2 -2z M9 22v-4h6v4 M8 6h.01 M16 6h.01 M12 6h.01 M12 10h.01 M12 14h.01 M16 10h.01 M16 14h.01 M8 10h.01 M8 14h.01",
  "calendar": "M8 2v4 M16 2v4 M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2z M3 10h18",
  "mail": "M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-16a2 2 0 0 1 -2 -2v-12a2 2 0 0 1 2 -2z M22 7l-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7",
  "phone": "M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z",
  "pin": "M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0 M9 10a3 3 0 1 0 6 0a3 3 0 1 0 -6 0",
  "globe": "M2 12a10 10 0 1 0 20 0a10 10 0 1 0 -20 0 M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20 M2 12h20",
  "check": "M2 12a10 10 0 1 0 20 0a10 10 0 1 0 -20 0 M9 12l2 2 4-4",
  "spark": "M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z M20 3v4 M22 5h-4 M4 17v2 M5 18H3",
  "palette": "M13 6.5a.5 .5 0 1 0 1 0a.5 .5 0 1 0 -1 0 M17 10.5a.5 .5 0 1 0 1 0a.5 .5 0 1 0 -1 0 M8 7.5a.5 .5 0 1 0 1 0a.5 .5 0 1 0 -1 0 M6 12.5a.5 .5 0 1 0 1 0a.5 .5 0 1 0 -1 0 M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z",
  "film": "M20.2 6 3 11l-.9-2.4c-.3-1.1.3-2.2 1.3-2.5l13.5-4c1.1-.3 2.2.3 2.5 1.3Z M6.2 5.3l3.1 3.9 M12.4 3.4l3.1 4 M3 11h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z",
  "mic": "M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z M19 10v2a7 7 0 0 1-14 0v-2 M12 19L12 22",
  "chart": "M3 3v16a2 2 0 0 0 2 2h16 M18 17V9 M13 17V5 M8 17v-3",
  "handshake": "M11 17l2 2a1 1 0 1 0 3-3 M14 14l2.5 2.5a1 1 0 1 0 3-3l-3.88-3.88a3 3 0 0 0-4.24 0l-.88.88a1 1 0 1 1-3-3l2.81-2.81a5.79 5.79 0 0 1 7.06-.87l.47.28a2 2 0 0 0 1.42.25L21 4 M21 3l1 11h-2 M3 3 2 14l6.5 6.5a1 1 0 1 0 3-3 M3 4h8",
  "message": "M7.9 20A9 9 0 1 0 4 16.1L2 22Z",
  "content": "M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z M14 2v4a2 2 0 0 0 2 2h4 M10 9H8 M16 13H8 M16 17H8",
  "target": "M2 12a10 10 0 1 0 20 0a10 10 0 1 0 -20 0 M6 12a6 6 0 1 0 12 0a6 6 0 1 0 -12 0 M10 12a2 2 0 1 0 4 0a2 2 0 1 0 -4 0",
  "instagram": "M7 2h10a5 5 0 0 1 5 5v10a5 5 0 0 1 -5 5h-10a5 5 0 0 1 -5 -5v-10a5 5 0 0 1 5 -5z M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z M17.5 6.5L17.51 6.5",
  "facebook": "M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z",
  "youtube": "M2.5 17a24.12 24.12 0 0 1 0-10 2 2 0 0 1 1.4-1.4 49.56 49.56 0 0 1 16.2 0A2 2 0 0 1 21.5 7a24.12 24.12 0 0 1 0 10 2 2 0 0 1-1.4 1.4 49.55 49.55 0 0 1-16.2 0A2 2 0 0 1 2.5 17 M10 15l5-3-5-3z",
  "linkedin": "M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z M2 9h4v12h-4Z M2 4a2 2 0 1 0 4 0a2 2 0 1 0 -4 0",
  "tiktok": "M4 18a4 4 0 1 0 8 0a4 4 0 1 0 -8 0 M12 18V2l7 4",
  "scan": "M3 7V5a2 2 0 0 1 2-2h2 M17 3h2a2 2 0 0 1 2 2v2 M21 17v2a2 2 0 0 1-2 2h-2 M7 21H5a2 2 0 0 1-2-2v-2 M7 12h10",
  "brand": "M6 3h12l4 6-10 13L2 9Z M11 3 8 9l4 13 4-13-3-6 M2 9h20",
  "multimedia": "M10 7.75a.75.75 0 0 1 1.142-.638l3.664 2.249a.75.75 0 0 1 0 1.278l-3.664 2.25a.75.75 0 0 1-1.142-.64z M12 17v4 M8 21h8 M4 3h16a2 2 0 0 1 2 2v10a2 2 0 0 1 -2 2h-16a2 2 0 0 1 -2 -2v-10a2 2 0 0 1 2 -2z",
  "scissors": "M3 6a3 3 0 1 0 6 0a3 3 0 1 0 -6 0 M8.12 8.12 12 12 M20 4 8.12 15.88 M3 18a3 3 0 1 0 6 0a3 3 0 1 0 -6 0 M14.8 14.8 20 20",
  "copywrite": "M12 20h9 M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.854z",
  "images": "M18 22H4a2 2 0 0 1-2-2V6 M22 13l-1.296-1.296a2.41 2.41 0 0 0-3.408 0L11 18 M10 8a2 2 0 1 0 4 0a2 2 0 1 0 -4 0 M8 2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2v-12a2 2 0 0 1 2 -2z",
  "clapper": "M20.2 6 3 11l-.9-2.4c-.3-1.1.3-2.2 1.3-2.5l13.5-4c1.1-.3 2.2.3 2.5 1.3Z M6.2 5.3l3.1 3.9 M12.4 3.4l3.1 4 M3 11h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z",
  "idea": "M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5 M9 18h6 M10 22h4",
  "present": "M2 3h20 M21 3v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V3 M7 21l5-5 5 5",
  "seo": "M3 11a8 8 0 1 0 16 0a8 8 0 1 0 -16 0 M21 21l-4.3-4.3",
  "click": "M14 4.1 12 6 M5.1 8l-2.9-.8 M6 12l-1.9 2 M7.2 2.2 8 5.1 M9.037 9.69a.498.498 0 0 1 .653-.653l11 4.5a.5.5 0 0 1-.074.949l-4.349 1.041a1 1 0 0 0-.74.739l-1.04 4.35a.5.5 0 0 1-.95.074z",
  "cart": "M7 21a1 1 0 1 0 2 0a1 1 0 1 0 -2 0 M18 21a1 1 0 1 0 2 0a1 1 0 1 0 -2 0 M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12",
  "package": "M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z M12 22V12 M3.3 7l7.703 4.734a2 2 0 0 0 1.994 0L20.7 7 M7.5 4.27l9 5.15",
  "truck": "M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2 M15 18H9 M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14 M15 18a2 2 0 1 0 4 0a2 2 0 1 0 -4 0 M5 18a2 2 0 1 0 4 0a2 2 0 1 0 -4 0",
  "headset": "M3 11h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5Zm0 0a9 9 0 1 1 18 0m0 0v5a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3Z M21 16v2a4 4 0 0 1-4 4h-5",
  "calculator": "M6 2h12a2 2 0 0 1 2 2v16a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2v-16a2 2 0 0 1 2 -2z M8 6L16 6 M16 14L16 18 M16 10h.01 M12 10h.01 M8 10h.01 M12 14h.01 M8 14h.01 M12 18h.01 M8 18h.01",
  "wallet": "M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1 M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4",
  "code": "M16 18L22 12L16 6 M8 6L2 12L8 18",
  "mobile": "M7 2h10a2 2 0 0 1 2 2v16a2 2 0 0 1 -2 2h-10a2 2 0 0 1 -2 -2v-16a2 2 0 0 1 2 -2z M12 18h.01",
  "heart": "M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z",
  "share": "M15 5a3 3 0 1 0 6 0a3 3 0 1 0 -6 0 M3 12a3 3 0 1 0 6 0a3 3 0 1 0 -6 0 M15 19a3 3 0 1 0 6 0a3 3 0 1 0 -6 0 M8.59 13.51L15.42 17.49 M15.41 6.51L8.59 10.49",
  "trend": "M22 7L13.5 15.5L8.5 10.5L2 17 M16 7L22 7L22 13",
  "layout": "M4 3h16a1 1 0 0 1 1 1v5a1 1 0 0 1 -1 1h-16a1 1 0 0 1 -1 -1v-5a1 1 0 0 1 1 -1z M4 14h7a1 1 0 0 1 1 1v5a1 1 0 0 1 -1 1h-7a1 1 0 0 1 -1 -1v-5a1 1 0 0 1 1 -1z M17 14h3a1 1 0 0 1 1 1v5a1 1 0 0 1 -1 1h-3a1 1 0 0 1 -1 -1v-5a1 1 0 0 1 1 -1z",
  "type": "M4 7L4 4L20 4L20 7 M9 20L15 20 M12 4L12 20",
  "brush": "M9.06 11.9l8.07-8.06a2.85 2.85 0 1 1 4.03 4.03l-8.06 8.08 M7.07 14.94c-1.66 0-3 1.35-3 3.02 0 1.33-2.5 1.52-2 2.02 1.08 1.1 2.49 2.02 4 2.02 2.2 0 4-1.8 4-4.04a3.01 3.01 0 0 0-3-3.02z",
  "aperture": "M2 12a10 10 0 1 0 20 0a10 10 0 1 0 -20 0 M14.31 8l5.74 9.94 M9.69 8h11.48 M7.38 12l5.74-9.94 M9.69 16 3.95 6.06 M14.31 16H2.83 M16.62 12l-5.74 9.94",
  "clipboard": "M9 2h6a1 1 0 0 1 1 1v2a1 1 0 0 1 -1 1h-6a1 1 0 0 1 -1 -1v-2a1 1 0 0 1 1 -1z M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2 M12 11h4 M12 16h4 M8 11h.01 M8 16h.01",
  "shield": "M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z M9 12l2 2 4-4",
  "languages": "M5 8l6 6 M4 14l6-6 2-3 M2 5h12 M7 2h1 M22 22l-5-10-5 10 M14 18h6",
  "wand": "M21.64 3.64l-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72 M14 7l3 3 M5 6v4 M19 14v4 M10 2v2 M7 8H3 M21 16h-4 M11 3H9",
  "book": "M12 7v14 M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z",
  "school": "M21.42 10.922a1 1 0 0 0-.019-1.838L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.832l8.57 3.908a2 2 0 0 0 1.66 0z M22 10v6 M6 12.5V16a6 3 0 0 0 12 0v-3.5",
  "trophy": "M6 9H4.5a2.5 2.5 0 0 1 0-5H6 M18 9h1.5a2.5 2.5 0 0 0 0-5H18 M4 22h16 M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22 M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22 M18 2H6v7a6 6 0 0 0 12 0V2Z",
} as const;
export type CardIcon = keyof typeof CARD_ICONS;

/* ---------------------------------------------------------------- choosing a specialty's icon
   19-11-2026 (the CEO: "Key specialties require to find correct svc to ensure it is related to it ...
   This should make sure that it is able to check and match it properly").
   A specialty is matched from the MOST SPECIFIC phrase to the most general word, in English and Malay
   ("Video Editing" is editing before it is video; "Multimedia" is never "social media"). Each rule
   lists icons in order of fit; on one card a second specialty that lands on the same rule takes the
   next icon, so two specialties do not share a picture when another fits. A star only when nothing fits. */
type Rule = readonly [RegExp, readonly CardIcon[]];
const RULES: readonly Rule[] = [
  /* phrases first */
  [/\b(video edit|edit(ing)? video|suntingan video|sunting video|post[- ]?production)/, ["clapper", "scissors", "video"]],
  [/\b(photo edit|edit(ing)? photo|retouch|suntingan foto)/, ["images", "camera"]],
  [/\b(motion graphic|animation|animasi|motion design)/, ["wand", "clapper"]],
  [/\b(ui|ux)\b|\b(web ?design|website design|laman web|landing page|user interface)/, ["layout", "code"]],
  [/\b(social media|media sosial|socmed)/, ["share", "message"]],
  [/\b(digital marketing|pemasaran digital|performance marketing|meta ads|facebook ads|tiktok ads|google ads|paid ads|ads\b|iklan)/, ["click", "megaphone"]],
  [/\b(seo|search engine)/, ["seo", "trend"]],
  [/\b(copywrit|copy writing|caption|penulisan|script|skrip|writing)/, ["copywrite", "content"]],
  [/\b(content creat|content|kandungan|pencipta kandungan)/, ["content", "copywrite", "layers"]],
  [/\b(live|host|stream|siaran langsung|hos\b)/, ["live", "mic"]],
  [/\b(multi ?media)/, ["multimedia", "layers"]],
  [/\b(graphic|grafik|layout design|poster|canva|photoshop|illustrator|adobe|figma)/, ["design", "palette", "brush"]],
  [/\b(brand|jenama|penjenamaan|identity|identiti|logo)/, ["brand", "star"]],
  [/\b(typograph|tipografi|font)/, ["type"]],
  [/\b(illustrat|ilustrasi|drawing|lukisan|art\b|seni)/, ["brush", "palette"]],
  [/\b(video|videograph|reel|film|filem)/, ["video", "clapper"]],
  [/\b(photo|foto|camera|kamera|shoot|fotograf)/, ["camera", "aperture"]],
  [/\b(customer service|customer support|khidmat pelanggan|after ?sales|helpdesk)/, ["headset", "message"]],
  [/\b(e-?commerce|shop|store|kedai|marketplace|shopee|lazada|product listing)/, ["cart", "shop"]],
  [/\b(sales|selling|jualan|closing|deal|negotiat|rundingan|leads?\b|lead generation)/, ["growth", "handshake"]],
  [/\b(client|customer|pelanggan|relationship|hubungan|partner)/, ["handshake", "team"]],
  [/\b(logistic|shipping|delivery|penghantaran|courier|kurier)/, ["truck", "package"]],
  [/\b(inventory|stock|stok|packing|pembungkusan|warehouse|gudang)/, ["package", "truck"]],
  [/\b(financ|account|kewangan|perakaunan|payroll|gaji|bookkeep)/, ["calculator", "wallet"]],
  [/\b(budget|bajet|payment|bayaran|collection|kutipan)/, ["wallet", "calculator"]],
  [/\b(data|report|laporan|analy|analisis|insight|kpi)/, ["chart", "trend"]],
  [/\b(strateg|idea|concept|konsep|creative direction|brainstorm)/, ["idea", "spark"]],
  [/\b(present|pitch|pembentangan|training|latihan|workshop|bengkel)/, ["present", "school"]],
  [/\b(teach|education|pendidikan|coach|mentor|tutor)/, ["school", "book"]],
  [/\b(event|acara|majlis|programme|program)/, ["calendar", "spark"]],
  [/\b(project|plan|manag|coordinat|pengurusan|admin|operation|operasi)/, ["clipboard", "target"]],
  [/\b(leader|kepimpinan|supervis|penyelia)/, ["team", "target"]],
  [/\b(hr\b|human resource|recruit|pengambilan|team|people|staff|kakitangan)/, ["team", "handshake"]],
  [/\b(complian|legal|quality|kualiti|audit)/, ["shield", "check"]],
  [/\b(translat|terjemah|language|bahasa)/, ["languages", "book"]],
  [/\b(develop|code|coding|programm|software|it\b)/, ["code", "mobile"]],
  [/\b(mobile|app\b|apps\b|aplikasi)/, ["mobile", "code"]],
  [/\b(engag|community|komuniti|follower)/, ["heart", "share"]],
  [/\b(voice|mc\b|emcee|speak|pengacara|vo\b)/, ["mic", "live"]],
  [/\b(award|achiev|pencapaian|winner)/, ["trophy", "star"]],
  /* the general words last */
  [/\b(marketing|pemasaran|campaign|kempen|promot|advert)/, ["megaphone", "click"]],
  [/\b(design|reka|creative|kreatif)/, ["design", "palette", "brush"]],
  [/\b(media)/, ["multimedia", "share"]],
];

/** the best icon for one specialty (a star when nothing fits) */
export function iconFor(label: string): CardIcon {
  const t = ` ${label.toLowerCase().replace(/[^\p{L}\p{N}&+-]+/gu, " ").trim()} `;
  return RULES.find(([re]) => re.test(t))?.[1][0] ?? "star";
}

/** icons for a card's specialties together: each takes its best fit not already used on the card */
export function iconsFor(labels: readonly string[]): CardIcon[] {
  const used = new Set<CardIcon>();
  return labels.map((label) => {
    const t = ` ${label.toLowerCase().replace(/[^\p{L}\p{N}&+-]+/gu, " ").trim()} `;
    const options = RULES.find(([re]) => re.test(t))?.[1] ?? (["star", "spark", "check"] as const);
    const pick = options.find((o) => !used.has(o)) ?? options[0]!;
    used.add(pick);
    return pick;
  });
}
