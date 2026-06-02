import { useState, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { isSaavnUrl } from '../types/saavn';

interface SearchBarProps {
  onUrlFetch: (url: string) => void;
  onSearch: (query: string) => void;
  isLoading: boolean;
}

type InputMode = 'empty' | 'url' | 'query';

function getMode(value: string): InputMode {
  if (!value.trim()) return 'empty';
  if (isSaavnUrl(value)) return 'url';
  return 'query';
}

export default function SearchBar({ onUrlFetch, onSearch, isLoading }: SearchBarProps) {
  const [value, setValue] = useState('');
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const mode = getMode(value);

  const handleSubmit = useCallback(() => {
    if (isLoading || !value.trim()) return;
    if (mode === 'url') {
      onUrlFetch(value.trim());
    } else if (mode === 'query') {
      onSearch(value.trim());
    }
  }, [isLoading, value, mode, onUrlFetch, onSearch]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') handleSubmit();
  };

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) return;
      setValue(text.trim());
      if (isSaavnUrl(text.trim())) {
        setTimeout(() => onUrlFetch(text.trim()), 80);
      }
    } catch { /* clipboard not available */ }
  };

  const clear = () => {
    setValue('');
    inputRef.current?.focus();
  };

  // Button label + icon
  const btnLabel = mode === 'url' ? 'Fetch' : 'Search';
  const btnActive = mode !== 'empty' && !isLoading;

  // Border glow colour based on mode
  const glowColor =
    focused && mode === 'url'
      ? '0 0 0 1px rgba(0,212,255,0.45), 0 0 24px rgba(0,212,255,0.1)'
      : focused
      ? '0 0 0 1px rgba(3, 252, 244,0.45), 0 0 24px rgba(139,107,255,0.08)'
      : '0 0 0 1px rgba(255,255,255,0.06)';

  return (
    <div className="w-full space-y-2">
      <motion.div
        animate={{ boxShadow: glowColor }}
        transition={{ duration: 0.2 }}
        className="relative flex items-center bg-glass rounded-2xl overflow-hidden"
      >
        {/* Left icon — changes based on mode */}
        <div className="pl-4 pr-2.5 flex-shrink-0 text-text-muted">
          <AnimatePresence mode="wait" initial={false}>
            {mode === 'url' ? (
              <motion.span key="link" initial={{ opacity: 0, scale: 0.7 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.7 }} transition={{ duration: 0.15 }}>
                <LinkIcon />
              </motion.span>
            ) : (
              <motion.span key="search" initial={{ opacity: 0, scale: 0.7 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.7 }} transition={{ duration: 0.15 }}>
                <SearchIcon />
              </motion.span>
            )}
          </AnimatePresence>
        </div>

        {/* Input */}
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={handleKeyDown}
          placeholder="Paste a JioSaavn link or search for a song…"
          className="flex-1 bg-transparent py-4 pr-2 text-sm font-body text-text-primary placeholder:text-text-muted outline-none min-w-0"
          autoComplete="off"
          spellCheck={false}
        />

        {/* Paste shortcut — only when empty */}
        {mode === 'empty' && (
          <motion.button
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={handlePaste}
            className="flex-shrink-0 mr-2 px-2.5 py-1.5 rounded-lg text-[11px] font-mono text-text-muted border border-border hover:border-cyan/30 hover:text-cyan transition-all duration-200"
          >
            paste
          </motion.button>
        )}

        {/* Clear button */}
        <AnimatePresence>
          {value && !isLoading && (
            <motion.button
              initial={{ opacity: 0, scale: 0.7 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.7 }}
              transition={{ duration: 0.12 }}
              onClick={clear}
              className="flex-shrink-0 mr-1.5 p-1.5 text-text-muted hover:text-text-primary transition-colors rounded-lg hover:bg-white/5"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </motion.button>
          )}
        </AnimatePresence>

        {/* Action button */}
        <motion.button
          onClick={handleSubmit}
          disabled={!btnActive}
          whileTap={{ scale: btnActive ? 0.96 : 1 }}
          className={`flex-shrink-0 m-2 px-4 py-2.5 rounded-xl text-sm font-display font-semibold transition-all duration-200 flex items-center gap-1.5 ${
            btnActive
              ? mode === 'url'
                ?  'bg-cyan text-black hover:bg-cyan-dim shadow-glow'
              : 'bg-cyan text-black hover:bg-cyan-dim shadow-glow'
              : 'bg-border text-text-muted cursor-not-allowed'
          }`}
        >
          {isLoading ? (
            <>
              <span className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" />
              <span className="hidden sm:inline">
                {mode === 'url' ? 'Fetching' : 'Searching'}
              </span>
            </>
          ) : (
            <>
              {mode === 'url' ? <FetchIcon /> : <SearchIcon size={13} />}
              <span className="hidden sm:inline">{btnLabel}</span>
            </>
          )}
        </motion.button>
      </motion.div>

      {/* Mode hint */}
      <AnimatePresence mode="wait">
        {mode === 'empty' && (
          <motion.p
           key="hint-empty"
           initial={{ opacity: 0 }}
           animate={{ opacity: 1 }}
           exit={{ opacity: 0 }}
           className="text-[11px] text-white/60 font-mono text-center"
        >
          e.g. Blinding Lights - The Weeknd or https://www.jiosaavn.com/song/blinding-lights/Fj9GfAxDWUY
        </motion.p>
        )}
        {mode === 'query' && (
          <motion.p
            key="hint-search"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="text-[11px] text-white/60 font-mono pl-1"
          >
            Press Enter or click Search
          </motion.p>
        )}
        {mode === 'url' && (
          <motion.p
            key="hint-url"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="text-[11px] text-cyan/60 font-mono pl-1"
          >
            JioSaavn link detected — press Enter or click Fetch
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Icon helpers ─────────────────────────────────────────────────────────────

function SearchIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

function LinkIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}

function FetchIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}
