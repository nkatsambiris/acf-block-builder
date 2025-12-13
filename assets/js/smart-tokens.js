/**
 * Smart Tokens System
 * 
 * Handles detection and rendering of clickable token chips in chat messages.
 * Currently supports file references, extensible for future token types
 * (post-types, taxonomies, ACF field groups, etc.)
 * 
 * @package ACF_Block_Builder
 */

(function($) {
    'use strict';

    // =========================================
    // TOKEN REGISTRY
    // =========================================
    
    /**
     * Extensible registry mapping token identifiers to their configuration.
     * Each token type has its own namespace for easy extension.
     */
    var tokenRegistry = {
        // File tokens - block files that can be opened in the Code Editor
        files: {
            'block.json': {
                tabId: 'block-json',
                icon: 'media-code',
                label: 'block.json',
                type: 'json'
            },
            'render.php': {
                tabId: 'render-php',
                icon: 'editor-code',
                label: 'render.php',
                type: 'php'
            },
            'style.css': {
                tabId: 'style-css',
                icon: 'art',
                label: 'style.css',
                type: 'css'
            },
            'script.js': {
                tabId: 'script-js',
                icon: 'media-default',
                label: 'script.js',
                type: 'js'
            },
            'fields.php': {
                tabId: 'fields-php',
                icon: 'database',
                label: 'fields.php',
                type: 'php'
            },
            'assets.php': {
                tabId: 'assets-php',
                icon: 'admin-links',
                label: 'assets.php',
                type: 'php'
            }
        }
        
        // Future token types can be added here:
        // postTypes: { ... },
        // taxonomies: { ... },
        // acfGroups: { ... },
        // acfFields: { ... },
        // optionsPages: { ... }
    };

    // =========================================
    // TOKEN PARSER
    // =========================================

    /**
     * Build regex pattern from registered file tokens.
     * Matches file names wrapped in backticks or as standalone words.
     * 
     * @returns {RegExp} Pattern to match file tokens
     */
    function buildFileTokenPattern() {
        var fileNames = Object.keys(tokenRegistry.files);
        // Escape special regex characters in file names
        var escapedNames = fileNames.map(function(name) {
            return name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        });
        
        // Match: `filename` or standalone filename with word boundaries
        // Priority given to backtick-wrapped versions
        var pattern = '`(' + escapedNames.join('|') + ')`|\\b(' + escapedNames.join('|') + ')\\b';
        return new RegExp(pattern, 'g');
    }

    /**
     * Parse text content and identify file token matches.
     * 
     * @param {string} text - Text content to parse
     * @returns {Array} Array of match objects with index, length, and token data
     */
    function parseFileTokens(text) {
        var pattern = buildFileTokenPattern();
        var matches = [];
        var match;
        
        while ((match = pattern.exec(text)) !== null) {
            // Group 1 is backtick-wrapped, Group 2 is standalone
            var fileName = match[1] || match[2];
            var tokenConfig = tokenRegistry.files[fileName];
            
            if (tokenConfig) {
                matches.push({
                    index: match.index,
                    length: match[0].length,
                    fullMatch: match[0],
                    fileName: fileName,
                    config: tokenConfig,
                    isBackticked: !!match[1]
                });
            }
        }
        
        return matches;
    }

    // =========================================
    // TOKEN RENDERER
    // =========================================

    /**
     * Render a single token chip HTML element.
     * 
     * @param {string} tokenType - Type of token (e.g., 'file')
     * @param {Object} tokenData - Token configuration and match data
     * @returns {string} HTML string for the token chip
     */
    function renderTokenChip(tokenType, tokenData) {
        var config = tokenData.config;
        
        var html = '<span class="acf-bb-token-chip" ' +
            'data-token-type="' + tokenType + '" ' +
            'data-token-id="' + tokenData.fileName + '" ' +
            'data-tab-id="' + config.tabId + '" ' +
            'title="Click to open ' + config.label + '">' +
            '<span class="dashicons dashicons-' + config.icon + '"></span>' +
            '<span class="acf-bb-token-label">' + config.label + '</span>' +
            '</span>';
        
        return html;
    }

    /**
     * Process text and replace file references with token chips.
     * 
     * @param {string} text - Text content to process
     * @returns {string} Text with file references replaced by token chip HTML
     */
    function replaceFileTokens(text) {
        var matches = parseFileTokens(text);
        
        if (matches.length === 0) {
            return text;
        }
        
        // Process matches in reverse order to preserve indices
        matches.sort(function(a, b) {
            return b.index - a.index;
        });
        
        var result = text;
        matches.forEach(function(match) {
            var chip = renderTokenChip('file', match);
            result = result.substring(0, match.index) + chip + result.substring(match.index + match.length);
        });
        
        return result;
    }

    // =========================================
    // HTML CONTENT PROCESSOR
    // =========================================

    /**
     * Process HTML content and convert file references to token chips.
     * Handles text nodes while preserving HTML structure.
     * 
     * @param {string} html - HTML content to process
     * @returns {string} Processed HTML with token chips
     */
    function processMessageContent(html) {
        if (!html || typeof html !== 'string') {
            return html;
        }
        
        // Create a temporary container to parse HTML
        var $temp = $('<div>').html(html);
        
        // Process text nodes recursively
        processTextNodes($temp[0]);
        
        return $temp.html();
    }

    /**
     * Recursively process text nodes in a DOM element.
     * 
     * @param {Element} element - DOM element to process
     */
    function processTextNodes(element) {
        var childNodes = Array.prototype.slice.call(element.childNodes);
        
        childNodes.forEach(function(node) {
            if (node.nodeType === Node.TEXT_NODE) {
                var text = node.textContent;
                var processed = replaceFileTokens(text);
                
                // Only replace if we found tokens
                if (processed !== text) {
                    var $wrapper = $('<span>').html(processed);
                    $(node).replaceWith($wrapper.contents());
                }
            } else if (node.nodeType === Node.ELEMENT_NODE) {
                // Skip processing inside certain elements
                var tagName = node.tagName.toLowerCase();
                var skipTags = ['script', 'style', 'code', 'pre', 'textarea', 'input'];
                
                // Also skip elements that are already token chips
                if (skipTags.indexOf(tagName) === -1 && !$(node).hasClass('acf-bb-token-chip')) {
                    processTextNodes(node);
                }
            }
        });
    }

    /**
     * Process a plain text string (not HTML) and convert to HTML with tokens.
     * Useful for processing summary items or other plain text content.
     * 
     * @param {string} text - Plain text to process
     * @returns {string} HTML string with token chips
     */
    function processPlainText(text) {
        if (!text || typeof text !== 'string') {
            return text;
        }
        
        // Escape HTML entities first
        var escaped = $('<div>').text(text).html();
        
        // Then process for tokens
        return replaceFileTokens(escaped);
    }

    // =========================================
    // CLICK HANDLERS
    // =========================================

    /**
     * Initialize click handlers for token chips.
     * Uses event delegation for dynamically created chips.
     */
    function initClickHandlers() {
        // Delegate click handler for file tokens
        $(document).on('click', '.acf-bb-token-chip[data-token-type="file"]', function(e) {
            e.preventDefault();
            e.stopPropagation();
            
            var $chip = $(this);
            var tabId = $chip.data('tab-id');
            
            if (tabId) {
                switchToTab(tabId);
            }
        });
    }

    /**
     * Switch to a specific tab in the Code Editor and scroll to it.
     * 
     * @param {string} tabId - ID of the tab to switch to
     */
    function switchToTab(tabId) {
        // Find and click the tab
        var $tab = $('.acf-bb-tab[data-tab="' + tabId + '"]');
        
        if ($tab.length) {
            // Trigger the tab click
            $tab.trigger('click');
            
            // Scroll the Code Editor section into view
            var $codeSection = $('.code-editors-section');
            if ($codeSection.length) {
                $codeSection[0].scrollIntoView({ 
                    behavior: 'smooth', 
                    block: 'start' 
                });
            }
            
            // Add a brief highlight effect to the tab
            $tab.addClass('acf-bb-tab-highlight');
            setTimeout(function() {
                $tab.removeClass('acf-bb-tab-highlight');
            }, 1000);
        }
    }

    // =========================================
    // PUBLIC API
    // =========================================

    /**
     * Initialize the Smart Tokens system.
     * Should be called once on document ready.
     */
    function init() {
        initClickHandlers();
    }

    /**
     * Register a new token type in the registry.
     * Allows extending the system with new token types.
     * 
     * @param {string} namespace - Token type namespace (e.g., 'postTypes')
     * @param {Object} tokens - Token definitions
     */
    function registerTokens(namespace, tokens) {
        tokenRegistry[namespace] = tokens;
    }

    /**
     * Register a single custom file in the files registry.
     * Used for dynamically created custom files.
     * 
     * @param {string} filename - The filename (e.g., 'readme.txt')
     * @param {string} tabId - The tab ID (e.g., 'custom-readme-txt')
     */
    function registerCustomFile(filename, tabId) {
        if (tokenRegistry.files[filename]) {
            return; // Already registered
        }
        
        // Determine icon based on file extension
        var ext = filename.split('.').pop().toLowerCase();
        var iconMap = {
            'php': 'editor-code',
            'js': 'media-default',
            'css': 'art',
            'json': 'media-code',
            'html': 'media-text',
            'txt': 'text-page'
        };
        
        tokenRegistry.files[filename] = {
            tabId: tabId,
            icon: iconMap[ext] || 'media-text',
            label: filename,
            type: ext
        };
    }

    /**
     * Get the token registry (for debugging/extension).
     * 
     * @returns {Object} The token registry
     */
    function getRegistry() {
        return tokenRegistry;
    }

    // =========================================
    // EXPOSE PUBLIC API
    // =========================================

    window.SmartTokens = {
        init: init,
        processMessageContent: processMessageContent,
        processPlainText: processPlainText,
        parseFileTokens: parseFileTokens,
        renderTokenChip: renderTokenChip,
        switchToTab: switchToTab,
        registerTokens: registerTokens,
        registerCustomFile: registerCustomFile,
        getRegistry: getRegistry
    };

    // Auto-initialize on document ready
    $(document).ready(function() {
        window.SmartTokens.init();
    });

})(jQuery);

