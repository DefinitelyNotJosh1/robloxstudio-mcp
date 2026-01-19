#!/usr/bin/env node

/**
 * Roblox Studio MCP Server v2.1.1
 * 
 * This server provides Model Context Protocol (MCP) tools for interacting with Roblox Studio.
 * It allows AI assistants to access Studio data, scripts, and objects through a bridge plugin.
 * 
 * v2.1.1 Changes:
 * - Consolidated redundant tools for better LLM performance
 * - Added batch tool for executing multiple operations in one call
 * - Added mass attribute, tag, and script tools
 * - Improved batching at transport layer
 * 
 * Usage:
 *   npx robloxstudio-mcp
 * 
 * Or add to your MCP configuration:
 *   "robloxstudio": {
 *     "command": "npx",
 *     "args": ["-y", "robloxstudio-mcp"]
 *   }
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { createHttpServer } from './http-server.js';
import { RobloxStudioTools } from './tools/index.js';
import { BridgeService } from './bridge-service.js';

class RobloxStudioMCPServer {
  private server: Server;
  private tools: RobloxStudioTools;
  private bridge: BridgeService;

  constructor() {
    this.server = new Server(
      {
        name: 'robloxstudio-mcp',
        version: '2.1.1',
      },
      {
        capabilities: {
          tools: {},
        },
        instructions: this.getServerInstructions(),
      }
    );

    this.bridge = new BridgeService();
    this.tools = new RobloxStudioTools(this.bridge);
    this.setupToolHandlers();
  }

  private getServerInstructions(): string {
    return `ROBLOX STUDIO MCP SERVER - OPTIMAL TOOL USAGE

PERFORMANCE OPTIMIZATION STRATEGIES

1. Use the 'batch' tool for 3+ sequential operations to reduce roundtrips
   Example: batch([{tool: "create_object", args: {...}}, {tool: "create_object", args: {...}}])

2. Use 'mass_*' tools instead of loops for bulk operations on multiple instances
   - mass_set_property, mass_set_properties: Set properties on multiple instances
   - mass_get_property: Get same property from multiple instances
   - mass_create_objects: Create multiple objects at once
   - mass_duplicate: Perform multiple smart duplications
   - mass_get_script_source, mass_set_script_source: Batch script operations
   - mass_get_attributes, mass_set_attribute: Batch attribute operations
   - mass_add_tag, mass_remove_tag: Batch tag operations

3. Always use 'search_instances' before bulk operations to validate paths and targets
   search_instances supports name, class, content, and property searches with optional scope

4. For script edits: Use 'edit_script' for targeted changes (replace/insert/delete lines)
   Use 'set_script_source' only for complete script replacement

5. Use 'get_project_structure' with maxDepth parameter for hierarchical exploration
   Default depth 3, use 5-10 for thorough exploration. Use scriptsOnly to filter.

WORKFLOW PATTERNS

Game Structure Analysis:
  1. get_place_info → get_project_structure (maxDepth=5-10)
  2. search_instances to find specific components
  3. get_instance_properties for detailed inspection

Multi-Object Creation:
  1. Use mass_create_objects with array of objects instead of multiple create_object calls
  2. Use batch with multiple operations if different object types or parents

Bulk Property Updates:
  1. Use mass_set_properties (multiple properties) or mass_set_property (single property)
  2. For calculated values: set_calculated_property with formula (e.g., "index * 50")
  3. For relative changes: set_relative_property (add, multiply, divide, subtract, power)

Script Management:
  1. mass_get_script_source to read multiple scripts
  2. edit_script for targeted changes (operation: replace/insert/delete)
  3. mass_set_script_source to update multiple scripts

Tag/Attribute Operations:
  1. Use mass_add_tag/mass_remove_tag for batch CollectionService operations
  2. Use mass_set_attribute/mass_get_attributes for batch attribute operations
  3. get_tagged to find all instances with a specific tag

Smart Duplication:
  1. smart_duplicate for single object with variations (name pattern, position/rotation offsets)
  2. mass_duplicate for multiple duplications at once

Asset Integration:
  1. search_asset_catalog to find curated assets (local catalog)
  2. insert_multiple_assets for bulk asset insertion instead of repeated insert_asset

CONSTRAINTS & LIMITATIONS
- HTTP requests must be enabled in Roblox Studio Game Settings (Security tab)
- Plugin must be connected in Studio before operations can execute
- Search results are cached for 5 minutes; invalidate with new operations
- Property operations support standard Roblox types (Vector3, Color3, UDim2, BrickColor)
- Mass operations require non-empty arrays`;
  }

  private setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          // =====================================================================
          // BATCH TOOL - Execute multiple operations in one call
          // =====================================================================
          {
            name: 'batch',
            description: 'Execute multiple tool operations in a single call. Reduces roundtrips and improves performance for multi-step workflows.',
            inputSchema: {
              type: 'object',
              properties: {
                operations: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      tool: { type: 'string', description: 'Name of the tool to execute' },
                      args: { type: 'object', description: 'Arguments for the tool' }
                    },
                    required: ['tool', 'args']
                  },
                  description: 'Array of operations to execute sequentially'
                },
                continueOnError: {
                  type: 'boolean',
                  description: 'If true, continue executing operations even if one fails (default: false)',
                  default: false
                }
              },
              required: ['operations']
            }
          },

          // =====================================================================
          // SEARCH (Consolidated)
          // =====================================================================
          {
            name: 'search_instances',
            description: 'Search for Roblox instances by name, class type, script content, or property value. Unified search tool.',
            inputSchema: {
              type: 'object',
              properties: {
                query: {
                  type: 'string',
                  description: 'Search query - instance name, class type, script content, or property value'
                },
                searchType: {
                  type: 'string',
                  enum: ['name', 'class', 'content', 'property'],
                  description: 'Type of search to perform',
                  default: 'name'
                },
                scope: {
                  type: 'string',
                  description: 'Instance path to search within (e.g., "game.Workspace"). Defaults to entire game.'
                },
                propertyName: {
                  type: 'string',
                  description: 'Property name (required when searchType is "property")'
                },
                propertyValue: {
                  description: 'Property value to match (used when searchType is "property")'
                },
                maxResults: {
                  type: 'number',
                  description: 'Maximum number of results to return',
                  default: 100
                }
              },
              required: ['query']
            }
          },

          // =====================================================================
          // HIERARCHY (Consolidated - removed get_file_tree)
          // =====================================================================
          {
            name: 'get_project_structure',
            description: 'Get the Roblox instance hierarchy tree. Use maxDepth to control depth (default: 3, use 5-10 for thorough exploration).',
            inputSchema: {
              type: 'object',
              properties: {
                path: {
                  type: 'string',
                  description: 'Instance path to start from (e.g., "game.Workspace"). Defaults to game root.',
                  default: ''
                },
                maxDepth: {
                  type: 'number',
                  description: 'Maximum depth to traverse (default: 3). Use 5-10 for comprehensive exploration.',
                  default: 3
                },
                scriptsOnly: {
                  type: 'boolean',
                  description: 'Show only scripts and script containers',
                  default: false
                }
              }
            }
          },

          // =====================================================================
          // STUDIO CONTEXT
          // =====================================================================
          {
            name: 'get_place_info',
            description: 'Get place ID, name, and game settings',
            inputSchema: {
              type: 'object',
              properties: {}
            }
          },
          {
            name: 'get_services',
            description: 'Get available Roblox services and their children',
            inputSchema: {
              type: 'object',
              properties: {
                serviceName: {
                  type: 'string',
                  description: 'Optional specific service name to query'
                }
              }
            }
          },

          // =====================================================================
          // INSTANCE PROPERTIES
          // =====================================================================
          {
            name: 'get_instance_properties',
            description: 'Get all properties of a specific Roblox instance',
            inputSchema: {
              type: 'object',
              properties: {
                instancePath: {
                  type: 'string',
                  description: 'Instance path using dot notation (e.g., "game.Workspace.Part")'
                }
              },
              required: ['instancePath']
            }
          },
          {
            name: 'get_instance_children',
            description: 'Get child instances and their class types',
            inputSchema: {
              type: 'object',
              properties: {
                instancePath: {
                  type: 'string',
                  description: 'Instance path using dot notation (e.g., "game.Workspace")'
                }
              },
              required: ['instancePath']
            }
          },
          {
            name: 'get_class_info',
            description: 'Get available properties/methods for a Roblox class',
            inputSchema: {
              type: 'object',
              properties: {
                className: {
                  type: 'string',
                  description: 'Roblox class name (e.g., "Part", "Script")'
                }
              },
              required: ['className']
            }
          },

          // =====================================================================
          // PROPERTY MODIFICATION
          // =====================================================================
          {
            name: 'set_property',
            description: 'Set a property on a Roblox instance',
            inputSchema: {
              type: 'object',
              properties: {
                instancePath: { type: 'string', description: 'Path to the instance' },
                propertyName: { type: 'string', description: 'Property name to set' },
                propertyValue: { description: 'Value to set' }
              },
              required: ['instancePath', 'propertyName', 'propertyValue']
            }
          },
          {
            name: 'mass_set_property',
            description: 'Set the same property on multiple instances',
            inputSchema: {
              type: 'object',
              properties: {
                paths: { type: 'array', items: { type: 'string' }, description: 'Array of instance paths' },
                propertyName: { type: 'string', description: 'Property name to set' },
                propertyValue: { description: 'Value to set' }
              },
              required: ['paths', 'propertyName', 'propertyValue']
            }
          },
          {
            name: 'mass_get_property',
            description: 'Get the same property from multiple instances',
            inputSchema: {
              type: 'object',
              properties: {
                paths: { type: 'array', items: { type: 'string' }, description: 'Array of instance paths' },
                propertyName: { type: 'string', description: 'Property name to get' }
              },
              required: ['paths', 'propertyName']
            }
          },
          {
            name: 'mass_set_properties',
            description: 'Set multiple properties on multiple instances at once',
            inputSchema: {
              type: 'object',
              properties: {
                paths: { type: 'array', items: { type: 'string' }, description: 'Array of instance paths' },
                properties: { type: 'object', description: 'Object of property names to values' }
              },
              required: ['paths', 'properties']
            }
          },

          // =====================================================================
          // OBJECT CREATION/DELETION (Consolidated)
          // =====================================================================
          {
            name: 'create_object',
            description: 'Create a new Roblox object, optionally with initial properties',
            inputSchema: {
              type: 'object',
              properties: {
                className: { type: 'string', description: 'Roblox class name (e.g., "Part", "Script")' },
                parent: { type: 'string', description: 'Parent instance path (e.g., "game.Workspace")' },
                name: { type: 'string', description: 'Optional name for the new object' },
                properties: { type: 'object', description: 'Optional properties to set on creation' }
              },
              required: ['className', 'parent']
            }
          },
          {
            name: 'mass_create_objects',
            description: 'Create multiple objects at once, each optionally with properties',
            inputSchema: {
              type: 'object',
              properties: {
                objects: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      className: { type: 'string', description: 'Roblox class name' },
                      parent: { type: 'string', description: 'Parent instance path' },
                      name: { type: 'string', description: 'Optional name' },
                      properties: { type: 'object', description: 'Optional properties' }
                    },
                    required: ['className', 'parent']
                  },
                  description: 'Array of objects to create'
                }
              },
              required: ['objects']
            }
          },
          {
            name: 'delete_object',
            description: 'Delete a Roblox object instance',
            inputSchema: {
              type: 'object',
              properties: {
                instancePath: { type: 'string', description: 'Path to the instance to delete' }
              },
              required: ['instancePath']
            }
          },

          // =====================================================================
          // SMART DUPLICATION
          // =====================================================================
          {
            name: 'smart_duplicate',
            description: 'Smart duplication with naming, positioning, and property variations',
            inputSchema: {
              type: 'object',
              properties: {
                instancePath: { type: 'string', description: 'Path to instance to duplicate' },
                count: { type: 'number', description: 'Number of duplicates to create' },
                options: {
                  type: 'object',
                  properties: {
                    namePattern: { type: 'string', description: 'Name pattern with {n} placeholder' },
                    positionOffset: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
                    rotationOffset: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
                    scaleOffset: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
                    propertyVariations: { type: 'object' },
                    targetParents: { type: 'array', items: { type: 'string' } }
                  }
                }
              },
              required: ['instancePath', 'count']
            }
          },
          {
            name: 'mass_duplicate',
            description: 'Perform multiple smart duplications at once',
            inputSchema: {
              type: 'object',
              properties: {
                duplications: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      instancePath: { type: 'string' },
                      count: { type: 'number' },
                      options: { type: 'object' }
                    },
                    required: ['instancePath', 'count']
                  }
                }
              },
              required: ['duplications']
            }
          },

          // =====================================================================
          // CALCULATED/RELATIVE PROPERTIES
          // =====================================================================
          {
            name: 'set_calculated_property',
            description: 'Set properties using mathematical formulas',
            inputSchema: {
              type: 'object',
              properties: {
                paths: { type: 'array', items: { type: 'string' }, description: 'Instance paths to modify' },
                propertyName: { type: 'string', description: 'Property to set' },
                formula: { type: 'string', description: 'Formula (e.g., "index * 50")' },
                variables: { type: 'object', description: 'Additional variables for formula' }
              },
              required: ['paths', 'propertyName', 'formula']
            }
          },
          {
            name: 'set_relative_property',
            description: 'Modify properties relative to current values',
            inputSchema: {
              type: 'object',
              properties: {
                paths: { type: 'array', items: { type: 'string' } },
                propertyName: { type: 'string' },
                operation: { type: 'string', enum: ['add', 'multiply', 'divide', 'subtract', 'power'] },
                value: {},
                component: { type: 'string', enum: ['X', 'Y', 'Z'] }
              },
              required: ['paths', 'propertyName', 'operation', 'value']
            }
          },

          // =====================================================================
          // SCRIPT MANAGEMENT (Consolidated + Mass)
          // =====================================================================
          {
            name: 'get_script_source',
            description: 'Get source code of a Roblox script. Returns "source" and "numberedSource" (with line numbers).',
            inputSchema: {
              type: 'object',
              properties: {
                instancePath: { type: 'string', description: 'Path to the script' },
                startLine: { type: 'number', description: 'Optional start line (1-indexed)' },
                endLine: { type: 'number', description: 'Optional end line (inclusive)' }
              },
              required: ['instancePath']
            }
          },
          {
            name: 'set_script_source',
            description: 'Replace entire source code of a script',
            inputSchema: {
              type: 'object',
              properties: {
                instancePath: { type: 'string', description: 'Path to the script' },
                source: { type: 'string', description: 'New source code' }
              },
              required: ['instancePath', 'source']
            }
          },
          {
            name: 'edit_script',
            description: 'Edit a script: replace lines, insert lines, or delete lines',
            inputSchema: {
              type: 'object',
              properties: {
                instancePath: { type: 'string', description: 'Path to the script' },
                operation: { 
                  type: 'string', 
                  enum: ['replace', 'insert', 'delete'],
                  description: 'Operation type'
                },
                startLine: { type: 'number', description: 'Start line for replace/delete (1-indexed)' },
                endLine: { type: 'number', description: 'End line for replace/delete (inclusive)' },
                afterLine: { type: 'number', description: 'Insert after this line (0 = beginning)', default: 0 },
                content: { type: 'string', description: 'Content for replace/insert operations' }
              },
              required: ['instancePath', 'operation']
            }
          },
          {
            name: 'mass_get_script_source',
            description: 'Get source code from multiple scripts at once',
            inputSchema: {
              type: 'object',
              properties: {
                paths: { type: 'array', items: { type: 'string' }, description: 'Array of script paths' },
                startLine: { type: 'number', description: 'Optional start line for all scripts' },
                endLine: { type: 'number', description: 'Optional end line for all scripts' }
              },
              required: ['paths']
            }
          },
          {
            name: 'mass_set_script_source',
            description: 'Set source code for multiple scripts at once',
            inputSchema: {
              type: 'object',
              properties: {
                scripts: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      instancePath: { type: 'string', description: 'Path to the script' },
                      source: { type: 'string', description: 'New source code' }
                    },
                    required: ['instancePath', 'source']
                  }
                }
              },
              required: ['scripts']
            }
          },

          // =====================================================================
          // ATTRIBUTES (Consolidated + Mass)
          // =====================================================================
          {
            name: 'get_attributes',
            description: 'Get attributes from an instance. If attributeName provided, get single attribute; otherwise get all.',
            inputSchema: {
              type: 'object',
              properties: {
                instancePath: { type: 'string', description: 'Instance path' },
                attributeName: { type: 'string', description: 'Optional: specific attribute name (omit for all)' }
              },
              required: ['instancePath']
            }
          },
          {
            name: 'set_attribute',
            description: 'Set an attribute on an instance',
            inputSchema: {
              type: 'object',
              properties: {
                instancePath: { type: 'string' },
                attributeName: { type: 'string' },
                attributeValue: { description: 'Value to set' },
                valueType: { type: 'string', description: 'Type hint: "Vector3", "Color3", "UDim2", "BrickColor"' }
              },
              required: ['instancePath', 'attributeName', 'attributeValue']
            }
          },
          {
            name: 'delete_attribute',
            description: 'Delete an attribute from an instance',
            inputSchema: {
              type: 'object',
              properties: {
                instancePath: { type: 'string' },
                attributeName: { type: 'string' }
              },
              required: ['instancePath', 'attributeName']
            }
          },
          {
            name: 'mass_get_attributes',
            description: 'Get attributes from multiple instances at once',
            inputSchema: {
              type: 'object',
              properties: {
                paths: { type: 'array', items: { type: 'string' }, description: 'Array of instance paths' },
                attributeName: { type: 'string', description: 'Optional: specific attribute (omit for all)' }
              },
              required: ['paths']
            }
          },
          {
            name: 'mass_set_attribute',
            description: 'Set the same attribute on multiple instances',
            inputSchema: {
              type: 'object',
              properties: {
                paths: { type: 'array', items: { type: 'string' } },
                attributeName: { type: 'string' },
                attributeValue: {},
                valueType: { type: 'string' }
              },
              required: ['paths', 'attributeName', 'attributeValue']
            }
          },

          // =====================================================================
          // TAGS (CollectionService) + Mass
          // =====================================================================
          {
            name: 'get_tags',
            description: 'Get all CollectionService tags on an instance',
            inputSchema: {
              type: 'object',
              properties: {
                instancePath: { type: 'string' }
              },
              required: ['instancePath']
            }
          },
          {
            name: 'add_tag',
            description: 'Add a tag to an instance',
            inputSchema: {
              type: 'object',
              properties: {
                instancePath: { type: 'string' },
                tagName: { type: 'string' }
              },
              required: ['instancePath', 'tagName']
            }
          },
          {
            name: 'remove_tag',
            description: 'Remove a tag from an instance',
            inputSchema: {
              type: 'object',
              properties: {
                instancePath: { type: 'string' },
                tagName: { type: 'string' }
              },
              required: ['instancePath', 'tagName']
            }
          },
          {
            name: 'get_tagged',
            description: 'Get all instances with a specific tag',
            inputSchema: {
              type: 'object',
              properties: {
                tagName: { type: 'string' }
              },
              required: ['tagName']
            }
          },
          {
            name: 'mass_add_tag',
            description: 'Add a tag to multiple instances at once',
            inputSchema: {
              type: 'object',
              properties: {
                paths: { type: 'array', items: { type: 'string' } },
                tagName: { type: 'string' }
              },
              required: ['paths', 'tagName']
            }
          },
          {
            name: 'mass_remove_tag',
            description: 'Remove a tag from multiple instances at once',
            inputSchema: {
              type: 'object',
              properties: {
                paths: { type: 'array', items: { type: 'string' } },
                tagName: { type: 'string' }
              },
              required: ['paths', 'tagName']
            }
          },

          // =====================================================================
          // SELECTION
          // =====================================================================
          {
            name: 'get_selection',
            description: 'Get currently selected objects in Studio',
            inputSchema: {
              type: 'object',
              properties: {}
            }
          },

          // =====================================================================
          // CREATOR STORE / ASSETS
          // =====================================================================
          {
            name: 'insert_asset',
            description: 'Insert an asset from the Roblox Creator Store by Asset ID',
            inputSchema: {
              type: 'object',
              properties: {
                assetId: { type: 'number', description: 'Roblox Asset ID' },
                parent: { type: 'string', description: 'Parent instance path' },
                position: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
                name: { type: 'string' }
              },
              required: ['assetId', 'parent']
            }
          },
          {
            name: 'insert_multiple_assets',
            description: 'Insert multiple assets at once',
            inputSchema: {
              type: 'object',
              properties: {
                assets: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      assetId: { type: 'number' },
                      parent: { type: 'string' },
                      position: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
                      name: { type: 'string' }
                    },
                    required: ['assetId', 'parent']
                  }
                }
              },
              required: ['assets']
            }
          },
          {
            name: 'get_asset_info',
            description: 'Get information about a Roblox asset',
            inputSchema: {
              type: 'object',
              properties: {
                assetId: { type: 'number' }
              },
              required: ['assetId']
            }
          },
          {
            name: 'search_asset_catalog',
            description: 'Search the local curated asset catalog',
            inputSchema: {
              type: 'object',
              properties: {
                query: { type: 'string' },
                category: { type: 'string' },
                maxResults: { type: 'number', default: 10 }
              },
              required: ['query']
            }
          },
          {
            name: 'list_asset_categories',
            description: 'List all asset catalog categories',
            inputSchema: {
              type: 'object',
              properties: {}
            }
          }
        ]
      };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      const a = args as Record<string, unknown>;

      try {
        switch (name) {
          // Batch
          case 'batch':
            return await this.tools.batch(
              a?.operations as Array<{tool: string; args: Record<string, unknown>}>,
              a?.continueOnError as boolean
            );

          // Search (consolidated)
          case 'search_instances':
            return await this.tools.searchInstances(
              a?.query as string,
              a?.searchType as string,
              a?.scope as string,
              a?.propertyName as string,
              a?.propertyValue,
              a?.maxResults as number
            );

          // Hierarchy
          case 'get_project_structure':
            return await this.tools.getProjectStructure(
              a?.path as string,
              a?.maxDepth as number,
              a?.scriptsOnly as boolean
            );

          // Studio Context
          case 'get_place_info':
            return await this.tools.getPlaceInfo();
          case 'get_services':
            return await this.tools.getServices(a?.serviceName as string);

          // Instance Properties
          case 'get_instance_properties':
            return await this.tools.getInstanceProperties(a?.instancePath as string);
          case 'get_instance_children':
            return await this.tools.getInstanceChildren(a?.instancePath as string);
          case 'get_class_info':
            return await this.tools.getClassInfo(a?.className as string);

          // Property Modification
          case 'set_property':
            return await this.tools.setProperty(
              a?.instancePath as string,
              a?.propertyName as string,
              a?.propertyValue
            );
          case 'mass_set_property':
            return await this.tools.massSetProperty(
              a?.paths as string[],
              a?.propertyName as string,
              a?.propertyValue
            );
          case 'mass_get_property':
            return await this.tools.massGetProperty(
              a?.paths as string[],
              a?.propertyName as string
            );
          case 'mass_set_properties':
            return await this.tools.massSetProperties(
              a?.paths as string[],
              a?.properties as Record<string, unknown>
            );

          // Object Creation/Deletion (consolidated)
          case 'create_object':
            return await this.tools.createObject(
              a?.className as string,
              a?.parent as string,
              a?.name as string,
              a?.properties as Record<string, unknown>
            );
          case 'mass_create_objects':
            return await this.tools.massCreateObjects(
              a?.objects as Array<{className: string; parent: string; name?: string; properties?: Record<string, unknown>}>
            );
          case 'delete_object':
            return await this.tools.deleteObject(a?.instancePath as string);

          // Smart Duplication
          case 'smart_duplicate':
            return await this.tools.smartDuplicate(
              a?.instancePath as string,
              a?.count as number,
              a?.options as Parameters<typeof this.tools.smartDuplicate>[2]
            );
          case 'mass_duplicate':
            return await this.tools.massDuplicate(
              a?.duplications as Parameters<typeof this.tools.massDuplicate>[0]
            );

          // Calculated/Relative Properties
          case 'set_calculated_property':
            return await this.tools.setCalculatedProperty(
              a?.paths as string[],
              a?.propertyName as string,
              a?.formula as string,
              a?.variables as Record<string, unknown>
            );
          case 'set_relative_property':
            return await this.tools.setRelativeProperty(
              a?.paths as string[],
              a?.propertyName as string,
              a?.operation as 'add' | 'multiply' | 'divide' | 'subtract' | 'power',
              a?.value,
              a?.component as 'X' | 'Y' | 'Z'
            );

          // Script Management (consolidated + mass)
          case 'get_script_source':
            return await this.tools.getScriptSource(
              a?.instancePath as string,
              a?.startLine as number,
              a?.endLine as number
            );
          case 'set_script_source':
            return await this.tools.setScriptSource(
              a?.instancePath as string,
              a?.source as string
            );
          case 'edit_script':
            return await this.tools.editScript(
              a?.instancePath as string,
              a?.operation as 'replace' | 'insert' | 'delete',
              a?.startLine as number,
              a?.endLine as number,
              a?.afterLine as number,
              a?.content as string
            );
          case 'mass_get_script_source':
            return await this.tools.massGetScriptSource(
              a?.paths as string[],
              a?.startLine as number,
              a?.endLine as number
            );
          case 'mass_set_script_source':
            return await this.tools.massSetScriptSource(
              a?.scripts as Array<{instancePath: string; source: string}>
            );

          // Attributes (consolidated + mass)
          case 'get_attributes':
            return await this.tools.getAttributes(
              a?.instancePath as string,
              a?.attributeName as string
            );
          case 'set_attribute':
            return await this.tools.setAttribute(
              a?.instancePath as string,
              a?.attributeName as string,
              a?.attributeValue,
              a?.valueType as string
            );
          case 'delete_attribute':
            return await this.tools.deleteAttribute(
              a?.instancePath as string,
              a?.attributeName as string
            );
          case 'mass_get_attributes':
            return await this.tools.massGetAttributes(
              a?.paths as string[],
              a?.attributeName as string
            );
          case 'mass_set_attribute':
            return await this.tools.massSetAttribute(
              a?.paths as string[],
              a?.attributeName as string,
              a?.attributeValue,
              a?.valueType as string
            );

          // Tags
          case 'get_tags':
            return await this.tools.getTags(a?.instancePath as string);
          case 'add_tag':
            return await this.tools.addTag(a?.instancePath as string, a?.tagName as string);
          case 'remove_tag':
            return await this.tools.removeTag(a?.instancePath as string, a?.tagName as string);
          case 'get_tagged':
            return await this.tools.getTagged(a?.tagName as string);
          case 'mass_add_tag':
            return await this.tools.massAddTag(a?.paths as string[], a?.tagName as string);
          case 'mass_remove_tag':
            return await this.tools.massRemoveTag(a?.paths as string[], a?.tagName as string);

          // Selection
          case 'get_selection':
            return await this.tools.getSelection();

          // Assets
          case 'insert_asset':
            return await this.tools.insertAsset(
              a?.assetId as number,
              a?.parent as string,
              a?.position as [number, number, number],
              a?.name as string
            );
          case 'insert_multiple_assets':
            return await this.tools.insertMultipleAssets(
              a?.assets as Array<{assetId: number; parent: string; position?: [number, number, number]; name?: string}>
            );
          case 'get_asset_info':
            return await this.tools.getAssetInfo(a?.assetId as number);
          case 'search_asset_catalog':
            return await this.tools.searchAssetCatalog(
              a?.query as string,
              a?.category as string,
              a?.maxResults as number
            );
          case 'list_asset_categories':
            return await this.tools.listAssetCategories();

          default:
            throw new McpError(
              ErrorCode.MethodNotFound,
              `Unknown tool: ${name}`
            );
        }
      } catch (error) {
        throw new McpError(
          ErrorCode.InternalError,
          `Tool execution failed: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    });
  }

  async run() {
    const port = process.env.ROBLOX_STUDIO_PORT ? parseInt(process.env.ROBLOX_STUDIO_PORT) : 3002;
    const host = process.env.ROBLOX_STUDIO_HOST || '0.0.0.0';
    const httpServer = createHttpServer(this.tools, this.bridge);
    
    await new Promise<void>((resolve) => {
      httpServer.listen(port, host, () => {
        console.error(`HTTP server listening on ${host}:${port} for Studio plugin`);
        resolve();
      });
    });

    // Mark MCP server as active BEFORE waiting for stdio connection
    // This allows the plugin to connect and show "connected" status while waiting for MCP client
    (httpServer as ReturnType<typeof createHttpServer> & { setMCPServerActive: (active: boolean) => void }).setMCPServerActive(true);
    console.error('MCP server marked as active');

    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Roblox Studio MCP server running on stdio');
    
    console.error('Waiting for Studio plugin to connect...');
    
    setInterval(() => {
      const pluginConnected = (httpServer as ReturnType<typeof createHttpServer> & { isPluginConnected: () => boolean }).isPluginConnected();
      const mcpActive = (httpServer as ReturnType<typeof createHttpServer> & { isMCPServerActive: () => boolean }).isMCPServerActive();
      
      if (pluginConnected && mcpActive) {
        // Both connected, no need to log
      } else if (pluginConnected && !mcpActive) {
        console.error('Studio plugin connected, but MCP server inactive');
      } else if (!pluginConnected && mcpActive) {
        console.error('MCP server active, waiting for Studio plugin...');
      } else {
        console.error('Waiting for connections...');
      }
    }, 5000);
    
    setInterval(() => {
      this.bridge.cleanupOldRequests();
    }, 5000);
  }
}

const server = new RobloxStudioMCPServer();
server.run().catch((error) => {
  console.error('Server failed to start:', error);
  process.exit(1);
});
