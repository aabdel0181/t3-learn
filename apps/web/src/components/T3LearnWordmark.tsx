import type { SVGProps } from "react";

import { T3Wordmark } from "./T3Wordmark";

// The viewBox spans the letters like T3Wordmark's, so the same height classes size them; the cap rises above it.
export function T3LearnWordmark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      viewBox="15.5309 37 111 56.96"
      overflow="visible"
      xmlns="http://www.w3.org/2000/svg"
    >
      <T3Wordmark x={15.5309} y={37} width={94.3941} height={56.96} />
      <g
        fill="currentColor"
        stroke="currentColor"
        transform="scale(0.151515) translate(-84.18 -173.43)"
      >
        <path
          d="M-112 0V-96H112V0Q0 18-112 0ZM-225-116 0-24 225-116V-92L0 0-225-92ZM-225-116 0-208 225-116 0-24Z"
          strokeWidth={22}
          strokeLinejoin="round"
          transform="translate(663.66 369.63) rotate(12)"
        />
        <path d="M893.54 302.97V392.97" strokeWidth={10} strokeLinecap="round" />
        <path d="M880.54 386.97H906.54L917.54 464.97Q893.54 474.97 869.54 464.97Z" stroke="none" />
        <circle cx={893.54} cy={386.97} r={14} stroke="none" />
      </g>
    </svg>
  );
}
