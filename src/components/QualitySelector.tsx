import { motion } from 'framer-motion';
import type { Quality, QualityOption } from '../types/saavn';
import { QUALITY_OPTIONS } from '../types/saavn';

interface QualitySelectorProps {
  selected: Quality;
  onChange: (q: Quality) => void;
}

export default function QualitySelector({ selected, onChange }: QualitySelectorProps) {
  return (
    <>
      {/* Mobile: a compact native dropdown so the options don't wrap and eat space */}
      <select
        value={selected}
        onChange={(e) => onChange(e.target.value as Quality)}
        className="sm:hidden w-full px-3 py-2 rounded-lg bg-glass border border-border text-xs font-mono text-text-secondary focus:outline-none focus:border-cyan/40"
        aria-label="Quality"
      >
        {QUALITY_OPTIONS.map((opt: QualityOption) => (
          <option key={opt.value} value={opt.value} className="bg-void text-text-primary">
            {opt.label}{opt.tag ? ` — ${opt.tag}` : ''}
          </option>
        ))}
      </select>

      {/* Desktop: the pill buttons */}
      <div className="hidden sm:flex items-center gap-1.5 flex-wrap">
        {QUALITY_OPTIONS.map((opt: QualityOption) => {
          const isSelected = opt.value === selected;
          return (
            <motion.button
              key={opt.value}
              onClick={() => onChange(opt.value)}
              whileTap={{ scale: 0.95 }}
              className={`relative flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-mono transition-all duration-150 ${isSelected
                ? 'text-void bg-cyan shadow-glow'
                : 'text-text-secondary bg-glass border border-border hover:border-cyan/30 hover:text-cyan'
                }`}
            >
              {opt.label}
              {opt.tag && (
                <span
                  className={`text-[9px] font-display font-bold leading-none px-1 py-0.5 rounded ${isSelected ? 'bg-void/20 text-void' : 'bg-cyan/10 text-cyan'
                    }`}
                >
                  {opt.tag}
                </span>
              )}
            </motion.button>
          );
        })}
      </div>
    </>
  );
}
