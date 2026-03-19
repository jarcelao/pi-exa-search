# pi-exa-search

Exa search extension for [pi](https://github.com/mariozechner/pi) - web search and content fetching via the [Exa API](https://exa.ai/).

## Features

- **exa_search** - Natural language web search with configurable result types (text, highlights, summary, or metadata only)
- **exa_fetch** - Fetch and extract content from specific URLs
- **Cost tracking** - API costs are displayed in tool results

## Installation

Install as a pi package:

```bash
pi install https://github.com/jarcelao/pi-exa-search@v1.0.0
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
