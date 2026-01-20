/**
 * Build Queue System - Multi-Concurrent Build Support
 * Allows configurable number of concurrent builds
 */

class BuildQueue {
    constructor() {
        // Get max concurrent from env (default 1)
        this.maxConcurrent = parseInt(process.env.MAX_CONCURRENT_BUILDS) || 1;
        this.maxConcurrent = Math.max(1, Math.min(this.maxConcurrent, 4)); // Clamp 1-4

        // Track active builds
        this.activeBuilds = new Map(); // chatId -> { startTime, lastActivity }

        // Timeout settings
        this.MAX_BUILD_TIME = 45 * 60 * 1000;      // 45 minutes absolute max
        this.INACTIVITY_TIMEOUT = 10 * 60 * 1000;  // 10 minutes no activity

        console.log(`🔧 Build Queue: max ${this.maxConcurrent} concurrent build(s)`);

        // Start watchdog to detect stuck builds
        this.startWatchdog();
    }

    /**
     * Start watchdog to check for stuck builds every minute
     */
    startWatchdog() {
        setInterval(() => {
            this.checkStuckBuilds();
        }, 60 * 1000); // Check every 1 minute
    }

    /**
     * Check and auto-release stuck builds
     */
    checkStuckBuilds() {
        if (this.activeBuilds.size === 0) return;

        const now = Date.now();
        const toRelease = [];

        for (const [chatId, build] of this.activeBuilds) {
            const totalTime = now - build.startTime;
            const inactiveTime = now - (build.lastActivity || build.startTime);

            // Force release if exceeded max time
            if (totalTime > this.MAX_BUILD_TIME) {
                console.warn(`[Queue] ⚠️ BUILD TIMEOUT! Chat ${chatId}, ${Math.round(totalTime / 60000)}m exceeded limit.`);
                toRelease.push(chatId);
                continue;
            }

            // Force release if inactive too long
            if (inactiveTime > this.INACTIVITY_TIMEOUT) {
                console.warn(`[Queue] ⚠️ BUILD INACTIVE! Chat ${chatId}, no activity for ${Math.round(inactiveTime / 60000)}m.`);
                toRelease.push(chatId);
            }
        }

        // Release stuck builds
        for (const chatId of toRelease) {
            this.forceRelease(chatId);
        }

        // Log status
        if (this.activeBuilds.size > 0) {
            console.log(`[Queue] 📊 Active builds: ${this.activeBuilds.size}/${this.maxConcurrent}`);
        }
    }

    /**
     * Update activity timestamp (call during build progress)
     */
    updateActivity(chatId = null) {
        if (chatId && this.activeBuilds.has(chatId)) {
            this.activeBuilds.get(chatId).lastActivity = Date.now();
        } else {
            // Update all (backwards compatibility)
            for (const build of this.activeBuilds.values()) {
                build.lastActivity = Date.now();
            }
        }
    }

    /**
     * Check if queue is at capacity
     * @returns {boolean}
     */
    isBusy() {
        return this.activeBuilds.size >= this.maxConcurrent;
    }

    /**
     * Get active builds count
     * @returns {number}
     */
    getActiveCount() {
        return this.activeBuilds.size;
    }

    /**
     * Get max concurrent limit
     * @returns {number}
     */
    getMaxConcurrent() {
        return this.maxConcurrent;
    }

    /**
     * Get current build info (for backwards compatibility - returns first build)
     * @returns {object|null}
     */
    getCurrentBuild() {
        if (this.activeBuilds.size === 0) return null;

        const [chatId, build] = this.activeBuilds.entries().next().value;
        return {
            chatId: chatId,
            startTime: build.startTime,
            duration: Date.now() - build.startTime,
            lastActivity: build.lastActivity
        };
    }

    /**
     * Get all active builds
     * @returns {array}
     */
    getAllBuilds() {
        const now = Date.now();
        return Array.from(this.activeBuilds.entries()).map(([chatId, build]) => ({
            chatId,
            startTime: build.startTime,
            duration: now - build.startTime,
            lastActivity: build.lastActivity
        }));
    }

    /**
     * Lock a build slot for a specific chat
     * @param {number} chatId - Chat ID of the user
     * @returns {boolean} - True if lock acquired, false if busy
     */
    acquire(chatId) {
        // Check if already building
        if (this.activeBuilds.has(chatId)) {
            console.log(`[Queue] ⚠️ Chat ${chatId} already has active build`);
            return false;
        }

        // Check capacity
        if (this.activeBuilds.size >= this.maxConcurrent) {
            console.log(`[Queue] 🚫 Queue full (${this.activeBuilds.size}/${this.maxConcurrent})`);
            return false;
        }

        const now = Date.now();
        this.activeBuilds.set(chatId, {
            startTime: now,
            lastActivity: now
        });

        console.log(`[Queue] ✅ Build started for chat ${chatId} (${this.activeBuilds.size}/${this.maxConcurrent})`);
        return true;
    }

    /**
     * Release the build lock
     * @param {number} chatId - Chat ID of the user
     */
    release(chatId) {
        const build = this.activeBuilds.get(chatId);
        if (!build) {
            console.warn(`[Queue] Attempted to release non-existent build for chat: ${chatId}`);
            return;
        }

        const duration = Date.now() - build.startTime;
        console.log(`[Queue] ✅ Build completed for chat ${chatId} (${Math.round(duration / 1000)}s)`);

        this.activeBuilds.delete(chatId);
    }

    /**
     * Force release (for error recovery or admin)
     * @param {number} chatId - Optional: specific chat to release
     */
    forceRelease(chatId = null) {
        if (chatId) {
            if (this.activeBuilds.has(chatId)) {
                console.log(`[Queue] 🔄 Force releasing build for chat ${chatId}`);
                this.activeBuilds.delete(chatId);
            }
        } else {
            // Release all builds
            console.log(`[Queue] 🔄 Force releasing ALL ${this.activeBuilds.size} builds`);
            this.activeBuilds.clear();
        }
    }

    /**
     * Get formatted status message
     * @returns {string}
     */
    getStatusMessage() {
        if (this.activeBuilds.size === 0) {
            return `✅ Server siap (0/${this.maxConcurrent} slot)`;
        }

        const slots = `${this.activeBuilds.size}/${this.maxConcurrent}`;
        if (this.activeBuilds.size >= this.maxConcurrent) {
            return `⏳ Server sibuk (${slots} slot terpakai)`;
        }
        return `🔄 Server aktif (${slots} slot terpakai)`;
    }
}

// Singleton instance
const buildQueue = new BuildQueue();

module.exports = { buildQueue };
