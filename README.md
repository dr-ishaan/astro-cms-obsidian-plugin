# Astro Content Graph CMS

> **Your Astro website's control panel — inside Obsidian.**

Write your blog posts and research notes in Obsidian. This plugin checks they're perfect, then helps you publish them to your Astro website.

---

## What Does This Plugin Do?

Think of it like a **spell-checker for your blog posts**, but instead of checking spelling, it checks that every post has all the information your Astro website needs to display it properly.

Here's what you get:

| Feature | What It Means |
|---|---|
| **Dashboard** | See all your blog posts in one place, like a spreadsheet |
| **Validation** | The plugin tells you if a post is missing something (like a title or date) |
| **Pre-Flight** | One click to change a draft post into a published post |
| **Quick Validate Sidebar** | See errors on the post you're currently editing |
| **Bulk Pre-Flight** | Publish many draft posts at the same time |

---

## Screenshots

*The Dashboard shows all your content with status badges (Ready / Errors / Warnings), search, filters, and one-click actions.*

*The Sidebar validates the post you're editing in real time — no need to open the dashboard.*

---

## Installation (Using BRAT)

BRAT is a tool that lets you install Obsidian plugins that aren't in the official store yet. Here's how to set it up:

### Step 1: Install BRAT

1. Open Obsidian
2. Go to **Settings** (the gear icon in the bottom left)
3. Click **Community plugins**
4. Click **Browse**
5. Search for **"BRAT"**
6. Click **Install**, then click **Enable**

### Step 2: Add This Plugin Using BRAT

1. Still in **Settings → Community plugins**
2. Find **BRAT** in your installed plugins list and click the gear icon next to it
3. Click **Add Beta plugin**
4. Paste this exact URL:
   ```
   https://github.com/dr-ishaan/astro-cms-obsidian-plugin
   ```
5. Click **Add Plugin**
6. Go back to **Community plugins** and enable **"Astro Content Graph CMS"**

### Step 3: Open the Dashboard

1. Look at the left sidebar in Obsidian — you'll see a new dashboard icon
2. Click it to open your Astro CMS Dashboard
3. Or press `Ctrl+P` (or `Cmd+P` on Mac) and search for **"Open Dashboard"**

That's it! You're up and running.

---

## How to Set Up Your Vault

Your Obsidian vault needs to look like your Astro project's content folder for the plugin to find your posts.

### For the isHistory Project

The plugin looks for content inside `src/content` by default. Your vault should have this structure:

```
your-vault/
  src/
    content/
      blog/           ← Your blog posts (archive collection)
        A1-the-ancient-dream-of-artificial-life.md
        P1-ada-lovelace.md
        E1-the-dartmouth-conference-1956.md
        ...
      vault/          ← Your research notes (vault collection)
        vision-and-architecture.md
        content-schema.md
        ...
```

**The easiest way:** Open your entire Astro project folder as your Obsidian vault. That way, the `src/content` path matches automatically.

### If Your Content Is Somewhere Else

1. Go to **Settings → Astro CMS Plugin Settings**
2. Change the **Content folder path** to wherever your content lives
3. For example, if you just have blog posts in a `posts/` folder, type `posts`

---

## How to Write a Blog Post

Every blog post needs a special block at the very top called **frontmatter**. It tells your Astro website everything it needs to know about the post.

### Blog Post Template (Archive Collection)

Copy this template and fill in your own information:

```markdown
---
title: "Your Post Title Here"
date: 2026-05-28
description: "A short one-line description of your post (15 to 160 characters)."
draft: false
tags: ["tag1", "tag2", "tag3"]
image: "/images/your-hero-image.jpg"
series: "minds-and-machines"
seriesOrder: "A1"
track: "A"
status: "published"
part: "Part I · The Dream"
figures: "Person One, Person Two, Person Three"
connects: "P2, A5, E1"
era: "Ancient – 1850"
---

Your amazing blog post content goes here...
```

### Vault Note Template

```markdown
---
title: "Your Note Title"
created: 2026-05-28
updated: 2026-05-28
author: Ishaan
description: "What this note is about."
publish: true
tags: [meta, research, notes]
order: 1
relatedChapters: "A5, P2, E1"
seoDescription: "Optional: override the meta description for search engines"
---

Your research note content goes here...
```

---

## What Each Field Means

### Required Fields (Your Post WILL NOT Build Without These)

| Field | What to Write | Example |
|---|---|---|
| `title` | The name of your post (5–120 characters) | `"The Ancient Dream of Artificial Life"` |
| `date` | When this post is published (YYYY-MM-DD format) | `2026-05-28` |
| `description` | A short summary for search engines and previews (15–160 characters) | `"From bronze giants to clockwork wonders..."` |
| `draft` | Is this a work-in-progress? Must be `true` or `false` (no quotes!) | `false` |

### Series Fields (Only Needed if Your Post Belongs to a Series)

| Field | What to Write | Example |
|---|---|---|
| `series` | Which series this post belongs to | `"minds-and-machines"` |
| `seriesOrder` | The chapter code within the series | `"A1"` |
| `track` | Which track: `A` (Articles), `P` (Profiles), or `E` (Events) | `"A"` |
| `status` | Publication status: `published`, `upcoming`, or `planned` | `"published"` |
| `part` | The act/part label | `"Part I · The Dream"` |

### Connection Fields (Help Link Posts Together)

| Field | What to Write | Example |
|---|---|---|
| `figures` | Key people mentioned (comma-separated) | `"Ada Lovelace, Alan Turing"` |
| `connects` | Related chapter codes (comma-separated) | `"P2, A5, E1"` |
| `era` | The time period this post covers | `"1936-1954"` |

### Optional Fields

| Field | What to Write | Example |
|---|---|---|
| `tags` | A list of topic tags | `["ai-history", "philosophy"]` |
| `image` | Hero image path | `"/images/a1-hero.jpg"` |
| `author` | Author name | `"Ishaan"` |
| `dateModified` | When you last updated the content | `2026-05-28` |
| `part` | Part/act label within the series | `"Part I · The Dream"` |

---

## Common Mistakes the Plugin Catches

The plugin checks your posts and shows you exactly what's wrong. Here are the most common problems:

| Problem | What's Wrong | How to Fix |
|---|---|---|
| Missing title | No `title` field in frontmatter | Add `title: "Your Title"` |
| Missing date | No `date` field | Add `date: 2026-05-28` |
| Bad date format | Date is not in YYYY-MM-DD format | Use `2026-05-28` not `May 28, 2026` |
| Draft not set | `draft` field is missing or has quotes around it | Use `draft: false` (not `draft: "false"`) |
| Tags not a list | `tags` is a string instead of a list | Use `["tag1", "tag2"]` not `"tag1, tag2"` |
| Has series but no order | `series` is set but `seriesOrder` is missing | Add `seriesOrder: "A1"` |
| Missing description | No `description` field | Add `description: "Your description here"` |

---

## Dashboard Features

### Stats Bar

At the top of the dashboard, you'll see:
- **Total Posts** — How many posts the plugin found
- **Published** — Posts with `status: "published"`
- **Drafts** — Posts with `draft: true`
- **Errors** — Posts missing required fields
- **Warnings** — Posts with minor issues
- **Ready** — Posts that pass all checks

### Search & Filter

- **Search box** — Type to find posts by title, tag, era, or file path
- **Filter buttons** — Click to show only: All, Ready, Errors, Warnings, Drafts, Published

### Card Actions

Each post card has three buttons:
- **Open** — Opens the post in the editor
- **Pre-Flight** — Converts a draft to published (sets `draft: false`, `status: "published"`, and today's date)
- **Validate** — Shows a quick summary of what's right or wrong

### Bulk Pre-Flight

Click the **Bulk Pre-Flight** button to publish all drafts at once. It will ask you to confirm first.

---

## Quick Validate Sidebar

This is a lightweight panel that shows you validation results for whatever post you're currently editing.

**How to open it:**
1. Press `Ctrl+P` (or `Cmd+P` on Mac)
2. Search for **"Open Quick Validate Sidebar"**
3. The sidebar shows real-time validation as you type

---

## Commands

You can access these from the command palette (`Ctrl+P` or `Cmd+P`):

| Command | What It Does |
|---|---|
| `Open Dashboard` | Opens the full content management dashboard |
| `Open Quick Validate Sidebar` | Opens the sidebar validator |
| `Pre-Flight Current Post` | Publishes the post you're editing |
| `Validate Current Post` | Checks the post you're editing for errors |
| `Bulk Pre-Flight All Drafts` | Publishes all draft posts at once |

---

## Settings

Go to **Settings → Astro CMS Plugin Settings** to configure:

### Content Folder Path
Where your Astro content lives inside your vault. Default: `src/content`

### Validation Rules
- **Required fields** — Which frontmatter fields must be present. Default: `title, description, status, era`
- **Validate draft field** — Check that `draft` exists and is `true` or `false`. Default: On
- **Validate date field** — Check that `date` exists and is a valid date. Default: On

### Performance
- **Cards per page** — How many post cards to show before the "Load More" button. Default: 40. Lower = faster.

### Graph Integration
- **Auto-sync graph links** — Adds `connects`, `series`, and `era` as links in Obsidian's graph view. Default: On

### Appearance
- **Show ribbon icon** — Show the dashboard icon in the left ribbon. Default: On

---

## FAQ

### The dashboard shows "No posts found"

Make sure your **Content folder path** in settings matches where your content actually is. If your posts are in `src/content/blog/`, the path should be `src/content`. If they're directly in a `blog/` folder, the path should be `blog`.

### BRAT says "frozen" next to my plugin version

That's normal! In BRAT, "(frozen)" just means the plugin is pinned to a specific version. It does NOT mean the plugin is broken. Your plugin is working fine.

### How do I update the plugin?

1. Go to **Settings → Community plugins**
2. Click the gear icon next to **BRAT**
3. Click **Check for updates**
4. If there's a new version, it will update automatically

### The plugin is slow with many posts

Go to **Settings → Astro CMS Plugin Settings** and lower the **Cards per page** number. Try 20 instead of 40.

---

## Built For

This plugin is designed for the **isHistory** Astro project — a 75-article deep-dive into the history of Artificial Intelligence. It uses:

- **Astro 6** with Content Collections
- **astro-loader-obsidian** for wiki-link resolution and backlink support
- **Two content collections**: `archive` (blog posts) and `vault` (research notes)
- **Series system**: Articles (A), Profiles (P), Events (E) — each organized into tracks

But it works with any Astro project that uses content collections!

---

## License

MIT
