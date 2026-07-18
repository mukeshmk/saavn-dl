import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

// ─── Types ────────────────────────────────────────────────────────────────────

interface SyncResult {
  timestamp: string;
  moved: number;
  failed: number;
  skipped: number;
  errors: { file: string; error: string }[];
}

interface SyncStatus {
  lastSyncTime: string | null;
  schedule: string;
  retryLimit: number;
  pendingCount: number;
  needsAttentionCount: number;
  lastResult: SyncResult | null;
  failedFiles: { path: string; retryCount: number; lastError: string; lastAttempt: string }[];
  scheduler: { active: boolean; expression: string; isRunning: boolean };
}

interface SyncConfig {
  schedule: string;
  retryLimit: number;
  enabled: boolean;
}

// ─── Presets ──────────────────────────────────────────────────────────────────

const SCHEDULE_PRESETS = [
  { label: 'Every hour', cron: '0 * * * *' },
  { label: 'Every 6h', cron: '0 */6 * * *' },
  { label: 'Every 12h', cron: '0 */12 * * *' },
  { label: 'Daily 3 AM', cron: '0 3 * * *' },
  { label: 'Disabled', cron: '' },
];

// ─── Component ────────────────────────────────────────────────────────────────

interface SyncControlsProps {
  onSyncComplete?: () => void;
}

export default function SyncControls({ onSyncComplete }: SyncControlsProps) {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [config, setConfig] = useState<SyncConfig | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [customCron, setCustomCron] = useState('');
  const [retryLimit, setRetryLimit] = useState(3);
  const [showHistory, setShowHistory] = useState(false);
  const [showFailed, setShowFailed] = useState(false);
  const [configError, setConfigError] = useState('');

  // ── Fetch status + config ───────────────────────────────────────────────

  const fetchStatus = useCallback(async () => {
    try {
      const resp = await fetch('/api/library/sync/status');
      if (resp.ok) setStatus(await resp.json());
    } catch { /* silent */ }
  }, []);

  const fetchConfig = useCallback(async () => {
    try {
      const resp = await fetch('/api/library/sync/config');
      if (resp.ok) {
        const data: SyncConfig = await resp.json();
        setConfig(data);
        setCustomCron(data.schedule);
        setRetryLimit(data.retryLimit);
      }
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    fetchStatus();
    fetchConfig();
    const interval = setInterval(fetchStatus, 10000);
    return () => clearInterval(interval);
  }, [fetchStatus, fetchConfig]);

  // ── Sync now ────────────────────────────────────────────────────────────

  const handleSync = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const resp = await fetch('/api/library/sync', { method: 'POST' });
      const data = await resp.json();
      if (resp.ok) {
        setSyncResult(data);
        fetchStatus();
        onSyncComplete?.();
      } else {
        setConfigError(data.error || 'Sync failed');
      }
    } catch (err) {
      setConfigError(err instanceof Error ? err.message : 'Sync failed');
    } finally {
      setSyncing(false);
    }
  };

  // ── Update config ───────────────────────────────────────────────────────

  const updateSchedule = async (cronExpr: string) => {
    setConfigError('');
    try {
      const resp = await fetch('/api/library/sync/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ schedule: cronExpr }),
      });
      const data = await resp.json();
      if (resp.ok) {
        setConfig(data);
        setCustomCron(data.schedule);
        fetchStatus();
      } else {
        setConfigError(data.error || 'Failed to update schedule');
      }
    } catch {
      setConfigError('Failed to update schedule');
    }
  };

  const updateRetryLimit = async () => {
    setConfigError('');
    try {
      const resp = await fetch('/api/library/sync/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ retryLimit }),
      });
      const data = await resp.json();
      if (resp.ok) {
        setConfig(data);
        fetchStatus();
      } else {
        setConfigError(data.error || 'Failed to update');
      }
    } catch {
      setConfigError('Failed to update');
    }
  };

  // ── Reset retries ──────────────────────────────────────────────────────

  const handleResetRetries = async (path?: string) => {
    try {
      await fetch('/api/library/sync/reset-retries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: path || null }),
      });
      fetchStatus();
    } catch { /* silent */ }
  };

  // ── Render ──────────────────────────────────────────────────────────────

  const activePreset = SCHEDULE_PRESETS.find((p) => p.cron === (config?.schedule ?? ''));

  return (
    <div className="mb-5 space-y-3">

      {/* Status bar + Sync button */}
      <div className="rounded-xl border border-border bg-glass/50 p-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          {/* Status info */}
          <div className="flex items-center gap-4 flex-wrap">
            {/* Pending */}
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-cyan/60" />
              <span className="text-[11px] font-mono text-text-muted">
                {status?.pendingCount ?? '—'} pending
              </span>
            </div>

            {/* Needs attention */}
            {(status?.needsAttentionCount ?? 0) > 0 && (
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-rose/60" />
                <span className="text-[11px] font-mono text-rose/80">
                  {status?.needsAttentionCount} need attention
                </span>
              </div>
            )}

            {/* Last sync */}
            {status?.lastSyncTime && (
              <span className="text-[10px] font-mono text-text-muted/60">
                Last sync: {new Date(status.lastSyncTime).toLocaleString()}
              </span>
            )}

            {/* Scheduler badge */}
            {status?.scheduler?.active && (
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-cyan/10 border border-cyan/20 text-cyan">
                ⏱ {status.scheduler.expression}
              </span>
            )}
          </div>

          {/* Sync button */}
          <button
            onClick={handleSync}
            disabled={syncing || status?.scheduler?.isRunning}
            className="px-4 py-2 rounded-lg bg-cyan/10 border border-cyan/30 text-cyan text-[12px] font-display font-semibold hover:bg-cyan/20 hover:border-cyan/50 transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {syncing || status?.scheduler?.isRunning ? (
              <>
                <span className="w-3 h-3 border-2 border-cyan border-t-transparent rounded-full animate-spin" />
                Syncing…
              </>
            ) : (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="1 4 1 10 7 10"/>
                  <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>
                </svg>
                Sync Now
              </>
            )}
          </button>
        </div>

        {/* Sync result toast */}
        <AnimatePresence>
          {syncResult && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="mt-3 overflow-hidden"
            >
              <div className={`rounded-lg px-3 py-2 border text-[11px] font-mono ${
                syncResult.failed > 0
                  ? 'border-rose/20 bg-rose/5 text-rose/80'
                  : 'border-cyan/20 bg-cyan/5 text-cyan/80'
              }`}>
                ✓ {syncResult.moved} moved · {syncResult.failed} failed · {syncResult.skipped} skipped
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Config error */}
        {configError && (
          <p className="mt-2 text-[11px] font-mono text-rose/80">{configError}</p>
        )}
      </div>

      {/* Schedule config */}
      <div className="rounded-xl border border-border bg-glass/50 p-4">
        <p className="text-[11px] font-mono text-text-muted uppercase tracking-wider mb-2.5">Schedule</p>

        {/* Preset buttons */}
        <div className="flex flex-wrap gap-1.5 mb-3">
          {SCHEDULE_PRESETS.map((preset) => (
            <button
              key={preset.label}
              onClick={() => updateSchedule(preset.cron)}
              className={`px-3 py-1.5 rounded-lg text-[11px] font-mono transition-all ${
                activePreset?.cron === preset.cron
                  ? 'bg-cyan/10 border border-cyan/40 text-cyan'
                  : 'border border-border text-text-muted hover:text-text-secondary hover:border-white/10'
              }`}
            >
              {preset.label}
            </button>
          ))}
        </div>

        {/* Custom cron */}
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={customCron}
            onChange={(e) => setCustomCron(e.target.value)}
            placeholder="Custom cron (e.g. */30 * * * *)"
            className="flex-1 px-3 py-1.5 rounded-lg bg-void border border-border text-[11px] font-mono text-text-primary placeholder:text-text-muted/40 focus:outline-none focus:border-cyan/40 transition-colors"
          />
          <button
            onClick={() => updateSchedule(customCron)}
            className="px-3 py-1.5 rounded-lg border border-border text-[11px] font-mono text-text-muted hover:text-cyan hover:border-cyan/30 transition-colors"
          >
            Set
          </button>
        </div>

        {/* Retry limit */}
        <div className="mt-3 flex items-center gap-2">
          <span className="text-[11px] font-mono text-text-muted">Retry limit:</span>
          <input
            type="number"
            min={1}
            max={100}
            value={retryLimit}
            onChange={(e) => setRetryLimit(parseInt(e.target.value, 10) || 3)}
            className="w-14 px-2 py-1 rounded-lg bg-void border border-border text-[11px] font-mono text-text-primary text-center focus:outline-none focus:border-cyan/40 transition-colors"
          />
          <button
            onClick={updateRetryLimit}
            className="px-2 py-1 rounded-lg border border-border text-[10px] font-mono text-text-muted hover:text-cyan hover:border-cyan/30 transition-colors"
          >
            Save
          </button>
        </div>
      </div>

      {/* History + Failed files toggle */}
      <div className="flex gap-2">
        <button
          onClick={() => { setShowHistory(!showHistory); setShowFailed(false); }}
          className={`px-3 py-1.5 rounded-lg text-[11px] font-mono transition-all ${
            showHistory ? 'bg-cyan/10 border border-cyan/30 text-cyan' : 'border border-border text-text-muted hover:text-text-secondary'
          }`}
        >
          History
        </button>
        {(status?.needsAttentionCount ?? 0) > 0 && (
          <button
            onClick={() => { setShowFailed(!showFailed); setShowHistory(false); }}
            className={`px-3 py-1.5 rounded-lg text-[11px] font-mono transition-all ${
              showFailed ? 'bg-rose/10 border border-rose/30 text-rose' : 'border border-border text-text-muted hover:text-text-secondary'
            }`}
          >
            Needs Attention ({status?.needsAttentionCount})
          </button>
        )}
      </div>

      {/* History panel */}
      <AnimatePresence>
        {showHistory && status?.lastResult && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="rounded-xl border border-border bg-glass/50 p-3 space-y-1.5 max-h-48 overflow-y-auto">
              <SyncHistoryList status={status} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Failed files panel */}
      <AnimatePresence>
        {showFailed && status && status.failedFiles.length > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="rounded-xl border border-rose/20 bg-rose/5 p-3 space-y-2 max-h-48 overflow-y-auto">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] font-mono text-rose/60 uppercase tracking-wider">Failed files</span>
                <button
                  onClick={() => handleResetRetries()}
                  className="text-[10px] font-mono text-rose/60 hover:text-rose transition-colors underline"
                >
                  Reset all
                </button>
              </div>
              {status.failedFiles.map((f) => (
                <div key={f.path} className="flex items-center gap-2">
                  <span className="text-[11px] font-mono text-text-secondary truncate flex-1">{f.path}</span>
                  <span className="text-[10px] font-mono text-rose/60 flex-shrink-0">{f.lastError}</span>
                  <button
                    onClick={() => handleResetRetries(f.path)}
                    className="text-[10px] font-mono text-text-muted hover:text-cyan transition-colors flex-shrink-0"
                  >
                    retry
                  </button>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Sync history list ────────────────────────────────────────────────────────

function SyncHistoryList({ status }: { status: SyncStatus }) {
  // We only have lastResult in status directly, but the full history is in config
  // For now show lastResult info; ideally we fetch history from status endpoint
  const [history, setHistory] = useState<SyncResult[]>([]);

  useEffect(() => {
    // Fetch full config to get history
    fetch('/api/library/sync/config')
      .then((r) => r.json())
      .then(() => {
        // The status endpoint provides lastResult; for full history we'd need to extend the API
        // For now, use the lastResult if available
        if (status.lastResult) setHistory([status.lastResult]);
      })
      .catch(() => {});
  }, [status]);

  // Try to get history from status fetch — the API already returns history via getStatus
  // Actually, let's fetch it from sync/status which returns lastResult
  // We'll work with what we have

  if (!status.lastResult) {
    return <p className="text-[11px] font-mono text-text-muted">No sync history yet</p>;
  }

  return (
    <>
      {[status.lastResult].map((result, i) => (
        <div key={i} className="flex items-center gap-3 py-1">
          <span className="text-[10px] font-mono text-text-muted/60 flex-shrink-0 w-28">
            {new Date(result.timestamp).toLocaleString(undefined, {
              month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
            })}
          </span>
          <span className="text-[10px] font-mono text-cyan/80">{result.moved} moved</span>
          {result.failed > 0 && (
            <span className="text-[10px] font-mono text-rose/80">{result.failed} failed</span>
          )}
          {result.skipped > 0 && (
            <span className="text-[10px] font-mono text-text-muted">{result.skipped} skipped</span>
          )}
        </div>
      ))}
    </>
  );
}
