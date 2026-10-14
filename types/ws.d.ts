// Declaración mínima para 'ws' (las definiciones oficiales están en @types/ws).
declare module 'ws' {
  import { EventEmitter } from 'node:events';
  import type { IncomingMessage } from 'node:http';
  import type { Duplex } from 'node:stream';
  export class WebSocket extends EventEmitter {
    readonly OPEN: number;
    readyState: number;
    send(data: string): void;
    close(code?: number, reason?: string): void;
    terminate(): void;
    ping(): void;
    on(event: 'message', cb: (data: Buffer | string) => void): this;
    on(event: string, cb: (...args: any[]) => void): this;
  }
  export class WebSocketServer extends EventEmitter {
    constructor(opts: { noServer?: boolean; maxPayload?: number; port?: number });
    clients: Set<WebSocket>;
    handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer, cb: (ws: WebSocket) => void): void;
    on(event: 'connection', cb: (ws: WebSocket) => void): this;
    on(event: string, cb: (...args: any[]) => void): this;
    close(): void;
  }
  export default WebSocket;
}
