/**
 * TypeScript interfaces for MCP tool arguments
 * Provides type safety and better IDE support
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
// File System / Instance Hierarchy Tools
// =============================================================================

export interface GetFileTreeArgs {
  path?: string;
}

export interface SearchFilesArgs {
  query: string;
  searchType?: 'name' | 'type' | 'content';
}

// =============================================================================
// Studio Context Tools
// =============================================================================

export interface GetServicesArgs {
  serviceName?: string;
}

export interface SearchObjectsArgs {
  query: string;
  searchType?: 'name' | 'class' | 'property';
  propertyName?: string;
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

export interface SearchByPropertyArgs {
  propertyName: string;
  propertyValue: string;
}

export interface GetClassInfoArgs {
  className: string;
}

// =============================================================================
// Project Tools
// =============================================================================

export interface GetProjectStructureArgs {
  path?: string;
  maxDepth?: number;
  scriptsOnly?: boolean;
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

// =============================================================================
// Object Creation/Deletion Tools
// =============================================================================

export interface CreateObjectArgs {
  className: string;
  parent: string;
  name?: string;
}

export interface CreateObjectWithPropertiesArgs {
  className: string;
  parent: string;
  name?: string;
  properties?: Record<string, unknown>;
}

export interface MassCreateObjectsArgs {
  objects: Array<{
    className: string;
    parent: string;
    name?: string;
  }>;
}

export interface MassCreateObjectsWithPropertiesArgs {
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
// Script Management Tools
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

export interface EditScriptLinesArgs {
  instancePath: string;
  startLine: number;
  endLine: number;
  newContent: string;
}

export interface InsertScriptLinesArgs {
  instancePath: string;
  afterLine?: number;
  newContent: string;
}

export interface DeleteScriptLinesArgs {
  instancePath: string;
  startLine: number;
  endLine: number;
}

// =============================================================================
// Attribute Tools
// =============================================================================

export interface GetAttributeArgs {
  instancePath: string;
  attributeName: string;
}

export interface SetAttributeArgs {
  instancePath: string;
  attributeName: string;
  attributeValue: unknown;
  valueType?: 'Vector3' | 'Color3' | 'UDim2' | 'BrickColor';
}

export interface GetAttributesArgs {
  instancePath: string;
}

export interface DeleteAttributeArgs {
  instancePath: string;
  attributeName: string;
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
