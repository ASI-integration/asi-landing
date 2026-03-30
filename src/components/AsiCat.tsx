'use client';

interface AsiCatProps {
  mode: 'location' | 'comm';
  size?: number;
  className?: string;
}

export function AsiCat({ mode, size = 80, className = '' }: AsiCatProps) {
  return (
    <div className={`relative inline-flex items-center justify-center ${className}`} style={{ width: size, height: size }}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 80 80"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        {/* Left ear */}
        <polygon
          points="20,32 13,13 30,24"
          fill="#1e293b"
          stroke="#475569"
          strokeWidth="1.2"
          strokeLinejoin="round"
        />
        {/* Right ear */}
        <polygon
          points="60,32 67,13 50,24"
          fill="#1e293b"
          stroke="#475569"
          strokeWidth="1.2"
          strokeLinejoin="round"
        />
        {/* Inner left ear */}
        <polygon points="21,30 16,17 28,24" fill="#312e81" opacity="0.55" />
        {/* Inner right ear */}
        <polygon points="59,30 64,17 52,24" fill="#312e81" opacity="0.55" />

        {/* Head */}
        <rect
          x="14"
          y="26"
          width="52"
          height="40"
          rx="16"
          fill="#1e293b"
          stroke="#334155"
          strokeWidth="1.5"
        />

        {/* Subtle circuit trace on head */}
        <path
          d="M28 30 L28 34 L22 34"
          stroke="#6366f1"
          strokeWidth="0.7"
          strokeLinecap="round"
          opacity="0.3"
        />
        <path
          d="M52 30 L52 34 L58 34"
          stroke="#6366f1"
          strokeWidth="0.7"
          strokeLinecap="round"
          opacity="0.3"
        />

        {/* Eye sockets */}
        <circle cx="30" cy="44" r="6" fill="#0f172a" />
        <circle cx="50" cy="44" r="6" fill="#0f172a" />

        {/* Iris glow */}
        <circle cx="30" cy="44" r="3.5" fill="#6366f1" opacity="0.85">
          <animate attributeName="opacity" values="0.85;0.95;0.85" dur="3s" repeatCount="indefinite" />
        </circle>
        <circle cx="50" cy="44" r="3.5" fill="#6366f1" opacity="0.85">
          <animate attributeName="opacity" values="0.85;0.95;0.85" dur="3s" begin="0.3s" repeatCount="indefinite" />
        </circle>

        {/* Eye highlight */}
        <circle cx="28.5" cy="42.5" r="1.2" fill="white" opacity="0.7" />
        <circle cx="48.5" cy="42.5" r="1.2" fill="white" opacity="0.7" />

        {/* Nose */}
        <ellipse cx="40" cy="53" rx="2" ry="1.3" fill="#6366f1" opacity="0.5" />

        {/* Whiskers left */}
        <line x1="14" y1="51" x2="33" y2="53" stroke="#475569" strokeWidth="0.8" opacity="0.5" />
        <line x1="14" y1="55" x2="33" y2="55" stroke="#475569" strokeWidth="0.8" opacity="0.3" />
        {/* Whiskers right */}
        <line x1="47" y1="53" x2="66" y2="51" stroke="#475569" strokeWidth="0.8" opacity="0.5" />
        <line x1="47" y1="55" x2="66" y2="55" stroke="#475569" strokeWidth="0.8" opacity="0.3" />

        {/* Mode-specific accessory */}
        {mode === 'location' && (
          <g>
            {/* Radar ring around cat */}
            <circle
              cx="40"
              cy="46"
              r="34"
              stroke="#6366f1"
              strokeWidth="0.8"
              strokeDasharray="3 4"
              opacity="0.18"
            />
            <circle
              cx="40"
              cy="46"
              r="26"
              stroke="#6366f1"
              strokeWidth="0.6"
              strokeDasharray="2 5"
              opacity="0.12"
            />
            {/* Small radar dot top-right */}
            <circle cx="62" cy="20" r="3" fill="#6366f1" opacity="0.5">
              <animate attributeName="opacity" values="0.5;0.9;0.5" dur="1.8s" repeatCount="indefinite" />
            </circle>
            <circle cx="62" cy="20" r="5" stroke="#6366f1" strokeWidth="0.8" opacity="0.2">
              <animate attributeName="r" values="5;9;5" dur="1.8s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="0.2;0;0.2" dur="1.8s" repeatCount="indefinite" />
            </circle>
          </g>
        )}

        {mode === 'comm' && (
          <g>
            {/* Chat bubble top-right */}
            <rect x="55" y="10" width="20" height="13" rx="4" fill="#0f172a" stroke="#38bdf8" strokeWidth="0.9" opacity="0.85" />
            <polygon points="60,23 60,27 65,23" fill="#0f172a" stroke="#38bdf8" strokeWidth="0.6" opacity="0.85" />
            {/* Dots inside bubble */}
            <circle cx="61" cy="17" r="1.2" fill="#38bdf8" opacity="0.8">
              <animate attributeName="opacity" values="0.8;0.3;0.8" dur="1.2s" repeatCount="indefinite" />
            </circle>
            <circle cx="65" cy="17" r="1.2" fill="#38bdf8" opacity="0.8">
              <animate attributeName="opacity" values="0.8;0.3;0.8" dur="1.2s" begin="0.4s" repeatCount="indefinite" />
            </circle>
            <circle cx="69" cy="17" r="1.2" fill="#38bdf8" opacity="0.8">
              <animate attributeName="opacity" values="0.8;0.3;0.8" dur="1.2s" begin="0.8s" repeatCount="indefinite" />
            </circle>
            {/* Small headset arc */}
            <path
              d="M18 22 Q18 14 28 14"
              stroke="#38bdf8"
              strokeWidth="1"
              strokeLinecap="round"
              fill="none"
              opacity="0.5"
            />
            <circle cx="18" cy="22" r="2.5" fill="#38bdf8" opacity="0.35" />
          </g>
        )}
      </svg>
    </div>
  );
}
