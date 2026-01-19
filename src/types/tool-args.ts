/**
 * TypeScript interfaces for MCP tool arguments
 * Provides type safety and better IDE support
 * 
 * v2.1.1 - Consolidated tools and batch support
 */

// =============================================================================
// MCP Response Types
// =============================================================================

export interface McpTextContent {
  type: 'text';
  text: string;
}

export interface McpToolResponse {
  content: McpTextContent[];
}

// =============================================================================
// Search Tools (Consolidated)
// =============================================================================

export interface SearchInstancesArgs {
  query: string;
  searchType?: 'name' | 'class' | 'content' | 'property';
  scope?: string; // Instance path to search within
  propertyName?: string; // Required when searchType is 'property'
  propertyValue?: unknown; // Required when searchType is 'property'
  maxResults?: number;
}

// =============================================================================
// Hierarchy Tools (Consolidated - get_project_structure only)
// =============================================================================

export interface GetProjectStructureArgs {
  path?: string;
  maxDepth?: number;
  scriptsOnly?: boolean;
}

// =============================================================================
// Studio Context Tools
// =============================================================================

export interface GetServicesArgs {
  serviceName?: string;
}

// =============================================================================
// Property & Instance Tools
// =============================================================================

export interface GetInstancePropertiesArgs {
  instancePath: string;
}

export interface GetInstanceChildrenArgs {
  instancePath: string;
}

export interface GetClassInfoArgs {
  className: string;
}

// =============================================================================
// Property Modification Tools
// =============================================================================

export interface SetPropertyArgs {
  instancePath: string;
  propertyName: string;
  propertyValue: unknown;
}

export interface MassSetPropertyArgs {
  paths: string[];
  propertyName: string;
  propertyValue: unknown;
}

export interface MassGetPropertyArgs {
  paths: string[];
  propertyName: string;
}

// NEW: Set multiple properties on multiple instances
export interface MassSetPropertiesArgs {
  paths: string[];
  properties: Record<string, unknown>;
}

// =============================================================================
// Object Creation/Deletion Tools (Consolidated)
// =============================================================================

// Consolidated: properties is optional
export interface CreateObjectArgs {
  className: string;
  parent: string;
  name?: string;
  properties?: Record<string, unknown>;
}

// Consolidated: properties is optional per-object
export interface MassCreateObjectsArgs {
  objects: Array<{
    className: string;
    parent: string;
    name?: string;
    properties?: Record<string, unknown>;
  }>;
}

export interface DeleteObjectArgs {
  instancePath: string;
}

// =============================================================================
// Smart Duplication Tools
// =============================================================================

export interface SmartDuplicateOptions {
  namePattern?: string;
  positionOffset?: [number, number, number];
  rotationOffset?: [number, number, number];
  scaleOffset?: [number, number, number];
  propertyVariations?: Record<string, unknown[]>;
  targetParents?: string[];
}

export interface SmartDuplicateArgs {
  instancePath: string;
  count: number;
  options?: SmartDuplicateOptions;
}

export interface MassDuplicateArgs {
  duplications: Array<{
    instancePath: string;
    count: number;
    options?: SmartDuplicateOptions;
  }>;
}

// =============================================================================
// Calculated Property Tools
// =============================================================================

export interface SetCalculatedPropertyArgs {
  paths: string[];
  propertyName: string;
  formula: string;
  variables?: Record<string, unknown>;
}

export interface SetRelativePropertyArgs {
  paths: string[];
  propertyName: string;
  operation: 'add' | 'multiply' | 'divide' | 'subtract' | 'power';
  value: unknown;
  component?: 'X' | 'Y' | 'Z';
}

// =============================================================================
// Script Management Tools (Consolidated)
// =============================================================================

export interface GetScriptSourceArgs {
  instancePath: string;
  startLine?: number;
  endLine?: number;
}

export interface SetScriptSourceArgs {
  instancePath: string;
  source: string;
}

// Consolidated: edit_script covers replace, insert, delete
export interface EditScriptArgs {
  instancePath: string;
  operation: 'replace' | 'insert' | 'delete';
  startLine?: number; // Required for replace, delete
  endLine?: number;   // Required for replace, delete
  afterLine?: number; // Required for insert (0 = beginning)
  content?: string;   // Required for replace, insert
}

// NEW: Mass script operations
export interface MassGetScriptSourceArgs {
  paths: string[];
  startLine?: number;
  endLine?: number;
}

export interface MassSetScriptSourceArgs {
  scripts: Array<{
    instancePath: string;
    source: string;
  }>;
}

// =============================================================================
// Attribute Tools (Consolidated)
// =============================================================================

// Consolidated: attributeName is optional (all attributes if omitted)
export interface GetAttributesArgs {
  instancePath: string;
  attributeName?: string;
}

export interface SetAttributeArgs {
  instancePath: string;
  attributeName: string;
  attributeValue: unknown;
  valueType?: 'Vector3' | 'Color3' | 'UDim2' | 'BrickColor';
}

export interface DeleteAttributeArgs {
  instancePath: string;
  attributeName: string;
}

// NEW: Mass attribute operations
export interface MassGetAttributesArgs {
  paths: string[];
  attributeName?: string;
}

export interface MassSetAttributeArgs {
  paths: string[];
  attributeName: string;
  attributeValue: unknown;
  valueType?: 'Vector3' | 'Color3' | 'UDim2' | 'BrickColor';
}

// =============================================================================
// Tag Tools (CollectionService)
// =============================================================================

export interface GetTagsArgs {
  instancePath: string;
}

export interface AddTagArgs {
  instancePath: string;
  tagName: string;
}

export interface RemoveTagArgs {
  instancePath: string;
  tagName: string;
}

export interface GetTaggedArgs {
  tagName: string;
}

// NEW: Mass tag operations
export interface MassAddTagArgs {
  paths: string[];
  tagName: string;
}

export interface MassRemoveTagArgs {
  paths: string[];
  tagName: string;
}

// =============================================================================
// Creator Store / Asset Tools
// =============================================================================

export interface InsertAssetArgs {
  assetId: number;
  parent: string;
  position?: [number, number, number];
  name?: string;
}

export interface InsertMultipleAssetsArgs {
  assets: Array<{
    assetId: number;
    parent: string;
    position?: [number, number, number];
    name?: string;
  }>;
}

export interface GetAssetInfoArgs {
  assetId: number;
}

export interface SearchAssetCatalogArgs {
  query: string;
  category?: string;
  maxResults?: number;
}

// =============================================================================
// Asset Catalog Types
// =============================================================================

export interface CatalogAsset {
  id: number;
  name: string;
  description: string;
  category: string;
  subcategory?: string;
  tags: string[];
  triangles?: 'low' | 'medium' | 'high';
  creator?: string;
}

export interface AssetCatalog {
  version: string;
  lastUpdated: string;
  categories: Record<string, CatalogAsset[]>;
}

// =============================================================================
// Batch Tool (NEW)
// =============================================================================

export interface BatchOperation {
  tool: string;
  args: Record<string, unknown>;
}

export interface BatchArgs {
  operations: BatchOperation[];
  continueOnError?: boolean;
}

export interface BatchResult {
  results: Array<{
    tool: string;
    success: boolean;
    result?: unknown;
    error?: string;
  }>;
  successCount: number;
  errorCount: number;
}
