/**
 * Decorative animated illustration of "trajectories between places".
 * Abstract shapes only: it is not a map and contains no real or synthetic data.
 */
const NODES = [
  { x: 70, y: 300, r: 7 },
  { x: 180, y: 120, r: 9 },
  { x: 300, y: 250, r: 12 },
  { x: 430, y: 90, r: 8 },
  { x: 470, y: 330, r: 10 },
  { x: 250, y: 400, r: 6 },
]
const PATHS = [
  'M70 300 C 120 220, 140 160, 180 120',
  'M180 120 C 230 150, 260 200, 300 250',
  'M300 250 C 350 190, 390 130, 430 90',
  'M300 250 C 360 290, 420 300, 470 330',
  'M70 300 C 140 360, 200 400, 250 400',
  'M250 400 C 300 380, 300 310, 300 250',
  'M430 90 C 480 170, 490 260, 470 330',
]

export default function HeroGraphic() {
  return (
    <div className="relative aspect-[5/4] w-full">
      <div aria-hidden className="absolute inset-[15%] rounded-full bg-brand opacity-[0.08] blur-[80px]" />
      <svg viewBox="0 0 540 470" className="relative h-full w-full" role="img" aria-label="Illustration: movement paths between campus places">
        <defs>
          <radialGradient id="node-glow">
            <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.55" />
            <stop offset="100%" stopColor="#f59e0b" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="path-grad" x1="0" x2="1">
            <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.15" />
            <stop offset="50%" stopColor="#f59e0b" stopOpacity="0.7" />
            <stop offset="100%" stopColor="#fafafa" stopOpacity="0.25" />
          </linearGradient>
          <filter id="soft-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        {/* faint background grid */}
        {Array.from({ length: 12 }, (_, i) => (
          <line key={`v${i}`} x1={i * 45} y1="0" x2={i * 45} y2="470" stroke="#fff" strokeOpacity="0.03" />
        ))}
        {Array.from({ length: 11 }, (_, i) => (
          <line key={`h${i}`} x1="0" y1={i * 45} x2="540" y2={i * 45} stroke="#fff" strokeOpacity="0.03" />
        ))}

        {PATHS.map((d, i) => (
          <path
            key={d}
            id={`hp${i}`}
            d={d}
            fill="none"
            stroke="url(#path-grad)"
            strokeWidth={i < 3 ? 2.5 : 1.5}
            strokeLinecap="round"
            className="animate-draw"
            style={{ strokeDasharray: 400, '--len': 400, animationDelay: `${i * 220}ms` }}
          />
        ))}

        {NODES.map((n, i) => (
          <g key={i}>
            <circle cx={n.x} cy={n.y} r={n.r * 4} fill="url(#node-glow)" />
            <circle cx={n.x} cy={n.y} r={n.r} fill="#12121a" stroke="#f59e0b" strokeOpacity="0.8" strokeWidth="1.5" />
            <circle cx={n.x} cy={n.y} r={n.r * 0.4} fill="#fafafa" />
          </g>
        ))}

        {/* travellers moving along the paths */}
        {[0, 1, 2, 3, 4, 6].map((p, i) => (
          <circle key={p} r="3.5" fill="#fbbf24" filter="url(#soft-glow)">
            {/* Negative begin = already partway along the path, so no dot ever sits at the SVG origin. */}
            <animateMotion dur={`${5 + i * 1.3}s`} begin={`${-i * 1.7}s`} repeatCount="indefinite" rotate="auto">
              <mpath href={`#hp${p}`} />
            </animateMotion>
          </circle>
        ))}
      </svg>
      <span className="absolute bottom-1 right-2 font-mono text-[10px] uppercase tracking-[0.14em] text-faint">Illustration</span>
    </div>
  )
}
