/** Pod 页面用的线条图标，颜色跟随文字颜色。 */

const PATHS: Readonly<Record<string, string>> = {
  overview: 'M4 5h7v6H4zM13 5h7v4h-7zM13 11h7v8h-7zM4 13h7v6H4z',
  chat: 'M5 6h14v9H9l-4 3z',
  tasks: 'M5 6h14M5 12h14M5 18h9M3 6h.01M3 12h.01M3 18h.01',
  inbox: 'M4 13l2-7h12l2 7v5H4zM4 13h5l1 2h4l1-2h5',
  bots: 'M8 9h8v8H8zM12 5v4M9 13h.01M15 13h.01M6 12H4M20 12h-2',
  settings: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM19 12l2-1-1-3-2 .2-1.3-1.4.4-2-3-1-1 1.8h-1.6L10.5 3l-3 1 .4 2-1.3 1.4L4.5 7.2l-1 3 2 1v1.6l-2 1 1 3 2-.2 1.3 1.4-.4 2 3 1 1-1.8h1.6l1 1.8 3-1-.4-2 1.3-1.4 2 .2 1-3-2-1z',
  plus: 'M12 5v14M5 12h14',
  send: 'M4 12l16-7-6 16-3-6z',
  stop: 'M7 7h10v10H7z',
  pause: 'M8 6v12M16 6v12',
  play: 'M8 5l11 7-11 7z',
  close: 'M6 6l12 12M18 6L6 18',
  open: 'M14 5h5v5M19 5l-8 8M18 14v5H5V6h5',
  pin: 'M9 4h6l-1 6 3 3H7l3-3zM12 13v7',
  reply: 'M10 8L5 12l5 4M5 12h9a5 5 0 0 1 5 5',
  history: 'M4 12a8 8 0 1 0 2.3-5.7M4 4v4h4M12 8v4l3 2',
  restore: 'M5 10a7 7 0 1 1 2 7M5 5v5h5',
  search: 'M11 5a6 6 0 1 0 0 12 6 6 0 0 0 0-12zM20 20l-4.3-4.3',
  check: 'M5 12l4 4 10-10',
  dot: 'M12 11a1 1 0 1 0 0 2 1 1 0 0 0 0-2z',
  file: 'M7 4h7l4 4v12H7zM14 4v4h4',
  team: 'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3 19a6 6 0 0 1 12 0M16 11a3 3 0 1 0 0-6M17 13a5 5 0 0 1 4 6',
  browser: 'M4 5h16v14H4zM4 9h16M7 7h.01M10 7h.01',
  memory: 'M7 4h10v16l-5-3-5 3z',
  bell: 'M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 20h4',
  routine: 'M12 6v6l4 2M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z',
  back: 'M15 6l-6 6 6 6',
  forward: 'M9 6l6 6-6 6',
  refresh: 'M19 12a7 7 0 1 1-2-5M19 5v4h-4',
  copy: 'M8 8h11v12H8zM5 16V4h11',
  select: 'M9 4h6M9 20h6M12 4v16',
  image: 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15 9h.01',
  shield: 'M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6z',
  up: 'M7 11v9H4v-9zM7 11l4-7c1.5 0 2.5 1 2.2 2.6L12.5 10H18a2 2 0 0 1 2 2.3l-1 6A2 2 0 0 1 17 20H7',
  down: 'M7 13V4H4v9zM7 13l4 7c1.5 0 2.5-1 2.2-2.6L12.5 14H18a2 2 0 0 0 2-2.3l-1-6A2 2 0 0 0 17 4H7',
  sparkle: 'M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  sidebar: 'M4 5h16v14H4zM9 5v14',
  edit: 'M4 20h4L19 9l-4-4L4 16zM13 7l4 4',
  trash: 'M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12',
  usage: 'M5 19v-7M10 19V6M15 19v-5M20 19V9',
  at: 'M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0zM16 12v1.5a2.5 2.5 0 0 0 5 0V12a9 9 0 1 0-3.6 7.2',
  upload: 'M12 16V4M7 9l5-5 5 5M5 20h14',
  folder: 'M4 6h6l2 2h8v10H4z',
  move: 'M4 6h6l2 2h8v10H4zM10 13h6M14 11l2 2-2 2',
  archive: 'M4 5h16v4H4zM5 9v10h14V9M10 13h4',
  unpin: 'M9 4h6l-1 6 3 3H7l3-3zM12 13v7M4 4l16 16',
  compose: 'M12 5H6a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-6M17.5 3.5l3 3L13 14h-3v-3z',
  incognito: 'M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.4 5.2A9.8 9.8 0 0 1 12 5c5 0 9 5 9 7a10.6 10.6 0 0 1-2.4 3.4M6.2 6.3C4.2 7.7 3 9.6 3 12c0 2 4 7 9 7a9.6 9.6 0 0 0 4.3-1',
  expand: 'M6 9l6 6 6-6',
  'arrow-down': 'M12 5v14M6 13l6 6 6-6',
  'add-member': 'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3 19a6 6 0 0 1 12 0M19 8v6M16 11h6',
  page: 'M4 4h16v16H4zM4 9h16M10 9v11',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  'kind-report': 'M7 4h7l4 4v12H7zM14 4v4h4M10 12h5M10 15.5h5',
  'kind-dashboard': 'M4 5h7v6H4zM13 5h7v4h-7zM13 11h7v8h-7zM4 13h7v6H4z',
  'kind-tracker': 'M4 5h16v14H4zM4 10h16M4 14.5h16M9 5v14',
  'kind-prototype': 'M8 3h8a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM11 18h2',
  'kind-slides': 'M3 5h18M5 5v10h14V5M12 15v4M9 21l3-2 3 2',
  'kind-poster': 'M6 3h12v18H6zM6 15l4-4 3 3 2-2 3 3M14.5 7.5h.01',
  'kind-diagram': 'M4 4h6v5H4zM14 15h6v5h-6zM7 9v4a2 2 0 0 0 2 2h5',
}

export type IconName = keyof typeof PATHS

export function Icon(props: { readonly name: string; readonly size?: number; readonly title?: string }) {
  const size = props.size ?? 16
  return (
    <svg
      className="pod-icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props.title === undefined ? true : undefined}
      role={props.title === undefined ? undefined : 'img'}
    >
      {props.title === undefined ? null : <title>{props.title}</title>}
      <path d={PATHS[props.name] ?? PATHS.dot} />
    </svg>
  )
}
