# Mahi Tech Group — Local Setup Guide

## Prerequisites
- Node.js v18 or higher
- Git
- VS Code (recommended)

## Step 1: Clone the Repository
git clone https://github.com/Munnabhai63/mahi-tech-group.git
cd mahi-tech-group

## Step 2: Install Dependencies
npm install

## Step 3: Create Environment File
cp .env.example .env

Open .env and fill in these values:

PORT=3000
JWT_SECRET=any-random-32-plus-character-string-here
ENCRYPTION_KEY=any-random-32-plus-character-string-here
SESSION_SECRET=any-random-32-plus-character-string-here
GITHUB_APP_ID=leave-blank-for-now
GITHUB_APP_PRIVATE_KEY_PATH=leave-blank-for-now
GITHUB_WEBHOOK_SECRET=leave-blank-for-now
GITHUB_ORG_NAME=leave-blank-for-now
GITHUB_APP_INSTALLATION_ID=leave-blank-for-now

Note: The platform runs fully on localhost without GitHub
credentials. GitHub automation features activate only when
real GitHub App credentials are provided.

## Step 4: Run Database Migrations
node scripts/migrate-prd17-batch1.js
node scripts/migrate-prd17-batch3.js

Both must print "migration complete" before continuing.

## Step 5: Start the Server
npm start

Open browser: http://localhost:3000

## Step 6: Default Admin Login
Check .env or src/db/seed.js for the default Admin
username and password created on first run.

## Step 7: Run Verification Tests
npm test
node scripts/run-step15-pipeline-tests.js
node scripts/run-prd16-layer1-tests.js
node scripts/run-prd16-layer2-tests.js

All suites must pass before the setup is considered complete.

## Troubleshooting

Problem: Port 3000 already in use
Solution: Change PORT=3001 in .env

Problem: Database locked error
Solution: Stop the server and restart with npm start

Problem: npm install fails
Solution: Delete node_modules folder and run npm install again

Problem: Migration script error
Solution: Confirm .env file exists and PORT is set correctly
