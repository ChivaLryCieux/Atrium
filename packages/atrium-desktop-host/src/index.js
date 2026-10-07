#!/usr/bin/env node
/**
 * Atrium 智役中庭 — Desktop Kernel Bridge
 *
 * Drives the real DeepSeek Harness (dsh) runtime through the official
 * `@deepseek-ai/dsh-sdk-client` and exposes it to the Tauri shell.
 */

import { startBridgeServer } from './server.js'

startBridgeServer()
