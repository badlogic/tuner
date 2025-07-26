#!/bin/bash

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

PROJECT=tuner
SERVER=slayer.marioslab.io
SERVER_DIR=/home/badlogic
DOMAIN=tuner.mariozechner.at

# Use different project name if PORT is set to allow multiple instances
if [ -n "$PORT" ]; then
    PROJECT="${PROJECT}-${PORT}"
fi

sync_files() {
    echo "Building for production..."
    npm install
    node infra/build.js

    echo "Syncing files..."
    rsync -avz \
      --include="dist/***" \
      --include="infra/***" \
      --include="run.sh" \
      --exclude="*" \
      --delete \
      ./ $SERVER:$SERVER_DIR/$DOMAIN/
}

pushd "$SCRIPT_DIR" > /dev/null

case "$1" in
dev)
    echo "Starting development server..."
    npm install
    node infra/build.js
    node infra/build.js --watch &
    docker compose -p $PROJECT -f infra/docker-compose.yml -f infra/docker-compose.dev.yml up --build --menu=false
    ;;
prod)
    echo "Starting production server..."
    docker compose -p $PROJECT -f infra/docker-compose.yml -f infra/docker-compose.prod.yml up -d --build
    ;;
stop)
    echo "Stopping services..."
    docker compose -p $PROJECT -f infra/docker-compose.yml -f infra/docker-compose.dev.yml down 2>/dev/null || \
    docker compose -p $PROJECT -f infra/docker-compose.yml -f infra/docker-compose.prod.yml down
    ;;
logs)
    docker compose -p $PROJECT -f infra/docker-compose.yml -f infra/docker-compose.dev.yml logs -f 2>/dev/null || \
    docker compose -p $PROJECT -f infra/docker-compose.yml -f infra/docker-compose.prod.yml logs -f
    ;;
deploy)
    echo "Deploying $PROJECT to $DOMAIN..."
    npm install
    node infra/build.js
    sync_files

    echo "Restarting services..."
    ssh $SERVER "cd $SERVER_DIR/$DOMAIN && ./run.sh stop && ./run.sh prod"

    echo "✅ Deployed to https://$DOMAIN"
    ;;
sync)
    echo "Syncing $PROJECT to $DOMAIN..."
    sync_files
    echo "✅ Synced to $DOMAIN"
    ;;
*)
    echo "Usage: $0 {dev|prod|stop|logs|deploy|sync}"
    echo ""
    echo "  dev     - Start development server (foreground)"
    echo "  prod    - Start production server (background)"
    echo "  stop    - Stop all services"
    echo "  logs    - Show logs"
    echo "  deploy  - Deploy and restart services"
    echo "  sync    - Sync files only, no restart"
    exit 1
    ;;
esac

popd > /dev/null