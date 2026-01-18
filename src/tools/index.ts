import { StudioHttpClient } from './studio-client.js';
import { BridgeService } from '../bridge-service.js';
import type { 
  SmartDuplicateOptions,
  CatalogAsset,
  AssetCatalog
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
  defaultTTL: number; // milliseconds
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
    defaultTTL: 5000, // 5 seconds
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

  /**
   * Formats a response for MCP protocol
   * Returns the standard MCP tool response shape
   */
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

  /**
   * Gets a value from cache if valid
   */
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

  /**
   * Sets a value in cache
   */
  private setCache(key: string, data: unknown): void {
    if (!this.cacheConfig.enabled) return;
    
    // Evict oldest entries if cache is full
    if (this.cache.size >= this.cacheConfig.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) this.cache.delete(oldestKey);
    }
    
    this.cache.set(key, { data, timestamp: Date.now() });
  }

  /**
   * Invalidates cache entries matching a pattern
   */
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

  /**
   * Loads the asset catalog from JSON file
   */
  private loadAssetCatalog(): void {
    try {
      // Try multiple possible locations for the catalog
      const possiblePaths = [
        join(process.cwd(), 'src', 'data', 'asset-catalog.json'),
        join(process.cwd(), 'dist', 'data', 'asset-catalog.json'),
        // For npm package installation
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
      
      // If no catalog found, log warning but don't fail
      console.error('Asset catalog not found in any expected location');
      this.assetCatalog = null;
    } catch (error) {
      console.error('Failed to load asset catalog:', error);
      this.assetCatalog = null;
    }
  }

  // ===========================================================================
  // File System / Instance Hierarchy Tools
  // ===========================================================================

  async getFileTree(path: string = '') {
    const cacheKey = `file-tree:${path}`;
    const cached = this.getCached(cacheKey);
    if (cached) return this.formatMcpResponse(cached);
    
    const response = await this.client.request('/api/file-tree', { path });
    this.setCache(cacheKey, response);
    return this.formatMcpResponse(response);
  }

  async searchFiles(query: string, searchType: string = 'name') {
    const response = await this.client.request('/api/search-files', { query, searchType });
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

  async searchObjects(query: string, searchType: string = 'name', propertyName?: string) {
    const response = await this.client.request('/api/search-objects', { 
      query, 
      searchType, 
      propertyName 
    });
    return this.formatMcpResponse(response);
  }

  // ===========================================================================
  // Property & Instance Tools
  // ===========================================================================

  async getInstanceProperties(instancePath: string) {
    if (!instancePath) {
      throw new Error('Instance path is required for get_instance_properties');
    }
    
    const cacheKey = `props:${instancePath}`;
    const cached = this.getCached(cacheKey);
    if (cached) return this.formatMcpResponse(cached);
    
    const response = await this.client.request('/api/instance-properties', { instancePath });
    this.setCache(cacheKey, response);
    return this.formatMcpResponse(response);
  }

  async getInstanceChildren(instancePath: string) {
    if (!instancePath) {
      throw new Error('Instance path is required for get_instance_children');
    }
    
    const cacheKey = `children:${instancePath}`;
    const cached = this.getCached(cacheKey);
    if (cached) return this.formatMcpResponse(cached);
    
    const response = await this.client.request('/api/instance-children', { instancePath });
    this.setCache(cacheKey, response);
    return this.formatMcpResponse(response);
  }

  async searchByProperty(propertyName: string, propertyValue: string) {
    if (!propertyName || !propertyValue) {
      throw new Error('Property name and value are required for search_by_property');
    }
    const response = await this.client.request('/api/search-by-property', { 
      propertyName, 
      propertyValue 
    });
    return this.formatMcpResponse(response);
  }

  async getClassInfo(className: string) {
    if (!className) {
      throw new Error('Class name is required for get_class_info');
    }
    
    const cacheKey = `class-info:${className}`;
    const cached = this.getCached(cacheKey);
    if (cached) return this.formatMcpResponse(cached);
    
    const response = await this.client.request('/api/class-info', { className });
    this.setCache(cacheKey, response);
    return this.formatMcpResponse(response);
  }

  // ===========================================================================
  // Project Tools
  // ===========================================================================

  async getProjectStructure(path?: string, maxDepth?: number, scriptsOnly?: boolean) {
    const response = await this.client.request('/api/project-structure', { 
      path, 
      maxDepth, 
      scriptsOnly 
    });
    return this.formatMcpResponse(response);
  }

  // ===========================================================================
  // Property Modification Tools
  // ===========================================================================

  async setProperty(instancePath: string, propertyName: string, propertyValue: unknown) {
    if (!instancePath || !propertyName) {
      throw new Error('Instance path and property name are required for set_property');
    }
    
    // Invalidate cache for this instance
    this.invalidateCache(instancePath);
    
    const response = await this.client.request('/api/set-property', { 
      instancePath, 
      propertyName, 
      propertyValue 
    });
    return this.formatMcpResponse(response);
  }

  async massSetProperty(paths: string[], propertyName: string, propertyValue: unknown) {
    if (!paths || paths.length === 0 || !propertyName) {
      throw new Error('Paths array and property name are required for mass_set_property');
    }
    
    // Invalidate cache for all affected instances
    paths.forEach(path => this.invalidateCache(path));
    
    const response = await this.client.request('/api/mass-set-property', { 
      paths, 
      propertyName, 
      propertyValue 
    });
    return this.formatMcpResponse(response);
  }

  async massGetProperty(paths: string[], propertyName: string) {
    if (!paths || paths.length === 0 || !propertyName) {
      throw new Error('Paths array and property name are required for mass_get_property');
    }
    const response = await this.client.request('/api/mass-get-property', { 
      paths, 
      propertyName
    });
    return this.formatMcpResponse(response);
  }

  // ===========================================================================
  // Object Creation/Deletion Tools
  // ===========================================================================

  async createObject(className: string, parent: string, name?: string) {
    if (!className || !parent) {
      throw new Error('Class name and parent are required for create_object');
    }
    
    // Invalidate cache for parent
    this.invalidateCache(parent);
    
    const response = await this.client.request('/api/create-object', { 
      className, 
      parent, 
      name
    });
    return this.formatMcpResponse(response);
  }

  async createObjectWithProperties(className: string, parent: string, name?: string, properties?: Record<string, unknown>) {
    if (!className || !parent) {
      throw new Error('Class name and parent are required for create_object_with_properties');
    }
    
    // Invalidate cache for parent
    this.invalidateCache(parent);
    
    const response = await this.client.request('/api/create-object', { 
      className, 
      parent, 
      name, 
      properties 
    });
    return this.formatMcpResponse(response);
  }

  async massCreateObjects(objects: Array<{className: string, parent: string, name?: string}>) {
    if (!objects || objects.length === 0) {
      throw new Error('Objects array is required for mass_create_objects');
    }
    
    // Invalidate cache for all parents
    const parents = new Set(objects.map(o => o.parent));
    parents.forEach(parent => this.invalidateCache(parent));
    
    const response = await this.client.request('/api/mass-create-objects', { objects });
    return this.formatMcpResponse(response);
  }

  async massCreateObjectsWithProperties(objects: Array<{className: string, parent: string, name?: string, properties?: Record<string, unknown>}>) {
    if (!objects || objects.length === 0) {
      throw new Error('Objects array is required for mass_create_objects_with_properties');
    }
    
    // Invalidate cache for all parents
    const parents = new Set(objects.map(o => o.parent));
    parents.forEach(parent => this.invalidateCache(parent));
    
    const response = await this.client.request('/api/mass-create-objects-with-properties', { objects });
    return this.formatMcpResponse(response);
  }

  async deleteObject(instancePath: string) {
    if (!instancePath) {
      throw new Error('Instance path is required for delete_object');
    }
    
    // Invalidate cache for this instance and its parent
    this.invalidateCache(instancePath);
    const parentPath = instancePath.substring(0, instancePath.lastIndexOf('.'));
    if (parentPath) this.invalidateCache(parentPath);
    
    const response = await this.client.request('/api/delete-object', { instancePath });
    return this.formatMcpResponse(response);
  }

  // ===========================================================================
  // Smart Duplication Tools
  // ===========================================================================

  async smartDuplicate(instancePath: string, count: number, options?: SmartDuplicateOptions) {
    if (!instancePath || count < 1) {
      throw new Error('Instance path and count > 0 are required for smart_duplicate');
    }
    
    // Invalidate cache for parent
    const parentPath = instancePath.substring(0, instancePath.lastIndexOf('.'));
    if (parentPath) this.invalidateCache(parentPath);
    
    const response = await this.client.request('/api/smart-duplicate', { 
      instancePath, 
      count, 
      options 
    });
    return this.formatMcpResponse(response);
  }

  async massDuplicate(duplications: Array<{instancePath: string; count: number; options?: SmartDuplicateOptions}>) {
    if (!duplications || duplications.length === 0) {
      throw new Error('Duplications array is required for mass_duplicate');
    }
    
    // Invalidate cache for all affected parents
    duplications.forEach(d => {
      const parentPath = d.instancePath.substring(0, d.instancePath.lastIndexOf('.'));
      if (parentPath) this.invalidateCache(parentPath);
    });
    
    const response = await this.client.request('/api/mass-duplicate', { duplications });
    return this.formatMcpResponse(response);
  }

  // ===========================================================================
  // Calculated Property Tools
  // ===========================================================================

  async setCalculatedProperty(paths: string[], propertyName: string, formula: string, variables?: Record<string, unknown>) {
    if (!paths || paths.length === 0 || !propertyName || !formula) {
      throw new Error('Paths, property name, and formula are required for set_calculated_property');
    }
    
    // Invalidate cache for all affected instances
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
    if (!paths || paths.length === 0 || !propertyName || !operation || value === undefined) {
      throw new Error('Paths, property name, operation, and value are required for set_relative_property');
    }
    
    // Invalidate cache for all affected instances
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
    if (!instancePath) {
      throw new Error('Instance path is required for get_script_source');
    }
    const response = await this.client.request('/api/get-script-source', { instancePath, startLine, endLine });
    return this.formatMcpResponse(response);
  }

  async setScriptSource(instancePath: string, source: string) {
    if (!instancePath || typeof source !== 'string') {
      throw new Error('Instance path and source code string are required for set_script_source');
    }
    
    // Invalidate cache for this instance
    this.invalidateCache(instancePath);
    
    const response = await this.client.request('/api/set-script-source', { instancePath, source });
    return this.formatMcpResponse(response);
  }

  // ===========================================================================
  // Partial Script Editing Tools
  // ===========================================================================

  async editScriptLines(instancePath: string, startLine: number, endLine: number, newContent: string) {
    if (!instancePath || !startLine || !endLine || typeof newContent !== 'string') {
      throw new Error('Instance path, startLine, endLine, and newContent are required for edit_script_lines');
    }
    
    this.invalidateCache(instancePath);
    
    const response = await this.client.request('/api/edit-script-lines', { instancePath, startLine, endLine, newContent });
    return this.formatMcpResponse(response);
  }

  async insertScriptLines(instancePath: string, afterLine: number, newContent: string) {
    if (!instancePath || typeof newContent !== 'string') {
      throw new Error('Instance path and newContent are required for insert_script_lines');
    }
    
    this.invalidateCache(instancePath);
    
    const response = await this.client.request('/api/insert-script-lines', { instancePath, afterLine: afterLine || 0, newContent });
    return this.formatMcpResponse(response);
  }

  async deleteScriptLines(instancePath: string, startLine: number, endLine: number) {
    if (!instancePath || !startLine || !endLine) {
      throw new Error('Instance path, startLine, and endLine are required for delete_script_lines');
    }
    
    this.invalidateCache(instancePath);
    
    const response = await this.client.request('/api/delete-script-lines', { instancePath, startLine, endLine });
    return this.formatMcpResponse(response);
  }

  // ===========================================================================
  // Attribute Tools
  // ===========================================================================

  async getAttribute(instancePath: string, attributeName: string) {
    if (!instancePath || !attributeName) {
      throw new Error('Instance path and attribute name are required for get_attribute');
    }
    const response = await this.client.request('/api/get-attribute', { instancePath, attributeName });
    return this.formatMcpResponse(response);
  }

  async setAttribute(instancePath: string, attributeName: string, attributeValue: unknown, valueType?: string) {
    if (!instancePath || !attributeName) {
      throw new Error('Instance path and attribute name are required for set_attribute');
    }
    
    this.invalidateCache(instancePath);
    
    const response = await this.client.request('/api/set-attribute', { instancePath, attributeName, attributeValue, valueType });
    return this.formatMcpResponse(response);
  }

  async getAttributes(instancePath: string) {
    if (!instancePath) {
      throw new Error('Instance path is required for get_attributes');
    }
    const response = await this.client.request('/api/get-attributes', { instancePath });
    return this.formatMcpResponse(response);
  }

  async deleteAttribute(instancePath: string, attributeName: string) {
    if (!instancePath || !attributeName) {
      throw new Error('Instance path and attribute name are required for delete_attribute');
    }
    
    this.invalidateCache(instancePath);
    
    const response = await this.client.request('/api/delete-attribute', { instancePath, attributeName });
    return this.formatMcpResponse(response);
  }

  // ===========================================================================
  // Tag Tools (CollectionService)
  // ===========================================================================

  async getTags(instancePath: string) {
    if (!instancePath) {
      throw new Error('Instance path is required for get_tags');
    }
    const response = await this.client.request('/api/get-tags', { instancePath });
    return this.formatMcpResponse(response);
  }

  async addTag(instancePath: string, tagName: string) {
    if (!instancePath || !tagName) {
      throw new Error('Instance path and tag name are required for add_tag');
    }
    const response = await this.client.request('/api/add-tag', { instancePath, tagName });
    return this.formatMcpResponse(response);
  }

  async removeTag(instancePath: string, tagName: string) {
    if (!instancePath || !tagName) {
      throw new Error('Instance path and tag name are required for remove_tag');
    }
    const response = await this.client.request('/api/remove-tag', { instancePath, tagName });
    return this.formatMcpResponse(response);
  }

  async getTagged(tagName: string) {
    if (!tagName) {
      throw new Error('Tag name is required for get_tagged');
    }
    const response = await this.client.request('/api/get-tagged', { tagName });
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

  /**
   * Insert an asset from the Roblox Creator Store by asset ID
   */
  async insertAsset(assetId: number, parent: string, position?: [number, number, number], name?: string) {
    if (!assetId || !parent) {
      throw new Error('Asset ID and parent path are required for insert_asset');
    }
    
    // Invalidate cache for parent
    this.invalidateCache(parent);
    
    const response = await this.client.request('/api/insert-asset', { 
      assetId, 
      parent, 
      position,
      name
    });
    return this.formatMcpResponse(response);
  }

  /**
   * Insert multiple assets at once
   */
  async insertMultipleAssets(assets: Array<{assetId: number, parent: string, position?: [number, number, number], name?: string}>) {
    if (!assets || assets.length === 0) {
      throw new Error('Assets array is required for insert_multiple_assets');
    }
    
    // Invalidate cache for all parents
    const parents = new Set(assets.map(a => a.parent));
    parents.forEach(parent => this.invalidateCache(parent));
    
    const response = await this.client.request('/api/insert-multiple-assets', { assets });
    return this.formatMcpResponse(response);
  }

  /**
   * Get information about an asset (works for assets you own/have access to)
   */
  async getAssetInfo(assetId: number) {
    if (!assetId) {
      throw new Error('Asset ID is required for get_asset_info');
    }
    const response = await this.client.request('/api/get-asset-info', { assetId });
    return this.formatMcpResponse(response);
  }

  /**
   * Search the local curated asset catalog
   * Note: This searches a local catalog, not the live Creator Store (no public API available yet)
   */
  async searchAssetCatalog(query: string, category?: string, maxResults: number = 10) {
    if (!query) {
      throw new Error('Query is required for search_asset_catalog');
    }

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

    // Search through all categories
    for (const [cat, assets] of Object.entries(this.assetCatalog.categories)) {
      // Skip if category filter is set and doesn't match
      if (categoryLower && cat.toLowerCase() !== categoryLower) {
        continue;
      }

      for (const asset of assets) {
        // Score-based matching
        let score = 0;
        
        // Name match (highest priority)
        if (asset.name.toLowerCase().includes(queryLower)) {
          score += 10;
        }
        
        // Description match
        if (asset.description.toLowerCase().includes(queryLower)) {
          score += 5;
        }
        
        // Tag match
        for (const tag of asset.tags) {
          if (tag.toLowerCase().includes(queryLower)) {
            score += 3;
          }
        }
        
        // Category match
        if (cat.toLowerCase().includes(queryLower)) {
          score += 2;
        }

        if (score > 0) {
          results.push({ ...asset, category: cat });
        }
      }
    }

    // Sort by relevance and limit results
    results.sort((a, b) => {
      // Prefer exact name matches
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

  /**
   * List all available categories in the asset catalog
   */
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
