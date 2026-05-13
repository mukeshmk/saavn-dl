import { useState, useRef } from 'react';
import { motion } from 'framer-motion';

interface URLInputProps {
  onFetch: (url: string) => void;
  isLoading: boolean;
}

export default function URLInput({ onFetch, isLoading }: URLInputProps) {
  const [value, setValue] = useState('');
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const isValid = value.includes('jiosaavn.com/song/') || value.includes('jiosaavn.com/s/song/');

  const handleSubmit = () => {
    if (!isValid || isLoading) return;
    onFetch(value.trim());
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSubmit();
  };

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text.includes('jiosaavn.com')) {
        setValue(text.trim());
        setTimeout(() => onFetch(text.trim()), 100);
      }
    } catch {
      // clipboard not available
    }
  };

  return (
    <div className="w-full">
      <motion.div
        animate={{
          boxShadow: focused
            ? '0 0 0 1px rgba(0,212,255,0.4), 0 0 24px rgba(0,212,255,0.1)'
            : '0 0 0 1px rgba(255,255,255,0.06)',
        }}
        transition={{ duration: 0.2 }}
        className="relative flex items-center bg-glass rounded-2xl overflow-hidden"
      >
        {/* Icon */}
        <div className="pl-5 pr-3 text-text-muted flex-shrink-0">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
          </svg>
        </div>

        {/* Input */}
        <input
          ref={inputRef}
          type="url"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={handleKeyDown}
          placeholder="Paste a JioSaavn song link…"
          className="flex-1 bg-transparent py-4 pr-2 text-sm font-body text-text-primary placeholder:text-text-muted outline-none min-w-0"
        />

        {/* Paste shortcut */}
        {!value && (
          <button
            onClick={handlePaste}
            className="flex-shrink-0 mr-2 px-3 py-1.5 rounded-lg text-[11px] font-mono text-text-muted border border-border hover:border-cyan/30 hover:text-cyan transition-all duration-200"
          >
            paste
          </button>
        )}

        {/* Clear */}
        {value && !isLoading && (
          <button
            onClick={() => setValue('')}
            className="flex-shrink-0 mr-2 p-1.5 text-text-muted hover:text-text-primary transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}

        {/* Fetch button */}
        <motion.button
          onClick={handleSubmit}
          disabled={!isValid || isLoading}
          whileTap={{ scale: 0.97 }}
          className={`flex-shrink-0 m-2 px-5 py-2.5 rounded-xl text-sm font-display font-semibold transition-all duration-200 flex items-center gap-2 ${
            isValid && !isLoading
              ? 'bg-cyan text-void hover:bg-cyan-dim shadow-glow'
              : 'bg-border text-text-muted cursor-not-allowed'
          }`}
        >
          {isLoading ? (
            <>
              <span className="w-3.5 h-3.5 border border-current border-t-transparent rounded-full animate-spin" />
              <span>Fetching</span>
            </>
          ) : (
            'Fetch'
          )}
        </motion.button>
      </motion.div>

      {value && !isValid && (
        <motion.p
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-2 ml-1 text-xs text-rose font-mono"
        >
          Not a valid JioSaavn song URL
        </motion.p>
      )}
    </div>
  );
}
