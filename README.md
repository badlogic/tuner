# Guitar Tuner

Browser-based guitar tuner using Web Audio API and YIN pitch detection algorithm.

https://tuner.mariozechner.at

## Features

- **YIN Pitch Detection**: Industry-standard algorithm for accurate pitch detection
- **Extended Range**: Supports baritone guitars and extended range instruments (40Hz - 800Hz)
- **Real-time Performance**: Optimized for low-latency audio processing
- **Visual Feedback**: Tuning needle with color-coded accuracy
- **Browser-based**: No installation required, works in any modern browser

## Usage

1. Click START
2. Allow microphone access
3. Pluck a single guitar string
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
│   │   ├── index.html            # Main HTML with SVG tuner display
│   │   ├── index.ts              # Main TypeScript application
│   │   ├── pitch-worklet.js      # AudioWorklet for real-time processing
│   │   ├── styles.css            # Tailwind CSS styles
│   │   └── img/                  # Images and assets
│   │       ├── favicon.svg       # SVG favicon (needle icon)
│   │       └── og-image.png      # Social media preview image
│   ├── pitch-detector.ts         # YIN pitch detection algorithm
│   └── test/                     # Test suite
│       ├── frequency-to-note.test.ts  # YIN accuracy tests
│       └── test-wav-file.ts      # WAV file analysis tool
├── dist/                         # Build output (git ignored)
│   ├── index.html                # Built HTML with meta tags
│   ├── index.js                  # Bundled JavaScript
│   ├── index.js.map              # Source map
│   ├── styles.css                # Compiled CSS
│   └── img/                      # Built images and assets
│       ├── favicon.svg           # SVG favicon
│       └── og-image.png          # Social media preview image
├── infra/                        # Infrastructure
│   ├── build.js                  # Build script
│   ├── static-files.js           # Static file handling
│   ├── tsup.config.js            # TypeScript bundler config
│   ├── Caddyfile                 # Caddy web server configuration
│   ├── docker-compose.yml        # Base configuration
│   ├── docker-compose.dev.yml    # Development overrides
│   └── docker-compose.prod.yml   # Production overrides
├── build.json                    # Build & watch commands
├── run.sh                        # All-in-one CLI to build, dev, deploy
├── package.json                  # Dependencies and scripts
├── biome.json                    # Code formatting and linting
├── tsconfig.json                 # TypeScript configuration
├── LICENSE                       # GPL-2 License
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

## Testing

```bash
# Run YIN pitch detection tests
npm test

# Test with audio files
npm run build
node src/test/test-wav-file.ts path/to/audio.wav
```

## Algorithm Details

The tuner uses the **YIN algorithm** for pitch detection:

- **Autocorrelation-based**: More robust than FFT for musical instruments
- **Real-time capable**: ~1-5ms processing time for 2048 sample frames
- **Parabolic interpolation**: Sub-sample accuracy for precise frequency estimation
- **Note-aware smoothing**: Stable display with quick response to note changes

## License

MIT License - see [LICENSE](LICENSE) file for details.