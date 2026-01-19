# Roblox Studio MCP Server

**Connect AI assistants like Claude to Roblox Studio**

---

## What is This?

An enhanced MCP server that lets AI explore your game structure, read/edit scripts, and perform bulk changes all locally and safely. This is a modified fork with additional features and improvements. Built it for fun, just wanted to give an existing MCP more functionality. May maintain, may not. Send bug reports if you find them and I might get to them if I feel like it.

**Credits:** This project is a fork of the original work by [@boshyxd](https://github.com/boshyxd), with modifications by [@DefinitelyNotJosh1](https://github.com/DefinitelyNotJosh1). This fork contains the active development and latest features.

## Setup

### 1. Install the Studio Plugin

Place the `studio-plugin/MCPPlugin.rbxmx` file in your Roblox Studio Plugins folder.

### 2. Enable HTTP Requests

In Roblox Studio:
- Open Game Settings (F4 or View → Game Settings)
- Go to the Security tab
- Check **Allow HTTP Requests**

### 3. Configure Your MCP Client

Add this to your MCP client configuration (Cursor, Claude Desktop, etc.):

```json
{
  "mcpServers": {
    "roblox-mcp": {
      "command": "npx",
      "args": ["-y", "roblox-mcp@latest"]
    }
  }
}
```

### Important Note:
First enable the MCP server, then connect with the plugin in studio. If there's an error, go in task manager and end all node.exe processes, and try again.
It's a bug I'll try to fix, but isn't at the front of my priorities due to the easy workaround.

## What Can You Do?

The MCP server provides 40+ tools organized into categories:

### 🚀 **Batch Operations (New in v2.1.0)**
- `batch` - Execute multiple tool operations in a single call (reduces roundtrips, improves performance)

### 🏗️ **Instance Hierarchy & Navigation**
- `get_project_structure` - Get complete game structure with customizable depth
- `search_instances` - Unified search by name, class, script content, or property values
- `get_services` - Access Roblox services and their children
- `get_instance_children` - Get children of any instance

### 🔧 **Property Management**
- `get_instance_properties` - Read all properties of any instance
- `set_property` - Modify instance properties
- `mass_set_property` - Bulk property modifications (same property on multiple instances)
- `mass_get_property` - Bulk property reads
- `mass_set_properties` - Set multiple properties on multiple instances at once
- `set_calculated_property` - Use mathematical formulas for property values
- `set_relative_property` - Modify properties relative to current values

### 🏭 **Object Creation & Management**
- `create_object` - Create new Roblox instances (optionally with initial properties)
- `mass_create_objects` - Bulk object creation (each with optional properties)
- `smart_duplicate` - Intelligent duplication with automatic naming/positioning
- `mass_duplicate` - Multiple smart duplications at once
- `delete_object` - Remove instances

### 📝 **Script Management**
- `get_script_source` - Read script source code with line numbers
- `set_script_source` - Replace entire script content
- `edit_script` - Edit scripts: replace, insert, or delete lines (consolidated)
- `mass_get_script_source` - Read multiple scripts at once
- `mass_set_script_source` - Write multiple scripts at once

### 🏷️ **Attributes**
- `get_attributes` - Get single attribute or all attributes from an instance
- `set_attribute` - Set an attribute on an instance
- `delete_attribute` - Remove an attribute
- `mass_get_attributes` - Bulk attribute reads
- `mass_set_attribute` - Bulk attribute writes

### 🔖 **Tags (CollectionService)**
- `get_tags` - Get all tags on an instance
- `add_tag` / `remove_tag` - Manage individual tags
- `get_tagged` - Find all instances with a specific tag
- `mass_add_tag` / `mass_remove_tag` - Bulk tag operations

### 🎨 **Asset Integration**
- `insert_asset` - Add models/assets from Creator Store by ID
- `insert_multiple_assets` - Insert multiple assets at once
- `search_asset_catalog` - Search curated asset catalog (trees, buildings, effects, etc.)
- `get_asset_info` - Get information about assets
- `list_asset_categories` - List all available asset categories

### 📊 **Studio Context**
- `get_place_info` - Current place details
- `get_selection` - Currently selected objects
- `get_class_info` - Get properties/methods for Roblox classes

### 💡 **Example Queries**

Ask things like:
- *"What's the structure of this game?"*
- *"Find all scripts with deprecated APIs"*
- *"Create 50 test NPCs in a grid pattern"*
- *"Add trees around the map perimeter"*
- *"Optimize this movement script"*
- *"Search for all parts with CanCollide = false"*

### 🔥 **v2.1.0 Batch Example**

Execute multiple operations in one call:
```
batch([
  { tool: "create_object", args: { className: "Part", parent: "game.Workspace", name: "Floor", properties: { Size: [100, 1, 100] } } },
  { tool: "create_object", args: { className: "SpawnLocation", parent: "game.Workspace", name: "Spawn" } },
  { tool: "mass_add_tag", args: { paths: ["game.Workspace.Floor", "game.Workspace.Spawn"], tagName: "GameObjects" } }
])
```

## Troubleshooting

### Plugin Connection Issues
1. Ensure the plugin shows "Connected" in the toolbar
2. Check that HTTP requests are enabled in Game Settings
3. Verify your MCP client is configured with the correct path to `dist/index.js`

### MCP Client Issues
1. Restart your MCP client after configuration changes
2. Check that the path to `dist/index.js` is correct
3. Ensure Node.js is installed and in your PATH
4. Check that the `dist` folder exists (run `npm run build` if it doesn't)

## Development

### Building and Testing

```bash
# Install dependencies
npm install

# Build the project
npm run build

# Build plugin (requires Rojo)
npm run build:plugin

# Run tests
npm test

# Run development server
npm run dev
```

### Project Structure

- `src/index.ts` - Main MCP server entry point
- `src/tools/` - Tool implementations
- `src/bridge-service.ts` - HTTP bridge to Studio plugin (with batch support)
- `src/http-server.ts` - HTTP server for plugin communication
- `studio-plugin/MCPPlugin.rbxmx` - Roblox Studio plugin file (place in Plugins folder)
- `studio-plugin/` - Source for the Roblox Studio plugin (Luau)

---

**v2.1.0** — Consolidated tools, batch execution, mass operations, smart duplication, calculated properties (Modified Fork)

**Changes in v2.1.0:**
- **Tool consolidation** - Reduced tool count while maintaining functionality (better LLM performance)
- **Batch tool** - Execute multiple operations in a single call
- **New mass tools** - `mass_set_properties`, `mass_get_script_source`, `mass_set_script_source`, `mass_get_attributes`, `mass_set_attribute`, `mass_add_tag`, `mass_remove_tag`
- **Unified search** - `search_instances` replaces multiple search tools
- **Consolidated script editing** - `edit_script` with operation type (replace/insert/delete)
- **Transport batching** - Plugin polls for and responds to batched requests

[Report Issues](https://github.com/DefinitelyNotJosh1/robloxstudio-mcp/issues) | [DevForum](https://devforum.roblox.com/t/v180-roblox-studio-mcp-speed-up-your-workflow-by-letting-ai-read-paths-and-properties/3707071) | MIT Licensed
