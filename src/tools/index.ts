import { StudioHttpClient } from './studio-client.js';
import { BridgeService } from '../bridge-service.js';
import type { 
  SmartDuplicateOptions,
  CatalogAsset,
  AssetCatalog,
  BatchResult
} from '../types/tool-args.js';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// ESM equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// =============================================================================
// Cache Configuration
// =============================================================================

interface CacheEntry {
  data: unknown;
  timestamp: number;
}

interface CacheConfig {
  enabled: boolean;
  defaultTTL: number;
  maxSize: number;
}

// =============================================================================
// RobloxStudioTools Class
// =============================================================================

export class RobloxStudioTools {
  private client: StudioHttpClient;
  private cache: Map<string, CacheEntry> = new Map();
  private cacheConfig: CacheConfig = {
    enabled: true,
    defaultTTL: 5000,
    maxSize: 100
  };
  private assetCatalog: AssetCatalog | null = null;

  constructor(bridge: BridgeService) {
    this.client = new StudioHttpClient(bridge);
    this.loadAssetCatalog();
  }

  // ===========================================================================
  // Helper Methods
  // ===========================================================================

  private formatMcpResponse(response: unknown) {
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(response, null, 2)
        }
      ]
    };
  }

  private getCached(key: string): unknown | null {
    if (!this.cacheConfig.enabled) return null;
    
    const entry = this.cache.get(key);
    if (!entry) return null;
    
    if (Date.now() - entry.timestamp > this.cacheConfig.defaultTTL) {
      this.cache.delete(key);
      return null;
    }
    
    return entry.data;
  }

  private setCache(key: string, data: unknown): void {
    if (!this.cacheConfig.enabled) return;
    
    if (this.cache.size >= this.cacheConfig.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) this.cache.delete(oldestKey);
    }
    
    this.cache.set(key, { data, timestamp: Date.now() });
  }

  public invalidateCache(pattern?: string): void {
    if (!pattern) {
      this.cache.clear();
      return;
    }
    
    for (const key of this.cache.keys()) {
      if (key.includes(pattern)) {
        this.cache.delete(key);
      }
    }
  }

  private loadAssetCatalog(): void {
    try {
      const possiblePaths = [
        join(process.cwd(), 'src', 'data', 'asset-catalog.json'),
        join(process.cwd(), 'dist', 'data', 'asset-catalog.json'),
        join(__dirname, '..', 'data', 'asset-catalog.json'),
        join(__dirname, 'data', 'asset-catalog.json'),
      ];
      
      for (const catalogPath of possiblePaths) {
        try {
          if (existsSync(catalogPath)) {
            const catalogData = readFileSync(catalogPath, 'utf-8');
            this.assetCatalog = JSON.parse(catalogData) as AssetCatalog;
            return;
          }
        } catch {
          // Continue to next path
        }
      }
      
      console.error('Asset catalog not found in any expected location');
      this.assetCatalog = null;
    } catch (error) {
      console.error('Failed to load asset catalog:', error);
      this.assetCatalog = null;
    }
  }

  private validateRequired(value: unknown, name: string): void {
    if (value === undefined || value === null || value === '') {
      throw new Error(`${name} is required`);
    }
  }

  private getParentPath(instancePath: string): string {
    const lastDot = instancePath.lastIndexOf('.');
    return lastDot > 0 ? instancePath.substring(0, lastDot) : '';
  }

  // ===========================================================================
  // BATCH TOOL - Execute multiple operations
  // ===========================================================================

  async batch(
    operations: Array<{tool: string; args: Record<string, unknown>}>,
    continueOnError: boolean = false
  ) {
    if (!operations || operations.length === 0) {
      throw new Error('Operations array is required for batch');
    }

    const results: BatchResult['results'] = [];
    let successCount = 0;
    let errorCount = 0;

    for (const op of operations) {
      try {
        const result = await this.executeTool(op.tool, op.args);
        results.push({
          tool: op.tool,
          success: true,
          result
        });
        successCount++;
      } catch (error) {
        errorCount++;
        results.push({
          tool: op.tool,
          success: false,
          error: error instanceof Error ? error.message : String(error)
        });
        
        if (!continueOnError) {
          break;
        }
      }
    }

    return this.formatMcpResponse({
      results,
      successCount,
      errorCount,
      totalOperations: operations.length
    });
  }

  private async executeTool(tool: string, args: Record<string, unknown>): Promise<unknown> {
    switch (tool) {
      case 'search_instances':
        return await this.searchInstances(
          args.query as string,
          args.searchType as string,
          args.scope as string,
          args.propertyName as string,
          args.propertyValue,
          args.maxResults as number
        );
      case 'get_project_structure':
        return await this.getProjectStructure(args.path as string, args.maxDepth as number, args.scriptsOnly as boolean);
      case 'get_place_info':
        return await this.getPlaceInfo();
      case 'get_services':
        return await this.getServices(args.serviceName as string);
      case 'get_instance_properties':
        return await this.getInstanceProperties(args.instancePath as string);
      case 'get_instance_children':
        return await this.getInstanceChildren(args.instancePath as string);
      case 'get_class_info':
        return await this.getClassInfo(args.className as string);
      case 'set_property':
        return await this.setProperty(args.instancePath as string, args.propertyName as string, args.propertyValue);
      case 'mass_set_property':
        return await this.massSetProperty(args.paths as string[], args.propertyName as string, args.propertyValue);
      case 'mass_get_property':
        return await this.massGetProperty(args.paths as string[], args.propertyName as string);
      case 'mass_set_properties':
        return await this.massSetProperties(args.paths as string[], args.properties as Record<string, unknown>);
      case 'create_object':
        return await this.createObject(args.className as string, args.parent as string, args.name as string, args.properties as Record<string, unknown>);
      case 'mass_create_objects':
        return await this.massCreateObjects(args.objects as Array<{className: string; parent: string; name?: string; properties?: Record<string, unknown>}>);
      case 'delete_object':
        return await this.deleteObject(args.instancePath as string);
      case 'smart_duplicate':
        return await this.smartDuplicate(args.instancePath as string, args.count as number, args.options as SmartDuplicateOptions);
      case 'mass_duplicate':
        return await this.massDuplicate(args.duplications as Array<{instancePath: string; count: number; options?: SmartDuplicateOptions}>);
      case 'set_calculated_property':
        return await this.setCalculatedProperty(args.paths as string[], args.propertyName as string, args.formula as string, args.variables as Record<string, unknown>);
      case 'set_relative_property':
        return await this.setRelativeProperty(args.paths as string[], args.propertyName as string, args.operation as 'add' | 'multiply' | 'divide' | 'subtract' | 'power', args.value, args.component as 'X' | 'Y' | 'Z');
      case 'get_script_source':
        return await this.getScriptSource(args.instancePath as string, args.startLine as number, args.endLine as number);
      case 'set_script_source':
        return await this.setScriptSource(args.instancePath as string, args.source as string);
      case 'edit_script':
        return await this.editScript(args.instancePath as string, args.operation as 'replace' | 'insert' | 'delete', args.startLine as number, args.endLine as number, args.afterLine as number, args.content as string);
      case 'mass_get_script_source':
        return await this.massGetScriptSource(args.paths as string[], args.startLine as number, args.endLine as number);
      case 'mass_set_script_source':
        return await this.massSetScriptSource(args.scripts as Array<{instancePath: string; source: string}>);
      case 'get_attributes':
        return await this.getAttributes(args.instancePath as string, args.attributeName as string);
      case 'set_attribute':
        return await this.setAttribute(args.instancePath as string, args.attributeName as string, args.attributeValue, args.valueType as string);
      case 'delete_attribute':
        return await this.deleteAttribute(args.instancePath as string, args.attributeName as string);
      case 'mass_get_attributes':
        return await this.massGetAttributes(args.paths as string[], args.attributeName as string);
      case 'mass_set_attribute':
        return await this.massSetAttribute(args.paths as string[], args.attributeName as string, args.attributeValue, args.valueType as string);
      case 'get_tags':
        return await this.getTags(args.instancePath as string);
      case 'add_tag':
        return await this.addTag(args.instancePath as string, args.tagName as string);
      case 'remove_tag':
        return await this.removeTag(args.instancePath as string, args.tagName as string);
      case 'get_tagged':
        return await this.getTagged(args.tagName as string);
      case 'mass_add_tag':
        return await this.massAddTag(args.paths as string[], args.tagName as string);
      case 'mass_remove_tag':
        return await this.massRemoveTag(args.paths as string[], args.tagName as string);
      case 'get_selection':
        return await this.getSelection();
      case 'insert_asset':
        return await this.insertAsset(args.assetId as number, args.parent as string, args.position as [number, number, number], args.name as string);
      case 'insert_multiple_assets':
        return await this.insertMultipleAssets(args.assets as Array<{assetId: number; parent: string; position?: [number, number, number]; name?: string}>);
      case 'get_asset_info':
        return await this.getAssetInfo(args.assetId as number);
      case 'search_asset_catalog':
        return await this.searchAssetCatalog(args.query as string, args.category as string, args.maxResults as number);
      case 'list_asset_categories':
        return await this.listAssetCategories();
      default:
        throw new Error(`Unknown tool in batch: ${tool}`);
    }
  }

  // ===========================================================================
  // SEARCH (Consolidated)
  // ===========================================================================

  async searchInstances(
    query: string,
    searchType: string = 'name',
    scope?: string,
    propertyName?: string,
    propertyValue?: unknown,
    maxResults: number = 100
  ) {
    this.validateRequired(query, 'query');
    
    const response = await this.client.request('/api/search-instances', {
      query,
      searchType,
      scope,
      propertyName,
      propertyValue,
      maxResults
    });
    return this.formatMcpResponse(response);
  }

  // ===========================================================================
  // HIERARCHY (Consolidated)
  // ===========================================================================

  async getProjectStructure(path?: string, maxDepth?: number, scriptsOnly?: boolean) {
    const cacheKey = `project-structure:${path || ''}:${maxDepth || 3}:${scriptsOnly || false}`;
    const cached = this.getCached(cacheKey);
    if (cached) return this.formatMcpResponse(cached);
    
    const response = await this.client.request('/api/project-structure', { 
      path, 
      maxDepth, 
      scriptsOnly 
    });
    this.setCache(cacheKey, response);
    return this.formatMcpResponse(response);
  }

  // ===========================================================================
  // Studio Context Tools
  // ===========================================================================

  async getPlaceInfo() {
    const cacheKey = 'place-info';
    const cached = this.getCached(cacheKey);
    if (cached) return this.formatMcpResponse(cached);
    
    const response = await this.client.request('/api/place-info', {});
    this.setCache(cacheKey, response);
    return this.formatMcpResponse(response);
  }

  async getServices(serviceName?: string) {
    const cacheKey = `services:${serviceName || 'all'}`;
    const cached = this.getCached(cacheKey);
    if (cached) return this.formatMcpResponse(cached);
    
    const response = await this.client.request('/api/services', { serviceName });
    this.setCache(cacheKey, response);
    return this.formatMcpResponse(response);
  }

  // ===========================================================================
  // Property & Instance Tools
  // ===========================================================================

  async getInstanceProperties(instancePath: string) {
    this.validateRequired(instancePath, 'instancePath');
    
    const cacheKey = `props:${instancePath}`;
    const cached = this.getCached(cacheKey);
    if (cached) return this.formatMcpResponse(cached);
    
    const response = await this.client.request('/api/instance-properties', { instancePath });
    this.setCache(cacheKey, response);
    return this.formatMcpResponse(response);
  }

  async getInstanceChildren(instancePath: string) {
    this.validateRequired(instancePath, 'instancePath');
    
    const cacheKey = `children:${instancePath}`;
    const cached = this.getCached(cacheKey);
    if (cached) return this.formatMcpResponse(cached);
    
    const response = await this.client.request('/api/instance-children', { instancePath });
    this.setCache(cacheKey, response);
    return this.formatMcpResponse(response);
  }

  async getClassInfo(className: string) {
    this.validateRequired(className, 'className');
    
    const cacheKey = `class-info:${className}`;
    const cached = this.getCached(cacheKey);
    if (cached) return this.formatMcpResponse(cached);
    
    const response = await this.client.request('/api/class-info', { className });
    this.setCache(cacheKey, response);
    return this.formatMcpResponse(response);
  }

  // ===========================================================================
  // Property Modification Tools
  // ===========================================================================

  async setProperty(instancePath: string, propertyName: string, propertyValue: unknown) {
    this.validateRequired(instancePath, 'instancePath');
    this.validateRequired(propertyName, 'propertyName');
    
    this.invalidateCache(instancePath);
    
    const response = await this.client.request('/api/set-property', { 
      instancePath, 
      propertyName, 
      propertyValue 
    });
    return this.formatMcpResponse(response);
  }

  async massSetProperty(paths: string[], propertyName: string, propertyValue: unknown) {
    this.validateRequired(paths, 'paths');
    this.validateRequired(propertyName, 'propertyName');
    if (paths.length === 0) throw new Error('paths array cannot be empty');
    
    paths.forEach(path => this.invalidateCache(path));
    
    const response = await this.client.request('/api/mass-set-property', { 
      paths, 
      propertyName, 
      propertyValue 
    });
    return this.formatMcpResponse(response);
  }

  async massGetProperty(paths: string[], propertyName: string) {
    this.validateRequired(paths, 'paths');
    this.validateRequired(propertyName, 'propertyName');
    if (paths.length === 0) throw new Error('paths array cannot be empty');
    
    const response = await this.client.request('/api/mass-get-property', { 
      paths, 
      propertyName
    });
    return this.formatMcpResponse(response);
  }

  async massSetProperties(paths: string[], properties: Record<string, unknown>) {
    this.validateRequired(paths, 'paths');
    this.validateRequired(properties, 'properties');
    if (paths.length === 0) throw new Error('paths array cannot be empty');
    
    paths.forEach(path => this.invalidateCache(path));
    
    const response = await this.client.request('/api/mass-set-properties', { 
      paths, 
      properties 
    });
    return this.formatMcpResponse(response);
  }

  // ===========================================================================
  // Object Creation/Deletion Tools (Consolidated)
  // ===========================================================================

  async createObject(className: string, parent: string, name?: string, properties?: Record<string, unknown>) {
    this.validateRequired(className, 'className');
    this.validateRequired(parent, 'parent');
    
    this.invalidateCache(parent);
    
    const response = await this.client.request('/api/create-object', { 
      className, 
      parent, 
      name,
      properties 
    });
    return this.formatMcpResponse(response);
  }

  async massCreateObjects(objects: Array<{className: string; parent: string; name?: string; properties?: Record<string, unknown>}>) {
    this.validateRequired(objects, 'objects');
    if (objects.length === 0) throw new Error('objects array cannot be empty');
    
    const parents = new Set(objects.map(o => o.parent));
    parents.forEach(parent => this.invalidateCache(parent));
    
    const response = await this.client.request('/api/mass-create-objects', { objects });
    return this.formatMcpResponse(response);
  }

  async deleteObject(instancePath: string) {
    this.validateRequired(instancePath, 'instancePath');
    
    this.invalidateCache(instancePath);
    const parentPath = this.getParentPath(instancePath);
    if (parentPath) this.invalidateCache(parentPath);
    
    const response = await this.client.request('/api/delete-object', { instancePath });
    return this.formatMcpResponse(response);
  }

  // ===========================================================================
  // Smart Duplication Tools
  // ===========================================================================

  async smartDuplicate(instancePath: string, count: number, options?: SmartDuplicateOptions) {
    this.validateRequired(instancePath, 'instancePath');
    if (count < 1) throw new Error('count must be at least 1');
    
    const parentPath = this.getParentPath(instancePath);
    if (parentPath) this.invalidateCache(parentPath);
    
    const response = await this.client.request('/api/smart-duplicate', { 
      instancePath, 
      count, 
      options 
    });
    return this.formatMcpResponse(response);
  }

  async massDuplicate(duplications: Array<{instancePath: string; count: number; options?: SmartDuplicateOptions}>) {
    this.validateRequired(duplications, 'duplications');
    if (duplications.length === 0) throw new Error('duplications array cannot be empty');
    
    duplications.forEach(d => {
      const parentPath = this.getParentPath(d.instancePath);
      if (parentPath) this.invalidateCache(parentPath);
    });
    
    const response = await this.client.request('/api/mass-duplicate', { duplications });
    return this.formatMcpResponse(response);
  }

  // ===========================================================================
  // Calculated Property Tools
  // ===========================================================================

  async setCalculatedProperty(paths: string[], propertyName: string, formula: string, variables?: Record<string, unknown>) {
    this.validateRequired(paths, 'paths');
    this.validateRequired(propertyName, 'propertyName');
    this.validateRequired(formula, 'formula');
    if (paths.length === 0) throw new Error('paths array cannot be empty');
    
    paths.forEach(path => this.invalidateCache(path));
    
    const response = await this.client.request('/api/set-calculated-property', { 
      paths, 
      propertyName, 
      formula,
      variables
    });
    return this.formatMcpResponse(response);
  }

  // ===========================================================================
  // Relative Property Tools
  // ===========================================================================

  async setRelativeProperty(
    paths: string[], 
    propertyName: string, 
    operation: 'add' | 'multiply' | 'divide' | 'subtract' | 'power',
    value: unknown,
    component?: 'X' | 'Y' | 'Z'
  ) {
    this.validateRequired(paths, 'paths');
    this.validateRequired(propertyName, 'propertyName');
    this.validateRequired(operation, 'operation');
    if (paths.length === 0) throw new Error('paths array cannot be empty');
    
    paths.forEach(path => this.invalidateCache(path));
    
    const response = await this.client.request('/api/set-relative-property', { 
      paths, 
      propertyName, 
      operation,
      value,
      component
    });
    return this.formatMcpResponse(response);
  }

  // ===========================================================================
  // Script Management Tools
  // ===========================================================================

  async getScriptSource(instancePath: string, startLine?: number, endLine?: number) {
    this.validateRequired(instancePath, 'instancePath');
    
    const cacheKey = `script:${instancePath}:${startLine || 0}:${endLine || 0}`;
    const cached = this.getCached(cacheKey);
    if (cached) return this.formatMcpResponse(cached);
    
    const response = await this.client.request('/api/get-script-source', { instancePath, startLine, endLine });
    this.setCache(cacheKey, response);
    return this.formatMcpResponse(response);
  }

  async setScriptSource(instancePath: string, source: string) {
    this.validateRequired(instancePath, 'instancePath');
    if (typeof source !== 'string') throw new Error('source must be a string');
    
    this.invalidateCache(instancePath);
    
    const response = await this.client.request('/api/set-script-source', { instancePath, source });
    return this.formatMcpResponse(response);
  }

  async editScript(
    instancePath: string,
    operation: 'replace' | 'insert' | 'delete',
    startLine?: number,
    endLine?: number,
    afterLine?: number,
    content?: string
  ) {
    this.validateRequired(instancePath, 'instancePath');
    this.validateRequired(operation, 'operation');
    
    this.invalidateCache(instancePath);
    
    const response = await this.client.request('/api/edit-script', {
      instancePath,
      operation,
      startLine,
      endLine,
      afterLine: afterLine ?? 0,
      content
    });
    return this.formatMcpResponse(response);
  }

  async massGetScriptSource(paths: string[], startLine?: number, endLine?: number) {
    this.validateRequired(paths, 'paths');
    if (paths.length === 0) throw new Error('paths array cannot be empty');
    
    const response = await this.client.request('/api/mass-get-script-source', { 
      paths, 
      startLine, 
      endLine 
    });
    return this.formatMcpResponse(response);
  }

  async massSetScriptSource(scripts: Array<{instancePath: string; source: string}>) {
    this.validateRequired(scripts, 'scripts');
    if (scripts.length === 0) throw new Error('scripts array cannot be empty');
    
    scripts.forEach(s => this.invalidateCache(s.instancePath));
    
    const response = await this.client.request('/api/mass-set-script-source', { scripts });
    return this.formatMcpResponse(response);
  }

  // ===========================================================================
  // Attribute Tools (Consolidated)
  // ===========================================================================

  async getAttributes(instancePath: string, attributeName?: string) {
    this.validateRequired(instancePath, 'instancePath');
    
    const cacheKey = `attrs:${instancePath}:${attributeName || 'all'}`;
    const cached = this.getCached(cacheKey);
    if (cached) return this.formatMcpResponse(cached);
    
    const response = await this.client.request('/api/get-attributes', { instancePath, attributeName });
    this.setCache(cacheKey, response);
    return this.formatMcpResponse(response);
  }

  async setAttribute(instancePath: string, attributeName: string, attributeValue: unknown, valueType?: string) {
    this.validateRequired(instancePath, 'instancePath');
    this.validateRequired(attributeName, 'attributeName');
    
    this.invalidateCache(instancePath);
    
    const response = await this.client.request('/api/set-attribute', { instancePath, attributeName, attributeValue, valueType });
    return this.formatMcpResponse(response);
  }

  async deleteAttribute(instancePath: string, attributeName: string) {
    this.validateRequired(instancePath, 'instancePath');
    this.validateRequired(attributeName, 'attributeName');
    
    this.invalidateCache(instancePath);
    
    const response = await this.client.request('/api/delete-attribute', { instancePath, attributeName });
    return this.formatMcpResponse(response);
  }

  async massGetAttributes(paths: string[], attributeName?: string) {
    this.validateRequired(paths, 'paths');
    if (paths.length === 0) throw new Error('paths array cannot be empty');
    
    const response = await this.client.request('/api/mass-get-attributes', { paths, attributeName });
    return this.formatMcpResponse(response);
  }

  async massSetAttribute(paths: string[], attributeName: string, attributeValue: unknown, valueType?: string) {
    this.validateRequired(paths, 'paths');
    this.validateRequired(attributeName, 'attributeName');
    if (paths.length === 0) throw new Error('paths array cannot be empty');
    
    paths.forEach(path => this.invalidateCache(path));
    
    const response = await this.client.request('/api/mass-set-attribute', { paths, attributeName, attributeValue, valueType });
    return this.formatMcpResponse(response);
  }

  // ===========================================================================
  // Tag Tools (CollectionService)
  // ===========================================================================

  async getTags(instancePath: string) {
    this.validateRequired(instancePath, 'instancePath');
    
    const cacheKey = `tags:${instancePath}`;
    const cached = this.getCached(cacheKey);
    if (cached) return this.formatMcpResponse(cached);
    
    const response = await this.client.request('/api/get-tags', { instancePath });
    this.setCache(cacheKey, response);
    return this.formatMcpResponse(response);
  }

  async addTag(instancePath: string, tagName: string) {
    this.validateRequired(instancePath, 'instancePath');
    this.validateRequired(tagName, 'tagName');
    
    this.invalidateCache(instancePath);
    
    const response = await this.client.request('/api/add-tag', { instancePath, tagName });
    return this.formatMcpResponse(response);
  }

  async removeTag(instancePath: string, tagName: string) {
    this.validateRequired(instancePath, 'instancePath');
    this.validateRequired(tagName, 'tagName');
    
    this.invalidateCache(instancePath);
    
    const response = await this.client.request('/api/remove-tag', { instancePath, tagName });
    return this.formatMcpResponse(response);
  }

  async getTagged(tagName: string) {
    this.validateRequired(tagName, 'tagName');
    
    const response = await this.client.request('/api/get-tagged', { tagName });
    return this.formatMcpResponse(response);
  }

  async massAddTag(paths: string[], tagName: string) {
    this.validateRequired(paths, 'paths');
    this.validateRequired(tagName, 'tagName');
    if (paths.length === 0) throw new Error('paths array cannot be empty');
    
    paths.forEach(path => this.invalidateCache(path));
    
    const response = await this.client.request('/api/mass-add-tag', { paths, tagName });
    return this.formatMcpResponse(response);
  }

  async massRemoveTag(paths: string[], tagName: string) {
    this.validateRequired(paths, 'paths');
    this.validateRequired(tagName, 'tagName');
    if (paths.length === 0) throw new Error('paths array cannot be empty');
    
    paths.forEach(path => this.invalidateCache(path));
    
    const response = await this.client.request('/api/mass-remove-tag', { paths, tagName });
    return this.formatMcpResponse(response);
  }

  // ===========================================================================
  // Selection Tools
  // ===========================================================================

  async getSelection() {
    const response = await this.client.request('/api/get-selection', {});
    return this.formatMcpResponse(response);
  }

  // ===========================================================================
  // Creator Store / Asset Tools
  // ===========================================================================

  async insertAsset(assetId: number, parent: string, position?: [number, number, number], name?: string) {
    this.validateRequired(assetId, 'assetId');
    this.validateRequired(parent, 'parent');
    
    this.invalidateCache(parent);
    
    const response = await this.client.request('/api/insert-asset', { 
      assetId, 
      parent, 
      position,
      name
    });
    return this.formatMcpResponse(response);
  }

  async insertMultipleAssets(assets: Array<{assetId: number; parent: string; position?: [number, number, number]; name?: string}>) {
    this.validateRequired(assets, 'assets');
    if (assets.length === 0) throw new Error('assets array cannot be empty');
    
    const parents = new Set(assets.map(a => a.parent));
    parents.forEach(parent => this.invalidateCache(parent));
    
    const response = await this.client.request('/api/insert-multiple-assets', { assets });
    return this.formatMcpResponse(response);
  }

  async getAssetInfo(assetId: number) {
    this.validateRequired(assetId, 'assetId');
    
    const response = await this.client.request('/api/get-asset-info', { assetId });
    return this.formatMcpResponse(response);
  }

  async searchAssetCatalog(query: string, category?: string, maxResults: number = 10) {
    this.validateRequired(query, 'query');

    if (!this.assetCatalog) {
      this.loadAssetCatalog();
    }

    if (!this.assetCatalog) {
      return this.formatMcpResponse({
        error: 'Asset catalog not loaded',
        note: 'The curated asset catalog could not be loaded. Try using insert_asset with a known asset ID.'
      });
    }

    const results: CatalogAsset[] = [];
    const queryLower = query.toLowerCase();
    const categoryLower = category?.toLowerCase();

    for (const [cat, assets] of Object.entries(this.assetCatalog.categories)) {
      if (categoryLower && cat.toLowerCase() !== categoryLower) {
        continue;
      }

      for (const asset of assets) {
        let score = 0;
        
        if (asset.name.toLowerCase().includes(queryLower)) {
          score += 10;
        }
        
        if (asset.description.toLowerCase().includes(queryLower)) {
          score += 5;
        }
        
        for (const tag of asset.tags) {
          if (tag.toLowerCase().includes(queryLower)) {
            score += 3;
          }
        }
        
        if (cat.toLowerCase().includes(queryLower)) {
          score += 2;
        }

        if (score > 0) {
          results.push({ ...asset, category: cat });
        }
      }
    }

    results.sort((a, b) => {
      const aExact = a.name.toLowerCase() === queryLower ? 1 : 0;
      const bExact = b.name.toLowerCase() === queryLower ? 1 : 0;
      return bExact - aExact;
    });

    const limitedResults = results.slice(0, maxResults);

    return this.formatMcpResponse({
      query,
      category: category || 'all',
      results: limitedResults,
      count: limitedResults.length,
      totalMatches: results.length,
      availableCategories: Object.keys(this.assetCatalog.categories),
      note: 'This searches a curated local catalog. Use the asset ID with insert_asset to add an asset to your game.'
    });
  }

  async listAssetCategories() {
    if (!this.assetCatalog) {
      this.loadAssetCatalog();
    }

    if (!this.assetCatalog) {
      return this.formatMcpResponse({
        error: 'Asset catalog not loaded'
      });
    }

    const categories: Record<string, number> = {};
    for (const [cat, assets] of Object.entries(this.assetCatalog.categories)) {
      categories[cat] = assets.length;
    }

    return this.formatMcpResponse({
      categories,
      totalAssets: Object.values(categories).reduce((a, b) => a + b, 0),
      catalogVersion: this.assetCatalog.version,
      lastUpdated: this.assetCatalog.lastUpdated
    });
  }
}
