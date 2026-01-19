import request from 'supertest';
import { createHttpServer } from '../http-server';
import { RobloxStudioTools } from '../tools/index';
import { BridgeService } from '../bridge-service';
import { Application } from 'express';

describe('HTTP Server', () => {
  let app: Application & any;
  let bridge: BridgeService;
  let tools: RobloxStudioTools;

  beforeEach(() => {
    bridge = new BridgeService();
    tools = new RobloxStudioTools(bridge);
    app = createHttpServer(tools, bridge);
  });

  afterEach(() => {
    // Clean up any pending requests to prevent open handles
    bridge.clearAllPendingRequests();
  });

  describe('Health Check', () => {
    test('should return health status', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);

      expect(response.body).toMatchObject({
        status: 'ok',
        service: 'roblox-mcp',
        version: '2.1.1',
        pluginConnected: false,
        mcpServerActive: false,
        pendingRequests: 0
      });
    });
  });

  describe('Plugin Connection Management', () => {
    test('should handle plugin ready notification', async () => {
      const response = await request(app)
        .post('/ready')
        .expect(200);

      expect(response.body).toEqual({ success: true });
      expect(app.isPluginConnected()).toBe(true);
    });

    test('should handle plugin disconnect', async () => {
      // First connect
      await request(app).post('/ready').expect(200);
      expect(app.isPluginConnected()).toBe(true);

      // Then disconnect
      const response = await request(app)
        .post('/disconnect')
        .expect(200);

      expect(response.body).toEqual({ success: true });
      expect(app.isPluginConnected()).toBe(false);
    });

    test('should clear pending requests on disconnect', async () => {
      // Add some pending requests
      const p1 = bridge.sendRequest('/api/test1', {});
      const p2 = bridge.sendRequest('/api/test2', {});
      p1.catch(() => {});
      p2.catch(() => {});

      expect(bridge.getPendingRequest()).toBeTruthy();

      // Disconnect
      await request(app).post('/disconnect').expect(200);

      // All requests should be cleared
      expect(bridge.getPendingRequest()).toBeNull();
    });

    test('should timeout plugin connection after inactivity', async () => {
      // Connect plugin
      await request(app).post('/ready').expect(200);
      expect(app.isPluginConnected()).toBe(true);

      // Simulate time passing (11 seconds of inactivity)
      const originalDateNow = Date.now;
      Date.now = jest.fn(() => originalDateNow() + 11000);

      // Plugin should be considered disconnected
      expect(app.isPluginConnected()).toBe(false);

      // Restore Date.now
      Date.now = originalDateNow;
    });
  });

  describe('Polling Endpoint (v2.0.0 Batch)', () => {
    test('should return 503 when MCP server is not active', async () => {
      const response = await request(app)
        .get('/poll')
        .expect(503);

      expect(response.body).toMatchObject({
        error: 'MCP server not connected',
        pluginConnected: true,
        mcpConnected: false,
        requests: []
      });
    });

    test('should return batch of pending requests when MCP is active', async () => {
      // Activate MCP server
      app.setMCPServerActive(true);

      // Add pending requests
      const p1 = bridge.sendRequest('/api/test1', { data: 'test1' });
      const p2 = bridge.sendRequest('/api/test2', { data: 'test2' });
      p1.catch(() => {});
      p2.catch(() => {});

      const response = await request(app)
        .get('/poll?longPoll=false&maxBatch=10')
        .expect(200);

      expect(response.body.mcpConnected).toBe(true);
      expect(response.body.pluginConnected).toBe(true);
      expect(response.body.requests.length).toBe(2);
      expect(response.body.batchSize).toBe(2);
      
      // Verify requests in order
      expect(response.body.requests[0].request.endpoint).toBe('/api/test1');
      expect(response.body.requests[1].request.endpoint).toBe('/api/test2');
    });

    test('should respect maxBatch parameter', async () => {
      app.setMCPServerActive(true);

      // Add 5 pending requests
      for (let i = 1; i <= 5; i++) {
        const p = bridge.sendRequest(`/api/test${i}`, { order: i });
        p.catch(() => {});
      }

      const response = await request(app)
        .get('/poll?longPoll=false&maxBatch=2')
        .expect(200);

      expect(response.body.requests.length).toBe(2);
      expect(response.body.batchSize).toBe(2);
    });

    test('should return empty requests when no pending requests', async () => {
      // Activate MCP server
      app.setMCPServerActive(true);

      const response = await request(app)
        .get('/poll?longPoll=false')
        .expect(200);

      expect(response.body).toMatchObject({
        requests: [],
        mcpConnected: true,
        pluginConnected: true,
        batchSize: 0
      });
    });

    test('should mark plugin as connected when polling', async () => {
      expect(app.isPluginConnected()).toBe(false);

      await request(app).get('/poll').expect(503);

      expect(app.isPluginConnected()).toBe(true);
    });
  });

  describe('Response Handling (v2.0.0 Batch)', () => {
    test('should handle single response (backward compatible)', async () => {
      const responseData = { result: 'success' };

      // Create a pending request
      const requestPromise = bridge.sendRequest('/api/test', {});
      const pendingRequest = bridge.getPendingRequest();

      // Send response
      const response = await request(app)
        .post('/response')
        .send({
          requestId: pendingRequest!.requestId,
          response: responseData
        })
        .expect(200);

      expect(response.body).toEqual({ success: true });

      // Check that the request was resolved
      const result = await requestPromise;
      expect(result).toEqual(responseData);
    });

    test('should handle batch responses', async () => {
      // Create pending requests
      const p1 = bridge.sendRequest('/api/test1', {});
      const p2 = bridge.sendRequest('/api/test2', {});
      const p3 = bridge.sendRequest('/api/test3', {});

      const requests = bridge.getPendingRequests(10);

      // Send batch response
      const response = await request(app)
        .post('/response')
        .send({
          responses: [
            { requestId: requests[0].requestId, response: { result: 1 } },
            { requestId: requests[1].requestId, response: { result: 2 } },
            { requestId: requests[2].requestId, response: { result: 3 } }
          ]
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.resolved).toBe(3);
      expect(response.body.notFound).toBe(0);

      // Verify all resolved
      const results = await Promise.all([p1, p2, p3]);
      expect(results).toEqual([{ result: 1 }, { result: 2 }, { result: 3 }]);
    });

    test('should handle mixed success/error in batch', async () => {
      const p1 = bridge.sendRequest('/api/test1', {});
      const p2 = bridge.sendRequest('/api/test2', {});
      p2.catch(() => {});

      const requests = bridge.getPendingRequests(10);

      const response = await request(app)
        .post('/response')
        .send({
          responses: [
            { requestId: requests[0].requestId, response: { ok: true } },
            { requestId: requests[1].requestId, error: 'Test error' }
          ]
        })
        .expect(200);

      expect(response.body.resolved).toBe(2);

      await expect(p1).resolves.toEqual({ ok: true });
      await expect(p2).rejects.toEqual('Test error');
    });

    test('should return 404 for non-existent single request', async () => {
      const response = await request(app)
        .post('/response')
        .send({
          requestId: 'non-existent-id',
          response: {}
        })
        .expect(404);

      expect(response.body.error).toContain('not found');
    });

    test('should handle error response (single)', async () => {
      const error = 'Test error message';

      const requestPromise = bridge.sendRequest('/api/test', {});
      requestPromise.catch(() => {});
      const pendingRequest = bridge.getPendingRequest();

      const response = await request(app)
        .post('/response')
        .send({
          requestId: pendingRequest!.requestId,
          error: error
        })
        .expect(200);

      expect(response.body).toEqual({ success: true });

      await expect(requestPromise).rejects.toEqual(error);
    });

    test('should return 400 when neither requestId nor responses provided', async () => {
      const response = await request(app)
        .post('/response')
        .send({})
        .expect(400);

      expect(response.body.error).toContain('required');
    });
  });

  describe('MCP Server State Management', () => {
    test('should track MCP server activity', async () => {
      app.setMCPServerActive(true);
      expect(app.isMCPServerActive()).toBe(true);

      // Simulate activity
      app.trackMCPActivity();

      // Should still be active
      expect(app.isMCPServerActive()).toBe(true);
    });

    test('should timeout MCP server after inactivity', async () => {
      app.setMCPServerActive(true);
      expect(app.isMCPServerActive()).toBe(true);

      // Simulate time passing (16 seconds of inactivity)
      const originalDateNow = Date.now;
      Date.now = jest.fn(() => originalDateNow() + 16000);

      // MCP server should be considered inactive
      expect(app.isMCPServerActive()).toBe(false);

      // Restore Date.now
      Date.now = originalDateNow;
    });
  });

  describe('Status Endpoint', () => {
    test('should return current status with pending count', async () => {
      // Set up some state
      await request(app).post('/ready').expect(200);
      app.setMCPServerActive(true);

      // Add a pending request
      const p = bridge.sendRequest('/api/test', {});
      p.catch(() => {});

      const response = await request(app)
        .get('/status')
        .expect(200);

      expect(response.body).toMatchObject({
        pluginConnected: true,
        mcpServerActive: true,
        pendingRequests: 1
      });
      expect(response.body.lastMCPActivity).toBeGreaterThan(0);
      expect(response.body.uptime).toBeGreaterThan(0);
    });
  });
});
