# pi-exa-api

Web search, content fetching, and code context for [pi](https://pi.dev) via the [Exa API](https://exa.ai/).

## Installation

Install as a pi package:

```bash
pi install npm:@jarcelao/pi-exa-api
```

## Configuration

Set your Exa API key as an environment variable before starting pi:

```bash
export EXA_API_KEY="your-api-key-here"
pi
```

Or add to your shell profile (`~/.bashrc`, `~/.zshrc`, etc.) for persistence.

### Check Configuration

Run the `/exa-status` command in pi to verify your API key is configured:

```
/exa-status
```

## Usage

### Web Search

The agent can use `exa_search` to find information on the web:

```
Search for recent developments in quantum computing
```

**Parameters:**

- `query` (required) - Natural language search query
- `contentType` (optional) - Type of content to retrieve:
  - `highlights` (default) - Key excerpts from each result
  - `text` - Full text content (may be truncated)
  - `summary` - AI-generated summary
  - `none` - Metadata only (title, URL, date, author)
- `numResults` (optional) - Number of results (1-100, default: 10)

### Fetch URL Content

The agent can use `exa_fetch` to extract content from a specific URL:

```
Fetch the content from https://example.com/article
```

**Parameters:**

- `url` (required) - URL to fetch
- `contentType` (optional) - Type of content:
  - `text` (default) - Full page text
  - `highlights` - Key excerpts
  - `summary` - AI-generated summary
- `maxCharacters` (optional) - Maximum characters to return (1000-100000)

### Code Context

The agent can use `exa_code_context` to find code snippets and examples from open source libraries and repositories:

```
Find examples of React hooks for state management
```

It's ideal for understanding how libraries, frameworks, or programming concepts are implemented in practice.

**Parameters:**

- `query` (required) - Search query for code snippets and examples (1-2000 characters)
- `tokensNum` (optional) - Token limit for the response:
  - `"dynamic"` (default) - Automatically determine optimal response length
  - `50-100000` - Specific number of tokens (5000 is a good default, use 10000 when more context is needed)

## Development

```bash
# Install dependencies
npm install

# Run tests
npm test

# Run linting
npm run lint

# Format code
npm run format
```

## License

MIT
