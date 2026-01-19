import { BridgeService } from '../bridge-service';

describe('BridgeService', () => {
  let bridgeService: BridgeService;

  beforeEach(() => {
    bridgeService = new BridgeService();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('Request Management', () => {
    test('should create and store a pending request', async () => {
      const endpoint = '/api/test';
      const data = { test: 'data' };
      
      const requestPromise = bridgeService.sendRequest(endpoint, data);
      
      // Check that request is pending
      const pendingRequest = bridgeService.getPendingRequest();
      expect(pendingRequest).toBeTruthy();
      expect(pendingRequest?.request.endpoint).toBe(endpoint);
      expect(pendingRequest?.request.data).toEqual(data);
    });

    test('should resolve request when response is received', async () => {
      const endpoint = '/api/test';
      const data = { test: 'data' };
      const response = { result: 'success' };
      
      const requestPromise = bridgeService.sendRequest(endpoint, data);
      const pendingRequest = bridgeService.getPendingRequest();
      
      // Resolve the request
      bridgeService.resolveRequest(pendingRequest!.requestId, response);
      
      const result = await requestPromise;
      expect(result).toEqual(response);
    });

    test('should reject request on error', async () => {
      const endpoint = '/api/test';
      const data = { test: 'data' };
      const error = 'Test error';
      
      const requestPromise = bridgeService.sendRequest(endpoint, data);
      const pendingRequest = bridgeService.getPendingRequest();
      
      // Reject the request
      bridgeService.rejectRequest(pendingRequest!.requestId, error);
      
      await expect(requestPromise).rejects.toEqual(error);
    });

    test('should timeout request after 30 seconds', async () => {
      const endpoint = '/api/test';
      const data = { test: 'data' };
      
      const requestPromise = bridgeService.sendRequest(endpoint, data);
      
      // Fast-forward time by 31 seconds
      jest.advanceTimersByTime(31000);
      
      await expect(requestPromise).rejects.toThrow('Request timeout');
    });
  });

  describe('Batch Request Operations (v2.0.0)', () => {
    test('should return multiple pending requests with getPendingRequests', async () => {
      // Create multiple requests
      bridgeService.sendRequest('/api/test1', { order: 1 });
      jest.advanceTimersByTime(10);
      bridgeService.sendRequest('/api/test2', { order: 2 });
      jest.advanceTimersByTime(10);
      bridgeService.sendRequest('/api/test3', { order: 3 });

      // Get batch of requests
      const requests = bridgeService.getPendingRequests(10);
      expect(requests.length).toBe(3);
      expect((requests[0].request.data as {order: number}).order).toBe(1);
      expect((requests[1].request.data as {order: number}).order).toBe(2);
      expect((requests[2].request.data as {order: number}).order).toBe(3);
    });

    test('should limit batch size with maxCount', async () => {
      // Create 5 requests
      for (let i = 1; i <= 5; i++) {
        bridgeService.sendRequest(`/api/test${i}`, { order: i });
        jest.advanceTimersByTime(10);
      }

      // Get only 2 requests
      const requests = bridgeService.getPendingRequests(2);
      expect(requests.length).toBe(2);
      expect((requests[0].request.data as {order: number}).order).toBe(1);
      expect((requests[1].request.data as {order: number}).order).toBe(2);
    });

    test('should check if request exists with hasPendingRequest', async () => {
      const requestPromise = bridgeService.sendRequest('/api/test', {});
      const pendingRequest = bridgeService.getPendingRequest();

      expect(bridgeService.hasPendingRequest(pendingRequest!.requestId)).toBe(true);
      expect(bridgeService.hasPendingRequest('non-existent-id')).toBe(false);

      // Clean up
      bridgeService.resolveRequest(pendingRequest!.requestId, {});
    });

    test('should track pending count with getPendingCount', async () => {
      expect(bridgeService.getPendingCount()).toBe(0);

      const p1 = bridgeService.sendRequest('/api/test1', {});
      expect(bridgeService.getPendingCount()).toBe(1);

      const p2 = bridgeService.sendRequest('/api/test2', {});
      expect(bridgeService.getPendingCount()).toBe(2);

      const req1 = bridgeService.getPendingRequest();
      bridgeService.resolveRequest(req1!.requestId, {});
      expect(bridgeService.getPendingCount()).toBe(1);

      const req2 = bridgeService.getPendingRequest();
      bridgeService.resolveRequest(req2!.requestId, {});
      expect(bridgeService.getPendingCount()).toBe(0);
    });

    test('should resolve multiple requests with resolveRequests', async () => {
      const promises = [
        bridgeService.sendRequest('/api/test1', { id: 1 }),
        bridgeService.sendRequest('/api/test2', { id: 2 }),
        bridgeService.sendRequest('/api/test3', { id: 3 })
      ];

      const requests = bridgeService.getPendingRequests(10);
      
      // Batch resolve
      const result = bridgeService.resolveRequests([
        { requestId: requests[0].requestId, response: { result: 1 } },
        { requestId: requests[1].requestId, response: { result: 2 } },
        { requestId: requests[2].requestId, response: { result: 3 } }
      ]);

      expect(result.resolved).toBe(3);
      expect(result.notFound).toBe(0);

      // Verify all promises resolved
      const results = await Promise.all(promises);
      expect(results[0]).toEqual({ result: 1 });
      expect(results[1]).toEqual({ result: 2 });
      expect(results[2]).toEqual({ result: 3 });
    });

    test('should handle mixed success/error in batch resolve', async () => {
      const p1 = bridgeService.sendRequest('/api/test1', {});
      const p2 = bridgeService.sendRequest('/api/test2', {});
      p2.catch(() => {}); // Prevent unhandled rejection

      const requests = bridgeService.getPendingRequests(10);
      
      // Batch resolve with one error
      const result = bridgeService.resolveRequests([
        { requestId: requests[0].requestId, response: { success: true } },
        { requestId: requests[1].requestId, error: 'Test error' }
      ]);

      expect(result.resolved).toBe(2);
      expect(result.notFound).toBe(0);

      // Verify first resolved, second rejected
      await expect(p1).resolves.toEqual({ success: true });
      await expect(p2).rejects.toEqual('Test error');
    });

    test('should report notFound for invalid request IDs in batch', async () => {
      const p1 = bridgeService.sendRequest('/api/test', {});
      const req = bridgeService.getPendingRequest();

      const result = bridgeService.resolveRequests([
        { requestId: req!.requestId, response: { ok: true } },
        { requestId: 'invalid-id-1' },
        { requestId: 'invalid-id-2' }
      ]);

      expect(result.resolved).toBe(1);
      expect(result.notFound).toBe(2);

      await expect(p1).resolves.toEqual({ ok: true });
    });
  });

  describe('Cleanup Operations', () => {
    test('should clean up old requests', async () => {
      // Create multiple requests
      const promises = [
        bridgeService.sendRequest('/api/test1', {}),
        bridgeService.sendRequest('/api/test2', {}),
        bridgeService.sendRequest('/api/test3', {})
      ];
      
      // Fast-forward time by 31 seconds
      jest.advanceTimersByTime(31000);
      
      // Clean up old requests
      bridgeService.cleanupOldRequests();
      
      // All requests should be rejected
      for (const promise of promises) {
        await expect(promise).rejects.toThrow('Request timeout');
      }
      
      // No pending requests should remain
      expect(bridgeService.getPendingRequest()).toBeNull();
    });

    test('should clear all pending requests on disconnect', async () => {
      // Create multiple requests
      const promises = [
        bridgeService.sendRequest('/api/test1', {}),
        bridgeService.sendRequest('/api/test2', {}),
        bridgeService.sendRequest('/api/test3', {})
      ];
      
      // Clear all requests
      bridgeService.clearAllPendingRequests();
      
      // All requests should be rejected with connection closed error
      for (const promise of promises) {
        await expect(promise).rejects.toThrow('Connection closed');
      }
      
      // No pending requests should remain
      expect(bridgeService.getPendingRequest()).toBeNull();
    });
  });

  describe('Request Priority (FIFO)', () => {
    test('should return oldest request first', async () => {
      // Create requests with different timestamps using fake timers
      bridgeService.sendRequest('/api/test1', { order: 1 });

      // Advance time to ensure different timestamps
      jest.advanceTimersByTime(10);

      bridgeService.sendRequest('/api/test2', { order: 2 });

      jest.advanceTimersByTime(10);

      bridgeService.sendRequest('/api/test3', { order: 3 });

      // Should get the first (oldest) request
      const firstRequest = bridgeService.getPendingRequest();
      expect((firstRequest?.request.data as {order: number}).order).toBe(1);

      // Resolve the first request to remove it from the queue
      bridgeService.resolveRequest(firstRequest!.requestId, {});

      // Should get the second request next
      const secondRequest = bridgeService.getPendingRequest();
      expect((secondRequest?.request.data as {order: number}).order).toBe(2);

      // Resolve the second request
      bridgeService.resolveRequest(secondRequest!.requestId, {});

      // Should get the third request last
      const thirdRequest = bridgeService.getPendingRequest();
      expect((thirdRequest?.request.data as {order: number}).order).toBe(3);

      // Resolve the third request
      bridgeService.resolveRequest(thirdRequest!.requestId, {});

      // No more pending requests
      expect(bridgeService.getPendingRequest()).toBeNull();
    });
  });
});
