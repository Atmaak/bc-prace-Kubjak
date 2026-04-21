import fs from 'fs';
import path from 'path';
import { SimulationEvent, EventType, EventSeverity } from '../types/simulationEvent';

export class SimulationLogger {
  private logFilePath: string;
  private eventBuffer: SimulationEvent[] = [];
  private bufferMaxSize: number = 10000;
  private isWriting: boolean = false;
  private writeQueue: SimulationEvent[] = [];
  private readonly persistToDisk: boolean;

  constructor(logsDir: string = 'logs', options: { persistToDisk?: boolean } = {}) {
    this.persistToDisk = options.persistToDisk ?? true;

    if (!this.persistToDisk) {
      this.logFilePath = 'disabled-in-learning-mode';
      return;
    }

    // Ensure logs directory exists
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }

    // Create timestamped log file
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    this.logFilePath = path.join(logsDir, `simulation-${timestamp}.jsonl`);

    // Touch file in append mode (creates file if missing, never truncates)
    fs.appendFileSync(this.logFilePath, '');
  }

  /**
   * Log an event. Appends to file immediately and maintains in-memory buffer.
   */
  logEvent(event: SimulationEvent): void {
    // Add to buffer
    this.eventBuffer.push(event);

    // Trim buffer if exceeds max size (keep most recent)
    if (this.eventBuffer.length > this.bufferMaxSize) {
      this.eventBuffer = this.eventBuffer.slice(-this.bufferMaxSize);
    }

    if (this.persistToDisk) {
      // Queue for disk write (async to avoid blocking)
      this.writeQueue.push(event);
      this.flushAsync();
    }
  }

  /**
   * Create a structured event object
   */
  createEvent(
    tick: number,
    eventType: EventType,
    agentId: number,
    payload: Record<string, any> = {},
    options: {
      companyId?: number | string;
      correlationId?: string;
      strategyId?: string;
      severity?: EventSeverity;
      error?: { message: string; stack?: string };
    } = {}
  ): SimulationEvent {
    const event: SimulationEvent = {
      tick,
      eventType,
      severity: options.severity || 'info',
      agentId,
      payload,
    };
    
    if (options.companyId !== undefined) {
      event.companyId = options.companyId;
    }
    if (options.correlationId !== undefined) {
      event.correlationId = options.correlationId;
    }
    if (options.strategyId !== undefined) {
      event.strategyId = options.strategyId;
    }
    if (options.error !== undefined) {
      event.error = options.error;
    }
    
    return event;
  }

  /**
   * Async flush events to disk
   */
  private flushAsync(): void {
    if (!this.persistToDisk) {
      return;
    }

    if (this.isWriting || this.writeQueue.length === 0) {
      return;
    }

    this.isWriting = true;
    const eventsToWrite = [...this.writeQueue];
    this.writeQueue = [];

    setImmediate(() => {
      try {
        const lines = eventsToWrite
          .map(e => JSON.stringify(e))
          .join('\n') + '\n';
        fs.appendFileSync(this.logFilePath, lines);
      } catch (err) {
        console.error('Failed to write logs to disk:', err);
      } finally {
        this.isWriting = false;
        // Process remaining queue if any
        if (this.writeQueue.length > 0) {
          this.flushAsync();
        }
      }
    });
  }

  /**
   * Synchronously flush all pending events to disk (e.g., on shutdown)
   */
  flushSync(): void {
    if (!this.persistToDisk) {
      return;
    }

    if (this.writeQueue.length === 0) {
      return;
    }

    try {
      const lines = this.writeQueue
        .map(e => JSON.stringify(e))
        .join('\n') + '\n';
      fs.appendFileSync(this.logFilePath, lines);
      this.writeQueue = [];
    } catch (err) {
      console.error('Failed to synchronously flush logs:', err);
    }
  }

  /**
   * Get recent events from buffer (for API endpoint or state snapshot)
   */
  getRecentEvents(limit: number = 100): SimulationEvent[] {
    return this.eventBuffer.slice(-limit);
  }

  /**
   * Filter events by criteria
   */
  filterEvents(filter: {
    tick?: number;
    agentId?: number;
    companyId?: number | string;
    correlationId?: string;
    eventType?: EventType;
    severity?: EventSeverity;
  }): SimulationEvent[] {
    return this.eventBuffer.filter(event => {
      if (filter.tick !== undefined && event.tick !== filter.tick) return false;
      if (filter.agentId !== undefined && event.agentId !== filter.agentId) return false;
      if (filter.companyId !== undefined && event.companyId !== filter.companyId) return false;
      if (filter.correlationId !== undefined && event.correlationId !== filter.correlationId) return false;
      if (filter.eventType !== undefined && event.eventType !== filter.eventType) return false;
      if (filter.severity !== undefined && event.severity !== filter.severity) return false;
      return true;
    });
  }

  /**
   * Get the path to the current log file
   */
  getLogFilePath(): string {
    return this.logFilePath;
  }

  /**
   * Get total event count
   */
  getEventCount(): number {
    return this.eventBuffer.length;
  }

  /**
   * Clear buffer (useful for testing)
   */
  clearBuffer(): void {
    this.eventBuffer = [];
  }
}
