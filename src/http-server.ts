import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { RobloxStudioTools } from './tools/index.js';
import { BridgeService } from './bridge-service.js';

// =============================================================================
// Route Factory - Reduces code duplication for MCP tool endpoints
// =============================================================================

type ToolHandler = (body: Record<string, unknown>) => Promise<unknown>;

interface RouteDefinition {
  path: string;
  handler: ToolHandler;
}

/**
 * Creates a POST route with standardized error handling
 */
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

/**
 * Registers multiple tool routes at once
 */
function registerToolRoutes(app: Express, routes: RouteDefinition[]): void {
  for (const route of routes) {
    createToolRoute(app, route.path, route.handler);
  }
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
    return mcpServerActive && (Date.now() - lastMCPActivity < 15000); // 15 second timeout
  };

  const isPluginConnected = () => {
    // Consider plugin disconnected if no activity for 10 seconds
    return pluginConnected && (Date.now() - lastPluginActivity < 10000);
  };

  // ==========================================================================
  // Middleware Setup
  // ==========================================================================

  app.use(cors());
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));

  // Track MCP activity for all MCP endpoints
  app.use('/mcp/*', (_req: Request, _res: Response, next: NextFunction) => {
    trackMCPActivity();
    next();
  });

  // ==========================================================================
  // Core Endpoints (Health, Status, Polling)
  // ==========================================================================

  // Health check endpoint
  app.get('/health', (_req: Request, res: Response) => {
    res.json({ 
      status: 'ok', 
      service: 'robloxstudio-mcp',
      pluginConnected,
      mcpServerActive: isMCPServerActive(),
      uptime: mcpServerActive ? Date.now() - mcpServerStartTime : 0
    });
  });

  // Plugin readiness endpoint
  app.post('/ready', (_req: Request, res: Response) => {
    pluginConnected = true;
    lastPluginActivity = Date.now();
    res.json({ success: true });
  });

  // Plugin disconnect endpoint
  app.post('/disconnect', (_req: Request, res: Response) => {
    pluginConnected = false;
    bridge.clearAllPendingRequests();
    res.json({ success: true });
  });

  // Enhanced status endpoint
  app.get('/status', (_req: Request, res: Response) => {
    res.json({ 
      pluginConnected,
      mcpServerActive: isMCPServerActive(),
      lastMCPActivity,
      uptime: mcpServerActive ? Date.now() - mcpServerStartTime : 0
    });
  });

  // Polling endpoint for Studio plugin
  app.get('/poll', (_req: Request, res: Response) => {
    // Track plugin activity
    if (!pluginConnected) {
      pluginConnected = true;
    }
    lastPluginActivity = Date.now();
    
    if (!isMCPServerActive()) {
      res.status(503).json({ 
        error: 'MCP server not connected',
        pluginConnected: true,
        mcpConnected: false,
        request: null
      });
      return;
    }
    
    trackMCPActivity();
    
    const pendingRequest = bridge.getPendingRequest();
    if (pendingRequest) {
      res.json({ 
        request: pendingRequest.request, 
        requestId: pendingRequest.requestId,
        mcpConnected: true,
        pluginConnected: true
      });
    } else {
      res.json({ 
        request: null,
        mcpConnected: true,
        pluginConnected: true
      });
    }
  });

  // Response endpoint for Studio plugin
  app.post('/response', (req: Request, res: Response) => {
    const { requestId, response, error } = req.body;
    
    if (error) {
      bridge.rejectRequest(requestId, error);
    } else {
      bridge.resolveRequest(requestId, response);
    }
    
    res.json({ success: true });
  });

  // ==========================================================================
  // MCP Tool Routes - Using Route Factory
  // ==========================================================================

  const toolRoutes: RouteDefinition[] = [
    // File System / Instance Hierarchy
    { path: '/mcp/get_file_tree', handler: (body) => tools.getFileTree(body.path as string) },
    { path: '/mcp/search_files', handler: (body) => tools.searchFiles(body.query as string, body.searchType as string) },
    
    // Studio Context
    { path: '/mcp/get_place_info', handler: () => tools.getPlaceInfo() },
    { path: '/mcp/get_services', handler: (body) => tools.getServices(body.serviceName as string) },
    { path: '/mcp/search_objects', handler: (body) => tools.searchObjects(body.query as string, body.searchType as string, body.propertyName as string) },
    
    // Property & Instance
    { path: '/mcp/get_instance_properties', handler: (body) => tools.getInstanceProperties(body.instancePath as string) },
    { path: '/mcp/get_instance_children', handler: (body) => tools.getInstanceChildren(body.instancePath as string) },
    { path: '/mcp/search_by_property', handler: (body) => tools.searchByProperty(body.propertyName as string, body.propertyValue as string) },
    { path: '/mcp/get_class_info', handler: (body) => tools.getClassInfo(body.className as string) },
    
    // Project Structure
    { path: '/mcp/get_project_structure', handler: (body) => tools.getProjectStructure(body.path as string, body.maxDepth as number, body.scriptsOnly as boolean) },
    
    // Property Modification
    { path: '/mcp/set_property', handler: (body) => tools.setProperty(body.instancePath as string, body.propertyName as string, body.propertyValue) },
    { path: '/mcp/mass_set_property', handler: (body) => tools.massSetProperty(body.paths as string[], body.propertyName as string, body.propertyValue) },
    { path: '/mcp/mass_get_property', handler: (body) => tools.massGetProperty(body.paths as string[], body.propertyName as string) },
    
    // Object Creation/Deletion
    { path: '/mcp/create_object', handler: (body) => tools.createObject(body.className as string, body.parent as string, body.name as string) },
    { path: '/mcp/create_object_with_properties', handler: (body) => tools.createObjectWithProperties(body.className as string, body.parent as string, body.name as string, body.properties as Record<string, unknown>) },
    { path: '/mcp/mass_create_objects', handler: (body) => tools.massCreateObjects(body.objects as Array<{className: string, parent: string, name?: string}>) },
    { path: '/mcp/mass_create_objects_with_properties', handler: (body) => tools.massCreateObjectsWithProperties(body.objects as Array<{className: string, parent: string, name?: string, properties?: Record<string, unknown>}>) },
    { path: '/mcp/delete_object', handler: (body) => tools.deleteObject(body.instancePath as string) },
    
    // Smart Duplication
    { path: '/mcp/smart_duplicate', handler: (body) => tools.smartDuplicate(body.instancePath as string, body.count as number, body.options as Parameters<typeof tools.smartDuplicate>[2]) },
    { path: '/mcp/mass_duplicate', handler: (body) => tools.massDuplicate(body.duplications as Parameters<typeof tools.massDuplicate>[0]) },
    
    // Calculated/Relative Properties
    { path: '/mcp/set_calculated_property', handler: (body) => tools.setCalculatedProperty(body.paths as string[], body.propertyName as string, body.formula as string, body.variables as Record<string, unknown>) },
    { path: '/mcp/set_relative_property', handler: (body) => tools.setRelativeProperty(body.paths as string[], body.propertyName as string, body.operation as 'add' | 'multiply' | 'divide' | 'subtract' | 'power', body.value, body.component as 'X' | 'Y' | 'Z') },
    
    // Script Management
    { path: '/mcp/get_script_source', handler: (body) => tools.getScriptSource(body.instancePath as string, body.startLine as number, body.endLine as number) },
    { path: '/mcp/set_script_source', handler: (body) => tools.setScriptSource(body.instancePath as string, body.source as string) },
    { path: '/mcp/edit_script_lines', handler: (body) => tools.editScriptLines(body.instancePath as string, body.startLine as number, body.endLine as number, body.newContent as string) },
    { path: '/mcp/insert_script_lines', handler: (body) => tools.insertScriptLines(body.instancePath as string, body.afterLine as number, body.newContent as string) },
    { path: '/mcp/delete_script_lines', handler: (body) => tools.deleteScriptLines(body.instancePath as string, body.startLine as number, body.endLine as number) },
    
    // Attributes
    { path: '/mcp/get_attribute', handler: (body) => tools.getAttribute(body.instancePath as string, body.attributeName as string) },
    { path: '/mcp/set_attribute', handler: (body) => tools.setAttribute(body.instancePath as string, body.attributeName as string, body.attributeValue, body.valueType as string) },
    { path: '/mcp/get_attributes', handler: (body) => tools.getAttributes(body.instancePath as string) },
    { path: '/mcp/delete_attribute', handler: (body) => tools.deleteAttribute(body.instancePath as string, body.attributeName as string) },
    
    // Tags (CollectionService)
    { path: '/mcp/get_tags', handler: (body) => tools.getTags(body.instancePath as string) },
    { path: '/mcp/add_tag', handler: (body) => tools.addTag(body.instancePath as string, body.tagName as string) },
    { path: '/mcp/remove_tag', handler: (body) => tools.removeTag(body.instancePath as string, body.tagName as string) },
    { path: '/mcp/get_tagged', handler: (body) => tools.getTagged(body.tagName as string) },
    
    // Selection
    { path: '/mcp/get_selection', handler: () => tools.getSelection() },
    
    // Creator Store / Assets
    { path: '/mcp/insert_asset', handler: (body) => tools.insertAsset(body.assetId as number, body.parent as string, body.position as [number, number, number], body.name as string) },
    { path: '/mcp/insert_multiple_assets', handler: (body) => tools.insertMultipleAssets(body.assets as Array<{assetId: number, parent: string, position?: [number, number, number], name?: string}>) },
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
