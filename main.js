const obsidian = require('obsidian');

/* ═══════════════════════════════════════════════════════════
   SETTINGS — with schema versioning
   ═══════════════════════════════════════════════════════════ */

const SETTINGS_VERSION = 3;

const DEFAULT_SETTINGS = {
    _version: SETTINGS_VERSION,
    contentPath: "src/content",
    requiredFields: ["title", "description", "status", "era"],
    validateDraft: true,
    validateDate: true,
    autoSyncGraph: false, // DISABLED by default — was causing infinite loops
    showRibbonIcon: true,
    cardsPerPage: 40,
};

function migrateSettings(loaded) {
    const version = loaded._version || 0;
    if (version < 1) {
        if (loaded.oldContentPath) { loaded.contentPath = loaded.oldContentPath; delete loaded.oldContentPath; }
    }
    if (version < 2) {
        if (typeof loaded.requiredFields === "string") {
            loaded.requiredFields = loaded.requiredFields.split(",").map(s => s.trim()).filter(s => s);
        }
        if (loaded.cardsPerPage === undefined) loaded.cardsPerPage = 40;
    }
    if (version < 3) {
        // v3: graph sync disabled by default due to cache.links mutation causing freezes
        // If user had it enabled, keep it — but they've been warned
    }
    loaded._version = SETTINGS_VERSION;
    return loaded;
}

/* ═══════════════════════════════════════════════════════════
   VALIDATOR ENGINE
   ═══════════════════════════════════════════════════════════ */

class AstroCMSValidator {
    static validate(frontmatter, settings) {
        const errors = [];
        if (!frontmatter) {
            errors.push({ field: "Frontmatter", message: "Metadata block is completely missing.", severity: "error" });
            return errors;
        }
        const required = settings.requiredFields || DEFAULT_SETTINGS.requiredFields;
        for (const field of required) {
            if (!frontmatter[field] || typeof frontmatter[field] !== "string" || frontmatter[field].trim() === "") {
                errors.push({ field, message: `This field is missing or empty. Astro requires it to compile.`, severity: "error" });
            }
        }
        if (settings.validateDraft) {
            if (frontmatter["draft"] === undefined || typeof frontmatter["draft"] !== "boolean") {
                errors.push({ field: "draft", message: "Must be explicitly set to true or false (no quotes).", severity: "error" });
            }
        }
        if (settings.validateDate) {
            if (!frontmatter["date"]) {
                errors.push({ field: "date", message: "Publication date is missing.", severity: "error" });
            } else {
                if (isNaN(Date.parse(String(frontmatter["date"])))) {
                    errors.push({ field: "date", message: "Invalid date format. Use YYYY-MM-DD.", severity: "error" });
                }
            }
        }
        const arrayFields = ["tags", "connects"];
        for (const field of arrayFields) {
            if (frontmatter[field] !== undefined && !Array.isArray(frontmatter[field])) {
                errors.push({ field, message: `Must be formatted as a list, e.g.: ["item1", "item2"]`, severity: "warning" });
            }
        }
        if (frontmatter["series"] && !frontmatter["seriesOrder"]) {
            errors.push({ field: "seriesOrder", message: "You have an active 'series' but forgot to specify a 'seriesOrder' (e.g., 'A1').", severity: "warning" });
        }
        return errors;
    }

    static getStatusForFile(file, app, settings) {
        try {
            const cache = app.metadataCache.getFileCache(file);
            const fm = cache?.frontmatter;
            const errors = this.validate(fm, settings);
            if (errors.length === 0) return { status: "ready", label: "Ready", errors: [] };
            if (errors.some(e => e.severity === "error")) return { status: "error", label: "Errors", errors };
            return { status: "warning", label: "Warnings", errors };
        } catch (e) {
            return { status: "error", label: "Error", errors: [{ field: "Validation", message: "Failed to validate file.", severity: "error" }] };
        }
    }
}

/* ═══════════════════════════════════════════════════════════
   CONTENT CACHE — incremental, with safe async scanning
   ═══════════════════════════════════════════════════════════ */

class ContentCache {
    constructor() {
        this.items = new Map();
        this._stats = null;
        this._statsDirty = true;
        this._lastContentPath = null;
    }

    _buildItem(file, app, settings) {
        try {
            const cache = app.metadataCache.getFileCache(file);
            const fm = cache?.frontmatter || {};
            const validation = AstroCMSValidator.getStatusForFile(file, app, settings);
            return {
                file, path: file.path, name: file.basename,
                title: fm.title || file.basename, description: fm.description || "",
                status: fm.status || "—", era: fm.era || "—", draft: fm.draft,
                date: fm.date ? String(fm.date) : "—",
                tags: Array.isArray(fm.tags) ? fm.tags : [],
                connects: Array.isArray(fm.connects) ? fm.connects : [],
                series: fm.series || "", seriesOrder: fm.seriesOrder || "",
                validation,
            };
        } catch (e) { return null; }
    }

    scanAll(app, settings) {
        const contentPath = settings.contentPath || DEFAULT_SETTINGS.contentPath;
        if (this._lastContentPath && this._lastContentPath !== contentPath) this.items.clear();
        this._lastContentPath = contentPath;

        const files = app.vault.getMarkdownFiles();
        const contentFiles = files.filter(f => f.path.startsWith(contentPath));
        const currentPaths = new Set(contentFiles.map(f => f.path));

        for (const path of [...this.items.keys()]) {
            if (!currentPaths.has(path)) { this.items.delete(path); this._statsDirty = true; }
        }
        for (const file of contentFiles) {
            const existing = this.items.get(file.path);
            if (!existing || existing.file !== file) {
                const item = this._buildItem(file, app, settings);
                if (item) { this.items.set(file.path, item); this._statsDirty = true; }
            }
        }
        this._statsDirty = true;
    }

    updateFile(file, app, settings) {
        const contentPath = settings.contentPath || DEFAULT_SETTINGS.contentPath;
        if (!file.path.startsWith(contentPath)) return;
        const item = this._buildItem(file, app, settings);
        if (item) { this.items.set(file.path, item); this._statsDirty = true; }
    }

    removeFile(path) {
        if (this.items.has(path)) { this.items.delete(path); this._statsDirty = true; }
    }

    getStats() {
        if (!this._statsDirty && this._stats) return this._stats;
        const items = [...this.items.values()];
        this._stats = {
            total: items.length,
            published: items.filter(i => i.status === "published").length,
            drafts: items.filter(i => i.draft === true).length,
            ready: items.filter(i => i.validation.status === "ready").length,
            errors: items.filter(i => i.validation.status === "error").length,
            warnings: items.filter(i => i.validation.status === "warning").length,
            uniqueTags: [...new Set(items.flatMap(i => i.tags))],
            allEras: [...new Set(items.map(i => i.era).filter(e => e && e !== "—"))],
            allSeries: [...new Set(items.map(i => i.series).filter(s => s && s !== ""))],
        };
        this._statsDirty = false;
        return this._stats;
    }

    getSortedItems() {
        return [...this.items.values()].sort((a, b) => a.path.localeCompare(b.path));
    }

    matchesFilter(item, filter, searchQuery) {
        if (filter === "ready" && item.validation.status !== "ready") return false;
        if (filter === "error" && item.validation.status !== "error") return false;
        if (filter === "warning" && item.validation.status !== "warning") return false;
        if (filter === "draft" && item.draft !== true) return false;
        if (filter === "published" && item.status !== "published") return false;
        if (searchQuery) {
            const q = searchQuery.toLowerCase();
            return item.title.toLowerCase().includes(q) || item.path.toLowerCase().includes(q) ||
                item.tags.some(t => t.toLowerCase().includes(q)) || item.era.toLowerCase().includes(q);
        }
        return true;
    }
}

/* ═══════════════════════════════════════════════════════════
   DASHBOARD VIEW — freeze-proof architecture
   
   Key safety principles:
   1. NEVER process metadataCache.on("changed") during startup flood
   2. ALL cache updates are debounced (not just DOM)
   3. Initial scan only after workspace.layoutReady
   4. No direct mutation of Obsidian internals
   ═══════════════════════════════════════════════════════════ */

const VIEW_TYPE_DASHBOARD = "astro-cms-dashboard";

class AstroCMSDashboardView extends obsidian.ItemView {
    constructor(leaf, plugin) {
        super(leaf);
        this.plugin = plugin;
        this.currentFilter = "all";
        this.searchQuery = "";
        this._visibleLimit = plugin.settings.cardsPerPage || 40;
        this._cardElements = new Map();
        this._gridEl = null;
        this._statsEl = null;
        this._loadMoreEl = null;
        this._totalVisible = 0;

        // ─── Safety gates ───
        this._destroyed = false;
        this._ready = false;
        this._pendingPaths = new Set();   // paths that need cache update
        this._updateTimer = null;         // debounce timer for cache + DOM updates
    }

    getViewType() { return VIEW_TYPE_DASHBOARD; }
    getDisplayText() { return "Astro CMS Dashboard"; }
    getIcon() { return "layout-dashboard"; }

    async onOpen() {
        this._destroyed = false;

        // ─── EVENT ROUTING: all debounced, gated on layoutReady ───

        this.registerEvent(this.app.metadataCache.on("changed", (file) => {
            // CRITICAL: Skip ALL events during Obsidian's startup metadata flood
            if (!this.app.workspace.layoutReady) return;
            if (this._destroyed) return;
            if (!file.path.startsWith(this.plugin.settings.contentPath)) return;
            this._queuePath(file.path);
        }));

        this.registerEvent(this.app.vault.on("create", (file) => {
            if (!this.app.workspace.layoutReady) return;
            if (this._destroyed) return;
            if (!file.path.startsWith(this.plugin.settings.contentPath) || file.extension !== "md") return;
            // Delay: new file may not have metadata yet
            setTimeout(() => {
                if (!this._destroyed) this._queuePath(file.path);
            }, 500);
        }));

        this.registerEvent(this.app.vault.on("delete", (file) => {
            if (!this.app.workspace.layoutReady) return;
            if (this._destroyed) return;
            if (!file.path.startsWith(this.plugin.settings.contentPath)) return;
            // For deleted files, remove from cache immediately (no metadata to read)
            this.plugin.cache.removeFile(file.path);
            this._queuePath(file.path);
        }));

        this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
            if (!this.app.workspace.layoutReady) return;
            if (this._destroyed) return;
            if (oldPath.startsWith(this.plugin.settings.contentPath)) {
                this.plugin.cache.removeFile(oldPath);
                this._queuePath(oldPath);
            }
            if (file.path.startsWith(this.plugin.settings.contentPath) && file.extension === "md") {
                setTimeout(() => {
                    if (!this._destroyed) this._queuePath(file.path);
                }, 500);
            }
        }));

        // ─── Initial scan — only after layout is ready ───
        if (this.app.workspace.layoutReady) {
            this._doInitialScan();
        } else {
            const ref = this.app.workspace.on("layout-ready", () => {
                this.app.workspace.offref(ref);
                this._doInitialScan();
            });
            this.registerEvent(ref);
            // Show loading state immediately
            this._showLoading();
        }
    }

    _showLoading() {
        try {
            const container = this._getContainer();
            if (!container) return;
            container.empty();
            container.addClass("astro-cms-dashboard");
            container.createEl("div", { cls: "cms-loading-state" }).innerHTML =
                '<div class="cms-empty-title">Loading Astro Content...</div>' +
                '<div class="cms-empty-desc">Scanning your content folder. This may take a moment for large vaults.</div>';
        } catch (e) { /* ignore */ }
    }

    _doInitialScan() {
        if (this._destroyed) return;
        try {
            this.plugin.cache.scanAll(this.app, this.plugin.settings);
        } catch (e) {
            console.error("Astro CMS: initial scan failed", e);
        }
        this.renderDashboard();
        this._ready = true;
    }

    /* ─── DEBOUNCED UPDATE QUEUE ─── */
    // Instead of updating cache immediately on every event,
    // we queue paths and process them in a debounced batch.

    _queuePath(path) {
        this._pendingPaths.add(path);
        this._scheduleUpdate();
    }

    _scheduleUpdate() {
        if (!this._ready) return;
        if (this._updateTimer) clearTimeout(this._updateTimer);
        this._updateTimer = setTimeout(() => this._processPending(), 500);
    }

    _processPending() {
        if (this._destroyed) return;
        if (this._pendingPaths.size === 0) return;

        const paths = new Set(this._pendingPaths);
        this._pendingPaths.clear();

        // Update cache for all pending paths
        for (const path of paths) {
            try {
                const item = this.plugin.cache.items.get(path);
                if (item) {
                    // File still in cache — it was an update
                    const file = this.app.vault.getAbstractFileByPath(path);
                    if (file && file.extension === "md") {
                        this.plugin.cache.updateFile(file, this.app, this.plugin.settings);
                    }
                }
                // If item was removed (delete handler), cache is already updated
            } catch (e) {
                console.error("Astro CMS: error updating cache for", path, e);
            }
        }

        // Refresh the entire dashboard (simple, safe, debounced)
        this._refreshView();
    }

    _refreshView() {
        if (this._destroyed || !this._ready) return;
        try {
            this.renderDashboard();
        } catch (e) {
            console.error("Astro CMS: refresh failed", e);
        }
    }

    _getContainer() {
        try {
            return this.containerEl.children[1] || this.containerEl.createDiv();
        } catch (e) {
            return null;
        }
    }

    /* ─── FULL RENDER ─── */

    renderDashboard() {
        const container = this._getContainer();
        if (!container) return;

        container.empty();
        container.addClass("astro-cms-dashboard");
        this._cardElements.clear();

        try {
            const cache = this.plugin.cache;

            // ─── Header ───
            const header = container.createEl("div", { cls: "cms-dash-header" });
            header.createEl("h2", { text: "Astro Content Dashboard", cls: "cms-dash-title" });
            header.createEl("p", { text: "Manage and validate your Astro content folder", cls: "cms-dash-subtitle" });

            // ─── Stats Row ───
            this._statsEl = container.createEl("div", { cls: "cms-stats-row" });
            this._renderStats();

            // ─── Toolbar ───
            const toolbar = container.createEl("div", { cls: "cms-toolbar" });

            const searchWrap = toolbar.createEl("div", { cls: "cms-search-wrap" });
            const searchInput = searchWrap.createEl("input", {
                type: "text", placeholder: "Search posts...",
                cls: "cms-search-input", value: this.searchQuery,
            });
            searchInput.addEventListener("input", () => {
                this.searchQuery = searchInput.value;
                this.applyFilters();
            });

            const filterGroup = toolbar.createEl("div", { cls: "cms-filter-group" });
            const filters = [
                { key: "all", label: "All" }, { key: "ready", label: "Ready" },
                { key: "error", label: "Errors" }, { key: "warning", label: "Warnings" },
                { key: "draft", label: "Drafts" }, { key: "published", label: "Published" },
            ];
            for (const f of filters) {
                const btn = filterGroup.createEl("button", {
                    text: f.label,
                    cls: `cms-filter-btn ${this.currentFilter === f.key ? "cms-filter-btn-active" : ""}`,
                });
                btn.addEventListener("click", () => {
                    this.currentFilter = f.key;
                    filterGroup.querySelectorAll(".cms-filter-btn").forEach(b => b.removeClass("cms-filter-btn-active"));
                    btn.addClass("cms-filter-btn-active");
                    this.applyFilters();
                });
            }

            const actionsGroup = toolbar.createEl("div", { cls: "cms-actions-group" });
            actionsGroup.createEl("button", { text: "Bulk Pre-Flight", cls: "cms-btn cms-btn-primary" })
                .addEventListener("click", () => this._bulkPreflight());
            actionsGroup.createEl("button", { text: "Refresh", cls: "cms-btn cms-btn-secondary" })
                .addEventListener("click", () => {
                    try {
                        this.plugin.cache.scanAll(this.app, this.plugin.settings);
                        this.renderDashboard();
                    } catch (e) {
                        console.error("Astro CMS: refresh failed", e);
                    }
                });

            // ─── Content Grid ───
            this._gridEl = container.createEl("div", { cls: "cms-content-grid" });
            const items = cache.getSortedItems();

            if (items.length === 0) {
                this._gridEl.createEl("div", { cls: "cms-empty-state" }).innerHTML =
                    `<div class="cms-empty-title">No posts found in ${this.plugin.settings.contentPath}</div>` +
                    `<div class="cms-empty-desc">Make sure your Astro content folder is inside your Obsidian vault.</div>`;
            } else {
                for (const item of items) this._createCardElement(item);
            }

            // ─── Load More ───
            this._loadMoreEl = container.createEl("div", { cls: "cms-load-more-wrap" });
            this._loadMoreEl.createEl("button", { text: "Load More", cls: "cms-btn cms-btn-secondary cms-btn-full" })
                .addEventListener("click", () => {
                    this._visibleLimit += this.plugin.settings.cardsPerPage || 40;
                    this.applyFilters();
                });

            this.applyFilters();
            this._renderMetaSection(container);

        } catch (e) {
            console.error("Astro CMS Dashboard render error:", e);
            container.empty();
            const err = container.createEl("div", { cls: "cms-error-display" });
            err.createEl("h3", { text: "Dashboard Error" });
            err.createEl("p", { text: e.message || "Unknown error." });
            err.createEl("pre", { text: e.stack || "" });
        }
    }

    /* ─── STATS ─── */

    _renderStats() {
        if (!this._statsEl) return;
        this._statsEl.empty();
        try {
            const s = this.plugin.cache.getStats();
            const cards = [
                { label: "Total Posts", value: s.total, cls: "" },
                { label: "Published", value: s.published, cls: "cms-stat-success" },
                { label: "Drafts", value: s.drafts, cls: "cms-stat-warning" },
                { label: "Errors", value: s.errors, cls: "cms-stat-error" },
                { label: "Warnings", value: s.warnings, cls: "cms-stat-warn" },
                { label: "Ready", value: s.ready, cls: "cms-stat-success" },
            ];
            for (const c of cards) {
                const el = this._statsEl.createEl("div", { cls: `cms-stat-card ${c.cls}` });
                el.createEl("div", { text: String(c.value), cls: "cms-stat-value" });
                el.createEl("div", { text: c.label, cls: "cms-stat-label" });
            }
        } catch (e) {
            console.error("Astro CMS: stats render error", e);
        }
    }

    /* ─── CARD CREATION ─── */

    _createCardElement(item) {
        if (!this._gridEl) return null;
        try {
            const card = this._gridEl.createEl("div", {
                cls: `cms-card cms-card-${item.validation.status}`,
                attr: {
                    "data-path": item.path,
                    "data-validation": item.validation.status,
                    "data-draft": String(item.draft === true),
                    "data-publish": item.status,
                },
            });
            this._populateCard(card, item);
            this._cardElements.set(item.path, card);
            return card;
        } catch (e) {
            console.error("Astro CMS: card creation error", e);
            return null;
        }
    }

    _populateCard(card, item) {
        card.empty();
        const cardHeader = card.createEl("div", { cls: "cms-card-header" });
        cardHeader.createEl("span", { text: item.title, cls: "cms-card-title" });
        const badgeCls = { ready: "cms-badge-success", error: "cms-badge-error", warning: "cms-badge-warning" };
        cardHeader.createEl("span", { text: item.validation.label, cls: `cms-badge ${badgeCls[item.validation.status] || ""}` });

        const cardBody = card.createEl("div", { cls: "cms-card-body" });
        const metaRow = cardBody.createEl("div", { cls: "cms-card-meta" });
        metaRow.createEl("span", { text: `Status: ${item.status}`, cls: "cms-meta-item" });
        metaRow.createEl("span", { text: `Era: ${item.era}`, cls: "cms-meta-item" });
        metaRow.createEl("span", { text: `Date: ${item.date}`, cls: "cms-meta-item" });
        if (item.draft !== undefined) {
            metaRow.createEl("span", { text: item.draft ? "Draft" : "Published", cls: `cms-meta-item cms-draft-${item.draft ? "yes" : "no"}` });
        }

        if (item.tags.length > 0) {
            const tagRow = cardBody.createEl("div", { cls: "cms-card-tags" });
            for (const tag of item.tags.slice(0, 5)) tagRow.createEl("span", { text: tag, cls: "cms-card-tag" });
            if (item.tags.length > 5) tagRow.createEl("span", { text: `+${item.tags.length - 5}`, cls: "cms-card-tag cms-card-tag-more" });
        }

        if (item.validation.errors.length > 0) {
            const errorList = cardBody.createEl("div", { cls: "cms-card-errors" });
            for (const err of item.validation.errors.slice(0, 3)) {
                errorList.createEl("div", { text: `${err.field}: ${err.message}`, cls: `cms-card-error cms-card-error-${err.severity}` });
            }
            if (item.validation.errors.length > 3) {
                errorList.createEl("div", { text: `+${item.validation.errors.length - 3} more`, cls: "cms-card-error-more" });
            }
        }

        const cardActions = card.createEl("div", { cls: "cms-card-actions" });
        cardActions.createEl("button", { text: "Open", cls: "cms-btn cms-btn-sm" })
            .addEventListener("click", () => {
                if (item.file) this.app.workspace.getLeaf(false).openFile(item.file);
            });
        if (item.draft === true) {
            cardActions.createEl("button", { text: "Pre-Flight", cls: "cms-btn cms-btn-sm cms-btn-primary" })
                .addEventListener("click", () => this._preflightSingle(item.file));
        }
        cardActions.createEl("button", { text: "Validate", cls: "cms-btn cms-btn-sm cms-btn-secondary" })
            .addEventListener("click", () => {
                try {
                    const r = AstroCMSValidator.getStatusForFile(item.file, this.app, this.plugin.settings);
                    new obsidian.Notice(r.errors.length === 0
                        ? `${item.file.basename}: All fields valid!`
                        : `${item.file.basename}: ${r.errors.filter(e => e.severity === "error").length} error(s), ${r.errors.filter(e => e.severity === "warning").length} warning(s)`);
                } catch (e) {
                    new obsidian.Notice(`Validation failed: ${e.message}`);
                }
            });
    }

    /* ─── CSS-BASED SEARCH & FILTER ─── */

    applyFilters() {
        try {
            const filter = this.currentFilter;
            const search = this.searchQuery.toLowerCase().trim();
            let visibleCount = 0;

            for (const [path, cardEl] of this._cardElements) {
                const item = this.plugin.cache.items.get(path);
                if (!item) { cardEl.style.display = "none"; continue; }
                const matches = this.plugin.cache.matchesFilter(item, filter, search);
                const beyondPage = matches && visibleCount >= this._visibleLimit;
                if (matches) visibleCount++;
                cardEl.style.display = (!matches || beyondPage) ? "none" : "";
            }

            this._totalVisible = visibleCount;
            this._updateLoadMore();
        } catch (e) {
            console.error("Astro CMS: filter error", e);
        }
    }

    _updateLoadMore() {
        if (!this._loadMoreEl) return;
        try {
            this._loadMoreEl.style.display = this._totalVisible > this._visibleLimit ? "" : "none";
            const btn = this._loadMoreEl.querySelector("button");
            if (btn) btn.textContent = `Load More (${Math.max(0, this._totalVisible - this._visibleLimit)} remaining)`;
        } catch (e) { /* ignore */ }
    }

    /* ─── META SECTION ─── */

    _renderMetaSection(container) {
        if (!container) return;
        try {
            const existing = container.querySelector(".cms-meta-section");
            if (existing) existing.remove();

            const stats = this.plugin.cache.getStats();
            if (stats.uniqueTags.length === 0 && stats.allEras.length === 0 && stats.allSeries.length === 0) return;

            const items = this.plugin.cache.getSortedItems();
            const section = container.createEl("div", { cls: "cms-meta-section" });

            if (stats.uniqueTags.length > 0) {
                const block = section.createEl("div", { cls: "cms-meta-block" });
                block.createEl("h4", { text: `Tags (${stats.uniqueTags.length})`, cls: "cms-meta-heading" });
                const list = block.createEl("div", { cls: "cms-tag-list" });
                for (const tag of stats.uniqueTags.sort()) {
                    list.createEl("span", { text: `${tag} (${items.filter(i => i.tags.includes(tag)).length})`, cls: "cms-tag-chip" });
                }
            }
            if (stats.allEras.length > 0) {
                const block = section.createEl("div", { cls: "cms-meta-block" });
                block.createEl("h4", { text: `Eras (${stats.allEras.length})`, cls: "cms-meta-heading" });
                const list = block.createEl("div", { cls: "cms-tag-list" });
                for (const era of stats.allEras.sort()) {
                    list.createEl("span", { text: `${era} (${items.filter(i => i.era === era).length})`, cls: "cms-tag-chip cms-era-chip" });
                }
            }
            if (stats.allSeries.length > 0) {
                const block = section.createEl("div", { cls: "cms-meta-block" });
                block.createEl("h4", { text: `Series (${stats.allSeries.length})`, cls: "cms-meta-heading" });
                const list = block.createEl("div", { cls: "cms-tag-list" });
                for (const s of stats.allSeries.sort()) {
                    list.createEl("span", { text: `${s} (${items.filter(i => i.series === s).length})`, cls: "cms-tag-chip cms-series-chip" });
                }
            }
        } catch (e) {
            console.error("Astro CMS: meta section error", e);
        }
    }

    /* ─── ACTIONS ─── */

    async _preflightSingle(file) {
        if (!file) return;
        try {
            await this.app.fileManager.processFrontMatter(file, (fm) => {
                fm["draft"] = false; fm["status"] = "published";
                fm["date"] = new Date().toISOString().split('T')[0];
            });
            new obsidian.Notice(`Pre-flight complete: ${file.basename}`);
            // Cache will be updated by the debounced event handler
        } catch (e) {
            new obsidian.Notice(`Pre-flight failed: ${e.message}`);
        }
    }

    async _bulkPreflight() {
        try {
            const items = this.plugin.cache.getSortedItems().filter(i => i.draft === true);
            if (items.length === 0) { new obsidian.Notice("No drafts to pre-flight."); return; }
            const confirmed = await this._confirmAction(
                `Pre-flight ${items.length} draft(s)?`,
                `This will set draft=false, status="published", and today's date on all draft posts.`
            );
            if (!confirmed) return;
            let success = 0;
            for (const item of items) {
                try {
                    await this.app.fileManager.processFrontMatter(item.file, (fm) => {
                        fm["draft"] = false; fm["status"] = "published";
                        fm["date"] = new Date().toISOString().split('T')[0];
                    });
                    success++;
                } catch (e) { /* skip */ }
            }
            new obsidian.Notice(`Pre-flight complete: ${success}/${items.length} posts updated.`);
            // Refresh after bulk operation
            this.plugin.cache.scanAll(this.app, this.plugin.settings);
            this.renderDashboard();
        } catch (e) {
            new obsidian.Notice(`Bulk pre-flight failed: ${e.message}`);
        }
    }

    async _confirmAction(title, message) {
        return new Promise((resolve) => {
            try {
                const modal = new obsidian.Modal(this.app);
                modal.titleEl.setText(title);
                modal.contentEl.createEl("p", { text: message });
                const btnRow = modal.contentEl.createEl("div", { cls: "cms-modal-btn-row" });
                btnRow.createEl("button", { text: "Cancel", cls: "cms-btn cms-btn-secondary" })
                    .addEventListener("click", () => { modal.close(); resolve(false); });
                btnRow.createEl("button", { text: "Confirm", cls: "cms-btn cms-btn-primary" })
                    .addEventListener("click", () => { modal.close(); resolve(true); });
                modal.open();
            } catch (e) {
                resolve(false);
            }
        });
    }

    async onClose() {
        this._destroyed = true;
        this._ready = false;
        if (this._updateTimer) clearTimeout(this._updateTimer);
        this._cardElements.clear();
        this._pendingPaths.clear();
    }
}

/* ═══════════════════════════════════════════════════════════
   SIDEBAR VIEW — lightweight, debounced, layoutReady-gated
   ═══════════════════════════════════════════════════════════ */

const VIEW_TYPE_SIDEBAR = "astro-cms-sidebar-view";

class AstroCMSSidebarView extends obsidian.ItemView {
    constructor(leaf, plugin) {
        super(leaf);
        this.plugin = plugin;
        this._updateTimer = null;
        this._destroyed = false;
    }

    getViewType() { return VIEW_TYPE_SIDEBAR; }
    getDisplayText() { return "Astro CMS Validate"; }
    getIcon() { return "checklist"; }

    async onOpen() {
        this._destroyed = false;

        this.registerEvent(this.app.workspace.on("active-file-change", () => {
            if (!this.app.workspace.layoutReady) return;
            if (this._destroyed) return;
            this._debounceUpdate();
        }));

        this.registerEvent(this.app.metadataCache.on("changed", (file) => {
            // Skip startup flood
            if (!this.app.workspace.layoutReady) return;
            if (this._destroyed) return;
            const active = this.app.workspace.getActiveFile();
            if (active && file.path === active.path) this._debounceUpdate();
        }));

        // Wait for layout ready before showing content
        if (this.app.workspace.layoutReady) {
            this._debounceUpdate();
        } else {
            const ref = this.app.workspace.on("layout-ready", () => {
                this.app.workspace.offref(ref);
                this._debounceUpdate();
            });
            this.registerEvent(ref);
            this._showLoading();
        }
    }

    _showLoading() {
        try {
            const container = this.containerEl.children[1];
            if (!container) return;
            container.empty();
            container.addClass("astro-cms-sidebar");
            container.createEl("div", { text: "Waiting for Obsidian to finish loading...", cls: "cms-sidebar-empty-state" });
        } catch (e) { /* ignore */ }
    }

    _debounceUpdate() {
        if (this._destroyed) return;
        if (this._updateTimer) clearTimeout(this._updateTimer);
        this._updateTimer = setTimeout(() => this.updateUI(), 400);
    }

    updateUI() {
        if (this._destroyed) return;
        try {
            const container = this.containerEl.children[1];
            if (!container) return;
            container.empty();
            container.addClass("astro-cms-sidebar");
            const activeFile = this.app.workspace.getActiveFile();

            if (!activeFile || activeFile.extension !== "md" || !activeFile.path.startsWith(this.plugin.settings.contentPath)) {
                container.createEl("div", { text: `Open a file in ${this.plugin.settings.contentPath} to validate.`, cls: "cms-sidebar-empty-state" });
                return;
            }

            const cached = this.plugin.cache.items.get(activeFile.path);
            const result = cached ? cached.validation : AstroCMSValidator.getStatusForFile(activeFile, this.app, this.plugin.settings);

            container.createEl("div", { text: "Quick Validate", cls: "cms-sidebar-title" });
            container.createEl("div", { text: activeFile.path, cls: "cms-sidebar-file-title" });

            const statusWrapper = container.createEl("div", { cls: "cms-status-wrapper" });
            const badgeMap = { ready: { text: "Ready for GitHub", cls: "cms-badge-success" }, error: { text: "Structural Errors Found", cls: "cms-badge-error" }, warning: { text: "Optimization Warnings", cls: "cms-badge-warning" } };
            const badge = badgeMap[result.status] || badgeMap.error;
            statusWrapper.createEl("span", { text: badge.text, cls: `cms-badge ${badge.cls}` });

            container.createEl("hr");
            const listContainer = container.createEl("div", { cls: "cms-diagnostics-list" });

            if (result.errors.length === 0) {
                listContainer.createEl("div", { text: "All fields look perfect! Ready to push cleanly to production.", cls: "cms-success-text" });
            } else {
                for (const error of result.errors) {
                    const errorItem = listContainer.createEl("div", { cls: `cms-error-item severity-${error.severity}` });
                    errorItem.createEl("div", { text: error.field, cls: "cms-error-field" });
                    errorItem.createEl("p", { text: error.message, cls: "cms-error-message" });
                }
            }

            const actions = container.createEl("div", { cls: "cms-sidebar-actions" });
            actions.createEl("button", { text: "Pre-Flight This Post", cls: "cms-btn cms-btn-primary cms-btn-full" })
                .addEventListener("click", async () => {
                    try {
                        await this.app.fileManager.processFrontMatter(activeFile, (fm) => {
                            fm["draft"] = false; fm["status"] = "published";
                            fm["date"] = new Date().toISOString().split('T')[0];
                        });
                        new obsidian.Notice(`Pre-flight complete: ${activeFile.basename}`);
                        // Cache will be updated by debounced handler
                        this._debounceUpdate();
                    } catch (e) { new obsidian.Notice(`Pre-flight failed: ${e.message}`); }
                });
            actions.createEl("button", { text: "Open Dashboard", cls: "cms-btn cms-btn-secondary cms-btn-full" })
                .addEventListener("click", () => this.plugin.activateDashboard());
        } catch (e) {
            console.error("Astro CMS: sidebar update error", e);
        }
    }

    async onClose() {
        this._destroyed = true;
        if (this._updateTimer) clearTimeout(this._updateTimer);
    }
}

/* ═══════════════════════════════════════════════════════════
   SETTINGS TAB
   ═══════════════════════════════════════════════════════════ */

class AstroCMSSettingTab extends obsidian.PluginSettingTab {
    constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }

    display() {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.createEl("h2", { text: "Astro CMS Plugin Settings" });

        new obsidian.Setting(containerEl).setName("Content folder path").setDesc("Path to your Astro content collection folder")
            .addText(text => text.setPlaceholder("src/content").setValue(this.plugin.settings.contentPath)
                .onChange(async (value) => { this.plugin.settings.contentPath = value; await this.plugin.saveSettings(); }));

        containerEl.createEl("h3", { text: "Validation Rules" });

        new obsidian.Setting(containerEl).setName("Required fields").setDesc("Comma-separated list of required frontmatter fields")
            .addText(text => text.setPlaceholder("title, description, status, era").setValue(this.plugin.settings.requiredFields.join(", "))
                .onChange(async (value) => { this.plugin.settings.requiredFields = value.split(",").map(s => s.trim()).filter(s => s); await this.plugin.saveSettings(); }));

        new obsidian.Setting(containerEl).setName("Validate draft field").setDesc("Check that the 'draft' field exists and is a boolean")
            .addToggle(toggle => toggle.setValue(this.plugin.settings.validateDraft).onChange(async (value) => { this.plugin.settings.validateDraft = value; await this.plugin.saveSettings(); }));

        new obsidian.Setting(containerEl).setName("Validate date field").setDesc("Check that the 'date' field exists and is valid")
            .addToggle(toggle => toggle.setValue(this.plugin.settings.validateDate).onChange(async (value) => { this.plugin.settings.validateDate = value; await this.plugin.saveSettings(); }));

        containerEl.createEl("h3", { text: "Performance" });

        new obsidian.Setting(containerEl).setName("Cards per page").setDesc("Number of content cards to show before 'Load More' (lower = faster)")
            .addSlider(slider => slider.setLimits(10, 100, 10).setValue(this.plugin.settings.cardsPerPage || 40).setDynamicTooltip()
                .onChange(async (value) => { this.plugin.settings.cardsPerPage = value; await this.plugin.saveSettings(); }));

        containerEl.createEl("h3", { text: "Graph Integration" });

        new obsidian.Setting(containerEl).setName("Auto-sync graph links").setDesc("WARNING: Injects dynamic links into Obsidian's graph view. May cause performance issues with large vaults. Disabled by default.")
            .addToggle(toggle => toggle.setValue(this.plugin.settings.autoSyncGraph).onChange(async (value) => { this.plugin.settings.autoSyncGraph = value; await this.plugin.saveSettings(); }));

        containerEl.createEl("h3", { text: "Appearance" });

        new obsidian.Setting(containerEl).setName("Show ribbon icon").setDesc("Show the Astro CMS icon in the left ribbon")
            .addToggle(toggle => toggle.setValue(this.plugin.settings.showRibbonIcon).onChange(async (value) => { this.plugin.settings.showRibbonIcon = value; await this.plugin.saveSettings(); }));

        containerEl.createEl("div", { cls: "cms-settings-version" }).innerHTML =
            `Settings schema v${this.plugin.settings._version} &middot; Plugin v${this.plugin.manifest.version}`;
    }
}

/* ═══════════════════════════════════════════════════════════
   MAIN PLUGIN CLASS
   ═══════════════════════════════════════════════════════════ */

module.exports = class AstroCMSPlugin extends obsidian.Plugin {
    async onload() {
        await this.loadSettings();
        this.cache = new ContentCache();

        this.registerView(VIEW_TYPE_DASHBOARD, (leaf) => new AstroCMSDashboardView(leaf, this));
        this.registerView(VIEW_TYPE_SIDEBAR, (leaf) => new AstroCMSSidebarView(leaf, this));

        this.addRibbonIcon("layout-dashboard", "Astro CMS Dashboard", () => this.activateDashboard());

        this.addCommand({ id: "open-dashboard", name: "Open Dashboard", callback: () => this.activateDashboard() });
        this.addCommand({ id: "open-sidebar", name: "Open Quick Validate Sidebar", callback: () => this.activateSidebar() });
        this.addCommand({ id: "preflight-current", name: "Pre-Flight Current Post", callback: () => this.executePreflight() });
        this.addCommand({ id: "validate-current", name: "Validate Current Post", callback: () => this.validateCurrentFile() });
        this.addCommand({ id: "bulk-preflight", name: "Bulk Pre-Flight All Drafts", callback: () => this.bulkPreflight() });

        this.addSettingTab(new AstroCMSSettingTab(this.app, this));

        // Graph link injection — ONLY after layout ready, debounced, and safe
        this._linkQueue = new Map();
        this._linkTimer = null;
        this._graphReady = false;

        // Wait for full layout ready before enabling graph sync
        if (this.app.workspace.layoutReady) {
            this._enableGraphSync();
        } else {
            const ref = this.app.workspace.on("layout-ready", () => {
                this.app.workspace.offref(ref);
                // Extra delay: wait 3 seconds after layout ready for all metadata to settle
                setTimeout(() => this._enableGraphSync(), 3000);
            });
            this.registerEvent(ref);
        }

        console.log("Astro CMS Plugin v" + this.manifest.version + " loaded");
    }

    _enableGraphSync() {
        this._graphReady = true;
        this.registerEvent(
            this.app.metadataCache.on("changed", (file) => {
                if (!this._graphReady) return;
                if (!this.settings.autoSyncGraph) return;
                if (!file.path.startsWith(this.settings.contentPath)) return;
                try {
                    const cache = this.app.metadataCache.getFileCache(file);
                    if (!cache || !cache.frontmatter) return;
                    const fm = cache.frontmatter;
                    const dynamicLinks = [];
                    if (Array.isArray(fm["connects"])) dynamicLinks.push(...fm["connects"]);
                    else if (typeof fm["connects"] === "string") dynamicLinks.push(...fm["connects"].split(",").map(s => s.trim()));
                    if (fm["series"]) dynamicLinks.push(String(fm["series"]));
                    if (fm["era"]) dynamicLinks.push(String(fm["era"]));
                    if (dynamicLinks.length === 0) return;
                    this._linkQueue.set(file.path, { file, dynamicLinks });
                    this._scheduleLinkInjection();
                } catch (e) { /* skip */ }
            })
        );
    }

    _scheduleLinkInjection() {
        if (this._linkTimer) clearTimeout(this._linkTimer);
        this._linkTimer = setTimeout(() => this._processLinkQueue(), 1000);
    }

    _processLinkQueue() {
        if (!this._graphReady) return;
        const batch = new Map(this._linkQueue);
        this._linkQueue.clear();

        for (const [, { file, dynamicLinks }] of batch) {
            try {
                const cache = this.app.metadataCache.getFileCache(file);
                if (!cache) continue;
                // SAFE: Only add links if they don't already exist (prevents cascading)
                if (!cache.links) cache.links = [];
                for (const dest of dynamicLinks) {
                    if (dest && !cache.links.some(l => l.link === dest)) {
                        cache.links.push({
                            link: dest, original: `[[${dest}]]`, displayText: dest,
                            position: { start: { line: 0, col: 0, offset: 0 }, end: { line: 0, col: 0, offset: 0 } }
                        });
                    }
                }
            } catch (e) { /* skip */ }
        }
    }

    async onunload() {
        this._graphReady = false;
        if (this._linkTimer) clearTimeout(this._linkTimer);
        this.app.workspace.detachLeavesOfType(VIEW_TYPE_DASHBOARD);
        this.app.workspace.detachLeavesOfType(VIEW_TYPE_SIDEBAR);
    }

    async loadSettings() {
        const loaded = await this.loadData();
        const migrated = migrateSettings(loaded || {});
        this.settings = Object.assign({}, DEFAULT_SETTINGS, migrated);
        this.settings._version = SETTINGS_VERSION;
        await this.saveData(this.settings);
    }

    async saveSettings() { await this.saveData(this.settings); }

    async activateDashboard() {
        const { workspace } = this.app;
        let leaf = workspace.getLeavesOfType(VIEW_TYPE_DASHBOARD)[0];
        if (!leaf) { leaf = workspace.getLeaf(false); await leaf.setViewState({ type: VIEW_TYPE_DASHBOARD, active: true }); }
        workspace.revealLeaf(leaf);
    }

    async activateSidebar() {
        const { workspace } = this.app;
        let leaf = workspace.getLeavesOfType(VIEW_TYPE_SIDEBAR)[0];
        if (!leaf) { leaf = workspace.getRightLeaf(false); await leaf.setViewState({ type: VIEW_TYPE_SIDEBAR, active: true }); }
        workspace.revealLeaf(leaf);
    }

    async executePreflight() {
        const file = this.app.workspace.getActiveFile();
        if (!file || !file.path.startsWith(this.settings.contentPath)) { new obsidian.Notice("Open a file in the content folder first."); return; }
        try {
            await this.app.fileManager.processFrontMatter(file, (fm) => {
                fm["draft"] = false; fm["status"] = "published"; fm["date"] = new Date().toISOString().split('T')[0];
            });
            new obsidian.Notice(`Pre-flight complete: ${file.basename}`);
        } catch (e) { new obsidian.Notice(`Pre-flight failed: ${e.message}`); }
    }

    validateCurrentFile() {
        const file = this.app.workspace.getActiveFile();
        if (!file || !file.path.startsWith(this.settings.contentPath)) { new obsidian.Notice("Open a file in the content folder first."); return; }
        try {
            const result = AstroCMSValidator.getStatusForFile(file, this.app, this.settings);
            if (result.errors.length === 0) { new obsidian.Notice(`${file.basename}: All fields valid!`); }
            else {
                const e = result.errors.filter(e => e.severity === "error").length;
                const w = result.errors.filter(e => e.severity === "warning").length;
                new obsidian.Notice(`${file.basename}: ${e} error(s), ${w} warning(s)`);
            }
        } catch (e) {
            new obsidian.Notice(`Validation failed: ${e.message}`);
        }
    }

    async bulkPreflight() {
        try {
            const items = this.cache.getSortedItems().filter(i => i.draft === true);
            if (items.length === 0) { new obsidian.Notice("No drafts to pre-flight."); return; }
            let success = 0;
            for (const item of items) {
                try {
                    await this.app.fileManager.processFrontMatter(item.file, (fm) => {
                        fm["draft"] = false; fm["status"] = "published"; fm["date"] = new Date().toISOString().split('T')[0];
                    });
                    success++;
                } catch (e) { /* skip */ }
            }
            new obsidian.Notice(`Pre-flight complete: ${success}/${items.length} posts updated.`);
        } catch (e) {
            new obsidian.Notice(`Bulk pre-flight failed: ${e.message}`);
        }
    }
};
