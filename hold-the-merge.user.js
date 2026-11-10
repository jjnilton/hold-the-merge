// ==UserScript==
// @name         Hold the Merge - GitHub Merge Two-step confirmation
// @namespace    https://github.com/jjnilton/hold-the-merge
// @version      0.2.0
// @description  Adds a two-step confirmation before GitHub's "Confirm merge" button
// @updateURL    https://github.com/jjnilton/hold-the-merge/raw/refs/heads/main/hold-the-merge.user.js
// @downloadURL  https://github.com/jjnilton/hold-the-merge/raw/refs/heads/main/hold-the-merge.user.js
// @author       JJ
// @license      GPL-3.0-only
// @match        https://github.com/*/*/pull/*
// @match        https://github.com/*/*/pulls*
// @match        https://github.com/*/*/compare/*
// @match        https://github.com/*/*/edit/*
// @match        https://github.com/*/*/blob/*
// @match        https://github.com/*/*/tree/*
// @match        https://github.com/*/*/branches*
// @exclude      https://github.com/settings*
// @exclude      https://github.com/*/*/settings*
// @exclude      https://github.com/*/*/security*
// @grant        GM_getValue
// @grant        GM_setValue
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    const PREFIX = '[Hold the Merge]';
    const VERSION = '0.2.0';
    const CONFIG_KEY = 'jjnilton:hold-the-merge:config';
    const SETTINGS_KEY = 'settings';
    const REPOSITORIES_KEY = 'repositories';
    const COUNTDOWN_KEY = 'countdown';
    const DEFAULT_COUNTDOWN_SECONDS = 5;
    const MAX_COUNTDOWN_SECONDS = 300;

    console.log(PREFIX, 'v' + VERSION + ' loaded');

    // settings.countdown: wait in seconds
    // repositories: owner/repo to branches ("*" = all branches)

    // keep only stored keys to preserve defaults for missing ones
    // drop empty objects to keep "{}" out of the editor
    function normalizeConfig(raw) {
        const cfg = {};
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return cfg;

        const repositories = raw[REPOSITORIES_KEY];
        if (repositories && typeof repositories === 'object' &&
            !Array.isArray(repositories) && Object.keys(repositories).length) {
            cfg[REPOSITORIES_KEY] = repositories;
        }

        const settings = raw[SETTINGS_KEY];
        if (settings && typeof settings === 'object' && !Array.isArray(settings) &&
            settings[COUNTDOWN_KEY] !== undefined) {
            cfg[SETTINGS_KEY] = { [COUNTDOWN_KEY]: settings[COUNTDOWN_KEY] };
        }

        return cfg;
    }

    function loadConfig() {
        let raw;
        try {
            raw = typeof GM_getValue === 'function'
                ? GM_getValue(CONFIG_KEY, '{}')
                : (localStorage.getItem(CONFIG_KEY) || '{}');
        } catch (e) {
            console.error(PREFIX, 'failed to read config', e);
            return {};
        }
        if (raw && typeof raw === 'object') return normalizeConfig(raw); // some managers store objects directly
        try {
            const cfg = JSON.parse(raw || '{}');
            if (cfg && typeof cfg === 'object' && !Array.isArray(cfg)) return normalizeConfig(cfg);
            console.warn(PREFIX, 'config is not a JSON object, using empty config');
        } catch (e) {
            console.error(PREFIX, 'failed to parse config', e);
        }
        return {};
    }

    function saveConfig(cfg) {
        const str = JSON.stringify(cfg, null, 2);
        try {
            if (typeof GM_setValue === 'function') {
                GM_setValue(CONFIG_KEY, str);
                return;
            }
        } catch (e) {
            console.warn(PREFIX, 'GM_setValue failed, falling back to localStorage', e);
        }
        localStorage.setItem(CONFIG_KEY, str);
    }

    function branchesFor(fullRepo, cfg) {
        const repos = (cfg && cfg[REPOSITORIES_KEY]) || {};
        if (Object.prototype.hasOwnProperty.call(repos, fullRepo)) return repos[fullRepo];
        const lower = fullRepo.toLowerCase();
        const key = Object.keys(repos).find(k => k.toLowerCase() === lower);
        if (key !== undefined) return repos[key];
        // "*" applies to any repository when no exact entry exists
        return Object.prototype.hasOwnProperty.call(repos, '*') ? repos['*'] : undefined;
    }

    function normalizeBranches(value) {
        if (typeof value === 'string') return [value];
        if (Array.isArray(value)) return value.filter(b => typeof b === 'string');
        return null;
    }

    // global options under the reserved "settings" key
    function getSettings(cfg) {
        const s = cfg && cfg[SETTINGS_KEY];
        return s && typeof s === 'object' && !Array.isArray(s) ? s : {};
    }

    // wait before merge from settings.countdown
    // default 5 and max 300 (0 = merge right after confirmation)
    function getCountdownSeconds(cfg) {
        const raw = getSettings(cfg)[COUNTDOWN_KEY];
        if (raw === undefined || raw === null || raw === '') return DEFAULT_COUNTDOWN_SECONDS;
        const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
        if (!Number.isFinite(n)) {
            console.warn(PREFIX, SETTINGS_KEY + '.' + COUNTDOWN_KEY + ' is not a number (' + JSON.stringify(raw) + '), using default ' + DEFAULT_COUNTDOWN_SECONDS);
            return DEFAULT_COUNTDOWN_SECONDS;
        }
        const secs = Math.round(n);
        if (secs < 0 || secs > MAX_COUNTDOWN_SECONDS) {
            console.warn(PREFIX, SETTINGS_KEY + '.' + COUNTDOWN_KEY + ' out of range (0..' + MAX_COUNTDOWN_SECONDS + '), clamping from ' + secs);
            return Math.min(Math.max(secs, 0), MAX_COUNTDOWN_SECONDS);
        }
        return secs;
    }

    // unknown branch: ask anyway to fail safe
    function isProtected(fullRepo, targetBranch) {
        const entry = branchesFor(fullRepo, loadConfig());
        if (entry === undefined || entry === null) return false;
        const branches = normalizeBranches(entry);
        if (!branches || branches.length === 0) {
            console.warn(PREFIX, 'config entry for', fullRepo, 'is not a list of branches - failing safe');
            return true;
        }
        if (branches.indexOf('*') !== -1) return true;
        if (!targetBranch) {
            console.warn(PREFIX, 'target branch unknown for', fullRepo, '- failing safe and asking for confirmation');
            return true;
        }
        return branches.indexOf(targetBranch) !== -1;
    }

    // follows the GitHub Overlay look via CSS variables
    // fallback values match the light theme

    const STYLE_ID = 'merge-protect-styles';

    const STYLES = `
.merge-protect-overlay {
    position: fixed;
    inset: 0;
    z-index: 10000;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
    background-color: var(--overlay-backdrop-bgColor, rgba(31, 35, 40, 0.4));
    font-family: var(--fontStack-sansSerif, -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji");
    font-size: var(--text-body-size-medium, 0.875rem);
    line-height: var(--text-body-lineHeight-medium, 1.5);
    color: var(--fgColor-default, #1f2328);
    -webkit-font-smoothing: antialiased;
}

/* medium portrait dialog matching the GitHub Overlay (480x600) */
.merge-protect-dialog {
    display: flex;
    flex-direction: column;
    width: min(480px, 100%);
    max-height: min(600px, 100%);
    margin: auto;
    padding: 0;
    overflow: hidden;
    background-color: var(--overlay-bgColor, var(--bgColor-default, #fff));
    border-radius: var(--borderRadius-large, 0.75rem);
    box-shadow: var(--shadow-floating-small, 0 0 0 1px rgba(31, 35, 40, 0.25), 0 6px 12px -3px rgba(31, 35, 40, 0.04), 0 6px 18px 0 rgba(31, 35, 40, 0.12));
    animation: merge-protect-scale-fade 0.2s cubic-bezier(0.33, 1, 0.68, 1);
}

@keyframes merge-protect-scale-fade {
    0% { opacity: 0; transform: scale(0.96); }
    100% { opacity: 1; transform: none; }
}

/* header matching the GitHub Overlay: headerContentWrap > titleWrap + actionWrap
 * both wrappers pad to keep title and close button off the edge */
.merge-protect-header {
    display: flex;
    flex-direction: column;
    z-index: 1;
    color: var(--fgColor-default, #1f2328);
    padding-bottom: var(--stack-padding-condensed, 0.5rem);
    box-shadow: inset 0 calc(-1 * var(--borderWidth-thin, 0.0625rem)) var(--borderColor-default, #d1d9e0);
}

.merge-protect-header-wrap {
    display: flex;
    align-items: flex-start;
    gap: var(--stack-gap-condensed, 0.5rem);
    padding: var(--stack-gap-condensed, 0.5rem) var(--stack-gap-condensed, 0.5rem) 0 var(--stack-gap-condensed, 0.5rem);
    min-width: 0;
}

.merge-protect-title-wrap {
    display: flex;
    flex-direction: column;
    flex-grow: 1;
    gap: var(--control-small-gap, 0.5rem);
    padding: calc(var(--stack-gap-condensed, 0.5rem) * 0.75) 0 calc(var(--stack-gap-condensed, 0.5rem) * 0.75) var(--stack-gap-condensed, 0.5rem);
    min-width: 0;
}

.merge-protect-title {
    margin: 0;
    font-size: var(--text-body-size-medium, 0.875rem);
    font-weight: var(--base-text-weight-semibold, 600);
    line-height: var(--text-body-lineHeight-medium, 1.5);
    color: var(--fgColor-default, #1f2328);
    overflow-wrap: anywhere;
}

.merge-protect-action-wrap {
    display: flex;
    flex-direction: row;
    gap: var(--stack-gap-condensed, 0.5rem);
    flex: none;
}

/* overlay close button: 2rem square
 * aligned with the title text box */
.merge-protect-close {
    align-self: flex-start;
    flex-shrink: 0;
    display: inline-grid;
    place-items: center;
    width: var(--base-size-32, 2rem);
    height: var(--base-size-32, 2rem);
    padding: 0;
    color: var(--fgColor-muted, #59636e);
    background-color: initial;
    border: var(--borderWidth-thin, 0.0625rem) solid transparent;
    border-radius: var(--borderRadius-medium, 0.375rem);
    cursor: pointer;
    user-select: none;
    transition: background-color 80ms cubic-bezier(0.33, 1, 0.68, 1);
}

.merge-protect-close:hover:not(:disabled),
.merge-protect-close:focus-visible {
    background-color: var(--button-default-bgColor-hover, rgba(175, 184, 193, 0.3));
    border-color: var(--control-bgColor-hover, rgba(175, 184, 193, 0.3));
    color: var(--fgColor-default, #1f2328);
}

.merge-protect-close:disabled {
    cursor: default;
    opacity: 0.5;
}

.merge-protect-close:focus-visible {
    outline: 2px solid var(--focus-outline-color, var(--borderColor-accent-emphasis, #0969da));
    outline-offset: -2px;
}

.merge-protect-body {
    flex: 1 1 auto;
    padding: var(--stack-padding-normal, 1rem);
    overflow-y: auto;
    font-size: var(--text-body-size-medium, 0.875rem);
    scrollbar-width: thin;
}

.merge-protect-message {
    margin: 0;
    white-space: pre-line;
    color: var(--fgColor-default, #1f2328);
}

/* branch pill matching GitHub's .prc-BranchName in the merge summary */
.merge-protect-branch {
    display: inline-block;
    padding: var(--base-size-2, 0.125rem) var(--base-size-6, 0.375rem);
    font-family: var(--fontStack-monospace, ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace);
    font-size: var(--text-body-size-small, 0.75rem);
    line-height: var(--text-body-lineHeight-small, 1.5);
    color: var(--fgColor-link, #0969da);
    background-color: var(--bgColor-accent-muted, #ddf4ff);
    border-radius: var(--borderRadius-medium, 0.375rem);
    text-decoration: none;
    overflow-wrap: anywhere;
    vertical-align: middle;
}

/* stylized code block matching .markdown-body pre */
.merge-protect-code {
    display: block;
    margin: var(--stack-gap-normal, 1rem) 0 0;
    padding: var(--base-size-16, 1rem);
    overflow: auto;
    color: var(--fgColor-default, #1f2328);
    background-color: var(--bgColor-muted, #f6f8fa);
    border-radius: 6px;
    font-family: var(--fontStack-monospace, ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace);
    font-size: 85%;
    line-height: 1.45;
    white-space: pre;
    tab-size: 4;
}

/* code block first child: drop top margin to avoid doubled body padding */
.merge-protect-code:first-child {
    margin-top: 0;
}

.merge-protect-label {
    display: block;
    margin: var(--stack-gap-normal, 1rem) 0 0;
    font-size: var(--text-body-size-medium, 0.875rem);
    font-weight: var(--base-text-weight-semibold, 600);
    line-height: var(--text-body-lineHeight-medium, 1.5);
    color: var(--fgColor-default, #1f2328);
}

.merge-protect-field {
    display: block;
    box-sizing: border-box;
    width: 100%;
    color: var(--fgColor-default, #1f2328);
    background-color: var(--bgColor-default, #fff);
    border: var(--borderWidth-thin, 0.0625rem) solid var(--control-borderColor-rest, var(--borderColor-default, #d1d9e0));
    border-radius: 6px;
    box-shadow: var(--shadow-inset, inset 0 1px 0 rgba(31, 35, 40, 0.04));
    font-family: inherit;
    font-size: 14px;
    line-height: 20px;
    transition: border-color 80ms cubic-bezier(0.33, 1, 0.68, 1), box-shadow 80ms cubic-bezier(0.33, 1, 0.68, 1);
}

.merge-protect-field--mono {
    font-family: var(--fontStack-monospace, ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace);
}

.merge-protect-field::placeholder {
    color: inherit;
    opacity: 0.54;
}

.merge-protect-field:focus {
    border-color: var(--focus-outline-color, var(--borderColor-accent-emphasis, #0969da));
    box-shadow: inset 0 0 0 1px var(--focus-outline-color, var(--borderColor-accent-emphasis, #0969da));
    outline: none;
}

.merge-protect-textarea {
    margin-top: var(--stack-gap-normal, 1rem);
    resize: vertical;
}

.merge-protect-input {
    margin-top: var(--base-size-4, 0.25rem);
    height: var(--control-medium-size, 2rem);
    padding: 0 var(--stack-gap-condensed, 0.5rem);
}

.merge-protect-footer {
    display: flex;
    flex-flow: wrap;
    justify-content: flex-end;
    gap: var(--stack-gap-condensed, 0.5rem);
    padding: 0 var(--stack-padding-normal, 1rem) var(--stack-padding-normal, 1rem);
}

/* medium-size Primer button */
.merge-protect-button {
    min-width: max-content;
    height: var(--control-medium-size, 2rem);
    padding: 0 var(--control-medium-paddingInline-normal, 0.75rem);
    font-family: inherit;
    font-size: var(--text-body-size-medium, 0.875rem);
    font-weight: var(--base-text-weight-medium, 500);
    line-height: var(--text-body-lineHeight-medium, 1.5);
    text-align: center;
    white-space: nowrap;
    cursor: pointer;
    user-select: none;
    border: var(--borderWidth-thin, 0.0625rem) solid;
    border-radius: var(--borderRadius-medium, 0.375rem);
    transition: color 80ms cubic-bezier(0.33, 1, 0.68, 1), background-color 80ms cubic-bezier(0.33, 1, 0.68, 1), border-color 80ms cubic-bezier(0.33, 1, 0.68, 1);
}

.merge-protect-button:focus-visible {
    outline: 2px solid var(--focus-outline-color, var(--borderColor-accent-emphasis, #0969da));
    outline-offset: -2px;
    box-shadow: none;
}

.merge-protect-button:disabled {
    cursor: not-allowed;
    box-shadow: none;
}

.merge-protect-button--secondary {
    color: var(--button-default-fgColor-rest, var(--fgColor-default, #1f2328));
    background-color: var(--button-default-bgColor-rest, var(--bgColor-default, #fff));
    border-color: var(--button-default-borderColor-rest, var(--borderColor-default, #d1d9e0));
    box-shadow: var(--button-default-shadow-resting, 0 1px 0 rgba(31, 35, 40, 0.04));
}

.merge-protect-button--secondary:hover:not(:disabled) {
    background-color: var(--button-default-bgColor-hover, rgba(175, 184, 193, 0.3));
    border-color: var(--button-default-borderColor-hover, var(--borderColor-default, #d1d9e0));
}

.merge-protect-button--secondary:active:not(:disabled) {
    background-color: var(--button-default-bgColor-active, rgba(175, 184, 193, 0.5));
}

.merge-protect-button--primary {
    color: var(--button-primary-fgColor-rest, var(--fgColor-white, #fff));
    background-color: var(--button-primary-bgColor-rest, var(--bgColor-success-emphasis, #1f883d));
    border-color: var(--button-primary-borderColor-rest, var(--borderColor-translucent, rgba(31, 35, 40, 0.15)));
}

.merge-protect-button--primary:hover:not(:disabled) {
    background-color: var(--button-primary-bgColor-hover, #1c8139);
    border-color: var(--button-primary-borderColor-hover, var(--button-primary-borderColor-rest, rgba(31, 35, 40, 0.15)));
}

.merge-protect-button--primary:active:not(:disabled) {
    background-color: var(--button-primary-bgColor-active, #197935);
    box-shadow: var(--button-primary-shadow-selected, inset 0 1px 0 rgba(0, 45, 17, 0.3));
}

/* spinner inside the busy confirm button */
.merge-protect-spinner {
    display: inline-block;
    width: 0.875rem;
    height: 0.875rem;
    margin-right: 0.5rem;
    vertical-align: -0.125rem;
    border: 2px solid currentColor;
    border-right-color: transparent;
    border-radius: 50%;
    animation: merge-protect-spin 0.75s linear infinite;
}

@keyframes merge-protect-spin {
    to { transform: rotate(360deg); }
}

@media (prefers-reduced-motion: reduce) {
    .merge-protect-dialog { animation: none; }
}
`;

    // inject once and re-check by id to survive soft reloads
    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = STYLES;
        (document.head || document.documentElement).appendChild(style);
    }

    // ---- Generic modal prompt ----

    let overlayOpen = false;
    let overlayCancel = null;
    let promptSeq = 0;

    function showTextareaPrompt(opts) {
        const options = opts || {};
        const title = options.title || '';
        // message: string or segments
        // segment: { branch: 'x' } pill or { text: 'x' } plain text
        const messageRaw = options.message || '';
        const messageIsSegments = Array.isArray(messageRaw);
        const message = messageIsSegments ? '' : String(messageRaw);
        const code = typeof options.code === 'string' ? options.code : '';
        const label = typeof options.label === 'string' ? options.label : '';
        const placeholder = options.placeholder || '';
        const value = typeof options.value === 'string' ? options.value : '';
        const rows = options.rows || 6;
        const okLabel = options.okLabel || 'OK';
        const mono = options.mono !== false;
        // input: true renders a single-line <input> instead of a textarea
        const useInput = !!options.input;

        return new Promise(resolve => {
            if (overlayOpen) {
                console.warn(PREFIX, 'overlay already open, ignoring new prompt');
                resolve(null);
                return;
            }
            overlayOpen = true;
            injectStyles();

            // lock page scrolling behind dialogs like GitHub
            const previousBodyOverflow = document.body.style.overflow;
            document.body.style.overflow = 'hidden';

            const overlay = document.createElement('div');
            overlay.className = 'merge-protect-overlay';

            const dialog = document.createElement('div');
            dialog.className = 'merge-protect-dialog';
            dialog.setAttribute('role', 'dialog');
            dialog.setAttribute('aria-modal', 'true');
            if (title) dialog.setAttribute('aria-label', title);

            // header matching GitHub's Overlay layout
            const header = document.createElement('div');
            header.className = 'merge-protect-header';

            const headerWrap = document.createElement('div');
            headerWrap.className = 'merge-protect-header-wrap';

            const titleWrap = document.createElement('div');
            titleWrap.className = 'merge-protect-title-wrap';

            const heading = document.createElement('h2');
            heading.className = 'merge-protect-title';
            heading.id = 'merge-protect-title-' + (++promptSeq);
            heading.textContent = title;
            dialog.setAttribute('aria-labelledby', heading.id);
            titleWrap.appendChild(heading);
            headerWrap.appendChild(titleWrap);

            const actionWrap = document.createElement('div');
            actionWrap.className = 'merge-protect-action-wrap';

            const closeBtn = document.createElement('button');
            closeBtn.type = 'button';
            closeBtn.className = 'merge-protect-close';
            closeBtn.setAttribute('aria-label', 'Close');
            closeBtn.setAttribute('data-mp-action', 'cancel');
            closeBtn.innerHTML = '<svg class="octicon octicon-x" aria-hidden="true" viewBox="0 0 16 16" width="16" height="16" fill="currentColor">' +
                '<path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.749.749 0 0 1 1.275.326.749.749 0 0 1-.215.734L9.06 8l3.22 3.22a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215L8 9.06l-3.22 3.22a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z"></path></svg>';
            actionWrap.appendChild(closeBtn);
            headerWrap.appendChild(actionWrap);
            header.appendChild(headerWrap);
            dialog.appendChild(header);

            const body = document.createElement('div');
            body.className = 'merge-protect-body';

            if (messageIsSegments) {
                const msg = document.createElement('p');
                msg.className = 'merge-protect-message';
                for (const seg of messageRaw) {
                    if (seg && typeof seg === 'object' && seg.branch) {
                        const chip = document.createElement('span');
                        chip.className = 'merge-protect-branch';
                        chip.textContent = String(seg.branch);
                        msg.appendChild(chip);
                    } else {
                        const text = seg && typeof seg === 'object' ? seg.text : seg;
                        msg.appendChild(document.createTextNode(text == null ? '' : String(text)));
                    }
                }
                body.appendChild(msg);
            } else if (message) {
                const msg = document.createElement('p');
                msg.className = 'merge-protect-message';
                msg.textContent = message;
                body.appendChild(msg);
            }

            if (code) {
                const pre = document.createElement('pre');
                pre.className = 'merge-protect-code';
                pre.textContent = code;
                body.appendChild(pre);
            }

            const fieldId = label ? 'merge-protect-field-' + (++promptSeq) : '';
            if (label) {
                const labelEl = document.createElement('label');
                labelEl.className = 'merge-protect-label';
                labelEl.setAttribute('for', fieldId);
                labelEl.textContent = label;
                body.appendChild(labelEl);
            }

            let field;
            if (useInput) {
                field = document.createElement('input');
                field.type = 'text';
                field.className = 'merge-protect-field merge-protect-input' + (mono ? ' merge-protect-field--mono' : '');
                field.spellcheck = false;
                field.setAttribute('aria-label', label || title || 'Input');
                field.placeholder = placeholder;
                field.value = value;
            } else {
                field = document.createElement('textarea');
                field.className = 'merge-protect-field merge-protect-textarea' + (mono ? ' merge-protect-field--mono' : '');
                field.rows = rows;
                field.spellcheck = false;
                field.setAttribute('aria-label', label || title || 'Input');
                field.placeholder = placeholder;
                // keep the draft as the value to allow editing and saving
                field.value = value;
            }
            if (fieldId) field.id = fieldId;
            body.appendChild(field);
            dialog.appendChild(body);

            const footer = document.createElement('div');
            footer.className = 'merge-protect-footer';

            const cancelBtn = document.createElement('button');
            cancelBtn.type = 'button';
            cancelBtn.className = 'merge-protect-button merge-protect-button--secondary';
            cancelBtn.setAttribute('data-mp-action', 'cancel');
            cancelBtn.textContent = 'Cancel';

            const okBtn = document.createElement('button');
            okBtn.type = 'button';
            okBtn.className = 'merge-protect-button merge-protect-button--primary';
            okBtn.setAttribute('data-mp-action', 'confirm');
            okBtn.textContent = okLabel;

            footer.appendChild(cancelBtn);
            footer.appendChild(okBtn);
            dialog.appendChild(footer);

            overlay.appendChild(dialog);
            document.body.appendChild(overlay);

            let resolved = false;
            function finish(result) {
                if (resolved) return;
                resolved = true;
                overlay.remove();
                document.body.style.overflow = previousBodyOverflow;
                overlayOpen = false;
                overlayCancel = null;
                resolve(result);
            }

            let busy = false;
            let busyStop = null;
            let busyLabel = null;

            const controller = {
                setBusy(text, onStop) {
                    busyStop = onStop || null;
                    if (!busy) {
                        busy = true;
                        field.disabled = true;
                        cancelBtn.hidden = true;
                        closeBtn.disabled = true;
                        okBtn.className = 'merge-protect-button merge-protect-button--secondary';
                        okBtn.setAttribute('data-mp-action', 'stop');
                        okBtn.textContent = '';
                        const spinner = document.createElement('span');
                        spinner.className = 'merge-protect-spinner';
                        spinner.setAttribute('aria-hidden', 'true');
                        okBtn.appendChild(spinner);
                        busyLabel = document.createElement('span');
                        okBtn.appendChild(busyLabel);
                    }
                    busyLabel.textContent = text;
                },
                setIdle() {
                    busy = false;
                    busyStop = null;
                    busyLabel = null;
                    field.disabled = false;
                    cancelBtn.hidden = false;
                    closeBtn.disabled = false;
                    okBtn.className = 'merge-protect-button merge-protect-button--primary';
                    okBtn.setAttribute('data-mp-action', 'confirm');
                    okBtn.textContent = okLabel;
                    field.focus();
                },
                close(result) {
                    finish(result);
                }
            };

            function submit() {
                if (busy) {
                    if (busyStop) busyStop();
                    return;
                }
                if (typeof options.onConfirm === 'function') {
                    Promise.resolve(options.onConfirm(field.value.trim(), controller)).catch(err => {
                        console.error(PREFIX, 'confirm handler failed', err);
                        finish(null);
                    });
                    return;
                }
                finish(field.value.trim());
            }

            function requestCancel() {
                if (busy) {
                    if (busyStop) busyStop();
                    return;
                }
                finish(null);
            }

            overlayCancel = requestCancel;

            okBtn.addEventListener('click', submit);
            cancelBtn.addEventListener('click', requestCancel);
            closeBtn.addEventListener('click', requestCancel);
            // backdrop click closes the dialog to match GitHub
            overlay.addEventListener('click', e => {
                if (e.target === overlay) requestCancel();
            });

            // key handling on the dialog to catch field and button events
            dialog.addEventListener('keydown', e => {
                if (busy) return;
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey || useInput)) {
                    e.stopPropagation();
                    e.preventDefault();
                    submit();
                } else if (e.key === 'Tab') {
                    // keep Tab focus inside the dialog
                    const focusables = dialog.querySelectorAll('button:not([disabled]), textarea, input, select, a[href]');
                    if (!focusables.length) return;
                    const first = focusables[0];
                    const last = focusables[focusables.length - 1];
                    if (e.shiftKey && document.activeElement === first) {
                        e.preventDefault();
                        last.focus();
                    } else if (!e.shiftKey && document.activeElement === last) {
                        e.preventDefault();
                        first.focus();
                    }
                }
            });

            // focus the field rather than the overlay to start typing right away
            field.focus();
            if (typeof field.setSelectionRange === 'function') {
                field.setSelectionRange(field.value.length, field.value.length);
            }
        });
    }

    // ---- Config editor (Ctrl+Alt+M) ----

    // indented to keep branch arrays on one line
    // the "*" examples document branch and repository wildcards
    const CONFIG_EXAMPLE = [
        '{',
        '  "settings": {',
        '    "countdown": ' + DEFAULT_COUNTDOWN_SECONDS,
        '  },',
        '  "repositories": {',
        '    "owner/repository": ["main", "develop"],',
        '    "owner/another-repository": ["*"]',
        '  }',
        '}'
    ].join('\n');

    // format a config like CONFIG_EXAMPLE with branch arrays on one line
    // missing keys stay missing to keep deleted fields away
    function formatConfig(cfg) {
        const settings = (cfg && cfg[SETTINGS_KEY]) || {};
        const repos = (cfg && cfg[REPOSITORIES_KEY]) || {};
        const sKeys = Object.keys(settings);
        const rKeys = Object.keys(repos);

        const blocks = [];
        if (sKeys.length) {
            blocks.push('  "settings": {\n' +
                sKeys.map(k => '    ' + JSON.stringify(k) + ': ' + JSON.stringify(settings[k])).join(',\n') +
                '\n  }');
        }
        if (rKeys.length) {
            blocks.push('  "repositories": {\n' +
                rKeys.map(k => {
                    const value = repos[k];
                    const rendered = Array.isArray(value)
                        ? '[' + value.map(b => JSON.stringify(b)).join(', ') + ']'
                        : JSON.stringify(value);
                    return '    ' + JSON.stringify(k) + ': ' + rendered;
                }).join(',\n') +
                '\n  }');
        }
        // empty config gives an empty box to show the placeholder example
        if (!blocks.length) return '';
        return '{\n' + blocks.join(',\n') + '\n}';
    }

    // invalid: { error }
    // valid: { config } with normalised values like a rounded countdown
    function parseAndValidate(text) {
        let parsed;
        try {
            parsed = JSON.parse(text);
        } catch (e) {
            return { error: 'Invalid JSON: ' + e.message };
        }
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return { error: 'The config must be a JSON object, e.g.:\n' + CONFIG_EXAMPLE };
        }

        const allowedTopLevel = [SETTINGS_KEY, REPOSITORIES_KEY];
        for (const key of Object.keys(parsed)) {
            if (allowedTopLevel.indexOf(key) === -1) {
                return {
                    error: 'Unknown top-level key "' + key + '". Only "' + SETTINGS_KEY +
                        '" and "' + REPOSITORIES_KEY + '" are allowed.'
                };
            }
        }

        const config = {};

        if (Object.prototype.hasOwnProperty.call(parsed, SETTINGS_KEY)) {
            const settings = parsed[SETTINGS_KEY];
            if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
                return { error: '"' + SETTINGS_KEY + '" must be an object, e.g. { "' + COUNTDOWN_KEY + '": 5 }.' };
            }
            for (const key of Object.keys(settings)) {
                if (key !== COUNTDOWN_KEY) {
                    return {
                        error: 'Unknown "' + SETTINGS_KEY + '" key "' + key + '". Only "' + COUNTDOWN_KEY + '" is supported.'
                    };
                }
            }
            if (Object.prototype.hasOwnProperty.call(settings, COUNTDOWN_KEY)) {
                const rawSecs = settings[COUNTDOWN_KEY];
                const secs = typeof rawSecs === 'number'
                    ? rawSecs
                    : (typeof rawSecs === 'string' && rawSecs.trim() !== '' ? Number(rawSecs) : NaN);
                if (!Number.isFinite(secs) || Math.round(secs) < 0 || Math.round(secs) > MAX_COUNTDOWN_SECONDS) {
                    return {
                        error: '"' + SETTINGS_KEY + '.' + COUNTDOWN_KEY + '" must be a number between 0 and ' +
                            MAX_COUNTDOWN_SECONDS + '.'
                    };
                }
                config[SETTINGS_KEY] = { [COUNTDOWN_KEY]: Math.round(secs) };
            }
        }

        if (Object.prototype.hasOwnProperty.call(parsed, REPOSITORIES_KEY)) {
            const repos = parsed[REPOSITORIES_KEY];
            if (!repos || typeof repos !== 'object' || Array.isArray(repos)) {
                return { error: '"' + REPOSITORIES_KEY + '" must be an object mapping "owner/repo" or "*" to branch names.' };
            }
            const repositories = {};
            for (const key of Object.keys(repos)) {
                if (key !== '*' && key.indexOf('/') === -1) {
                    return { error: 'Repository keys must look like "owner/repo" or "*" (got "' + key + '").' };
                }
                if (!normalizeBranches(repos[key])) {
                    return { error: 'Value for "' + key + '" must be a branch name or a list of branch names.' };
                }
                repositories[key] = repos[key];
            }
            // drop empty "repositories" to keep the config clean
            if (Object.keys(repositories).length) config[REPOSITORIES_KEY] = repositories;
        }

        return { config: config };
    }

    async function editConfig() {
        // reopen with the user's draft to preserve text after a typo
        let draft = formatConfig(loadConfig());
        for (;;) {
            const edited = await showTextareaPrompt({
                title: 'Edit Merge Protect config',
                code: CONFIG_EXAMPLE,
                placeholder: CONFIG_EXAMPLE,
                value: draft,
                rows: 10,
                okLabel: 'Save',
                mono: true
            });
            if (edited === null) return; // user cancelled

            // empty box = "clear everything" not cancel
            // treat it as an empty config to really remove the old one
            const result = parseAndValidate(edited === '' ? '{}' : edited);
            if (result.error) {
                alert(result.error + '\nNothing was saved.');
                draft = edited; // let the user fix it instead of retyping
                continue;
            }

            saveConfig(result.config);
            return;
        }
    }

    // ---- Page / DOM helpers ----

    function pageContext() {
        const m = location.pathname.match(/^\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
        if (!m) return null;
        return { owner: m[1], repo: m[2], fullRepo: m[1] + '/' + m[2], pr: m[3] };
    }

    function branchFromLink(link) {
        const href = link.getAttribute('href') || '';
        const m = href.match(/\/tree\/(.+?)(?:[?#].*)?$/);
        if (m && m[1]) {
            try {
                return decodeURIComponent(m[1]);
            } catch (e) {
                return m[1];
            }
        }
        return (link.textContent || '').trim();
    }

    // find base and head in "wants to merge ... into <base> from <head>"
    // fall back to the old span[data-testid="branch-name"] markup
    function detectMergeBranches() {
        const containers = document.querySelectorAll('[class*="summaryContainer"]');
        for (const container of containers) {
            if (!/wants to merge/i.test(container.textContent || '')) continue;
            let links = Array.from(container.querySelectorAll('a[data-component="BranchName"]'));
            if (!links.length) links = Array.from(container.querySelectorAll('a[href*="/tree/"]'));

            // drop duplicate hrefs only
            // fork PRs can merge into a same-named base branch
            const seen = new Set();
            const branches = [];
            for (const link of links) {
                const href = link.getAttribute('href') || '';
                if (href) {
                    if (seen.has(href)) continue;
                    seen.add(href);
                }
                const name = branchFromLink(link);
                if (name) branches.push(name);
            }
            if (branches.length) {
                return { base: branches[0], head: branches[1] || '' };
            }
        }

        const fallbackLink = document.querySelector('span[data-testid="branch-name"]');
        return { base: fallbackLink ? (fallbackLink.textContent || '').trim() : '', head: '' };
    }

    function detectTargetBranch() {
        return detectMergeBranches().base;
    }

    function isConfirmMergeButton(el) {
        if (!el || el.tagName !== 'BUTTON') return false;
        // never treat our own dialog buttons as GitHub's button
        if (el.closest('.merge-protect-overlay')) return false;
        if (el.matches('button[data-testid="merge-commit-button"]')) return true;
        // tagged by GitHub with data-dd-action-name=pull_request.merge_box.confirm_merge
        // or confirm_squash / confirm_rebase for other merge methods
        if (el.matches('button[data-dd-action-name^="pull_request.merge_box.confirm"]')) return true;
        // text fallback for "Confirm merge" and "Confirm squash and merge"
        const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
        return /^confirm\b/i.test(text) && /\bmerge\b/i.test(text);
    }

    function findConfirmMergeButton() {
        return document.querySelector(
            'button[data-testid="merge-commit-button"], button[data-dd-action-name^="pull_request.merge_box.confirm"]'
        ) || Array.from(document.querySelectorAll('button')).find(isConfirmMergeButton) || null;
    }

    // ---- Countdown ----

    function runCountdown(seconds, ui) {
        return new Promise(resolve => {
            let remaining = Math.max(0, Math.round(seconds));
            let done = false;
            const stop = () => {
                if (done) return;
                done = true;
                resolve(false);
            };
            if (remaining === 0) {
                // countdown 0 = merge right after the typed confirmation
                resolve(true);
                return;
            }
            const tick = () => {
                if (done) return;
                if (remaining <= 0) {
                    done = true;
                    resolve(true);
                    return;
                }
                ui.setBusy('Stop merging (' + remaining + 's)', stop);
                remaining--;
                setTimeout(tick, 1000);
            };
            tick();
        });
    }

    // ---- Confirmation flow ----

    let flowActive = false;
    // true only during the final programmatic click
    // keeps the countdown from intercepting its own click and looping forever
    let bypassNextClick = false;

    async function runConfirmation(btn, ctx, targetBranch) {
        flowActive = true;
        try {
            const cfg = loadConfig();
            const seconds = getCountdownSeconds(cfg);
            const branches = detectMergeBranches();
            const base = targetBranch || branches.base || '';
            const head = branches.head || '';

            // typed text: "<owner>/<repo>@<base branch>"
            // uses the protected branch being merged into
            const expected = base ? ctx.fullRepo + '@' + base : ctx.fullRepo;
            const answer = await showTextareaPrompt({
                title: 'Confirm merge',
                message: base && head
                    ? [
                        { text: 'Merging ' },
                        { branch: head },
                        { text: ' into ' },
                        { branch: base }
                    ]
                    : [{ text: 'Merge ' + ctx.fullRepo + '.' }],
                label: 'To confirm, type "' + expected + '" in the box below',
                placeholder: expected,
                input: true,
                okLabel: 'Confirm',
                mono: false,
                onConfirm: async (value, ui) => {
                    if (value.toLowerCase() !== expected.toLowerCase()) {
                        alert('Confirmation text does not match "' + expected + '". Merge aborted.');
                        return;
                    }
                    const proceed = await runCountdown(seconds, ui);
                    if (!proceed) {
                        console.log(PREFIX, 'countdown cancelled, merge aborted');
                        ui.setIdle();
                        return;
                    }
                    ui.close(value);
                }
            });
            if (answer === null) return;

            // find the button again to survive GitHub re-renders
            const btnNow = findConfirmMergeButton() || (btn && btn.isConnected ? btn : null);
            if (!btnNow) {
                console.warn(PREFIX, 'confirm merge button not found, merge not executed');
                return;
            }

            console.log(PREFIX, 'countdown finished (' + seconds + 's), proceeding with merge');
            bypassNextClick = true;
            try {
                btnNow.click();
            } finally {
                bypassNextClick = false;
            }
        } catch (err) {
            console.error(PREFIX, 'confirmation failed', err);
        } finally {
            flowActive = false;
        }
    }

    // capture Escape above GitHub to keep its merge box open
    window.addEventListener('keydown', function (e) {
        if (e.key !== 'Escape' || !overlayCancel) return;
        e.stopPropagation();
        e.preventDefault();
        overlayCancel();
    }, true);

    // capture phase on window to run before GitHub's handlers
    // look up the button at click time to survive soft navigation

    window.addEventListener('click', function (e) {
        if (bypassNextClick) return; // our own final click after the countdown

        const target = e.target;
        if (!(target instanceof Element)) return;
        const btn = target.closest('button');
        if (!isConfirmMergeButton(btn)) return;

        const ctx = pageContext();
        if (!ctx) return;

        const targetBranch = detectTargetBranch();
        if (!isProtected(ctx.fullRepo, targetBranch)) return;

        // stop GitHub's handler by capturing above it
        e.stopPropagation();
        e.preventDefault();

        // ignore extra clicks while a confirmation is running
        if (flowActive) return;

        console.log(PREFIX, 'intercepted Confirm merge click for', ctx.fullRepo, 'branch', targetBranch || '(unknown)');
        runConfirmation(btn, ctx, targetBranch);
    }, true);

    // ---- Startup ----

    // match the routes that can lead to a PR through soft navigation
    // the click handler reads the current URL when the button is clicked

    function init() {
        try {
            const ctx = pageContext();
            // stay quiet outside PR pages to avoid console noise
            if (!ctx) return;
            const targetBranch = detectTargetBranch();
            console.log(PREFIX, 'page:', ctx.fullRepo + ' #' + ctx.pr,
                '| target branch:', targetBranch || '(unknown)',
                '| protected:', isProtected(ctx.fullRepo, targetBranch),
                '| wait:', getCountdownSeconds(loadConfig()) + 's');
        } catch (err) {
            console.error(PREFIX, 'error during init', err);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }

    document.addEventListener('keydown', function (ev) {
        if (!ev.ctrlKey || !ev.altKey) return;
        const key = typeof ev.key === 'string' ? ev.key.toLowerCase() : '';
        if (key !== 'm') return;
        ev.preventDefault();
        editConfig();
    });

})();
