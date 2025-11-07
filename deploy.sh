set -e  # Exit on any error

echo "🚀 Starting ToolSmith deployment..."
echo ""

# Check if wrangler is installed
if ! command -v wrangler &> /dev/null; then
    echo "❌ Error: wrangler is not installed"
    echo "   Install it with: npm install -g wrangler"
    exit 1
fi

# Check if user is logged in
if ! wrangler whoami &> /dev/null; then
    echo "❌ Error: Not logged in to Cloudflare"
    echo "   Run: wrangler login"
    exit 1
fi

echo "✅ Wrangler authenticated"
echo ""

# Deploy Worker
echo "📦 Deploying Worker (Backend)..."
wrangler deploy

if [ $? -ne 0 ]; then
    echo "❌ Worker deployment failed"
    exit 1
fi

echo "✅ Worker deployed successfully"
echo ""

# Get Worker URL
WORKER_URL=$(wrangler deployments list --json 2>/dev/null | grep -o 'https://[^"]*workers.dev[^"]*' | head -1)

if [ -n "$WORKER_URL" ]; then
    echo "🌐 Worker URL: $WORKER_URL"
    echo ""
    
    # Update UI .env.production if Worker URL is found
    if [ -f "ui/.env.production" ]; then
        echo "📝 Updating ui/.env.production with Worker URL..."
        echo "VITE_WORKER_BASE_URL=$WORKER_URL" > ui/.env.production
        echo "✅ UI configuration updated"
    fi
else
    echo "⚠️  Could not determine Worker URL"
    echo "   Please update ui/.env.production manually"
fi

echo ""

# Build UI
echo "🏗️  Building UI..."
cd ui
npm install --silent
npm run build

if [ $? -ne 0 ]; then
    echo "❌ UI build failed"
    exit 1
fi

echo "✅ UI built successfully"
cd ..
echo ""

# Deploy UI to Pages
echo "📤 Deploying UI to Cloudflare Pages..."
wrangler pages deploy ui/dist --project-name=toolsmith-ui

if [ $? -ne 0 ]; then
    echo "❌ Pages deployment failed"
    exit 1
fi

echo ""
echo "✨ Deployment complete!"
echo ""
echo "📋 Your app is now live:"
echo "   🌐 UI:  https://toolsmith-ui.pages.dev"
if [ -n "$WORKER_URL" ]; then
    echo "   🔌 API: $WORKER_URL"
fi
echo ""
echo "🧪 Test the Worker:"
echo "   curl $WORKER_URL/api/skills/list -H \"X-User-ID: test-user\""
echo ""
echo "📝 Next steps:"
echo "   1. Open https://toolsmith-ui.pages.dev in your browser"
echo "   2. Test uploading a skill and chatting with the AI"
echo "   3. Update your README.md with the live URLs"
echo ""
