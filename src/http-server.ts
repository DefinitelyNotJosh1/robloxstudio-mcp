import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { RobloxStudioTools } from './tools/index.js';
import { BridgeService } from './bridge-service.js';

// =============================================================================
// Route Factory
// =============================================================================

type ToolHandler = (body: Record<string, unknown>) => Promise<unknown>;

interface RouteDefinition {
  path: string;
  handler: ToolHandler;
}

function createToolRoute(app: Express, path: string, handler: ToolHandler): void {
  app.post(path, async (req: Request, res: Response) => {
    try {
      const result = await handler(req.body);
      res.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[${path}] Error:`, message);
      res.status(500).json({ error: message });
    }
  });
}

function registerToolRoutes(app: Express, routes: RouteDefinition[]): void {
  for (const route of routes) {
    createToolRoute(app, route.path, route.handler);
  }
}

// =============================================================================
// Long Polling Helper
// =============================================================================

async function waitForRequests(
  bridge: BridgeService,
  maxWaitMs: number,
  maxBatchSize: number
): Promise<Array<{ requestId: string; request: { endpoint: string; data: unknown } }>> {
  const startTime = Date.now();
  const pollInterval = 50; // Check every 50ms
  
  while (Date.now() - startTime < maxWaitMs) {
    const requests = bridge.getPendingRequests(maxBatchSize);
    if (requests.length > 0) {
      return requests;
    }
    
    // Wait a bit before checking again
    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }
  
  return [];
}

// =============================================================================
// HTTP Server Factory
// =============================================================================

export function createHttpServer(tools: RobloxStudioTools, bridge: BridgeService) {
  const app = express();
  
  // Connection state tracking
  let pluginConnected = false;
  let mcpServerActive = false;
  let lastMCPActivity = 0;
  let mcpServerStartTime = 0;
  let lastPluginActivity = 0;

  // ==========================================================================
  // MCP Server Lifecycle Management
  // ==========================================================================

  const setMCPServerActive = (active: boolean) => {
    mcpServerActive = active;
    if (active) {
      mcpServerStartTime = Date.now();
      lastMCPActivity = Date.now();
    } else {
      mcpServerStartTime = 0;
      lastMCPActivity = 0;
    }
  };

  const trackMCPActivity = () => {
    if (mcpServerActive) {
      lastMCPActivity = Date.now();
    }
  };

  const isMCPServerActive = () => {
    // Simplified: just check if server was marked active
    // The timeout mechanism was causing connection issues
    return mcpServerActive;
  };

  const isPluginConnected = () => {
    return pluginConnected && (Date.now() - lastPluginActivity < 10000);
  };

  // ==========================================================================
  // Middleware Setup
  // ==========================================================================

  app.use(cors());
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));

  // Keep-alive optimization for frequent polling
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Keep-Alive', 'timeout=5, max=1000');
    next();
  });

  // Track MCP activity for all MCP endpoints
  app.use('/mcp/*', (_req: Request, _res: Response, next: NextFunction) => {
    trackMCPActivity();
    next();
  });

  // ==========================================================================
  // Core Endpoints
  // ==========================================================================

  app.get('/health', (_req: Request, res: Response) => {
    res.json({ 
      status: 'ok', 
      service: 'roblox-mcp',
      version: '2.1.0',
      pluginConnected,
      mcpServerActive: isMCPServerActive(),
      uptime: mcpServerActive ? Date.now() - mcpServerStartTime : 0,
      pendingRequests: bridge.getPendingCount()
    });
  });

  app.post('/ready', (_req: Request, res: Response) => {
    pluginConnected = true;
    lastPluginActivity = Date.now();
    res.json({ success: true });
  });

  app.post('/disconnect', (_req: Request, res: Response) => {
    pluginConnected = false;
    bridge.clearAllPendingRequests();
    res.json({ success: true });
  });

  app.get('/status', (_req: Request, res: Response) => {
    res.json({ 
      pluginConnected,
      mcpServerActive: isMCPServerActive(),
      lastMCPActivity,
      uptime: mcpServerActive ? Date.now() - mcpServerStartTime : 0,
      pendingRequests: bridge.getPendingCount()
    });
  });

  // ==========================================================================
  // Polling Endpoint with Long Polling and Batching
  // ==========================================================================

  app.get('/poll', async (req: Request, res: Response) => {
    // Track plugin activity
    if (!pluginConnected) {
      pluginConnected = true;
    }
    lastPluginActivity = Date.now();
    
    // Always refresh MCP activity on poll if server is supposed to be active
    // This prevents timeout from being permanent once started
    if (mcpServerActive) {
      lastMCPActivity = Date.now();
    }
    
    if (!isMCPServerActive()) {
      res.status(503).json({ 
        error: 'MCP server not connected',
        pluginConnected: true,
        mcpConnected: false,
        requests: []
      });
      return;
    }
    
    trackMCPActivity();
    
    // Parse query params for long polling config
    const longPoll = req.query.longPoll !== 'false';
    const maxWait = Math.min(parseInt(req.query.maxWait as string) || 5000, 30000);
    const maxBatch = Math.min(parseInt(req.query.maxBatch as string) || 10, 50);
    
    let requests: Array<{ requestId: string; request: { endpoint: string; data: unknown } }>;
    
    if (longPoll) {
      // Long polling: wait up to maxWait for requests
      requests = await waitForRequests(bridge, maxWait, maxBatch);
    } else {
      // Short polling: return immediately
      requests = bridge.getPendingRequests(maxBatch);
    }
    
    if (requests.length > 0) {
      res.json({ 
        requests,
        mcpConnected: true,
        pluginConnected: true,
        batchSize: requests.length
      });
    } else {
      res.json({ 
        requests: [],
        mcpConnected: true,
        pluginConnected: true,
        batchSize: 0
      });
    }
  });

  // ==========================================================================
  // Response Endpoint with Batch Support
  // ==========================================================================

  app.post('/response', (req: Request, res: Response) => {
    const { requestId, response, error, responses } = req.body;
    
    // Support both single response and batch responses
    if (responses && Array.isArray(responses)) {
      // Batch response mode
      const result = bridge.resolveRequests(responses);
      res.json({ 
        success: true, 
        resolved: result.resolved,
        notFound: result.notFound
      });
    } else if (requestId) {
      // Single response mode (backward compatible)
      if (!bridge.hasPendingRequest(requestId)) {
        res.status(404).json({ error: 'Request not found or already resolved' });
        return;
      }
      
      if (error) {
        bridge.rejectRequest(requestId, error);
      } else {
        bridge.resolveRequest(requestId, response);
      }
      
      res.json({ success: true });
    } else {
      res.status(400).json({ error: 'requestId or responses array is required' });
    }
  });

  // ==========================================================================
  // MCP Tool Routes (Updated for v2.0.0)
  // ==========================================================================

  const toolRoutes: RouteDefinition[] = [
    // Batch
    { 
      path: '/mcp/batch', 
      handler: (body) => tools.batch(
        body.operations as Array<{tool: string; args: Record<string, unknown>}>,
        body.continueOnError as boolean
      )
    },
    
    // Search (consolidated)
    { 
      path: '/mcp/search_instances', 
      handler: (body) => tools.searchInstances(
        body.query as string,
        body.searchType as string,
        body.scope as string,
        body.propertyName as string,
        body.propertyValue,
        body.maxResults as number
      )
    },
    
    // Hierarchy
    { path: '/mcp/get_project_structure', handler: (body) => tools.getProjectStructure(body.path as string, body.maxDepth as number, body.scriptsOnly as boolean) },
    
    // Studio Context
    { path: '/mcp/get_place_info', handler: () => tools.getPlaceInfo() },
    { path: '/mcp/get_services', handler: (body) => tools.getServices(body.serviceName as string) },
    
    // Property & Instance
    { path: '/mcp/get_instance_properties', handler: (body) => tools.getInstanceProperties(body.instancePath as string) },
    { path: '/mcp/get_instance_children', handler: (body) => tools.getInstanceChildren(body.instancePath as string) },
    { path: '/mcp/get_class_info', handler: (body) => tools.getClassInfo(body.className as string) },
    
    // Property Modification
    { path: '/mcp/set_property', handler: (body) => tools.setProperty(body.instancePath as string, body.propertyName as string, body.propertyValue) },
    { path: '/mcp/mass_set_property', handler: (body) => tools.massSetProperty(body.paths as string[], body.propertyName as string, body.propertyValue) },
    { path: '/mcp/mass_get_property', handler: (body) => tools.massGetProperty(body.paths as string[], body.propertyName as string) },
    { path: '/mcp/mass_set_properties', handler: (body) => tools.massSetProperties(body.paths as string[], body.properties as Record<string, unknown>) },
    
    // Object Creation/Deletion (consolidated)
    { path: '/mcp/create_object', handler: (body) => tools.createObject(body.className as string, body.parent as string, body.name as string, body.properties as Record<string, unknown>) },
    { path: '/mcp/mass_create_objects', handler: (body) => tools.massCreateObjects(body.objects as Array<{className: string; parent: string; name?: string; properties?: Record<string, unknown>}>) },
    { path: '/mcp/delete_object', handler: (body) => tools.deleteObject(body.instancePath as string) },
    
    // Smart Duplication
    { path: '/mcp/smart_duplicate', handler: (body) => tools.smartDuplicate(body.instancePath as string, body.count as number, body.options as Parameters<typeof tools.smartDuplicate>[2]) },
    { path: '/mcp/mass_duplicate', handler: (body) => tools.massDuplicate(body.duplications as Parameters<typeof tools.massDuplicate>[0]) },
    
    // Calculated/Relative Properties
    { path: '/mcp/set_calculated_property', handler: (body) => tools.setCalculatedProperty(body.paths as string[], body.propertyName as string, body.formula as string, body.variables as Record<string, unknown>) },
    { path: '/mcp/set_relative_property', handler: (body) => tools.setRelativeProperty(body.paths as string[], body.propertyName as string, body.operation as 'add' | 'multiply' | 'divide' | 'subtract' | 'power', body.value, body.component as 'X' | 'Y' | 'Z') },
    
    // Script Management (consolidated + mass)
    { path: '/mcp/get_script_source', handler: (body) => tools.getScriptSource(body.instancePath as string, body.startLine as number, body.endLine as number) },
    { path: '/mcp/set_script_source', handler: (body) => tools.setScriptSource(body.instancePath as string, body.source as string) },
    { path: '/mcp/edit_script', handler: (body) => tools.editScript(body.instancePath as string, body.operation as 'replace' | 'insert' | 'delete', body.startLine as number, body.endLine as number, body.afterLine as number, body.content as string) },
    { path: '/mcp/mass_get_script_source', handler: (body) => tools.massGetScriptSource(body.paths as string[], body.startLine as number, body.endLine as number) },
    { path: '/mcp/mass_set_script_source', handler: (body) => tools.massSetScriptSource(body.scripts as Array<{instancePath: string; source: string}>) },
    
    // Attributes (consolidated + mass)
    { path: '/mcp/get_attributes', handler: (body) => tools.getAttributes(body.instancePath as string, body.attributeName as string) },
    { path: '/mcp/set_attribute', handler: (body) => tools.setAttribute(body.instancePath as string, body.attributeName as string, body.attributeValue, body.valueType as string) },
    { path: '/mcp/delete_attribute', handler: (body) => tools.deleteAttribute(body.instancePath as string, body.attributeName as string) },
    { path: '/mcp/mass_get_attributes', handler: (body) => tools.massGetAttributes(body.paths as string[], body.attributeName as string) },
    { path: '/mcp/mass_set_attribute', handler: (body) => tools.massSetAttribute(body.paths as string[], body.attributeName as string, body.attributeValue, body.valueType as string) },
    
    // Tags (CollectionService) + mass
    { path: '/mcp/get_tags', handler: (body) => tools.getTags(body.instancePath as string) },
    { path: '/mcp/add_tag', handler: (body) => tools.addTag(body.instancePath as string, body.tagName as string) },
    { path: '/mcp/remove_tag', handler: (body) => tools.removeTag(body.instancePath as string, body.tagName as string) },
    { path: '/mcp/get_tagged', handler: (body) => tools.getTagged(body.tagName as string) },
    { path: '/mcp/mass_add_tag', handler: (body) => tools.massAddTag(body.paths as string[], body.tagName as string) },
    { path: '/mcp/mass_remove_tag', handler: (body) => tools.massRemoveTag(body.paths as string[], body.tagName as string) },
    
    // Selection
    { path: '/mcp/get_selection', handler: () => tools.getSelection() },
    
    // Creator Store / Assets
    { path: '/mcp/insert_asset', handler: (body) => tools.insertAsset(body.assetId as number, body.parent as string, body.position as [number, number, number], body.name as string) },
    { path: '/mcp/insert_multiple_assets', handler: (body) => tools.insertMultipleAssets(body.assets as Array<{assetId: number; parent: string; position?: [number, number, number]; name?: string}>) },
    { path: '/mcp/get_asset_info', handler: (body) => tools.getAssetInfo(body.assetId as number) },
    { path: '/mcp/search_asset_catalog', handler: (body) => tools.searchAssetCatalog(body.query as string, body.category as string, body.maxResults as number) },
    { path: '/mcp/list_asset_categories', handler: () => tools.listAssetCategories() },
  ];

  // Register all tool routes
  registerToolRoutes(app, toolRoutes);

  // ==========================================================================
  // Expose Server Control Methods
  // ==========================================================================

  (app as Express & { 
    isPluginConnected: typeof isPluginConnected;
    setMCPServerActive: typeof setMCPServerActive;
    isMCPServerActive: typeof isMCPServerActive;
    trackMCPActivity: typeof trackMCPActivity;
  }).isPluginConnected = isPluginConnected;
  (app as Express & { setMCPServerActive: typeof setMCPServerActive }).setMCPServerActive = setMCPServerActive;
  (app as Express & { isMCPServerActive: typeof isMCPServerActive }).isMCPServerActive = isMCPServerActive;
  (app as Express & { trackMCPActivity: typeof trackMCPActivity }).trackMCPActivity = trackMCPActivity;

  return app;
}
