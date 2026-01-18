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

### 🏗️ **Instance Hierarchy & Navigation**
- `get_file_tree` - Explore Roblox instance hierarchy
- `get_project_structure` - Get complete game structure with customizable depth
- `search_files` - Find instances by name, type, or script content
- `get_services` - Access Roblox services and their children

### 🔧 **Property Management**
- `get_instance_properties` - Read all properties of any instance
- `set_property` - Modify instance properties
- `mass_set_property` - Bulk property modifications
- `set_calculated_property` - Use mathematical formulas for property values
- `set_relative_property` - Modify properties relative to current values

### 🏭 **Object Creation & Management**
- `create_object` - Create new Roblox instances
- `mass_create_objects` - Bulk object creation
- `smart_duplicate` - Intelligent duplication with automatic naming/positioning
- `delete_object` - Remove instances

### 📝 **Script Management**
- `get_script_source` - Read script source code with line numbers
- `set_script_source` - Replace entire script content
- `edit_script_lines` - Modify specific lines in scripts
- `insert_script_lines` - Add new lines at specific positions
- `delete_script_lines` - Remove lines from scripts

### 🏷️ **Attributes & Tags**
- Full CollectionService tag management
- Instance attribute operations (get/set/delete)

### 🎨 **Asset Integration**
- `insert_asset` - Add models/assets from Creator Store by ID
- `search_asset_catalog` - Search curated asset catalog (trees, buildings, effects, etc.)
- `get_asset_info` - Get information about assets

### 📊 **Studio Context**
- `get_place_info` - Current place details
- `get_selection` - Currently selected objects

### 💡 **Example Queries**

Ask things like:
- *"What's the structure of this game?"*
- *"Find all scripts with deprecated APIs"*
- *"Create 50 test NPCs in a grid pattern"*
- *"Add trees around the map perimeter"*
- *"Optimize this movement script"*
- *"Search for all parts with CanCollide = false"*

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
- `src/bridge-service.ts` - HTTP bridge to Studio plugin
- `src/http-server.ts` - HTTP server for plugin communication
- `studio-plugin/MCPPlugin.rbxmx` - Roblox Studio plugin file (place in Plugins folder)
- `studio-plugin/` - Source for the Roblox Studio plugin (Luau)

---

**v2.0.0** — 40+ tools, asset catalog integration, mass operations, smart duplication, calculated properties (Modified Fork)

[Report Issues](https://github.com/DefinitelyNotJosh1/robloxstudio-mcp/issues) | [DevForum](https://devforum.roblox.com/t/v180-roblox-studio-mcp-speed-up-your-workflow-by-letting-ai-read-paths-and-properties/3707071) | MIT Licensed
