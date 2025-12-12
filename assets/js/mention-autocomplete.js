/**
 * Mention Autocomplete System
 * 
 * Handles @ mention autocomplete for file references in the chat input.
 * Uses a contenteditable div to render inline token chips.
 * 
 * @package ACF_Block_Builder
 */

(function($) {
    'use strict';

    // =========================================
    // STATE
    // =========================================
    
    var config = {
        textareaSelector: '#acf_block_builder_prompt',
        editorSelector: '#acf-bb-prompt-editor',
        dropdownSelector: '#acf-bb-mention-dropdown',
        editorsGetter: null
    };
    
    var state = {
        isDropdownOpen: false,
        selectedIndex: 0,
        filterText: '',
        mentionRange: null,
        wpData: null,
        wpDataLoading: false,
        wpDataLoaded: false,
        currentCategory: null, // For nested navigation (field_group, field)
        isScrolling: false // Prevents mouseenter selection during scroll
    };

    // =========================================
    // WORDPRESS DATA FETCHING
    // =========================================
    
    function fetchWordPressData() {
        if (state.wpDataLoaded || state.wpDataLoading) {
            return;
        }
        
        state.wpDataLoading = true;
        
        $.ajax({
            url: acfBlockBuilder.ajax_url,
            type: 'POST',
            data: {
                action: 'acf_block_builder_get_wp_data',
                nonce: acfBlockBuilder.nonce
            },
            success: function(response) {
                if (response.success && response.data) {
                    state.wpData = response.data;
                    state.wpDataLoaded = true;
                    
                    // Re-render dropdown if it's still open to show the new data
                    if (state.isDropdownOpen) {
                        var items = filterItems(state.filterText);
                        renderDropdown(items);
                        positionDropdown();
                    }
                }
                state.wpDataLoading = false;
            },
            error: function() {
                state.wpDataLoading = false;
            }
        });
    }

    // =========================================
    // FILE REGISTRY
    // =========================================
    
    function getAvailableFiles() {
        if (window.SmartTokens && window.SmartTokens.getRegistry) {
            var registry = window.SmartTokens.getRegistry();
            if (registry.files) {
                return Object.keys(registry.files).map(function(fileName) {
                    var fileConfig = registry.files[fileName];
                    return {
                        id: fileName,
                        label: fileConfig.label || fileName,
                        icon: fileConfig.icon || 'media-code',
                        tabId: fileConfig.tabId
                    };
                });
            }
        }
        
        return [
            { id: 'block.json', label: 'block.json', icon: 'media-code', tabId: 'block-json' },
            { id: 'render.php', label: 'render.php', icon: 'editor-code', tabId: 'render-php' },
            { id: 'style.css', label: 'style.css', icon: 'art', tabId: 'style-css' },
            { id: 'script.js', label: 'script.js', icon: 'media-default', tabId: 'script-js' },
            { id: 'fields.php', label: 'fields.php', icon: 'database', tabId: 'fields-php' },
            { id: 'assets.php', label: 'assets.php', icon: 'admin-links', tabId: 'assets-php' }
        ];
    }

    function getAcfFieldTypes() {
        return [
            // Basic
            { id: 'ft_text', label: 'Text', icon: 'editor-textcolor', type: 'field_type', data: { description: 'Single line text input' } },
            { id: 'ft_textarea', label: 'Text Area', icon: 'editor-paragraph', type: 'field_type', data: { description: 'Multiple line text input' } },
            { id: 'ft_number', label: 'Number', icon: 'editor-ol', type: 'field_type', data: { description: 'Numeric input' } },
            { id: 'ft_range', label: 'Range', icon: 'leftright', type: 'field_type', data: { description: 'Range slider input' } },
            { id: 'ft_email', label: 'Email', icon: 'email', type: 'field_type', data: { description: 'Email address input' } },
            { id: 'ft_url', label: 'Url', icon: 'admin-links', type: 'field_type', data: { description: 'URL input' } },
            { id: 'ft_password', label: 'Password', icon: 'lock', type: 'field_type', data: { description: 'Password input' } },
            
            // Content
            { id: 'ft_image', label: 'Image', icon: 'format-image', type: 'field_type', data: { description: 'Image upload/selection' } },
            { id: 'ft_file', label: 'File', icon: 'media-default', type: 'field_type', data: { description: 'File upload/selection' } },
            { id: 'ft_wysiwyg', label: 'Wysiwyg Editor', icon: 'editor-table', type: 'field_type', data: { description: 'Rich text editor' } },
            { id: 'ft_oembed', label: 'oEmbed', icon: 'format-video', type: 'field_type', data: { description: 'Embed videos and other content' } },
            { id: 'ft_gallery', label: 'Gallery', icon: 'format-gallery', type: 'field_type', data: { description: 'Gallery of images' } },

            // Choice
            { id: 'ft_select', label: 'Select', icon: 'menu', type: 'field_type', data: { description: 'Drop down list' } },
            { id: 'ft_checkbox', label: 'Checkbox', icon: 'forms', type: 'field_type', data: { description: 'Checkbox inputs' } },
            { id: 'ft_radio', label: 'Radio Button', icon: 'marker', type: 'field_type', data: { description: 'Radio button inputs' } },
            { id: 'ft_button_group', label: 'Button Group', icon: 'screenoptions', type: 'field_type', data: { description: 'Radio button group' } },
            { id: 'ft_true_false', label: 'True / False', icon: 'yes', type: 'field_type', data: { description: 'True/false toggle' } },
            
            // Relational
            { id: 'ft_link', label: 'Link', icon: 'admin-links', type: 'field_type', data: { description: 'Link selection' } },
            { id: 'ft_post_object', label: 'Post Object', icon: 'admin-post', type: 'field_type', data: { description: 'Select one or more posts' } },
            { id: 'ft_page_link', label: 'Page Link', icon: 'admin-page', type: 'field_type', data: { description: 'Link to a post/page' } },
            { id: 'ft_relationship', label: 'Relationship', icon: 'randomize', type: 'field_type', data: { description: 'Advanced relationship with posts' } },
            { id: 'ft_taxonomy', label: 'Taxonomy', icon: 'tag', type: 'field_type', data: { description: 'Select taxonomy terms' } },
            { id: 'ft_user', label: 'User', icon: 'admin-users', type: 'field_type', data: { description: 'Select one or more users' } },
            
            // jQuery
            { id: 'ft_google_map', label: 'Google Map', icon: 'location', type: 'field_type', data: { description: 'Google Map input' } },
            { id: 'ft_date_picker', label: 'Date Picker', icon: 'calendar', type: 'field_type', data: { description: 'Date selector' } },
            { id: 'ft_date_time_picker', label: 'Date Time Picker', icon: 'calendar-alt', type: 'field_type', data: { description: 'Date and time selector' } },
            { id: 'ft_time_picker', label: 'Time Picker', icon: 'clock', type: 'field_type', data: { description: 'Time selector' } },
            { id: 'ft_color_picker', label: 'Color Picker', icon: 'color-picker', type: 'field_type', data: { description: 'Color selector' } },
            
            // Layout
            { id: 'ft_message', label: 'Message', icon: 'format-status', type: 'field_type', data: { description: 'Text message (no input)' } },
            { id: 'ft_accordion', label: 'Accordion', icon: 'list-view', type: 'field_type', data: { description: 'Accordion container' } },
            { id: 'ft_tab', label: 'Tab', icon: 'index-card', type: 'field_type', data: { description: 'Tab container' } },
            { id: 'ft_group', label: 'Group', icon: 'category', type: 'field_type', data: { description: 'Group sub fields' } },
            { id: 'ft_repeater', label: 'Repeater', icon: 'controls-repeat', type: 'field_type', data: { description: 'Repeat sub fields' } },
            { id: 'ft_flexible_content', label: 'Flexible Content', icon: 'layout', type: 'field_type', data: { description: 'Flexible content layout' } },
            { id: 'ft_clone', label: 'Clone', icon: 'admin-page', type: 'field_type', data: { description: 'Clone other fields' } }
        ];
    }

    function getAvailableItems() {
        var items = getAvailableFiles();
        
        // Add ACF Field Types
        items = items.concat(getAcfFieldTypes());
        
        // Add WordPress data items if loaded
        if (state.wpDataLoaded && state.wpData) {
            // Add post types
            if (state.wpData.postTypes) {
                state.wpData.postTypes.forEach(function(postType) {
                    items.push({
                        id: 'pt_' + postType.id,
                        label: postType.label,
                        icon: 'admin-post',
                        type: 'post_type',
                        data: postType
                    });
                });
            }
            
            // Add taxonomies
            if (state.wpData.taxonomies) {
                state.wpData.taxonomies.forEach(function(taxonomy) {
                    items.push({
                        id: 'tax_' + taxonomy.id,
                        label: taxonomy.label,
                        icon: 'tag',
                        type: 'taxonomy',
                        data: taxonomy
                    });
                });
            }
            
            // Add field groups
            if (state.wpData.fieldGroups) {
                state.wpData.fieldGroups.forEach(function(group) {
                    items.push({
                        id: 'fg_' + group.id,
                        label: group.title,
                        icon: 'list-view',
                        type: 'field_group',
                        data: group
                    });
                });
            }
            
            // Add individual fields
            if (state.wpData.fields) {
                state.wpData.fields.forEach(function(field) {
                    items.push({
                        id: 'fld_' + field.id,
                        label: field.label,
                        icon: 'editor-ul',
                        type: 'field',
                        data: field
                    });
                });
            }
        }
        
        return items;
    }
    
    function filterItems(searchText) {
        var items = getAvailableItems();
        if (!searchText) return items;
        
        var search = searchText.toLowerCase();
        return items.filter(function(item) {
            return item.label.toLowerCase().indexOf(search) !== -1;
        });
    }

    // =========================================
    // CONTENTEDITABLE SETUP
    // =========================================

    function setupContentEditable() {
        var $textarea = $(config.textareaSelector);
        if (!$textarea.length) return;
        
        // Check if editor already exists
        if ($(config.editorSelector).length) return;
        
        // Create contenteditable div
        var $editor = $('<div></div>')
            .attr('id', 'acf-bb-prompt-editor')
            .attr('contenteditable', 'true')
            .attr('data-placeholder', $textarea.attr('placeholder') || 'Message AI Block Builder...')
            .addClass('acf-bb-prompt-editor');
        
        // Insert after textarea and hide textarea
        $textarea.after($editor).addClass('acf-bb-textarea-hidden');
        
        // Sync placeholder data attributes
        $editor.attr('data-placeholder-agent', $textarea.data('placeholder-agent'));
        $editor.attr('data-placeholder-ask', $textarea.data('placeholder-ask'));
        
        // Sync content from textarea if any
        var initialContent = $textarea.val();
        if (initialContent) {
            $editor.text(initialContent);
        }
    }

    // =========================================
    // DROPDOWN UI
    // =========================================

    function ensureDropdownExists() {
        if ($(config.dropdownSelector).length === 0) {
            var $dropdown = $('<div id="acf-bb-mention-dropdown" class="acf-bb-mention-dropdown"></div>');
            $('body').append($dropdown);
        }
        return $(config.dropdownSelector);
    }

    function groupItemsByType(itemList) {
        var grouped = {
            file: [],
            post_type: [],
            taxonomy: [],
            field_group: [],
            field: [],
            field_type: []
        };
        
        itemList.forEach(function(item) {
            var type = item.type || 'file';
            if (grouped[type]) {
                grouped[type].push(item);
            }
        });
        
        return grouped;
    }

    function highlightMatch(label, search) {
        if (!search) return label;
        
        var lowerLabel = label.toLowerCase();
        var lowerSearch = search.toLowerCase();
        var index = lowerLabel.indexOf(lowerSearch);
        
        if (index === -1) return label;
        
        return label.substring(0, index) + 
               '<strong>' + label.substring(index, index + search.length) + '</strong>' + 
               label.substring(index + search.length);
    }
    
    function escapeAttr(str) {
        if (!str) return '';
        return str.replace(/&/g, '&amp;')
                  .replace(/"/g, '&quot;')
                  .replace(/'/g, '&#39;')
                  .replace(/</g, '&lt;')
                  .replace(/>/g, '&gt;');
    }

    function renderDropdown(items) {
        var $dropdown = ensureDropdownExists();
        var html = '';
        var currentIndex = 0;
        
        // Always show search bar at top (real input field)
        html += '<div class="acf-bb-mention-search">';
        html += '<span class="dashicons dashicons-search"></span>';
        html += '<input type="text" class="acf-bb-mention-search-input" placeholder="Search..." value="' + escapeAttr(state.filterText) + '" />';
        html += '</div>';
        
        // Check if we're in a category detail view
        if (state.currentCategory && !state.filterText) {
            html += renderCategoryDetail(items);
        } else if (items.length === 0) {
            if (state.wpDataLoading) {
                html += '<div class="acf-bb-mention-empty">Loading...</div>';
            } else {
                html += '<div class="acf-bb-mention-empty">No matching items</div>';
            }
        } else if (!state.filterText) {
            // Show category overview
            html += renderCategoryOverview(items);
        } else {
            // Show filtered results grouped by category
            html += renderFilteredResults(items);
        }
        
        $dropdown.html(html);
        
        // Helper function for category detail view (nested navigation)
        function renderCategoryDetail(allItems) {
            var output = '';
            var grouped = groupItemsByType(allItems);
            var categoryItems = grouped[state.currentCategory] || [];
            
            var categoryLabels = {
                'file': 'Files',
                'post_type': 'Post Types',
                'taxonomy': 'Taxonomies',
                'field_group': 'Field Groups',
                'field': 'Fields',
                'field_type': 'Field Types'
            };
            var categoryIcons = {
                'file': 'media-code',
                'post_type': 'admin-post',
                'taxonomy': 'tag',
                'field_group': 'list-view',
                'field': 'editor-ul',
                'field_type': 'editor-table'
            };
            
            // Back button
            var isBackSelected = currentIndex === state.selectedIndex;
            var backClasses = 'acf-bb-mention-item acf-bb-mention-back';
            if (isBackSelected) backClasses += ' selected';
            
            output += '<div class="' + backClasses + '" data-action="back" data-index="' + currentIndex + '">';
            output += '<span class="dashicons dashicons-arrow-left-alt2"></span>';
            output += '<span class="acf-bb-mention-label">Back</span>';
            output += '</div>';
            currentIndex++;
            
            // Category header
            output += '<div class="acf-bb-mention-header">' + categoryLabels[state.currentCategory] + ' (' + categoryItems.length + ')</div>';
            
            // All items in category
            output += '<div class="acf-bb-mention-list">';
            categoryItems.forEach(function(item) {
                var isSelected = currentIndex === state.selectedIndex;
                var classes = 'acf-bb-mention-item';
                if (isSelected) classes += ' selected';
                
                output += '<div class="' + classes + '" data-item-id="' + item.id + '" data-index="' + currentIndex + '">';
                output += '<span class="dashicons dashicons-' + item.icon + '"></span>';
                output += '<span class="acf-bb-mention-label">' + item.label + '</span>';
                output += '</div>';
                
                currentIndex++;
            });
            output += '</div>';
            
            return output;
        }
        
        // Helper function for category overview (no search)
        function renderCategoryOverview(allItems) {
            var output = '';
            var grouped = groupItemsByType(allItems);
            var FOLDER_THRESHOLD = 7; // Categories with more than this become folders
            
            // All categories with their config
            var allCategories = [
                { key: 'file', label: 'Files', icon: 'media-code' },
                { key: 'post_type', label: 'Post Types', icon: 'admin-post' },
                { key: 'taxonomy', label: 'Taxonomies', icon: 'tag' },
                { key: 'field_group', label: 'Field Groups', icon: 'list-view' },
                { key: 'field', label: 'Fields', icon: 'editor-ul' },
                { key: 'field_type', label: 'Field Types', icon: 'editor-table' }
            ];
            
            allCategories.forEach(function(category) {
                var categoryItems = grouped[category.key];
                if (categoryItems.length === 0) return;
                
                // If more than threshold items, render as folder
                if (categoryItems.length > FOLDER_THRESHOLD) {
                    var isSelected = currentIndex === state.selectedIndex;
                    var classes = 'acf-bb-mention-item acf-bb-mention-folder';
                    if (isSelected) classes += ' selected';
                    
                    output += '<div class="' + classes + '" data-category-key="' + category.key + '" data-index="' + currentIndex + '">';
                    output += '<span class="dashicons dashicons-' + category.icon + '"></span>';
                    output += '<span class="acf-bb-mention-label">' + category.label + '</span>';
                    output += '<span class="acf-bb-mention-folder-count">(' + categoryItems.length + ')</span>';
                    output += '<span class="dashicons dashicons-arrow-right-alt2 acf-bb-folder-arrow"></span>';
                    output += '</div>';
                    
                    currentIndex++;
                } else {
                    // Render inline with all items shown
                    output += '<div class="acf-bb-mention-category">';
                    output += '<div class="acf-bb-mention-category-header">';
                    output += '<span class="dashicons dashicons-' + category.icon + '"></span>';
                    output += '<span class="acf-bb-mention-category-title">' + category.label + '</span>';
                    output += '<span class="acf-bb-mention-category-count">(' + categoryItems.length + ')</span>';
                    output += '</div>';
                    
                    // Show all items (since we're under the threshold)
                    categoryItems.forEach(function(item) {
                        var isSelected = currentIndex === state.selectedIndex;
                        var classes = 'acf-bb-mention-item';
                        if (isSelected) classes += ' selected';
                        
                        output += '<div class="' + classes + '" data-item-id="' + item.id + '" data-index="' + currentIndex + '">';
                        output += '<span class="dashicons dashicons-' + item.icon + '"></span>';
                        output += '<span class="acf-bb-mention-label">' + item.label + '</span>';
                        output += '</div>';
                        
                        currentIndex++;
                    });
                    
                    output += '</div>';
                }
            });
            
            return output;
        }
        
        // Helper function for filtered results (with search)
        function renderFilteredResults(filteredItems) {
            var output = '';
            var grouped = groupItemsByType(filteredItems);
            
            var categories = [
                { key: 'file', label: 'Files' },
                { key: 'post_type', label: 'Post Types' },
                { key: 'taxonomy', label: 'Taxonomies' },
                { key: 'field_group', label: 'Field Groups' },
                { key: 'field', label: 'Fields' },
                { key: 'field_type', label: 'Field Types' }
            ];
            
            categories.forEach(function(category) {
                var categoryItems = grouped[category.key];
                if (categoryItems.length > 0) {
                    output += '<div class="acf-bb-mention-header">' + category.label + '</div>';
                    output += '<div class="acf-bb-mention-list">';
                    
                    categoryItems.forEach(function(item) {
                        var isSelected = currentIndex === state.selectedIndex;
                        var classes = 'acf-bb-mention-item';
                        if (isSelected) classes += ' selected';
                        
                        output += '<div class="' + classes + '" data-item-id="' + item.id + '" data-index="' + currentIndex + '">';
                        output += '<span class="dashicons dashicons-' + item.icon + '"></span>';
                        output += '<span class="acf-bb-mention-label">' + highlightMatch(item.label, state.filterText) + '</span>';
                        output += '</div>';
                        
                        currentIndex++;
                    });
                    
                    output += '</div>';
                }
            });
            
            return output;
        }
    }
    
    // Get count of selectable items in current view
    function getSelectableItemCount() {
        var items = filterItems(state.filterText);
        var grouped = groupItemsByType(items);
        var count = 0;
        var FOLDER_THRESHOLD = 7;
        
        if (state.currentCategory && !state.filterText) {
            // In category detail: back button + category items
            count = 1 + (grouped[state.currentCategory] || []).length;
        } else if (!state.filterText) {
            // In overview: dynamically count based on threshold
            var allCategories = ['file', 'post_type', 'taxonomy', 'field_group', 'field', 'field_type'];
            
            allCategories.forEach(function(key) {
                var categoryItems = grouped[key];
                if (categoryItems.length === 0) return;
                
                if (categoryItems.length > FOLDER_THRESHOLD) {
                    // Folder item counts as 1
                    count += 1;
                } else {
                    // All inline items count
                    count += categoryItems.length;
                }
            });
        } else {
            // Filtered results: all matching items
            count = items.length;
        }
        
        return count;
    }

    function positionDropdown() {
        var $dropdown = $(config.dropdownSelector);
        var $editor = $(config.editorSelector);
        var $container = $editor.closest('.acf-bb-input-container');
        
        if (!$container.length) {
            $container = $editor.parent();
        }
        
        var containerOffset = $container.offset();
        var dropdownHeight = $dropdown.outerHeight();
        
        $dropdown.css({
            position: 'absolute',
            left: containerOffset.left + 'px',
            top: (containerOffset.top - dropdownHeight - 8) + 'px',
            width: $container.outerWidth() + 'px'
        });
        
        // If dropdown would go above viewport, position below
        if (parseFloat($dropdown.css('top')) < 0) {
            var containerHeight = $container.outerHeight();
            $dropdown.css({
                top: (containerOffset.top + containerHeight + 8) + 'px'
            });
        }
    }

    function showDropdown() {
        // Fetch WordPress data on first use
        if (!state.wpDataLoaded && !state.wpDataLoading) {
            fetchWordPressData();
        }
        
        var items = filterItems(state.filterText);
        state.selectedIndex = 0;
        state.currentCategory = null;
        
        renderDropdown(items);
        positionDropdown();
        
        $(config.dropdownSelector).addClass('visible');
        state.isDropdownOpen = true;
    }

    function hideDropdown() {
        $(config.dropdownSelector).removeClass('visible');
        state.isDropdownOpen = false;
        state.filterText = '';
        state.mentionRange = null;
        state.currentCategory = null;
        state.isScrolling = false;
    }

    function updateDropdown() {
        var items = filterItems(state.filterText);
        var maxIndex = getSelectableItemCount() - 1;
        
        if (state.selectedIndex > maxIndex) {
            state.selectedIndex = Math.max(0, maxIndex);
        }
        
        renderDropdown(items);
        scrollToSelected();
    }
    
    // Update just the visual selection without full re-render
    function updateDropdownSelection() {
        var $dropdown = $(config.dropdownSelector);
        $dropdown.find('.acf-bb-mention-item').removeClass('selected');
        $dropdown.find('.acf-bb-mention-item[data-index="' + state.selectedIndex + '"]').addClass('selected');
        scrollToSelected();
    }
    
    function scrollToSelected() {
        var $dropdown = $(config.dropdownSelector);
        var $selected = $dropdown.find('.acf-bb-mention-item.selected');
        
        if (!$selected.length) return;
        
        // Always use the dropdown as the scroll container (single scroll container)
        var $scrollContainer = $dropdown;
        
        if (!$scrollContainer.length) return;
        
        // Account for sticky search bar height
        var $searchBar = $dropdown.find('.acf-bb-mention-search');
        var searchBarHeight = $searchBar.length ? $searchBar.outerHeight() : 0;
        
        var padding = 8; // Add padding to ensure item is not at the very edge
        var containerTop = $scrollContainer.scrollTop();
        var containerHeight = $scrollContainer.outerHeight();
        
        // Get item position relative to its offset parent, not the viewport
        var selectedElement = $selected[0];
        var containerElement = $scrollContainer[0];
        var itemTop = selectedElement.offsetTop - containerElement.offsetTop + containerElement.scrollTop;
        var itemHeight = $selected.outerHeight();
        
        // Calculate visible range with padding, accounting for sticky search bar
        var visibleTop = containerTop + searchBarHeight + padding;
        var visibleBottom = containerTop + containerHeight - padding;
        var itemBottom = itemTop + itemHeight;
        
        // Only scroll if item is outside visible area (with padding)
        if (itemTop < visibleTop) {
            // Item is above visible area, scroll up (accounting for search bar)
            $scrollContainer.scrollTop(itemTop - searchBarHeight - padding);
        } else if (itemBottom > visibleBottom) {
            // Item is below visible area, scroll down
            $scrollContainer.scrollTop(itemBottom - containerHeight + padding);
        }
        // If item is already fully visible, don't scroll
    }

    // =========================================
    // INLINE CHIP MANAGEMENT
    // =========================================

    function createInlineChip(item) {
        var chip = document.createElement('span');
        chip.className = 'acf-bb-inline-chip';
        chip.setAttribute('contenteditable', 'false');
        chip.setAttribute('data-item-id', item.id);
        chip.setAttribute('data-item-type', item.type || 'file');
        
        // For files, also set tab-id
        if (item.tabId) {
            chip.setAttribute('data-tab-id', item.tabId);
        }
        
        // Store item data for context generation
        if (item.data) {
            chip.setAttribute('data-item-data', JSON.stringify(item.data));
        }
        
        chip.innerHTML = '<span class="dashicons dashicons-' + item.icon + '"></span>' +
                        '<span class="acf-bb-inline-chip-label">' + item.label + '</span>' +
                        '<button type="button" class="acf-bb-inline-chip-remove" tabindex="-1">' +
                        '<span class="dashicons dashicons-no-alt"></span>' +
                        '</button>';
        return chip;
    }

    function createErrorChip(errorData) {
        var chip = document.createElement('span');
        chip.className = 'acf-bb-inline-chip acf-bb-error-chip';
        chip.setAttribute('contenteditable', 'false');
        chip.setAttribute('data-chip-type', 'error');
        chip.setAttribute('data-error-count', errorData.count);
        chip.setAttribute('data-error-details', JSON.stringify(errorData.details));
        
        // Build tooltip content
        var tooltipContent = errorData.details.map(function(detail) {
            return '<strong>' + escapeHtml(detail.file) + '</strong>\\n' + 
                   detail.errors.map(function(err) {
                       return '• Line ' + err.line + ': ' + escapeHtml(err.message);
                   }).join('\\n');
        }).join('\\n\\n');
        
        chip.setAttribute('data-tooltip', tooltipContent);
        
        chip.innerHTML = '<span class="dashicons dashicons-warning"></span>' +
                        '<span class="acf-bb-inline-chip-label">' + errorData.count + ' Error' + (errorData.count !== 1 ? 's' : '') + '</span>' +
                        '<button type="button" class="acf-bb-inline-chip-remove" tabindex="-1">' +
                        '<span class="dashicons dashicons-no-alt"></span>' +
                        '</button>';
        return chip;
    }

    function escapeHtml(text) {
        var div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function insertErrorChip(errorData) {
        var $editor = $(config.editorSelector);
        var editor = $editor[0];
        
        // Clear existing content first
        $editor.empty();
        
        // Create and append the error chip
        var chip = createErrorChip(errorData);
        $editor.append(chip);
        
        // Add a space after the chip
        var space = document.createTextNode('\u00A0');
        $editor.append(space);
        
        // Add the prompt text
        var promptText = document.createTextNode('Please analyze these errors and provide the corrected code.');
        $editor.append(promptText);
        
        // Sync to textarea
        syncToTextarea();
        updateSendButton();
        
        // Focus the editor
        editor.focus();
    }

    function insertChipAtCursor(item) {
        var $editor = $(config.editorSelector);
        var editor = $editor[0];
        
        if (!state.mentionRange) return;
        
        // Restore the saved range
        var sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(state.mentionRange);
        
        // Delete the @mention text
        state.mentionRange.deleteContents();
        
        // Create and insert the chip
        var chip = createInlineChip(item);
        state.mentionRange.insertNode(chip);
        
        // Add a space after the chip and move cursor there
        var space = document.createTextNode('\u00A0'); // Non-breaking space
        chip.parentNode.insertBefore(space, chip.nextSibling);
        
        // Move cursor after the space
        var newRange = document.createRange();
        newRange.setStartAfter(space);
        newRange.collapse(true);
        sel.removeAllRanges();
        sel.addRange(newRange);
        
        // Focus the editor
        editor.focus();
        
        // Trigger input event
        $editor.trigger('input');
    }

    function getAttachedTokens() {
        var $editor = $(config.editorSelector);
        var tokens = [];
        
        $editor.find('.acf-bb-inline-chip').each(function() {
            var $chip = $(this);
            var chipType = $chip.data('chip-type');
            
            if (chipType === 'error') {
                // Error chip
                var errorDetails = $chip.data('error-details');
                tokens.push({
                    type: 'error',
                    count: $chip.data('error-count'),
                    details: typeof errorDetails === 'string' ? JSON.parse(errorDetails) : errorDetails,
                    label: $chip.find('.acf-bb-inline-chip-label').text()
                });
            } else {
                // Regular chip (file or WordPress data)
                var itemType = $chip.data('item-type') || 'file';
                var itemId = $chip.data('item-id') || $chip.data('file-id');
                var itemData = $chip.data('item-data');
                
                if (itemType === 'file') {
                // File chip
                var files = getAvailableFiles();
                    var file = files.find(function(f) { return f.id === itemId; });
                
                if (file) {
                    tokens.push({
                        type: 'file',
                        id: file.id,
                        label: file.label,
                        icon: file.icon,
                        tabId: file.tabId
                        });
                    }
                } else {
                    // WordPress data chip
                    tokens.push({
                        type: itemType,
                        id: itemId,
                        label: $chip.find('.acf-bb-inline-chip-label').text(),
                        data: typeof itemData === 'string' ? JSON.parse(itemData) : itemData
                    });
                }
            }
        });
        
        return tokens;
    }

    function getPlainText() {
        var $editor = $(config.editorSelector);
        if (!$editor.length) {
            return $(config.textareaSelector).val();
        }
        
        // Clone the editor content
        var $clone = $editor.clone();
        
        // Replace chips with their file references
        $clone.find('.acf-bb-inline-chip').each(function() {
            $(this).replaceWith('');
        });
        
        // Get text content
        return $clone.text().trim();
    }

    function clearEditor() {
        var $editor = $(config.editorSelector);
        $editor.empty();
        syncToTextarea();
    }

    function syncToTextarea() {
        var $textarea = $(config.textareaSelector);
        var text = getPlainText();
        $textarea.val(text);
    }

    // =========================================
    // CONTEXT BUILDING
    // =========================================

    function getFileContent(tabId) {
        if (config.editorsGetter && typeof config.editorsGetter === 'function') {
            var editors = config.editorsGetter();
            if (editors && editors[tabId]) {
                return editors[tabId].getValue();
            }
        }
        
        var $textarea = $('#textarea-' + tabId);
        if ($textarea.length) {
            return $textarea.val();
        }
        
        return null;
    }

    function getContextString() {
        var tokens = getAttachedTokens();
        
        if (tokens.length === 0) {
            return '';
        }
        
        var context = '';
        var hasFiles = tokens.some(function(t) { return t.type === 'file'; });
        var hasErrors = tokens.some(function(t) { return t.type === 'error'; });
        var hasWPData = tokens.some(function(t) { 
            return ['post_type', 'taxonomy', 'field_group', 'field', 'field_type'].indexOf(t.type) !== -1;
        });
        
        // Handle error tokens
        if (hasErrors) {
            context += '[CODE ERRORS TO FIX]\n\n';
            tokens.forEach(function(token) {
                if (token.type === 'error' && token.details) {
                    token.details.forEach(function(detail) {
                        context += '**' + detail.file + ':**\n';
                        detail.errors.forEach(function(err) {
                            context += '- Line ' + err.line + ': ' + err.message + '\n';
                        });
                        context += '\n';
                    });
                }
            });
            context += '[END CODE ERRORS]\n\n';
        }
        
        // Handle WordPress data tokens
        if (hasWPData) {
            context += '[WORDPRESS DATA - Schema/structure information for context]\n\n';
            
            tokens.forEach(function(token) {
                if (token.type === 'post_type') {
                    context += formatPostTypeContext(token.data);
                } else if (token.type === 'taxonomy') {
                    context += formatTaxonomyContext(token.data);
                } else if (token.type === 'field_group') {
                    context += formatFieldGroupContext(token.data);
                } else if (token.type === 'field') {
                    context += formatFieldContext(token.data);
                } else if (token.type === 'field_type') {
                    context += formatFieldTypeContext(token.data, token.label);
                }
            });
            
            context += '[END WORDPRESS DATA]\n\n';
        }
        
        // Handle file tokens
        if (hasFiles) {
            context += '[ATTACHED FILES - User has referenced these files for context]\n\n';
        }
        
        tokens.forEach(function(token) {
            if (token.type !== 'file') return;
            
            var content = getFileContent(token.tabId);
            
            context += '--- ' + token.label + ' ---\n';
            if (content) {
                context += content + '\n';
            } else {
                context += '(File content not available)\n';
            }
            context += '\n';
        });
        
        if (hasFiles) {
            context += '[END ATTACHED FILES]\n\n';
        }
        
        return context;
    }
    
    function formatPostTypeContext(postType) {
        var context = '[POST TYPE: ' + postType.label + ']\n';
        context += '- Slug: ' + postType.id + '\n';
        context += '- Hierarchical: ' + (postType.hierarchical ? 'Yes' : 'No') + '\n';
        
        if (postType.supports && postType.supports.length > 0) {
            context += '- Supports: ' + postType.supports.join(', ') + '\n';
        }
        
        if (postType.taxonomies && postType.taxonomies.length > 0) {
            context += '- Taxonomies: ' + postType.taxonomies.join(', ') + '\n';
        }
        
        if (postType.description) {
            context += '- Description: ' + postType.description + '\n';
        }
        
        context += '\n';
        return context;
    }
    
    function formatTaxonomyContext(taxonomy) {
        var context = '[TAXONOMY: ' + taxonomy.label + ']\n';
        context += '- Slug: ' + taxonomy.id + '\n';
        context += '- Hierarchical: ' + (taxonomy.hierarchical ? 'Yes' : 'No') + '\n';
        
        if (taxonomy.postTypes && taxonomy.postTypes.length > 0) {
            context += '- Used by Post Types: ' + taxonomy.postTypes.join(', ') + '\n';
        }
        
        if (taxonomy.description) {
            context += '- Description: ' + taxonomy.description + '\n';
        }
        
        context += '\n';
        return context;
    }
    
    function formatFieldGroupContext(group) {
        var context = '[ACF FIELD GROUP: ' + group.title + ']\n';
        
        if (group.description) {
            context += '- Description: ' + group.description + '\n';
        }
        
        if (group.locationDescription) {
            context += '- Location: ' + group.locationDescription + '\n';
        }
        
        if (group.fields && group.fields.length > 0) {
            context += '- Fields:\n';
            group.fields.forEach(function(field) {
                context += '  • ' + field.label + ' (' + field.name + ') - Type: ' + field.type + '\n';
            });
        }
        
        context += '\n';
        return context;
    }
    
    function formatFieldContext(field) {
        var context = '[ACF FIELD: ' + field.label + ']\n';
        context += '- Name: ' + field.name + '\n';
        context += '- Type: ' + field.type + '\n';
        context += '- Parent Group: ' + field.parentTitle + '\n';
        context += '- Required: ' + (field.required ? 'Yes' : 'No') + '\n';
        
        if (field.instructions) {
            context += '- Instructions: ' + field.instructions + '\n';
        }
        
        if (field.settings && Object.keys(field.settings).length > 0) {
            context += '- Settings:\n';
            for (var key in field.settings) {
                var value = field.settings[key];
                if (Array.isArray(value)) {
                    if (key === 'sub_fields') {
                        context += '  • ' + key + ':\n';
                        value.forEach(function(subField) {
                            context += '    - ' + subField.label + ' (' + subField.name + ') - ' + subField.type + '\n';
                        });
                    } else {
                        context += '  • ' + key + ': ' + value.join(', ') + '\n';
                    }
                } else if (typeof value === 'object') {
                    context += '  • ' + key + ': ' + JSON.stringify(value) + '\n';
                } else {
                    context += '  • ' + key + ': ' + value + '\n';
                }
            }
        }
        
        context += '\n';
        return context;
    }

    function formatFieldTypeContext(data, label) {
        var context = '[ACF FIELD TYPE: ' + label + ']\n';
        if (data && data.description) {
            context += '- Description: ' + data.description + '\n';
        }
        context += '\n';
        return context;
    }

    // =========================================
    // INPUT HANDLING
    // =========================================

    function findMentionContext() {
        var sel = window.getSelection();
        if (!sel.rangeCount) return null;
        
        var range = sel.getRangeAt(0);
        var container = range.startContainer;
        
        // Only handle text nodes
        if (container.nodeType !== Node.TEXT_NODE) return null;
        
        var text = container.textContent;
        var cursorPos = range.startOffset;
        var textBeforeCursor = text.substring(0, cursorPos);
        
        // Find the last @ before cursor
        var lastAtPos = textBeforeCursor.lastIndexOf('@');
        
        if (lastAtPos === -1) return null;
        
        var textAfterAt = textBeforeCursor.substring(lastAtPos + 1);
        
        // If there's a space or newline, we're not in a mention
        if (textAfterAt.indexOf(' ') !== -1 || textAfterAt.indexOf('\n') !== -1) {
            return null;
        }
        
        // Create a range for the @mention text
        var mentionRange = document.createRange();
        mentionRange.setStart(container, lastAtPos);
        mentionRange.setEnd(container, cursorPos);
        
        return {
            filterText: textAfterAt,
            range: mentionRange
        };
    }

    function handleInput(e) {
        var mentionContext = findMentionContext();
        
        if (mentionContext) {
            var previousFilterText = state.filterText;
            state.filterText = mentionContext.filterText;
            state.mentionRange = mentionContext.range;
            
            // If user started typing a filter, exit category detail view
            if (state.filterText && state.filterText !== previousFilterText) {
                state.currentCategory = null;
            }
            
            if (!state.isDropdownOpen) {
                showDropdown();
            } else {
                updateDropdown();
            }
        } else {
            if (state.isDropdownOpen) {
                hideDropdown();
            }
        }
        
        // Sync to hidden textarea
        syncToTextarea();
        
        // Update send button state
        updateSendButton();
    }

    function handleKeydown(e) {
        var $editor = $(config.editorSelector);
        
        // Handle backspace to delete chips
        if (e.key === 'Backspace') {
            var sel = window.getSelection();
            if (sel.rangeCount) {
                var range = sel.getRangeAt(0);
                if (range.collapsed) {
                    // Check if cursor is right after a chip
                    var prevSibling = range.startContainer.previousSibling;
                    if (range.startOffset === 0 && prevSibling && $(prevSibling).hasClass('acf-bb-inline-chip')) {
                        e.preventDefault();
                        $(prevSibling).remove();
                        syncToTextarea();
                        updateSendButton();
                        return;
                    }
                    
                    // Check if we're in a text node right after a chip
                    if (range.startContainer.nodeType === Node.TEXT_NODE && range.startOffset === 0) {
                        var prev = range.startContainer.previousSibling;
                        if (prev && $(prev).hasClass('acf-bb-inline-chip')) {
                            e.preventDefault();
                            $(prev).remove();
                            syncToTextarea();
                            updateSendButton();
                            return;
                        }
                    }
                }
            }
        }
        
        if (!state.isDropdownOpen) {
            // Handle Enter to submit (without shift)
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                $('#acf-block-builder-generate').click();
            }
            return;
        }
        
        var items = filterItems(state.filterText);
        var maxIndex = getSelectableItemCount() - 1;
        
        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                state.selectedIndex = Math.min(state.selectedIndex + 1, maxIndex);
                updateDropdown();
                break;
                
            case 'ArrowUp':
                e.preventDefault();
                state.selectedIndex = Math.max(state.selectedIndex - 1, 0);
                updateDropdown();
                break;
                
            case 'ArrowRight':
                // Enter folder if a folder is selected
                var $selected = $(config.dropdownSelector).find('.acf-bb-mention-item.selected');
                if ($selected.hasClass('acf-bb-mention-folder')) {
                    e.preventDefault();
                    var categoryKey = $selected.data('category-key');
                    if (categoryKey) {
                        state.currentCategory = categoryKey;
                        state.selectedIndex = 0;
                        updateDropdown();
                    }
                }
                break;
                
            case 'ArrowLeft':
                // Go back if in category detail view
                if (state.currentCategory) {
                    e.preventDefault();
                    state.currentCategory = null;
                    state.selectedIndex = 0;
                    updateDropdown();
                }
                break;
                
            case 'Enter':
            case 'Tab':
                e.preventDefault();
                var $selected = $(config.dropdownSelector).find('.acf-bb-mention-item.selected');
                
                // Handle back button
                if ($selected.data('action') === 'back') {
                    state.currentCategory = null;
                    state.selectedIndex = 0;
                    updateDropdown();
                    return;
                }
                
                // Handle folder navigation
                if ($selected.hasClass('acf-bb-mention-folder')) {
                    var categoryKey = $selected.data('category-key');
                    if (categoryKey) {
                        state.currentCategory = categoryKey;
                        state.selectedIndex = 0;
                        updateDropdown();
                    }
                    return;
                }
                
                // Handle regular item selection
                var itemId = $selected.data('item-id');
                if (itemId) {
                    var item = items.find(function(i) { return i.id === itemId; });
                    if (item) {
                        selectItem(item);
                    }
                }
                break;
                
            case 'Escape':
                e.preventDefault();
                // If in category, go back first
                if (state.currentCategory) {
                    state.currentCategory = null;
                    state.selectedIndex = 0;
                    updateDropdown();
                } else {
                    hideDropdown();
                }
                break;
        }
    }

    function selectItem(item) {
        insertChipAtCursor(item);
        hideDropdown();
        updateSendButton();
    }

    function updateSendButton() {
        // If in stop mode (generating), do not interfere
        if ($('#acf-block-builder-generate').hasClass('acf-bb-stop-mode')) {
            return;
        }
        var hasContent = getPlainText().length > 0 || getAttachedTokens().length > 0;
        var hasImage = $('#acf_block_builder_image_id').val().length > 0;
        $('#acf-block-builder-generate').prop('disabled', !hasContent && !hasImage);
    }

    // =========================================
    // EVENT HANDLERS
    // =========================================

    function initEventHandlers() {
        var $editor = $(config.editorSelector);
        
        // Input handler
        $editor.on('input', handleInput);
        
        // Keydown handler
        $editor.on('keydown', handleKeydown);
        
        // Paste handler - strip formatting
        $editor.on('paste', function(e) {
            e.preventDefault();
            var text = (e.originalEvent.clipboardData || window.clipboardData).getData('text/plain');
            document.execCommand('insertText', false, text);
        });
        
        // Focus/blur for placeholder
        $editor.on('focus', function() {
            $(this).addClass('focused');
        }).on('blur', function() {
            $(this).removeClass('focused');
        });
        
        // Click on dropdown item
        $(document).on('click', '.acf-bb-mention-item', function(e) {
            e.preventDefault();
            e.stopPropagation();
            
            var $this = $(this);
            
            // Handle back button
            if ($this.data('action') === 'back') {
                state.currentCategory = null;
                state.selectedIndex = 0;
                updateDropdown();
                return;
            }
            
            // Handle folder navigation
            if ($this.hasClass('acf-bb-mention-folder')) {
                var categoryKey = $this.data('category-key');
                if (categoryKey) {
                    state.currentCategory = categoryKey;
                    state.selectedIndex = 0;
                    updateDropdown();
                }
                return;
            }
            
            // Handle regular item selection
            var itemId = $this.data('item-id');
            var items = getAvailableItems();
            var item = items.find(function(i) { return i.id === itemId; });
            
            if (item) {
                selectItem(item);
            }
        });
        
        // Hover on dropdown item (disabled during scrolling to prevent jump-back)
        $(document).on('mouseenter', '.acf-bb-mention-item', function() {
            if (state.isScrolling) return; // Don't update selection while scrolling
            
            var index = parseInt($(this).data('index'), 10);
            if (!isNaN(index) && index !== state.selectedIndex) {
                state.selectedIndex = index;
                // Just update visual selection without scrolling
                $(config.dropdownSelector).find('.acf-bb-mention-item').removeClass('selected');
                $(this).addClass('selected');
            }
        });
        
        // Search input in dropdown - typing updates filter
        $(document).on('input', '.acf-bb-mention-search-input', function(e) {
            var newValue = $(this).val();
            state.filterText = newValue;
            state.currentCategory = null; // Exit category view when searching
            state.selectedIndex = 0;
            
            // Re-render dropdown but preserve focus on input
            var items = filterItems(state.filterText);
            renderDropdown(items);
            
            // Restore focus to search input and cursor position
            var $input = $(config.dropdownSelector).find('.acf-bb-mention-search-input');
            $input.focus();
            // Set cursor at end
            var val = $input.val();
            $input[0].setSelectionRange(val.length, val.length);
        });
        
        // Search input keydown - handle navigation
        $(document).on('keydown', '.acf-bb-mention-search-input', function(e) {
            var maxIndex = getSelectableItemCount() - 1;
            var items = filterItems(state.filterText);
            
            switch (e.key) {
                case 'ArrowDown':
                    e.preventDefault();
                    state.selectedIndex = Math.min(state.selectedIndex + 1, maxIndex);
                    updateDropdownSelection();
                    break;
                    
                case 'ArrowUp':
                    e.preventDefault();
                    state.selectedIndex = Math.max(state.selectedIndex - 1, 0);
                    updateDropdownSelection();
                    break;
                    
                case 'Enter':
                case 'Tab':
                    e.preventDefault();
                    var $selected = $(config.dropdownSelector).find('.acf-bb-mention-item.selected');
                    
                    // Handle back button
                    if ($selected.data('action') === 'back') {
                        state.currentCategory = null;
                        state.selectedIndex = 0;
                        updateDropdown();
                        $(config.dropdownSelector).find('.acf-bb-mention-search-input').focus();
                        return;
                    }
                    
                    // Handle folder navigation
                    if ($selected.hasClass('acf-bb-mention-folder')) {
                        var categoryKey = $selected.data('category-key');
                        if (categoryKey) {
                            state.currentCategory = categoryKey;
                            state.selectedIndex = 0;
                            updateDropdown();
                            $(config.dropdownSelector).find('.acf-bb-mention-search-input').focus();
                        }
                        return;
                    }
                    
                    // Handle regular item selection
                    var itemId = $selected.data('item-id');
                    if (itemId) {
                        var item = items.find(function(i) { return i.id === itemId; });
                        if (item) {
                            selectItem(item);
                        }
                    }
                    break;
                    
                case 'Escape':
                    e.preventDefault();
                    if (state.currentCategory) {
                        state.currentCategory = null;
                        state.selectedIndex = 0;
                        updateDropdown();
                        $(config.dropdownSelector).find('.acf-bb-mention-search-input').focus();
                    } else {
                        hideDropdown();
                        $(config.editorSelector).focus();
                    }
                    break;
                    
                case 'ArrowRight':
                    var $selected = $(config.dropdownSelector).find('.acf-bb-mention-item.selected');
                    if ($selected.hasClass('acf-bb-mention-folder')) {
                        e.preventDefault();
                        var categoryKey = $selected.data('category-key');
                        if (categoryKey) {
                            state.currentCategory = categoryKey;
                            state.selectedIndex = 0;
                            updateDropdown();
                            $(config.dropdownSelector).find('.acf-bb-mention-search-input').focus();
                        }
                    }
                    break;
                    
                case 'ArrowLeft':
                    if (state.currentCategory && $(this).val() === '') {
                        e.preventDefault();
                        state.currentCategory = null;
                        state.selectedIndex = 0;
                        updateDropdown();
                        $(config.dropdownSelector).find('.acf-bb-mention-search-input').focus();
                    }
                    break;
            }
        });
        
        // Prevent dropdown from closing when clicking search input
        $(document).on('click', '.acf-bb-mention-search-input', function(e) {
            e.stopPropagation();
        });
        
        // Remove chip button
        $(document).on('click', '.acf-bb-inline-chip-remove', function(e) {
            e.preventDefault();
            e.stopPropagation();
            
            var $chip = $(this).closest('.acf-bb-inline-chip');
            $chip.remove();
            syncToTextarea();
            updateSendButton();
            
            $(config.editorSelector).focus();
        });
        
        // Click on chip to open file (only for file type chips)
        $(document).on('click', '.acf-bb-inline-chip', function(e) {
            if ($(e.target).closest('.acf-bb-inline-chip-remove').length) {
                return;
            }
            
            var itemType = $(this).data('item-type') || 'file';
            
            // Only file chips are clickable to open tabs
            if (itemType === 'file') {
            var tabId = $(this).data('tab-id');
            if (tabId && window.SmartTokens && window.SmartTokens.switchToTab) {
                window.SmartTokens.switchToTab(tabId);
                }
            }
        });
        
        // Close dropdown when clicking outside
        $(document).on('click', function(e) {
            if (!$(e.target).closest(config.dropdownSelector).length &&
                !$(e.target).closest(config.editorSelector).length) {
                hideDropdown();
            }
        });
        
        // Window resize - debounced to prevent jumping
        var resizeTimeout;
        $(window).on('resize', function() {
            if (state.isDropdownOpen) {
                clearTimeout(resizeTimeout);
                resizeTimeout = setTimeout(function() {
                positionDropdown();
                }, 100);
            }
        });
        
        // Prevent parent scroll when dropdown scrolls and track scrolling state
        var scrollTimeout;
        $(document).on('wheel', '.acf-bb-mention-dropdown', function(e) {
            var $this = $(this);
            var scrollTop = $this.scrollTop();
            var scrollHeight = $this.prop('scrollHeight');
            var height = $this.outerHeight();
            var delta = e.originalEvent.deltaY;
            
            // Set scrolling state to prevent mouseenter from updating selection
            state.isScrolling = true;
            clearTimeout(scrollTimeout);
            scrollTimeout = setTimeout(function() {
                state.isScrolling = false;
            }, 150);
            
            // Prevent parent scroll when at boundaries
            if ((delta < 0 && scrollTop === 0) || (delta > 0 && scrollTop + height >= scrollHeight)) {
                e.preventDefault();
            }
            
            e.stopPropagation();
        });
        
        // Mention files button
        $('#acf-bb-mention-files').off('click').on('click', function(e) {
            e.preventDefault();
            
            var editor = $(config.editorSelector)[0];
            var $editor = $(editor);
            
            // Focus the editor first
            editor.focus();
            
            // Small delay to ensure focus is complete
            setTimeout(function() {
                // Get current selection
                var sel = window.getSelection();
                if (sel.rangeCount > 0) {
                    // Insert @ at cursor
                    var range = sel.getRangeAt(0);
                    var textNode = document.createTextNode('@');
                    range.insertNode(textNode);
                    
                    // Move cursor after the @
                    // We set it INSIDE the text node so findMentionContext can detect it properly
                    range.setStart(textNode, 1);
                    range.setEnd(textNode, 1);
                    sel.removeAllRanges();
                    sel.addRange(range);
                    
                    // Trigger input event which will detect the @ and show dropdown
                    var inputEvent = new Event('input', { bubbles: true, cancelable: true });
                    editor.dispatchEvent(inputEvent);
                }
            }, 10);
        });
        
        // Handle mode switching placeholder
        $('.acf-bb-mode-btn').on('click', function() {
            var mode = $(this).data('mode');
            var $editor = $(config.editorSelector);
            
            if (mode === 'agent') {
                $editor.attr('data-placeholder', $editor.attr('data-placeholder-agent'));
            } else {
                $editor.attr('data-placeholder', $editor.attr('data-placeholder-ask'));
            }
        });
    }

    // =========================================
    // PUBLIC API
    // =========================================

    function init(options) {
        if (options) {
            if (options.textareaSelector) config.textareaSelector = options.textareaSelector;
            if (options.editorsGetter) config.editorsGetter = options.editorsGetter;
        }
        
        setupContentEditable();
        initEventHandlers();
        
        // Pre-fetch WordPress data so it's ready when dropdown opens
        fetchWordPressData();
    }

    function clearAttached() {
        clearEditor();
    }

    function isTokenAttached(itemId) {
        var tokens = getAttachedTokens();
        return tokens.some(function(t) { return t.id === itemId; });
    }

    function attachToken(itemId) {
        var items = getAvailableItems();
        var item = items.find(function(i) { return i.id === itemId; });
        if (!item) return false;
        
        var $editor = $(config.editorSelector);
        var chip = createInlineChip(item);
        
        // Append chip and space
        $editor.append(chip);
        $editor.append(document.createTextNode('\u00A0'));
        
        syncToTextarea();
        updateSendButton();
        return true;
    }

    function detachToken(itemId) {
        var $editor = $(config.editorSelector);
        var $chip = $editor.find('.acf-bb-inline-chip[data-item-id="' + itemId + '"]');
        
        // Also check old data-file-id attribute for backwards compatibility
        if (!$chip.length) {
            $chip = $editor.find('.acf-bb-inline-chip[data-file-id="' + itemId + '"]');
        }
        
        if ($chip.length) {
            $chip.remove();
            syncToTextarea();
            updateSendButton();
            return true;
        }
        return false;
    }

    // =========================================
    // EXPOSE PUBLIC API
    // =========================================

    window.MentionAutocomplete = {
        init: init,
        getAttachedTokens: getAttachedTokens,
        getContextString: getContextString,
        getPlainText: getPlainText,
        clearAttached: clearAttached,
        attachToken: attachToken,
        detachToken: detachToken,
        isTokenAttached: isTokenAttached,
        insertErrorChip: insertErrorChip
    };

})(jQuery);
