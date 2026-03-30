// ═══════════════════════════════════════════════════════════════
//  Shared: Structured Logging
// ═══════════════════════════════════════════════════════════════

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogEntry = {
  timestamp: string;
  level: LogLevel;
  function_name: string;
  action?: string;
  user_id?: string;
  escola_id?: string;
  duration_ms?: number;
  message: string;
  error?: string;
  metadata?: Record<string, unknown>;
};

class Logger {
  private functionName: string;

  constructor(functionName: string) {
    this.functionName = functionName;
  }

  private log(level: LogLevel, message: string, extra?: Partial<LogEntry>) {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      function_name: this.functionName,
      message,
      ...extra,
    };
    // Output as JSON to stdout (captured by Supabase logs)
    if (level === 'error') {
      console.error(JSON.stringify(entry));
    } else if (level === 'warn') {
      console.warn(JSON.stringify(entry));
    } else {
      console.log(JSON.stringify(entry));
    }
  }

  debug(message: string, extra?: Partial<LogEntry>) { this.log('debug', message, extra); }
  info(message: string, extra?: Partial<LogEntry>) { this.log('info', message, extra); }
  warn(message: string, extra?: Partial<LogEntry>) { this.log('warn', message, extra); }
  error(message: string, extra?: Partial<LogEntry>) { this.log('error', message, extra); }

  /**
   * Log an API request with timing
   */
  request(action: string, startTime: number, extra?: Partial<LogEntry>) {
    this.info(`Action: ${action}`, {
      action,
      duration_ms: Date.now() - startTime,
      ...extra,
    });
  }

  /**
   * Log an error with context
   */
  apiError(action: string, error: unknown, extra?: Partial<LogEntry>) {
    this.error(`Error in ${action}: ${error instanceof Error ? error.message : String(error)}`, {
      action,
      error: error instanceof Error ? error.stack : String(error),
      ...extra,
    });
  }
}

/**
 * Create a logger instance for an edge function
 */
export function createLogger(functionName: string): Logger {
  return new Logger(functionName);
}
