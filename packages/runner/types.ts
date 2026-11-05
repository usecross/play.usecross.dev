/**
 * Type definitions for the CrossInertia Playground runner
 * 
 * These interfaces define the contract between the Service Worker,
 * Pyodide worker, and Python framework adapters.
 */

/**
 * Virtual filesystem representation
 */
export interface VirtualFileSystem {
  [path: string]: string | Uint8Array;
}

/**
 * HTTP request representation passed to Python
 */
export interface HttpRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: Uint8Array;
}

/**
 * HTTP response returned from Python
 */
export interface HttpResponse {
  status: number;
  statusText?: string;
  headers: Record<string, string>;
  body?: Uint8Array;
}

/**
 * WebSocket request (for future phases)
 */
export interface WebSocketRequest {
  url: string;
  headers: Record<string, string>;
  protocols?: string[];
}

/**
 * WebSocket session (for future phases)
 */
export interface SocketSession {
  accept(): Promise<void>;
  send(data: string | Uint8Array): Promise<void>;
  receive(): Promise<string | Uint8Array>;
  close(code?: number, reason?: string): Promise<void>;
}

/**
 * Main framework runtime interface
 * 
 * This is the core abstraction that allows different Python frameworks
 * (FastAPI, Django, Litestar, etc.) to run in the playground.
 */
export interface PythonFrameworkRuntime {
  /**
   * Initialize the framework with the provided virtual filesystem
   */
  initialize(files: VirtualFileSystem): Promise<void>;

  /**
   * Handle an HTTP request through the framework
   */
  handleHttp(request: HttpRequest): Promise<HttpResponse>;

  /**
   * Connect a WebSocket (optional, for future phases)
   */
  connectWebSocket?(request: WebSocketRequest): Promise<SocketSession>;

  /**
   * Reset the runtime (reload Python code, clear state)
   */
  reset(): Promise<void>;
}

/**
 * Runner configuration
 */
export interface RunnerConfig {
  /** Base path for the preview iframe */
  basePath?: string;
  /** Python framework to use */
  framework?: 'fastapi' | 'django' | 'litestar';
  /** Debug mode (verbose logging) */
  debug?: boolean;
}

/**
 * Cookie jar for managing virtual cookies
 */
export interface CookieJar {
  /** Set cookies from Set-Cookie header */
  setCookies(setCookieHeaders: string[], url: string): void;
  /** Get Cookie header value for a URL */
  getCookieHeader(url: string): string | null;
  /** Clear all cookies */
  clear(): void;
}

/**
 * Message types for worker communication
 */
export type WorkerMessage =
  | { type: 'initialize'; files: VirtualFileSystem }
  | { type: 'http-request'; request: HttpRequest }
  | { type: 'reset' };

export type WorkerResponse =
  | { type: 'initialized'; success: boolean; error?: string }
  | { type: 'http-response'; response: HttpResponse; error?: string }
  | { type: 'reset-complete'; success: boolean };
