import { v4 as uuidv4 } from 'uuid';

interface PendingRequest {
  id: string;
  endpoint: string;
  data: unknown;
  timestamp: number;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
  timeoutId: ReturnType<typeof setTimeout>;
}

interface BatchResponse {
  requestId: string;
  response?: unknown;
  error?: string;
}

export class BridgeService {
  private pendingRequests: Map<string, PendingRequest> = new Map();
  private requestQueue: string[] = []; // FIFO queue for O(1) retrieval
  private requestTimeout = 30000; // 30 seconds timeout

  async sendRequest(endpoint: string, data: unknown): Promise<unknown> {
    const requestId = uuidv4();

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        if (this.pendingRequests.has(requestId)) {
          this.removeFromQueue(requestId);
          this.pendingRequests.delete(requestId);
          reject(new Error('Request timeout'));
        }
      }, this.requestTimeout);

      const request: PendingRequest = {
        id: requestId,
        endpoint,
        data,
        timestamp: Date.now(),
        resolve,
        reject,
        timeoutId
      };

      this.pendingRequests.set(requestId, request);
      this.requestQueue.push(requestId);
    });
  }

  /**
   * Get a single pending request (oldest first - FIFO)
   */
  getPendingRequest(): { requestId: string; request: { endpoint: string; data: unknown } } | null {
    // O(1) retrieval with FIFO queue
    while (this.requestQueue.length > 0) {
      const requestId = this.requestQueue[0];
      const request = this.pendingRequests.get(requestId);
      
      if (request) {
        return {
          requestId: request.id,
          request: {
            endpoint: request.endpoint,
            data: request.data
          }
        };
      }
      
      // Request was cleaned up (timeout), remove from queue
      this.requestQueue.shift();
    }

    return null;
  }

  /**
   * Get multiple pending requests at once for batching
   */
  getPendingRequests(maxCount: number = 10): Array<{ requestId: string; request: { endpoint: string; data: unknown } }> {
    const results: Array<{ requestId: string; request: { endpoint: string; data: unknown } }> = [];
    const toRemove: number[] = [];
    
    for (let i = 0; i < this.requestQueue.length && results.length < maxCount; i++) {
      const requestId = this.requestQueue[i];
      const request = this.pendingRequests.get(requestId);
      
      if (request) {
        results.push({
          requestId: request.id,
          request: {
            endpoint: request.endpoint,
            data: request.data
          }
        });
      } else {
        // Mark for removal (cleaned up by timeout)
        toRemove.push(i);
      }
    }
    
    // Remove stale entries from queue (in reverse to maintain indices)
    for (let i = toRemove.length - 1; i >= 0; i--) {
      this.requestQueue.splice(toRemove[i], 1);
    }

    return results;
  }

  /**
   * Check if a request exists
   */
  hasPendingRequest(requestId: string): boolean {
    return this.pendingRequests.has(requestId);
  }

  /**
   * Get count of pending requests
   */
  getPendingCount(): number {
    return this.pendingRequests.size;
  }

  private removeFromQueue(requestId: string): void {
    const index = this.requestQueue.indexOf(requestId);
    if (index > -1) {
      this.requestQueue.splice(index, 1);
    }
  }

  resolveRequest(requestId: string, response: unknown): boolean {
    const request = this.pendingRequests.get(requestId);
    if (request) {
      clearTimeout(request.timeoutId);
      this.removeFromQueue(requestId);
      this.pendingRequests.delete(requestId);
      request.resolve(response);
      return true;
    }
    return false;
  }

  rejectRequest(requestId: string, error: unknown): boolean {
    const request = this.pendingRequests.get(requestId);
    if (request) {
      clearTimeout(request.timeoutId);
      this.removeFromQueue(requestId);
      this.pendingRequests.delete(requestId);
      request.reject(error);
      return true;
    }
    return false;
  }

  /**
   * Resolve multiple requests at once (batch response)
   */
  resolveRequests(responses: BatchResponse[]): { resolved: number; notFound: number } {
    let resolved = 0;
    let notFound = 0;

    for (const resp of responses) {
      if (resp.error) {
        if (this.rejectRequest(resp.requestId, resp.error)) {
          resolved++;
        } else {
          notFound++;
        }
      } else {
        if (this.resolveRequest(resp.requestId, resp.response)) {
          resolved++;
        } else {
          notFound++;
        }
      }
    }

    return { resolved, notFound };
  }

  cleanupOldRequests(): void {
    const now = Date.now();
    for (const [id, request] of this.pendingRequests.entries()) {
      if (now - request.timestamp > this.requestTimeout) {
        clearTimeout(request.timeoutId);
        this.removeFromQueue(id);
        this.pendingRequests.delete(id);
        request.reject(new Error('Request timeout'));
      }
    }
  }

  clearAllPendingRequests(): void {
    for (const [, request] of this.pendingRequests.entries()) {
      clearTimeout(request.timeoutId);
      request.reject(new Error('Connection closed'));
    }
    this.pendingRequests.clear();
    this.requestQueue = [];
  }
}
