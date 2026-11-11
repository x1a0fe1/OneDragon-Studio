/** 线条图标（自绘，24×24 网格，描边用 currentColor）。 */
const PATHS: Record<string, string> = {
  home: "M4 11 12 4l8 7M6 9.5V20h4.5v-5h3v5H18V9.5",
  film: "M4 5h16v14H4zM8 5v14M16 5v14M4 9h4M4 15h4M16 9h4M16 15h4",
  box: "M12 3 20 7.5v9L12 21l-8-4.5v-9zM4 7.5 12 12l8-4.5M12 12v9",
  list: "M9 6h11M9 12h11M9 18h11M4.5 5.5l1 1 1.8-2M4.5 11.5l1 1 1.8-2M4.5 17.5l1 1 1.8-2",
  prompt: "M6 3h9l4 4v14H6zM15 3v4h4M9 11h7M9 15h7M9 19h4",
  log: "M5 4h11a3 3 0 0 1 0 6H5zM5 10v10h12M9 14h5M9 17h3",
  gear: "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1",
  chevronLeft: "M15 5l-7 7 7 7",
  chevronRight: "M9 5l7 7-7 7",
  menu: "M4 7h16M4 12h16M4 17h16",
  book: "M4 5.5C6.5 4 9.5 4 12 6c2.5-2 5.5-2 8-.5V19c-2.5-1.5-5.5-1.5-8 .5-2.5-2-5.5-2-8-.5zM12 6v13.5",
  sparkle: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM18.5 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z",
  user: "M12 4a4 4 0 1 1 0 8 4 4 0 0 1 0-8zM4.5 20.5c.8-4 3.8-6 7.5-6s6.7 2 7.5 6",
  image: "M4 5h16v14H4zM4 16l4.5-4.5 3.5 3.5 2.5-2.5L20 17M15.5 8.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z",
  video: "M3.5 6.5h12v11h-12zM15.5 10.5l5-3v9l-5-3",
  mic: "M12 3.5a2.8 2.8 0 0 1 2.8 2.8v5.4a2.8 2.8 0 0 1-5.6 0V6.3A2.8 2.8 0 0 1 12 3.5zM6 11.5a6 6 0 0 0 12 0M12 17.5v3M9 20.5h6",
  captions: "M3.5 5.5h17v13h-17zM7 13h3.5M12.5 13H17M7 15.8h6M15 15.8h2",
  check: "M5 12.5l4.5 4.5L19 7.5",
  x: "M6 6l12 12M18 6 6 18",
  alert: "M12 4 21 19.5H3zM12 10v4.5M12 17v.5",
  refresh: "M19.5 8.5A8 8 0 0 0 5 9M4.5 15.5A8 8 0 0 0 19 15M19.5 4v4.5H15M4.5 20v-4.5H9",
  arrowRight: "M5 12h14M13 6l6 6-6 6",
  cpu: "M7 7h10v10H7zM10 10h4v4h-4zM9.5 3.5V7M14.5 3.5V7M9.5 17v3.5M14.5 17v3.5M3.5 9.5H7M3.5 14.5H7M17 9.5h3.5M17 14.5h3.5",
  wand: "M4 20 15 9M13 7l4 4M17.5 3v3M16 4.5h3M20.5 8v2.5M19.2 9.2h2.6",
};

export type IconName = keyof typeof PATHS;

export default function Icon({ name, size = 20, className }: { name: IconName | string; size?: number; className?: string }) {
  return (
    <svg className={`icon ${className ?? ""}`} width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name] ?? ""} />
    </svg>
  );
}
