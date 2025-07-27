# Guitar Tuner

Browser-based guitar tuner using Web Audio API.

https://tuner.mariozechner.at

## Usage

1. Click START
2. Allow microphone access
3. Play a guitar string
4. Tune until the needle is green and centered

Requires a browser with Web Audio API support.

## Development

### Quick Deployment

```bash
npm run build
# Copy dist/ files to any web server
```

### Full Development Setup

#### Development Workflow

```bash
# Start dev environment (Docker + live reload)
./run.sh dev

# Your app is now running at http://localhost:8080
# Edit files in src/ and see changes instantly

# Run on a different port
PORT=8081 ./run.sh dev

# For parallel development, use git worktrees
git worktree add ../tuner-feature feature-branch
cd ../tuner-feature
PORT=8081 ./run.sh dev  # Runs independently with its own dist/
```

#### Production Deployment

```bash
# Deploy to your server (builds automatically)
./run.sh deploy
```

The deploy command:
1. Builds TypeScript and CSS locally
2. Syncs files to your server via rsync
3. Restarts services with Docker Compose
4. Caddy automatically handles SSL and routing

To deploy to your own server, edit the server details in `run.sh` and set up SSH keys. Expects server configured per [create-app](https://github.com/badlogic/create-app).

## Project Structure

```
tuner/
├── src/                          # Source files
│   ├── frontend/                 # Frontend application
│   │   ├── index.html           # Main HTML with SVG tuner display
│   │   ├── index.ts             # Main TypeScript application
│   │   └── styles.css           # Tailwind CSS styles
│   ├── pitch-detector.ts         # Core pitch detection algorithm
│   └── test/                     # Test suite
│       └── test-frequency-to-note.ts  # Comprehensive pitch detection tests
├── dist/                         # Build output (git ignored)
│   ├── index.html               # Built HTML
│   ├── index.js                 # Bundled JavaScript
│   └── styles.css               # Compiled CSS
├── infra/                        # Infrastructure
│   ├── build.js                 # Build script
│   ├── Caddyfile                # Caddy web server configuration
│   ├── docker-compose.yml       # Base configuration
│   ├── docker-compose.dev.yml   # Development overrides
│   └── docker-compose.prod.yml  # Production overrides
├── run.sh                        # All-in-one CLI
├── package.json                  # Dependencies and scripts
├── LICENSE                       # MIT License
└── README.md                     # This file
```

## Commands

```bash
./run.sh dev              # Start dev server at localhost:8080
PORT=8081 ./run.sh dev    # Start on custom port
./run.sh prod             # Run production locally
./run.sh deploy           # Deploy to configured server
./run.sh sync             # Sync files (dist/, infra/) to configured server
./run.sh stop             # Stop containers locally
./run.sh logs             # View container logs locally
```

## Building WASM FFT

The guitar tuner includes an optional WebAssembly-accelerated FFT implementation for improved performance. To build the WASM module:

### Prerequisites

Install required tools with Homebrew:

```bash
# Install LLVM (clang compiler) and LLD (WASM linker)
brew install llvm lld

# Optional: Install WABT (WebAssembly Binary Toolkit) for debugging
brew install wabt
```

### Building

```bash
# Build the WASM FFT module
./build-wasm.sh
```

This compiles `src/wasm/fft.c` to `src/wasm/fft.wasm` using:
- **clang** (from LLVM) - C compiler with WASM target
- **wasm-ld** (from LLD) - WebAssembly linker

The generated WASM file is committed to git so end users don't need the build tools.

### Implementation Notes

- The TypeScript code automatically falls back to pure JS if WASM loading fails
- Current WASM implementation is a partial Bluestein FFT (work in progress)
- Browser environment loads WASM via `fetch('/dist/fft.wasm')`
- Node.js environment loads WASM via `fs.readFileSync()`

## License

MIT License - see [LICENSE](LICENSE) file for details.