jQuery(document).ready(function($) {
    var editors = {};
    var currentAbortController = null;
    var chatHistory = [];
    var diffEditor = null;
    var pendingAIChanges = {};
    var availableModels = [];
    var selectedModel = '';
    
    // Model picker storage key
    var MODEL_STORAGE_KEY = 'acf_block_builder_selected_model';
    
    // Load existing history
    var rawHistoryVal = '';
    try {
        rawHistoryVal = $('#acf_block_builder_chat_history').val();
        if (rawHistoryVal) {
            chatHistory = JSON.parse(rawHistoryVal);
        }
    } catch(e) { 
        console.error('Error parsing chat history', e);
        console.log('Raw history value:', rawHistoryVal);
    }
    
    // Initialize model picker
    function initModelPicker() {
        var $select = $('#acf_block_builder_model');
        
        $.ajax({
            url: acfBlockBuilder.ajax_url,
            type: 'POST',
            data: {
                action: 'acf_block_builder_get_models',
                nonce: acfBlockBuilder.nonce
            },
            success: function(response) {
                if (response.success && response.data) {
                    availableModels = response.data;
                    populateModelPicker(availableModels);
                    // Update initial welcome avatar after models are loaded
                    updateInitialWelcomeAvatar();
                } else {
                    $select.html('<option value="">No models available</option>');
                    $select.prop('disabled', true);
                }
            },
            error: function() {
                $select.html('<option value="">Error loading models</option>');
                $select.prop('disabled', true);
            }
        });
    }
    
    function populateModelPicker(models) {
        var $select = $('#acf_block_builder_model');
        var savedModel = localStorage.getItem(MODEL_STORAGE_KEY);
        var html = '';
        
        // Group models by provider
        var groupedModels = {};
        models.forEach(function(model) {
            if (!groupedModels[model.provider]) {
                groupedModels[model.provider] = [];
            }
            groupedModels[model.provider].push(model);
        });
        
        // Build hidden select (for form submission)
        $.each(groupedModels, function(provider, providerModels) {
            html += '<optgroup label="' + (providerNames[provider] || provider) + '">';
            providerModels.forEach(function(model) {
                var isSelected = (savedModel === model.id) ? ' selected' : '';
                html += '<option value="' + model.id + '"' + isSelected + '>' + model.name + '</option>';
            });
            html += '</optgroup>';
        });
        
        $select.html(html);
        
        // Set selected model
        if (savedModel && models.some(function(m) { return m.id === savedModel; })) {
            selectedModel = savedModel;
        } else if (models.length > 0) {
            selectedModel = models[0].id;
        }
        
        $select.val(selectedModel);
        
        // Update welcome avatar to match the selected model
        var provider = getProviderFromModel(selectedModel);
        updateWelcomeAvatar(provider);
        
        // Update model display in header
        updateModelDisplay();
    }
    
    // Helper function to get provider from model ID
    function getProviderFromModel(modelId) {
        if (!modelId) return null;
        
        // Find the model in availableModels array
        var model = availableModels.find(function(m) { return m.id === modelId; });
        return model ? model.provider : null;
    }
    
    // Helper function to update welcome message avatar
    function updateWelcomeAvatar(provider) {
        var $welcomeMessage = $('#acf-bb-chat-messages .acf-bb-message:first');
        if ($welcomeMessage.length && $welcomeMessage.hasClass('ai-message')) {
            var $avatar = $welcomeMessage.find('.acf-bb-avatar');
            
            if (provider) {
                $avatar.html('<img src="' + acfBlockBuilder.plugin_url + 'assets/images/' + provider + '.svg" alt="' + provider + '" />')
                    .removeClass('acf-bb-avatar-openai acf-bb-avatar-anthropic acf-bb-avatar-gemini')
                    .addClass('acf-bb-avatar-' + provider);
            } else {
                // Fallback to default icon
                $avatar.html('<span class="dashicons dashicons-superhero"></span>')
                    .removeClass('acf-bb-avatar-openai acf-bb-avatar-anthropic acf-bb-avatar-gemini');
            }
        }
    }
    
    // Handle model selection change
    $('#acf_block_builder_model').on('change', function() {
        selectedModel = $(this).val();
        localStorage.setItem(MODEL_STORAGE_KEY, selectedModel);
        
        // Update the welcome message avatar based on selected model
        var provider = getProviderFromModel(selectedModel);
        updateWelcomeAvatar(provider);
        
        // Update model display
        updateModelDisplay();
    });
    
    // Initialize model picker on page load
    initModelPicker();
    
    // ==========================================
    // NEW UI HANDLERS
    // ==========================================
    
    // Mode Switcher
    var currentMode = 'agent'; // 'agent' or 'ask'
    
    $('.acf-bb-mode-btn').on('click', function() {
        var mode = $(this).data('mode');
        currentMode = mode;
        
        // Update button states
        $('.acf-bb-mode-btn').removeClass('active');
        $(this).addClass('active');
        
        // Update hidden field
        $('#acf_block_builder_mode').val(mode);
        
        // Update body class for conditional styling
        $('body').toggleClass('acf-bb-ask-mode', mode === 'ask');
        
        // Update placeholder
        var $textarea = $('#acf_block_builder_prompt');
        if (mode === 'agent') {
            $textarea.attr('placeholder', $textarea.data('placeholder-agent'));
        } else {
            $textarea.attr('placeholder', $textarea.data('placeholder-ask'));
        }
    });
    
    // Provider icons mapping
    var providerIcons = {
        'openai': acfBlockBuilder.plugin_url + 'assets/images/openai.svg',
        'anthropic': acfBlockBuilder.plugin_url + 'assets/images/anthropic.svg',
        'gemini': acfBlockBuilder.plugin_url + 'assets/images/gemini.svg'
    };
    
    var providerNames = {
        'anthropic': 'Anthropic',
        'gemini': 'Google Gemini',
        'openai': 'OpenAI'
    };
    
    // Build custom dropdown with icons
    function buildModelDropdown() {
        if (!availableModels.length) return;
        
        var $dropdown = $('#acf-bb-model-dropdown');
        $dropdown.empty();
        
        // Group models by provider
        var groupedModels = {};
        availableModels.forEach(function(model) {
            if (!groupedModels[model.provider]) {
                groupedModels[model.provider] = [];
            }
            groupedModels[model.provider].push(model);
        });
        
        // Build dropdown HTML
        $.each(groupedModels, function(provider, models) {
            // Provider header
            $dropdown.append(
                '<div class="acf-bb-dropdown-group-label">' + 
                (providerNames[provider] || provider) + 
                '</div>'
            );
            
            // Model options
            models.forEach(function(model) {
                var isSelected = model.id === selectedModel;
                var $option = $('<div class="acf-bb-dropdown-option' + (isSelected ? ' selected' : '') + '" data-model-id="' + model.id + '">' +
                    '<img class="acf-bb-option-icon" src="' + providerIcons[provider] + '" alt="' + provider + '" />' +
                    '<span class="acf-bb-option-name">' + model.name + '</span>' +
                    (isSelected ? '<span class="acf-bb-option-check dashicons dashicons-yes"></span>' : '') +
                    '</div>');
                $dropdown.append($option);
            });
        });
    }
    
    // Model Dropdown Toggle
    $('#acf-bb-model-trigger').on('click', function(e) {
        e.stopPropagation();
        var $dropdown = $('#acf-bb-model-dropdown');
        var $trigger = $(this);
        
        if ($dropdown.is(':visible')) {
            $dropdown.hide();
        } else {
            buildModelDropdown();
            
            // Positioning Logic: Check if it fits below
            $dropdown.css({ 'display': 'block', 'visibility': 'hidden' }); // Show momentarily to measure
            
            var dropdownHeight = $dropdown.outerHeight();
            var triggerRect = $trigger[0].getBoundingClientRect();
            var windowHeight = $(window).height();
            
            // Space below the trigger
            var spaceBelow = windowHeight - triggerRect.bottom;
            
            if (spaceBelow < dropdownHeight && spaceBelow < triggerRect.top) {
                // If not enough space below AND there is more space above (or just go up if below is tight)
                // Actually, just checking if it fits below is usually enough to decide to flip, 
                // but checking if top has more space is safer. 
                // Let's just flip if it doesn't fit below.
                
                $dropdown.css({
                    'top': 'auto',
                    'bottom': '100%',
                    'margin-top': '0',
                    'margin-bottom': '4px',
                    'visibility': 'visible'
                });
            } else {
                // Fits below or nowhere better
                $dropdown.css({
                    'top': '100%',
                    'bottom': 'auto',
                    'margin-top': '4px',
                    'margin-bottom': '0',
                    'visibility': 'visible'
                });
            }
        }
    });
    
    // Handle model selection from dropdown
    $(document).on('click', '.acf-bb-dropdown-option', function() {
        var modelId = $(this).data('model-id');
        selectedModel = modelId;
        localStorage.setItem(MODEL_STORAGE_KEY, selectedModel);
        
        // Update hidden select
        $('#acf_block_builder_model').val(modelId);
        
        // Update display
        updateModelDisplay();
        
        // Update welcome avatar
        var provider = getProviderFromModel(selectedModel);
        updateWelcomeAvatar(provider);
        
        // Close dropdown
        $('#acf-bb-model-dropdown').hide();
    });
    
    // Close dropdown when clicking outside
    $(document).on('click', function(e) {
        if (!$(e.target).closest('.acf-bb-model-selector').length) {
            $('#acf-bb-model-dropdown').hide();
        }
    });
    
    // Update model display when selection changes
    function updateModelDisplay() {
        if (!selectedModel || !availableModels.length) return;
        
        var model = availableModels.find(function(m) { return m.id === selectedModel; });
        if (!model) return;
        
        var provider = model.provider;
        
        var $trigger = $('#acf-bb-model-trigger');
        $trigger.find('.acf-bb-model-name').text(model.name);
        
        // Update icon
        var $icon = $trigger.find('.acf-bb-model-icon');
        if (providerIcons[provider]) {
            $icon.css('background-image', 'url(' + providerIcons[provider] + ')')
                .css('background-size', 'cover')
                .css('background-position', 'center');
        }
    }
    
    // Enable/Disable Send Button - now handled by MentionAutocomplete for contenteditable
    // Fallback for textarea if MentionAutocomplete not loaded
    $('#acf_block_builder_prompt').on('input', function() {
        if (window.MentionAutocomplete) return; // Let MentionAutocomplete handle it
        
        // If in stop mode (generating), do not interfere
        if ($('#acf-block-builder-generate').hasClass('acf-bb-stop-mode')) {
            return;
        }
        
        var hasText = $(this).val().trim().length > 0;
        var hasImage = $('#acf_block_builder_image_id').val().length > 0;
        $('#acf-block-builder-generate').prop('disabled', !hasText && !hasImage);
    });
    
    // Mention Files Button - handled by MentionAutocomplete module

    // Remove attachment
    $(document).on('click', '.acf-bb-remove-attachment', function() {
        $('#acf_block_builder_image_id').val('');
        $('#acf-bb-image-preview-mini').hide().html('');
        $('#acf-bb-upload-image').removeClass('active');
        // Update send button state
        
        // If in stop mode (generating), do not interfere
        if ($('#acf-block-builder-generate').hasClass('acf-bb-stop-mode')) {
            return;
        }

        var hasText = $('#acf_block_builder_prompt').val().trim().length > 0;
        $('#acf-block-builder-generate').prop('disabled', !hasText);
    });

    // Clear Chat History button handler
    $(document).on('click', '#acf-bb-clear-history', function(e) {
        e.preventDefault();
        if (confirm('This will clear all chat history. Continue?')) {
            $('#acf_block_builder_chat_history').val('[]');
            chatHistory = [];
            $('#acf-bb-chat-messages').empty();
            
            // Show welcome message with provider avatar
            var provider = getProviderFromModel(selectedModel);
            var avatarHtml = '';
            
            if (provider) {
                avatarHtml = '<div class="acf-bb-avatar acf-bb-avatar-' + provider + '"><img src="' + acfBlockBuilder.plugin_url + 'assets/images/' + provider + '.svg" alt="' + provider + '" /></div>';
            } else {
                avatarHtml = '<div class="acf-bb-avatar"><span class="dashicons dashicons-superhero"></span></div>';
            }
            
            var welcomeHtml = '<div class="acf-bb-message ai-message">' +
                avatarHtml +
                '<div class="acf-bb-message-content">Hello! Describe the block you want to build, or upload a reference image.</div>' +
                '</div>';
            $('#acf-bb-chat-messages').append(welcomeHtml);
        }
    });

    // ==========================================
    // ERROR CHIP POPOVER
    // ==========================================
    
    // Create popover element
    var $errorPopover = $('<div class="acf-bb-error-popover"></div>').appendTo('body');
    var popoverHideTimeout = null;
    
    function showErrorPopover($chip) {
        var tooltip = $chip.data('tooltip');
        if (!tooltip) return;
        
        // Parse tooltip content and build HTML
        var lines = tooltip.split('\n');
        var html = '<div class="acf-bb-error-popover-title"><span class="dashicons dashicons-warning"></span> Code Errors</div>';
        
        var currentFile = null;
        var errorList = [];
        
        lines.forEach(function(line) {
            line = line.trim();
            if (!line) return;
            
            if (line.startsWith('<strong>')) {
                // It's a file name
                if (currentFile && errorList.length) {
                    html += '<div class="acf-bb-error-popover-file">' + currentFile + '</div>';
                    html += '<ul class="acf-bb-error-popover-list">' + errorList.join('') + '</ul>';
                    errorList = [];
                }
                currentFile = line.replace(/<\/?strong>/g, '');
            } else if (line.startsWith('•')) {
                // It's an error line
                var errorText = line.substring(1).trim();
                // Highlight line numbers
                errorText = errorText.replace(/^(Line \d+):/, '<span class="acf-bb-error-popover-line">$1</span>:');
                errorList.push('<li>' + errorText + '</li>');
            }
        });
        
        // Add last file if any
        if (currentFile && errorList.length) {
            html += '<div class="acf-bb-error-popover-file">' + currentFile + '</div>';
            html += '<ul class="acf-bb-error-popover-list">' + errorList.join('') + '</ul>';
        }
        
        $errorPopover.html(html);
        
        // Position popover above the chip
        var chipOffset = $chip.offset();
        var chipWidth = $chip.outerWidth();
        var chipHeight = $chip.outerHeight();
        var popoverWidth = $errorPopover.outerWidth();
        var popoverHeight = $errorPopover.outerHeight();
        
        var left = chipOffset.left + (chipWidth / 2) - (popoverWidth / 2);
        var top = chipOffset.top - popoverHeight - 10;
        
        // Keep within viewport
        if (left < 10) left = 10;
        if (left + popoverWidth > $(window).width() - 10) {
            left = $(window).width() - popoverWidth - 10;
        }
        
        // If would go above viewport, show below instead
        if (top < 10) {
            top = chipOffset.top + chipHeight + 10;
            $errorPopover.addClass('below');
        } else {
            $errorPopover.removeClass('below');
        }
        
        $errorPopover.css({
            left: left + 'px',
            top: top + 'px'
        });
        
        clearTimeout(popoverHideTimeout);
        $errorPopover.addClass('visible');
    }
    
    function hideErrorPopover() {
        popoverHideTimeout = setTimeout(function() {
            $errorPopover.removeClass('visible');
        }, 100);
    }
    
    // Show popover on hover
    $(document).on('mouseenter', '.acf-bb-error-token-chip[data-tooltip], .acf-bb-error-chip[data-tooltip]', function() {
        showErrorPopover($(this));
    });
    
    $(document).on('mouseleave', '.acf-bb-error-token-chip[data-tooltip], .acf-bb-error-chip[data-tooltip]', function() {
        hideErrorPopover();
    });
    
    // Keep popover visible when hovering over it
    $errorPopover.on('mouseenter', function() {
        clearTimeout(popoverHideTimeout);
    }).on('mouseleave', function() {
        hideErrorPopover();
    });

    function saveChatHistory() {
        $('#acf_block_builder_chat_history').val(JSON.stringify(chatHistory));
    }

    /**
     * Auto-save post meta data to the server.
     * Called after AI changes are applied to persist code changes and chat history.
     */
    function autoSavePost() {
        // Collect all editor content
        var data = {
            action: 'acf_block_builder_auto_save',
            nonce: acfBlockBuilder.save_nonce,
            post_id: acfBlockBuilder.post_id,
            acf_block_builder_chat_history: JSON.stringify(chatHistory)
        };
        
        // Collect main editor content
        if (editors['json']) {
            data.acf_block_builder_json = editors['json'].getValue();
        }
        if (editors['php']) {
            data.acf_block_builder_php = editors['php'].getValue();
        }
        if (editors['css']) {
            data.acf_block_builder_css = editors['css'].getValue();
        }
        if (editors['js']) {
            data.acf_block_builder_js = editors['js'].getValue();
        }
        if (editors['fields']) {
            data.acf_block_builder_fields = editors['fields'].getValue();
        }
        if (editors['assets']) {
            data.acf_block_builder_assets = editors['assets'].getValue();
        }
        
        // Collect custom files
        var customFiles = {};
        Object.keys(editors).forEach(function(tabId) {
            if (tabId.startsWith('custom-')) {
                var fileId = tabId.replace('custom-', '').replace(/-/g, '_');
                var $tab = $('[data-diff-tab="' + tabId + '"]');
                var filename = $tab.text().trim().replace(/[\s\S]*?([^\s]+)$/, '$1'); // Get filename from tab
                
                // Get proper filename from the tab's data or text
                var tabFilename = $tab.find('.acf-bb-tab-name').text() || $tab.text().split('\n')[0].trim();
                
                customFiles[fileId] = {
                    filename: tabFilename,
                    content: editors[tabId].getValue()
                };
            }
        });
        
        if (Object.keys(customFiles).length > 0) {
            data.custom_files = JSON.stringify(customFiles);
        }
        
        $.ajax({
            url: acfBlockBuilder.ajax_url,
            type: 'POST',
            data: data,
            success: function(response) {
                if (response.success) {
                    // Show brief save confirmation
                    showSaveNotification('Changes saved');
                } else {
                    console.error('Auto-save failed:', response.data);
                }
            },
            error: function(xhr, status, error) {
                console.error('Auto-save error:', error);
            }
        });
    }
    
    /**
     * Show a brief notification that changes were saved.
     */
    function showSaveNotification(message) {
        var $notification = $('#acf-bb-save-notification');
        
        if (!$notification.length) {
            $notification = $('<div id="acf-bb-save-notification" class="acf-bb-save-notification"></div>');
            $('body').append($notification);
        }
        
        $notification.text(message).addClass('visible');
        
        setTimeout(function() {
            $notification.removeClass('visible');
        }, 2000);
    }

    function scrollToBottom() {
        var $chat = $('#acf-bb-chat-messages');
        if ($chat.length) {
            $chat.scrollTop($chat[0].scrollHeight);
        }
    }
    
    // Scroll on load
    scrollToBottom();

    // Enhanced Header UI
    function initEnhancedHeader() {
        if (!$('body').hasClass('post-type-acf_block_builder')) return;

        // Create Header Bar
        var $header = $('<div class="acf-bb-header-bar"></div>');
        var $inner = $('<div class="acf-bb-header-inner"></div>');
        
        // Label
        var $label = $('<div class="acf-bb-header-label">Edit Block</div>');
        if ($('body').hasClass('post-new-php')) {
            $label.text('New Block');
        }
        
        // Title Area
        var $titleArea = $('<div class="acf-bb-title-area"></div>');
        var $titleInput = $('#title');
        
        if ($titleInput.length) {
            $titleInput.attr('placeholder', 'Block Name');
            $titleArea.append($titleInput);
        }

        // Actions Area
        var $actions = $('<div class="acf-bb-header-actions"></div>');
        var $publishBtn = $('#publish');
        
        if ($publishBtn.length) {
            // Create a proxy button instead of moving the real one
            // Moving the real one out of the form breaks submission in some WP versions
            var $proxyBtn = $('<button type="button" class="button button-primary button-large acf-bb-save-button">Save Changes</button>');
            
            // Handle click
            $proxyBtn.on('click', function(e) {
                e.preventDefault();
                $(this).text('Updating...').prop('disabled', true);
                $publishBtn.click();
            });

            $actions.append($proxyBtn);
        }
        
        $inner.append($label);
        $inner.append($titleArea);
        $inner.append($actions);
        $header.append($inner);
        
        // Inject at top of wrap
        var $wrap = $('.wrap');
        if ($wrap.length) {
            $wrap.prepend($header);
            $('body').addClass('acf-bb-enhanced-ui');
        }
        
        // Cleanup original UI
        $('#title-prompt-text').hide();
        $('#titlediv').css('margin-bottom', '0').hide(); // Hide the container
        
        // Hide default headings
        $('.wp-heading-inline').hide();
        $('.page-title-action').hide();
    }

    // Run enhancement
    initEnhancedHeader();

    function appendMessage(type, content, imageUrl, skipSave, provider, attachedTokens, structuredContent) {
        var icon = type === 'ai' ? 'superhero' : 'admin-users';
        var html = '<div class="acf-bb-message ' + type + '-message">';
        
        // Use provider logo if available, otherwise fallback to dashicon
        if (type === 'ai' && provider) {
            html += '<div class="acf-bb-avatar acf-bb-avatar-' + provider + '"><img src="' + acfBlockBuilder.plugin_url + 'assets/images/' + provider + '.svg" alt="' + provider + '" /></div>';
        } else {
            html += '<div class="acf-bb-avatar"><span class="dashicons dashicons-' + icon + '"></span></div>';
        }
        
        html += '<div class="acf-bb-message-content">';
        html += content; 
        if (imageUrl) {
            html += '<div class="acf-bb-chat-image"><img src="' + imageUrl + '" alt="Reference" /></div>';
        }
        html += '</div></div>';
        
        $('#acf-bb-chat-messages').append(html);
        scrollToBottom();
        
        if (!skipSave) {
            // Store plain text only, not HTML - prevents JSON parsing issues
            var plainText = content.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
            chatHistory.push({ 
                type: type, 
                text: plainText, 
                image_url: imageUrl || null,
                provider: provider || null,
                attachedTokens: attachedTokens || null,  // Save attached tokens for restoration
                structuredContent: structuredContent || null  // Save structured content with positions
            });
            saveChatHistory();
        }
    }

    // Render chat history on page load
    var pendingHistoryEditors = []; // Store editor configs to init after Monaco loads
    
    function renderChatHistory() {
        if (!chatHistory || !chatHistory.length) return;
        
        // Remove the default welcome message if we have history
        $('#acf-bb-chat-messages').empty();
        
        var fileNames = {
            'block_json': 'block.json',
            'render_php': 'render.php',
            'style_css': 'style.css',
            'script_js': 'script.js',
            'fields_php': 'fields.php',
            'assets_php': 'assets.php'
        };
        
        var langMap = {
            'block_json': 'json',
            'render_php': 'php',
            'style_css': 'css',
            'script_js': 'javascript',
            'fields_php': 'php',
            'assets_php': 'php'
        };
        
        // Extension to language mapping for custom files
        var extToLang = {
            'php': 'php',
            'js': 'javascript',
            'css': 'css',
            'json': 'json',
            'html': 'html',
            'txt': 'plaintext'
        };
        
        // Dynamically add custom file entries from chat history
        chatHistory.forEach(function(msg) {
            if (msg.code && typeof msg.code === 'object') {
                Object.keys(msg.code).forEach(function(key) {
                    if (key.startsWith('custom_') && !fileNames[key]) {
                        // Parse custom file key (e.g., custom_readme_txt -> readme.txt)
                        var keyParts = key.replace('custom_', '').split('_');
                        var ext = keyParts.pop();
                        var baseName = keyParts.join('_').replace(/_/g, '-');
                        var filename = baseName + '.' + ext;
                        var tabId = 'custom-' + baseName + '-' + ext;
                        
                        fileNames[key] = filename;
                        langMap[key] = extToLang[ext] || 'plaintext';
                        
                        // Register with SmartTokens for clickable chips in chat
                        if (window.SmartTokens && window.SmartTokens.registerCustomFile) {
                            window.SmartTokens.registerCustomFile(filename, tabId);
                        }
                    }
                });
            }
        });
        
        chatHistory.forEach(function(msg, msgIndex) {
            var icon = msg.type === 'ai' ? 'superhero' : 'admin-users';
            var displayContent = '';
            
            // Check if we have structured content with positions preserved
            if (msg.structuredContent && msg.structuredContent.segments && msg.structuredContent.segments.length > 0) {
                // Build content from segments, preserving chip positions
                displayContent = msg.structuredContent.segments.map(function(segment) {
                    if (segment.type === 'text') {
                        return $('<div>').text(segment.content).html();
                    } else if (segment.type === 'token') {
                        var token = segment.content;
                        if (token.type === 'error') {
                            var tooltipLines = [];
                            if (token.details) {
                                token.details.forEach(function(detail) {
                                    tooltipLines.push('<strong>' + $('<div>').text(detail.file).html() + '</strong>');
                                    detail.errors.forEach(function(err) {
                                        tooltipLines.push('• Line ' + err.line + ': ' + $('<div>').text(err.message).html());
                                    });
                                });
                            }
                            return '<span class="acf-bb-token-chip acf-bb-error-token-chip" data-token-type="error" data-tooltip="' + 
                                   tooltipLines.join('\n').replace(/"/g, '&quot;') + '">' +
                                   '<span class="dashicons dashicons-warning"></span>' +
                                   '<span class="acf-bb-token-label">' + token.count + ' Error' + (token.count !== 1 ? 's' : '') + '</span></span>';
                        } else {
                            // File or other token type
                            return '<span class="acf-bb-token-chip" data-token-type="' + (token.type || 'file') + '"' +
                                   (token.tabId ? ' data-tab-id="' + token.tabId + '"' : '') +
                                   (token.id ? ' data-item-id="' + token.id + '"' : '') + '>' +
                                   '<span class="dashicons dashicons-' + (token.icon || 'media-code') + '"></span>' +
                                   '<span class="acf-bb-token-label">' + $('<div>').text(token.label).html() + '</span></span>';
                        }
                    }
                    return '';
                }).join(' ');
            } else {
                // Fallback to old format (for backwards compatibility)
                displayContent = msg.text || msg.content || '';
                
                // Regenerate "Updated:" text from code keys for consistent formatting
                if (msg.code && typeof msg.code === 'object' && displayContent.indexOf('Updated:') === 0) {
                    var updatedFiles = Object.keys(msg.code).map(function(k) {
                        if (k.startsWith('custom_')) {
                            var keyParts = k.replace('custom_', '').split('_');
                            var ext = keyParts.pop();
                            var baseName = keyParts.join('_').replace(/_/g, '-');
                            return baseName + '.' + ext;
                        }
                        return k.replace('_', '.');
                    });
                    if (updatedFiles.length > 0) {
                        displayContent = 'Updated: ' + updatedFiles.join(', ');
                    }
                }
                
                // If it's old HTML content, strip tags for clean display
                if (displayContent.indexOf('<') !== -1) {
                    displayContent = displayContent.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
                }
                
                // Escape HTML entities for safe display
                displayContent = $('<div>').text(displayContent).html();
                
                // Reconstruct attached tokens (error chips, file chips) if saved (legacy: prepend)
                var tokenChipsHtml = '';
                if (msg.attachedTokens && msg.attachedTokens.length > 0) {
                    tokenChipsHtml = msg.attachedTokens.map(function(token) {
                        if (token.type === 'error') {
                            // Build tooltip content for error chip
                            var tooltipLines = [];
                            if (token.details) {
                                token.details.forEach(function(detail) {
                                    tooltipLines.push('<strong>' + $('<div>').text(detail.file).html() + '</strong>');
                                    detail.errors.forEach(function(err) {
                                        tooltipLines.push('• Line ' + err.line + ': ' + $('<div>').text(err.message).html());
                                    });
                                });
                            }
                            return '<span class="acf-bb-token-chip acf-bb-error-token-chip" data-token-type="error" data-tooltip="' + 
                                   tooltipLines.join('\n').replace(/"/g, '&quot;') + '">' +
                                   '<span class="dashicons dashicons-warning"></span>' +
                                   '<span class="acf-bb-token-label">' + token.count + ' Error' + (token.count !== 1 ? 's' : '') + '</span></span>';
                        } else if (token.type === 'file') {
                            return '<span class="acf-bb-token-chip" data-token-type="file" data-tab-id="' + token.tabId + '">' +
                                   '<span class="dashicons dashicons-' + token.icon + '"></span>' +
                                   '<span class="acf-bb-token-label">' + token.label + '</span></span>';
                        }
                        return '';
                    }).join(' ');
                    
                    if (tokenChipsHtml) {
                        tokenChipsHtml += ' ';
                    }
                }
                
                // Prepend token chips to display content (legacy behavior)
                displayContent = tokenChipsHtml + displayContent;
            }
            
            // Process Smart Tokens (file references become clickable chips)
            if (window.SmartTokens && window.SmartTokens.processMessageContent) {
                displayContent = window.SmartTokens.processMessageContent(displayContent);
            }
            
            // Wrap in paragraph tags
            if (displayContent && !displayContent.startsWith('<p>') && !displayContent.startsWith('<span')) {
                displayContent = '<p>' + displayContent + '</p>';
            }
            
            var html = '<div class="acf-bb-message ' + msg.type + '-message">';
            
            // Use provider logo if available for AI messages
            if (msg.type === 'ai' && msg.provider) {
                html += '<div class="acf-bb-avatar acf-bb-avatar-' + msg.provider + '"><img src="' + acfBlockBuilder.plugin_url + 'assets/images/' + msg.provider + '.svg" alt="' + msg.provider + '" /></div>';
            } else {
                html += '<div class="acf-bb-avatar"><span class="dashicons dashicons-' + icon + '"></span></div>';
            }
            
            html += '<div class="acf-bb-message-content">' + displayContent;
            
            // Render code blocks if present (new format) - create Monaco containers
            if (msg.code && typeof msg.code === 'object') {
                $.each(msg.code, function(key, code) {
                    if (code && fileNames[key]) {
                        var editorId = 'history-monaco-' + msgIndex + '-' + key;
                        var lineCount = (code.match(/\n/g) || []).length + 1;
                        var height = Math.min(Math.max(lineCount * 18 + 20, 80), 300);
                        
                        html += '<div class="acf-bb-code-widget">';
                        html += '<div class="acf-bb-code-header"><span class="dashicons dashicons-editor-code"></span> ' + fileNames[key] + '</div>';
                        html += '<div id="' + editorId + '" class="acf-bb-code-body acf-bb-chat-monaco-container" style="height:' + height + 'px;"></div>';
                        html += '</div>';
                        
                        // Queue editor for initialization
                        pendingHistoryEditors.push({
                            id: editorId,
                            code: code,
                            lang: langMap[key] || 'text'
                        });
                    }
                });
            }
            
            // Render summary if present
            if (msg.summary && Array.isArray(msg.summary) && msg.summary.length > 0) {
                html += '<div class="acf-bb-summary-widget">';
                html += '<div class="acf-bb-summary-header"><span class="dashicons dashicons-list-view"></span> Change Summary</div>';
                html += '<ul class="acf-bb-summary-list">';
                msg.summary.forEach(function(item) {
                    // Process Smart Tokens in summary items
                    var processedItem = $('<div>').text(item).html();
                    if (window.SmartTokens && window.SmartTokens.processPlainText) {
                        processedItem = window.SmartTokens.processPlainText(item);
                    }
                    html += '<li><span class="dashicons dashicons-yes"></span> <span class="acf-bb-summary-text">' + processedItem + '</span></li>';
                });
                html += '</ul></div>';
            }
            
            if (msg.image_url) {
                html += '<div class="acf-bb-chat-image"><img src="' + msg.image_url + '" alt="Reference" /></div>';
            }
            
            html += '</div></div>';
            
            $('#acf-bb-chat-messages').append(html);
        });
        
        scrollToBottom();
    }
    
    // Initialize Monaco editors for chat history (called after Monaco loads)
    function initHistoryMonacoEditors() {
        if (typeof monaco === 'undefined' || !pendingHistoryEditors.length) return;
        
        pendingHistoryEditors.forEach(function(config) {
            var container = document.getElementById(config.id);
            if (!container) return;
            
            try {
                var editor = monaco.editor.create(container, {
                    value: config.code,
                    language: config.lang,
                    theme: 'vs-dark',
                    automaticLayout: true,
                    readOnly: true,
                    minimap: { enabled: false },
                    scrollBeyondLastLine: false,
                    lineNumbers: 'on',
                    wordWrap: 'on',
                    fontSize: 12,
                    folding: false,
                    glyphMargin: false,
                    lineDecorationsWidth: 10,
                    lineNumbersMinChars: 3,
                    padding: { top: 8, bottom: 8 }
                });
                chatMonacoEditors.push(editor);
            } catch (e) {
                console.error('Error creating history Monaco editor:', e);
            }
        });
        
        // Clear the queue
        pendingHistoryEditors = [];
    }
    
    // Render history HTML immediately
    renderChatHistory();
    
    // If there's no chat history, the welcome message will be showing
    // Update it once the model picker is initialized
    function updateInitialWelcomeAvatar() {
        if (chatHistory.length === 0 && selectedModel) {
            var provider = getProviderFromModel(selectedModel);
            updateWelcomeAvatar(provider);
        }
    }

    // Track chat Monaco editors for cleanup
    var chatMonacoEditors = [];
    var chatEditorCounter = 0;

    // Helper function to convert text to paragraphs instead of <br> tags
    function textToParagraphs(text) {
        if (!text || !text.trim()) return '';
        
        // Split by double newlines for paragraphs, or single newlines
        var paragraphs = text.split(/\n\n+/);
        var html = '';
        
        paragraphs.forEach(function(para) {
            para = para.trim();
            if (para) {
                // Replace single newlines within a paragraph with spaces
                para = para.replace(/\n/g, ' ');
                
                // Process Smart Tokens (file references become clickable chips)
                if (window.SmartTokens && window.SmartTokens.processPlainText) {
                    para = window.SmartTokens.processPlainText(para);
                }
                
                html += '<p>' + para + '</p>';
            }
        });
        
        return html;
    }

    function createCodeWidget(fileKey) {
        // Map keys to nice names
        var names = {
            'block_json': 'block.json',
            'render_php': 'render.php',
            'style_css': 'style.css',
            'script_js': 'script.js',
            'fields_php': 'fields.php',
            'assets_php': 'assets.php',
            'summary': 'Summary'
        };
        var name = names[fileKey] || fileKey;
        
        // Handle custom file keys (e.g., custom_readme_txt -> readme.txt)
        if (fileKey.startsWith('custom_')) {
            var keyParts = fileKey.replace('custom_', '').split('_');
            var ext = keyParts.pop();
            var baseName = keyParts.join('_').replace(/_/g, '-');
            name = baseName + '.' + ext;
        }
        
        var lang = 'text';
        if (fileKey.endsWith('_json')) lang = 'json';
        if (fileKey.endsWith('_php')) lang = 'php';
        if (fileKey.endsWith('_css')) lang = 'css';
        if (fileKey.endsWith('_js')) lang = 'javascript';
        if (fileKey.endsWith('_txt')) lang = 'plaintext';
        if (fileKey.endsWith('_html')) lang = 'html';

        var $widget = $('<div class="acf-bb-code-widget"></div>');
        $widget.append('<div class="acf-bb-code-header"><span class="dashicons dashicons-editor-code"></span> ' + name + '</div>');
        
        // Create a unique ID for this Monaco editor container
        var editorId = 'chat-monaco-' + (++chatEditorCounter);
        var $editorContainer = $('<div id="' + editorId + '" class="acf-bb-code-body acf-bb-chat-monaco-container" data-lang="' + lang + '"></div>');
        $widget.append($editorContainer);
        
        // Store the raw code value and DOM element reference
        var codeValue = '';
        var monacoEditor = null;
        var editorElement = $editorContainer[0]; // Get the actual DOM element
        var initScheduled = false;
        var pendingUpdate = false;
        
        function initMonacoEditor() {
            if (monacoEditor) {
                // Editor already exists, just update it
                monacoEditor.setValue(codeValue);
                updateEditorHeight();
                return;
            }
            
            // Check if Monaco is available and element is in DOM
            if (typeof monaco === 'undefined') {
                // Monaco not ready, try again later
                setTimeout(initMonacoEditor, 50);
                return;
            }
            if (!document.body.contains(editorElement)) {
                // Element not in DOM yet, try again later
                setTimeout(initMonacoEditor, 50);
                return;
            }
            
            // Set initial height before creating editor
            $editorContainer.css('height', '80px');
            
            try {
                monacoEditor = monaco.editor.create(editorElement, {
                    value: codeValue,
                    language: lang,
                    theme: 'vs-dark',
                    automaticLayout: true,
                    readOnly: true,
                    minimap: { enabled: false },
                    scrollBeyondLastLine: false,
                    lineNumbers: 'on',
                    wordWrap: 'on',
                    fontSize: 12,
                    renderWhitespace: 'none',
                    folding: false,
                    glyphMargin: false,
                    lineDecorationsWidth: 0,
                    lineNumbersMinChars: 3
                });
                chatMonacoEditors.push(monacoEditor);
                
                // Auto-resize based on content
                updateEditorHeight();
                
                // If there was a pending update, apply it
                if (pendingUpdate) {
                    monacoEditor.setValue(codeValue);
                    updateEditorHeight();
                    pendingUpdate = false;
                }
            } catch (e) {
                console.error('Error creating Monaco editor:', e);
            }
        }
        
        function updateEditorHeight() {
            if (monacoEditor) {
                var lineCount = monacoEditor.getModel().getLineCount();
                var lineHeight = 18; // Approximate line height
                var minHeight = 80;
                var maxHeight = 400;
                var newHeight = Math.min(Math.max(lineCount * lineHeight + 20, minHeight), maxHeight);
                $editorContainer.css('height', newHeight + 'px');
                monacoEditor.layout();
            }
        }
        
        // Create a proxy object that mimics the jQuery text() interface but uses Monaco
        var $codeProxy = {
            text: function(val) {
                if (val === undefined) {
                    return codeValue;
                }
                // Trim leading/trailing whitespace from code
                codeValue = val.replace(/^\s*\n/, '').replace(/\n\s*$/, '');
                
                if (monacoEditor) {
                    // Editor exists, update it directly
                    monacoEditor.setValue(codeValue);
                    updateEditorHeight();
                } else {
                    // Editor not ready yet, mark pending and schedule init
                    pendingUpdate = true;
                    if (!initScheduled) {
                        initScheduled = true;
                        // Use setTimeout to ensure DOM is ready
                        setTimeout(initMonacoEditor, 10);
                    }
                }
                
                return val;
            }
        };
        
        return { $el: $widget, $code: $codeProxy, editorId: editorId };
    }

    var thinkingTimer;
    var startTime;

    function appendLoadingMessage() {
        // Placeholder for streaming content
        return; 
    }

    function removeLoadingMessage() {
        $('.loading-message').remove();
    }

    function getCurrentCode() {
        // Collect code from editors or textareas
        var code = {};
        if (editors['block-json']) code['block_json'] = editors['block-json'].getValue();
        if (editors['render-php']) code['render_php'] = editors['render-php'].getValue();
        if (editors['style-css']) code['style_css'] = editors['style-css'].getValue();
        if (editors['script-js']) code['script_js'] = editors['script-js'].getValue();
        if (editors['fields-php']) code['fields_php'] = editors['fields-php'].getValue();
        if (editors['assets-php']) code['assets_php'] = editors['assets-php'].getValue();
        
        // Include custom files
        try {
            var customFilesJson = $('#acf-bb-custom-files').val();
            if (customFilesJson) {
                var customFilesData = JSON.parse(customFilesJson);
                Object.keys(customFilesData).forEach(function(fileId) {
                    var tabId = 'custom-' + fileId.replace(/_/g, '-');
                    var dataKey = 'custom_' + fileId.replace(/-/g, '_');
                    if (editors[tabId]) {
                        code[dataKey] = editors[tabId].getValue();
                    }
                });
                // Also include custom files metadata for AI context
                code['_custom_files_meta'] = JSON.stringify(customFilesData);
            }
        } catch (e) {
            console.error('Error including custom files in code context:', e);
        }
        
        return JSON.stringify(code);
    }

    // --- Diff View Logic Maps ---
    var keyMap = {
        'block-json': 'block_json',
        'render-php': 'render_php',
        'style-css': 'style_css',
        'script-js': 'script_js',
        'fields-php': 'fields_php',
        'assets-php': 'assets_php'
    };
    
    var languageMap = {
        'block-json': 'json',
        'render-php': 'php',
        'style-css': 'css',
        'script-js': 'javascript',
        'fields-php': 'php',
        'assets-php': 'php'
    };

    // Track file-level acceptance status
    var fileAcceptanceStatus = {}; // { 'block-json': 'accepted' | 'rejected' | 'pending' }
    var currentDiffChanges = []; // Array of diff line ranges
    var currentDiffIndex = 0;
    var currentDiffTab = 'block-json';
    var changedFileTabs = []; // Array of tab IDs that have changes

    require.config({ paths: { 'vs': 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.44.0/min/vs' }});

    require(['vs/editor/editor.main'], function() {
        // =====================================================
        // Configure Monaco Diagnostics for JSON, CSS, and JS
        // =====================================================
        
        // JSON validation
        monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
            validate: true,
            allowComments: false,
            schemaValidation: 'error',
            enableSchemaRequest: false
        });
        
        // CSS validation with linting rules
        monaco.languages.css.cssDefaults.setOptions({
            validate: true,
            lint: {
                compatibleVendorPrefixes: 'warning',
                vendorPrefix: 'warning',
                duplicateProperties: 'warning',
                emptyRules: 'warning',
                importStatement: 'ignore',
                fontFaceProperties: 'warning',
                hexColorLength: 'warning',
                unknownProperties: 'warning',
                propertyIgnoredDueToDisplay: 'warning',
                ieHack: 'warning',
                zeroUnits: 'warning',
                argumentsInColorFunction: 'error',
                unknownAtRules: 'warning'
            }
        });
        
        // JavaScript validation
        monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
            noSemanticValidation: false,
            noSyntaxValidation: false
        });
        
        monaco.languages.typescript.javascriptDefaults.setCompilerOptions({
            target: monaco.languages.typescript.ScriptTarget.ES2020,
            allowNonTsExtensions: true,
            checkJs: true,
            allowJs: true,
            noEmit: true,
            noImplicitAny: false,
            strictNullChecks: false,
            suppressImplicitAnyIndexErrors: true
        });
        
        // Add global type declarations for WordPress/jQuery/ACF
        monaco.languages.typescript.javascriptDefaults.addExtraLib(`
            declare var jQuery: any;
            declare var $: any;
            declare var acf: any;
            declare var wp: any;
            declare interface Window {
                acf: any;
                jQuery: any;
                wp: any;
            }
        `, 'ts:globals.d.ts');
        
        // =====================================================
        // PHP Linting with php-parser.js
        // =====================================================
        
        var phpParser = null;
        
        // Lazy initialization - get or create parser instance
        function getPhpParser() {
            if (phpParser) return phpParser;
            
            // Check for PhpParser in various locations
            var PhpParserRef = window.PhpParser || window.phpParser || window.PHP_PARSER || 
                               (typeof PhpParser !== 'undefined' ? PhpParser : null);
            
            if (!PhpParserRef) return null;
            
            try {
                if (typeof PhpParserRef.Engine === 'function') {
                    phpParser = new PhpParserRef.Engine({
                        parser: { extractDoc: true, php7: true, suppressErrors: false },
                        ast: { withPositions: true }
                    });
                } else if (typeof PhpParserRef === 'function') {
                    phpParser = new PhpParserRef({
                        parser: { extractDoc: true, php7: true, suppressErrors: false },
                        ast: { withPositions: true }
                    });
                }
            } catch (e) {
                console.error('PHP Parser init error:', e);
            }
            
            return phpParser;
        }
        
        // Debounce helper
        function debounce(func, wait) {
            var timeout;
            return function() {
                var context = this, args = arguments;
                clearTimeout(timeout);
                timeout = setTimeout(function() {
                    func.apply(context, args);
                }, wait);
            };
        }
        
        // PHP lint function
        function lintPHP(editor, editorKey) {
            var parser = getPhpParser();
            if (!parser) return;
            
            var code = editor.getValue();
            var model = editor.getModel();
            
            // Clear existing markers
            monaco.editor.setModelMarkers(model, 'php-lint', []);
            
            // Skip empty content
            if (!code.trim()) return;
            
            try {
                if (parser.parseCode) {
                    parser.parseCode(code, editorKey + '.php');
                } else if (parser.parseEval) {
                    parser.parseEval(code);
                }
                // No errors - markers already cleared
            } catch (e) {
                var lineNumber = 1;
                var column = 1;
                var message = e.message || 'PHP syntax error';
                
                // Try to extract line number from error
                if (e.lineNumber) {
                    lineNumber = e.lineNumber;
                } else if (e.loc && e.loc.start) {
                    lineNumber = e.loc.start.line;
                    column = e.loc.start.column || 1;
                } else {
                    // Try to parse from message like "Parse Error: ... on line 5"
                    var lineMatch = message.match(/line\s*(\d+)/i);
                    if (lineMatch) {
                        lineNumber = parseInt(lineMatch[1], 10);
                    }
                }
                
                var markers = [{
                    severity: monaco.MarkerSeverity.Error,
                    startLineNumber: lineNumber,
                    startColumn: column,
                    endLineNumber: lineNumber,
                    endColumn: 1000,
                    message: message,
                    source: 'php-parser'
                }];
                
                monaco.editor.setModelMarkers(model, 'php-lint', markers);
            }
        }
        
        // Initialize editors
        editors['block-json'] = monaco.editor.create(document.getElementById('editor-block-json'), {
            value: $('#textarea-block-json').val(),
            language: 'json',
            theme: 'vs-dark',
            automaticLayout: true
        });

        editors['render-php'] = monaco.editor.create(document.getElementById('editor-render-php'), {
            value: $('#textarea-render-php').val(),
            language: 'php',
            theme: 'vs-dark',
            automaticLayout: true
        });

        editors['style-css'] = monaco.editor.create(document.getElementById('editor-style-css'), {
            value: $('#textarea-style-css').val(),
            language: 'css',
            theme: 'vs-dark',
            automaticLayout: true
        });

        editors['script-js'] = monaco.editor.create(document.getElementById('editor-script-js'), {
            value: $('#textarea-script-js').val(),
            language: 'javascript',
            theme: 'vs-dark',
            automaticLayout: true
        });

        editors['fields-php'] = monaco.editor.create(document.getElementById('editor-fields-php'), {
            value: $('#textarea-fields-php').val(),
            language: 'php',
            theme: 'vs-dark',
            automaticLayout: true
        });

        editors['assets-php'] = monaco.editor.create(document.getElementById('editor-assets-php'), {
            value: $('#textarea-assets-php').val(),
            language: 'php',
            theme: 'vs-dark',
            automaticLayout: true
        });

        // Sync editors with hidden textareas on change
        editors['block-json'].onDidChangeModelContent(function() { $('#textarea-block-json').val(editors['block-json'].getValue()); });
        editors['render-php'].onDidChangeModelContent(function() { $('#textarea-render-php').val(editors['render-php'].getValue()); });
        editors['style-css'].onDidChangeModelContent(function() { $('#textarea-style-css').val(editors['style-css'].getValue()); });
        editors['script-js'].onDidChangeModelContent(function() { $('#textarea-script-js').val(editors['script-js'].getValue()); });
        editors['fields-php'].onDidChangeModelContent(function() { $('#textarea-fields-php').val(editors['fields-php'].getValue()); });
        editors['assets-php'].onDidChangeModelContent(function() { $('#textarea-assets-php').val(editors['assets-php'].getValue()); });
        
        // =====================================================
        // Custom Files Management
        // =====================================================
        
        var customFiles = {};
        try {
            var customFilesJson = $('#acf-bb-custom-files').val();
            if (customFilesJson) {
                customFiles = JSON.parse(customFilesJson);
            }
        } catch (e) {
            console.error('Error parsing custom files:', e);
        }
        
        // Language mapping for file extensions
        var extToLanguage = {
            'php': 'php',
            'js': 'javascript',
            'css': 'css',
            'json': 'json',
            'html': 'html',
            'txt': 'plaintext'
        };
        
        // Icon mapping for file extensions
        var extToIcon = {
            'php': 'dashicons-editor-code',
            'js': 'dashicons-media-default',
            'css': 'dashicons-art',
            'json': 'dashicons-media-code',
            'html': 'dashicons-media-text',
            'txt': 'dashicons-text-page'
        };
        
        // Initialize existing custom file editors
        function initCustomFileEditors() {
            $('.acf-bb-custom-tab').each(function() {
                var $tab = $(this);
                var tabId = $tab.data('tab');
                var fileId = $tab.data('file-id');
                var editorContainerId = 'editor-' + tabId;
                var textareaId = 'textarea-' + tabId;
                
                if (editors[tabId]) return; // Already initialized
                
                var $container = $('#' + editorContainerId);
                var $textarea = $('#' + textareaId);
                
                if ($container.length && $textarea.length) {
                    var ext = getFileExtension(customFiles[fileId]?.filename || '');
                    var lang = extToLanguage[ext] || 'plaintext';
                    
                    editors[tabId] = monaco.editor.create($container[0], {
                        value: $textarea.val(),
                        language: lang,
                        theme: 'vs-dark',
                        automaticLayout: true
                    });
                    
                    // Sync with textarea
                    editors[tabId].onDidChangeModelContent(function() {
                        $textarea.val(editors[tabId].getValue());
                        updateCustomFilesData();
                    });
                    
                    // Update keyMap and languageMap
                    var dataKey = 'custom_' + fileId.replace(/-/g, '_');
                    keyMap[tabId] = dataKey;
                    languageMap[tabId] = lang;
                    
                    // Register with SmartTokens for clickable chips in chat
                    var filename = customFiles[fileId]?.filename || '';
                    if (filename && window.SmartTokens && window.SmartTokens.registerCustomFile) {
                        window.SmartTokens.registerCustomFile(filename, tabId);
                    }
                    
                    // Setup PHP linting if needed
                    if (lang === 'php') {
                        var debouncedLint = debounce(function() { lintPHP(editors[tabId], tabId); }, 500);
                        editors[tabId].onDidChangeModelContent(debouncedLint);
                    }
                }
            });
        }
        
        // Helper to get file extension
        function getFileExtension(filename) {
            return filename.split('.').pop().toLowerCase();
        }
        
        // Update the hidden custom files JSON field
        function updateCustomFilesData() {
            // Sync content from all custom editors
            Object.keys(customFiles).forEach(function(fileId) {
                var tabId = 'custom-' + fileId.replace(/_/g, '-');
                if (editors[tabId]) {
                    customFiles[fileId].content = editors[tabId].getValue();
                }
            });
            $('#acf-bb-custom-files').val(JSON.stringify(customFiles));
        }
        
        // Add new file handler
        $('#acf-bb-add-file').on('click', function() {
            var filename = prompt('Enter filename (e.g., functions.php, helpers.js):');
            if (!filename) return;
            
            // Validate filename
            filename = filename.trim();
            if (!filename.match(/^[a-zA-Z0-9_-]+\.[a-zA-Z0-9]+$/)) {
                alert('Invalid filename. Use letters, numbers, dashes, underscores, and a valid extension.');
                return;
            }
            
            // Check for duplicates
            var fileId = filename.replace(/\./g, '_');
            if (customFiles[fileId]) {
                alert('A file with this name already exists.');
                return;
            }
            
            // Check for reserved filenames
            var reservedNames = ['block.json', 'render.php', 'style.css', 'script.js', 'fields.php', 'assets.php'];
            if (reservedNames.indexOf(filename.toLowerCase()) !== -1) {
                alert('This filename is reserved. Please choose a different name.');
                return;
            }
            
            // Create file via AJAX
            $.ajax({
                url: acfBlockBuilder.ajax_url,
                type: 'POST',
                data: {
                    action: 'acf_block_builder_add_custom_file',
                    nonce: acfBlockBuilder.export_nonce,
                    post_id: acfBlockBuilder.post_id,
                    filename: filename,
                    content: ''
                },
                success: function(response) {
                    if (response.success) {
                        // Create new file in UI
                        var ext = getFileExtension(filename);
                        var lang = extToLanguage[ext] || 'plaintext';
                        var icon = extToIcon[ext] || 'dashicons-media-text';
                        var tabId = 'custom-' + fileId.replace(/_/g, '-');
                        var dataKey = 'custom_' + fileId.replace(/-/g, '_');
                        
                        // Add to customFiles object
                        customFiles[fileId] = {
                            filename: filename,
                            content: ''
                        };
                        
                        // Create tab
                        var $tab = $('<a href="#" class="acf-bb-tab acf-bb-custom-tab" data-tab="' + tabId + '" data-file-type="' + ext + '" data-custom-file="true" data-file-id="' + fileId + '">' +
                            '<span class="dashicons ' + icon + '"></span> ' + filename +
                            '<button type="button" class="acf-bb-delete-file" data-file-id="' + fileId + '" title="Delete file">' +
                            '<span class="dashicons dashicons-no-alt"></span>' +
                            '</button>' +
                            '<span class="acf-bb-lint-badge" data-lint-tab="' + tabId + '"></span>' +
                            '</a>');
                        
                        // Insert before the add button
                        $('#acf-bb-add-file').before($tab);
                        
                        // Create tab content
                        var $content = $('<div class="acf-bb-tab-content" id="tab-' + tabId + '">' +
                            '<div id="editor-' + tabId + '" class="monaco-editor-container"></div>' +
                            '<textarea name="acf_block_builder_custom_file_' + fileId + '" id="textarea-' + tabId + '" class="hidden-textarea"></textarea>' +
                            '</div>');
                        
                        $('.acf-bb-editor-wrapper').append($content);
                        
                        // Update keyMap and languageMap first
                        keyMap[tabId] = dataKey;
                        languageMap[tabId] = lang;
                        
                        // Register with SmartTokens for clickable chips in chat
                        if (window.SmartTokens && window.SmartTokens.registerCustomFile) {
                            window.SmartTokens.registerCustomFile(filename, tabId);
                        }
                        
                        // Update custom files data
                        updateCustomFilesData();
                        
                        // Switch to the new tab FIRST to make container visible
                        $('.acf-bb-tab').removeClass('active');
                        $tab.addClass('active');
                        $('.acf-bb-tab-content').removeClass('active');
                        $content.addClass('active');
                        
                        // Initialize Monaco editor AFTER container is visible
                        setTimeout(function() {
                            editors[tabId] = monaco.editor.create(document.getElementById('editor-' + tabId), {
                                value: '',
                                language: lang,
                                theme: 'vs-dark',
                                automaticLayout: true
                            });
                            
                            // Sync with textarea
                            editors[tabId].onDidChangeModelContent(function() {
                                $('#textarea-' + tabId).val(editors[tabId].getValue());
                                updateCustomFilesData();
                            });
                            
                            // Setup PHP linting if needed
                            if (lang === 'php') {
                                var debouncedLint = debounce(function() { lintPHP(editors[tabId], tabId); }, 500);
                                editors[tabId].onDidChangeModelContent(debouncedLint);
                            }
                            
                            // Force layout refresh
                            editors[tabId].layout();
                            editors[tabId].focus();
                        }, 50);
                    } else {
                        alert(response.data || 'Failed to create file.');
                    }
                },
                error: function() {
                    alert('Failed to create file. Please try again.');
                }
            });
        });
        
        // Delete file handler
        $(document).on('click', '.acf-bb-delete-file', function(e) {
            e.preventDefault();
            e.stopPropagation();
            
            var $btn = $(this);
            var fileId = $btn.data('file-id');
            var filename = customFiles[fileId]?.filename || fileId;
            
            if (!confirm('Are you sure you want to delete "' + filename + '"? This cannot be undone.')) {
                return;
            }
            
            var tabId = 'custom-' + fileId.replace(/_/g, '-');
            var $tab = $('.acf-bb-tab[data-tab="' + tabId + '"]');
            var isActive = $tab.hasClass('active');
            
            // Delete via AJAX
            $.ajax({
                url: acfBlockBuilder.ajax_url,
                type: 'POST',
                data: {
                    action: 'acf_block_builder_delete_custom_file',
                    nonce: acfBlockBuilder.export_nonce,
                    post_id: acfBlockBuilder.post_id,
                    file_id: fileId
                },
                success: function(response) {
                    if (response.success) {
                        // Dispose editor
                        if (editors[tabId]) {
                            editors[tabId].dispose();
                            delete editors[tabId];
                        }
                        
                        // Remove from keyMap and languageMap
                        delete keyMap[tabId];
                        delete languageMap[tabId];
                        
                        // Remove tab and content
                        $tab.remove();
                        $('#tab-' + tabId).remove();
                        
                        // Remove from customFiles
                        delete customFiles[fileId];
                        updateCustomFilesData();
                        
                        // If this was the active tab, switch to block-json
                        if (isActive) {
                            $('.acf-bb-tab[data-tab="block-json"]').click();
                        }
                    } else {
                        alert(response.data || 'Failed to delete file.');
                    }
                },
                error: function() {
                    alert('Failed to delete file. Please try again.');
                }
            });
        });
        
        // Initialize existing custom file editors
        initCustomFileEditors();
        
        // Setup debounced PHP linting for PHP editors
        var debouncedLintRenderPHP = debounce(function() { lintPHP(editors['render-php'], 'render-php'); }, 500);
        var debouncedLintFieldsPHP = debounce(function() { lintPHP(editors['fields-php'], 'fields-php'); }, 500);
        var debouncedLintAssetsPHP = debounce(function() { lintPHP(editors['assets-php'], 'assets-php'); }, 500);
        
        editors['render-php'].onDidChangeModelContent(debouncedLintRenderPHP);
        editors['fields-php'].onDidChangeModelContent(debouncedLintFieldsPHP);
        editors['assets-php'].onDidChangeModelContent(debouncedLintAssetsPHP);
        
        // Run initial PHP lint on all PHP editors
        setTimeout(function() {
            lintPHP(editors['render-php'], 'render-php');
            lintPHP(editors['fields-php'], 'fields-php');
            lintPHP(editors['assets-php'], 'assets-php');
        }, 500);
        
        // =====================================================
        // Lint Badge UI - Track and display errors/warnings
        // =====================================================
        
        // Update lint badge for a specific tab
        function updateLintBadge(tabId) {
            var editor = editors[tabId];
            if (!editor) return;
            
            var model = editor.getModel();
            if (!model) return;
            
            var markers = monaco.editor.getModelMarkers({ resource: model.uri });
            var errors = 0;
            var warnings = 0;
            
            markers.forEach(function(marker) {
                if (marker.severity === monaco.MarkerSeverity.Error) {
                    errors++;
                } else if (marker.severity === monaco.MarkerSeverity.Warning) {
                    warnings++;
                }
            });
            
            var $badge = $('.acf-bb-lint-badge[data-lint-tab="' + tabId + '"]');
            var $tab = $badge.closest('.acf-bb-tab');
            
            // Reset classes
            $badge.removeClass('has-errors has-warnings');
            $tab.removeClass('has-lint-errors');
            
            if (errors > 0) {
                $badge.addClass('has-errors').text(errors);
                $tab.addClass('has-lint-errors');
            } else if (warnings > 0) {
                $badge.addClass('has-warnings').text(warnings);
            } else {
                $badge.text('');
            }
        }
        
        // Update all lint badges
        function updateAllLintBadges() {
            Object.keys(editors).forEach(function(tabId) {
                updateLintBadge(tabId);
            });
        }
        
        // Listen for marker changes on all editor models
        monaco.editor.onDidChangeMarkers(function(uris) {
            uris.forEach(function(uri) {
                // Find which editor this URI belongs to
                Object.keys(editors).forEach(function(tabId) {
                    var editor = editors[tabId];
                    if (editor && editor.getModel() && editor.getModel().uri.toString() === uri.toString()) {
                        updateLintBadge(tabId);
                    }
                });
            });
        });
        
        // Initial badge update after a short delay (wait for Monaco diagnostics)
        setTimeout(function() {
            updateAllLintBadges();
            updateProblemsPanel();
        }, 1500);
        
        // =====================================================
        // Problems Panel - Grouped error display with AI fix
        // =====================================================
        
        var fileNameMap = {
            'block-json': 'block.json',
            'render-php': 'render.php',
            'style-css': 'style.css',
            'script-js': 'script.js',
            'fields-php': 'fields.php',
            'assets-php': 'assets.php'
        };
        
        var fileIconMap = {
            'block-json': 'dashicons-media-code',
            'render-php': 'dashicons-editor-code',
            'style-css': 'dashicons-art',
            'script-js': 'dashicons-media-default',
            'fields-php': 'dashicons-database',
            'assets-php': 'dashicons-admin-links'
        };
        
        // =====================================================
        // Ignored Errors Management
        // =====================================================
        
        // Load ignored errors from hidden field
        var ignoredErrors = [];
        try {
            var ignoredJson = $('#acf-bb-ignored-errors').val();
            if (ignoredJson) {
                ignoredErrors = JSON.parse(ignoredJson);
            }
        } catch (e) {
            console.error('Error parsing ignored errors:', e);
            ignoredErrors = [];
        }
        
        // Create error signature for matching
        function getErrorSignature(tabId, line, message) {
            return tabId + ':' + line + ':' + message.substring(0, 100);
        }
        
        // Check if error is ignored
        function isErrorIgnored(tabId, line, message) {
            var signature = getErrorSignature(tabId, line, message);
            return ignoredErrors.some(function(ignored) {
                return ignored.signature === signature;
            });
        }
        
        // Add error to ignored list
        function ignoreError(tabId, line, message) {
            var signature = getErrorSignature(tabId, line, message);
            
            // Check if already ignored
            if (isErrorIgnored(tabId, line, message)) return;
            
            ignoredErrors.push({
                signature: signature,
                tabId: tabId,
                line: line,
                message: message,
                timestamp: Date.now()
            });
            
            saveIgnoredErrors();
            updateProblemsPanel();
        }
        
        // Remove error from ignored list
        function restoreError(signature) {
            ignoredErrors = ignoredErrors.filter(function(err) {
                return err.signature !== signature;
            });
            
            saveIgnoredErrors();
            updateProblemsPanel();
        }
        
        // Clear all ignored errors
        function clearAllIgnored() {
            if (!confirm('Clear all ignored errors?')) return;
            
            ignoredErrors = [];
            saveIgnoredErrors();
            updateProblemsPanel();
        }
        
        // Save ignored errors to hidden field
        function saveIgnoredErrors() {
            $('#acf-bb-ignored-errors').val(JSON.stringify(ignoredErrors));
        }
        
        // Collect all problems from all editors
        function collectAllProblems() {
            var problems = {};
            var ignoredProblems = {};
            var totalErrors = 0;
            var totalWarnings = 0;
            
            Object.keys(editors).forEach(function(tabId) {
                var editor = editors[tabId];
                if (!editor) return;
                
                var model = editor.getModel();
                if (!model) return;
                
                var markers = monaco.editor.getModelMarkers({ resource: model.uri });
                if (markers.length > 0) {
                    markers.forEach(function(marker) {
                        var isError = marker.severity === monaco.MarkerSeverity.Error;
                        var message = marker.message;
                        var line = marker.startLineNumber;
                        
                        var problemData = {
                            severity: isError ? 'error' : 'warning',
                            message: message,
                            line: line,
                            column: marker.startColumn,
                            source: marker.source || ''
                        };
                        
                        // Check if ignored
                        if (isErrorIgnored(tabId, line, message)) {
                            if (!ignoredProblems[tabId]) ignoredProblems[tabId] = [];
                            ignoredProblems[tabId].push(problemData);
                        } else {
                            if (!problems[tabId]) problems[tabId] = [];
                            problems[tabId].push(problemData);
                            
                            if (isError) totalErrors++;
                            else totalWarnings++;
                        }
                    });
                }
            });
            
            return {
                problems: problems,
                ignoredProblems: ignoredProblems,
                totalErrors: totalErrors,
                totalWarnings: totalWarnings,
                total: totalErrors + totalWarnings,
                totalIgnored: ignoredErrors.length
            };
        }
        
        // Update the problems panel UI
        function updateProblemsPanel() {
            var data = collectAllProblems();
            var $panel = $('#acf-bb-problems-panel');
            var $count = $('#acf-bb-problems-count');
            var $list = $('#acf-bb-problems-list');
            var $fixBtn = $('#acf-bb-fix-with-ai');
            var $ignoredCount = $('.acf-bb-ignored-count');
            var $ignoredSection = $('#acf-bb-ignored-problems');
            var $ignoredList = $('#acf-bb-ignored-list');
            
            // Update counts
            $count.text(data.total);
            $ignoredCount.text(data.totalIgnored);
            
            // Update panel state
            $panel.removeClass('has-errors has-warnings');
            if (data.totalErrors > 0) {
                $panel.addClass('has-errors');
            } else if (data.totalWarnings > 0) {
                $panel.addClass('has-warnings');
            }
            
            // Enable/disable fix button
            $fixBtn.prop('disabled', data.total === 0);
            
            // Build problems list HTML with ignore buttons
            var html = '';
            Object.keys(data.problems).forEach(function(tabId) {
                var fileName = fileNameMap[tabId] || tabId;
                var iconClass = fileIconMap[tabId] || 'dashicons-media-code';
                var fileProblems = data.problems[tabId];
                
                html += '<div class="acf-bb-problems-group" data-tab="' + tabId + '">';
                html += '<div class="acf-bb-problems-file"><span class="dashicons ' + iconClass + '"></span>' + fileName + ' (' + fileProblems.length + ')</div>';
                
                fileProblems.forEach(function(problem) {
                    var signature = getErrorSignature(tabId, problem.line, problem.message);
                    html += '<div class="acf-bb-problem-item" data-tab="' + tabId + '" data-line="' + problem.line + '" data-col="' + problem.column + '">';
                    html += '<span class="acf-bb-problem-icon ' + problem.severity + '">';
                    html += problem.severity === 'error' ? '⊗' : '⚠';
                    html += '</span>';
                    html += '<span class="acf-bb-problem-message">' + escapeHtml(problem.message) + '</span>';
                    html += '<span class="acf-bb-problem-location">[Ln ' + problem.line + ', Col ' + problem.column + ']</span>';
                    html += '<span class="acf-bb-problem-actions">';
                    html += '<button class="acf-bb-problem-ignore" data-signature="' + signature + '" data-tab="' + tabId + '" data-line="' + problem.line + '" data-message="' + escapeHtml(problem.message) + '">Ignore</button>';
                    html += '</span>';
                    html += '</div>';
                });
                
                html += '</div>';
            });
            
            $list.html(html);
            
            // Build ignored problems list
            if (data.totalIgnored > 0 && $('#acf-bb-show-ignored').hasClass('active')) {
                var ignoredHtml = '';
                Object.keys(data.ignoredProblems).forEach(function(tabId) {
                    var fileName = fileNameMap[tabId] || tabId;
                    var iconClass = fileIconMap[tabId] || 'dashicons-media-code';
                    var fileProblems = data.ignoredProblems[tabId];
                    
                    ignoredHtml += '<div class="acf-bb-problems-group" data-tab="' + tabId + '">';
                    ignoredHtml += '<div class="acf-bb-problems-file"><span class="dashicons ' + iconClass + '"></span>' + fileName + ' (' + fileProblems.length + ')</div>';
                    
                    fileProblems.forEach(function(problem) {
                        var signature = getErrorSignature(tabId, problem.line, problem.message);
                        ignoredHtml += '<div class="acf-bb-problem-item" data-tab="' + tabId + '" data-line="' + problem.line + '" data-col="' + problem.column + '">';
                        ignoredHtml += '<span class="acf-bb-problem-icon ' + problem.severity + '">';
                        ignoredHtml += problem.severity === 'error' ? '⊗' : '⚠';
                        ignoredHtml += '</span>';
                        ignoredHtml += '<span class="acf-bb-problem-message">' + escapeHtml(problem.message) + '</span>';
                        ignoredHtml += '<span class="acf-bb-problem-location">[Ln ' + problem.line + ', Col ' + problem.column + ']</span>';
                        ignoredHtml += '<span class="acf-bb-problem-actions">';
                        ignoredHtml += '<button class="acf-bb-problem-restore" data-signature="' + signature + '">Restore</button>';
                        ignoredHtml += '</span>';
                        ignoredHtml += '</div>';
                    });
                    
                    ignoredHtml += '</div>';
                });
                
                $ignoredList.html(ignoredHtml);
                $ignoredSection.show();
            } else {
                $ignoredSection.hide();
            }
        }
        
        // Helper to escape HTML
        function escapeHtml(text) {
            var div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }
        
        // Click on problem to jump to line
        $(document).on('click', '.acf-bb-problem-item', function() {
            var tabId = $(this).data('tab');
            var line = $(this).data('line');
            var col = $(this).data('col');
            
            // Switch to tab
            $('.acf-bb-tab[data-tab="' + tabId + '"]').click();
            
            // Jump to line in editor
            setTimeout(function() {
                var editor = editors[tabId];
                if (editor) {
                    editor.revealLineInCenter(line);
                    editor.setPosition({ lineNumber: line, column: col });
                    editor.focus();
                }
            }, 100);
        });
        
        // Toggle problems panel
        $('#acf-bb-problems-toggle').on('click', function() {
            $('#acf-bb-problems-panel').toggleClass('collapsed');
        });
        
        // Event handlers for ignore/restore
        $(document).on('click', '.acf-bb-problem-ignore', function(e) {
            e.stopPropagation();
            var tabId = $(this).data('tab');
            var line = $(this).data('line');
            var message = $(this).data('message');
            ignoreError(tabId, line, message);
        });
        
        $(document).on('click', '.acf-bb-problem-restore', function(e) {
            e.stopPropagation();
            var signature = $(this).data('signature');
            restoreError(signature);
        });
        
        $('#acf-bb-show-ignored').on('click', function() {
            $(this).toggleClass('active');
            updateProblemsPanel();
        });
        
        $('#acf-bb-clear-ignored').on('click', clearAllIgnored);
        
        // Fix with AI button
        $('#acf-bb-fix-with-ai').on('click', function() {
            var data = collectAllProblems();
            if (data.total === 0) return;
            
            // Build error data for the chip
            var errorDetails = [];
            Object.keys(data.problems).forEach(function(tabId) {
                var fileName = fileNameMap[tabId] || tabId;
                var fileProblems = data.problems[tabId];
                
                errorDetails.push({
                    file: fileName,
                    tabId: tabId,
                    errors: fileProblems.map(function(problem) {
                        return {
                            line: problem.line,
                            message: problem.message
                        };
                    })
                });
            });
            
            // Insert error chip using MentionAutocomplete
            if (window.MentionAutocomplete && window.MentionAutocomplete.insertErrorChip) {
                window.MentionAutocomplete.insertErrorChip({
                    count: data.total,
                    details: errorDetails
                });
                
                // Scroll chat section into view
                $('.ai-chat-section')[0]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                
                // Auto-submit after a brief delay to allow user to see the chip
                setTimeout(function() {
                    $('#acf-block-builder-generate').click();
                }, 100);
            }
        });
        
        // Update problems panel when markers change
        monaco.editor.onDidChangeMarkers(function() {
            updateProblemsPanel();
        });

        // --- Diff View Functions (Inside require to access monaco) ---
        window.updateDiffEditor = function(tabId) {
            if (!diffEditor) {
                 diffEditor = monaco.editor.createDiffEditor(document.getElementById('acf-bb-diff-editor-container'), {
                    automaticLayout: true,
                    theme: 'vs-dark',
                    readOnly: true,
                    originalEditable: false,
                    renderSideBySide: true,
                    enableSplitViewResizing: true
                });
            }
    
            currentDiffTab = tabId;
            var dataKey = keyMap[tabId];
            var lang = languageMap[tabId];
            
            var originalValue = editors[tabId] ? editors[tabId].getValue() : '';
            var modifiedValue = (pendingAIChanges && pendingAIChanges[dataKey] !== undefined) ? pendingAIChanges[dataKey] : originalValue;
            
            // Trim leading/trailing whitespace from code for cleaner diff view
            modifiedValue = modifiedValue.replace(/^\s*\n/, '').replace(/\n\s*$/, '');
    
            // We need to create models only if they don't match what we want, or create new ones every time.
            var originalModel = monaco.editor.createModel(originalValue, lang);
            var modifiedModel = monaco.editor.createModel(modifiedValue, lang);
    
            diffEditor.setModel({
                original: originalModel,
                modified: modifiedModel
            });

            // Update UI based on file acceptance status
            updateFileStatusUI(tabId);
            
            // Wait for diff to compute then extract changes
            setTimeout(function() {
                extractDiffChanges();
            }, 100);
        };

        // Extract diff changes from the diff editor
        window.extractDiffChanges = function() {
            currentDiffChanges = [];
            currentDiffIndex = 0;
            
            if (diffEditor) {
                var lineChanges = diffEditor.getLineChanges();
                if (lineChanges) {
                    currentDiffChanges = lineChanges;
                }
            }
            
            updateDiffNavigation();
        };

        // Update diff navigation UI
        window.updateDiffNavigation = function() {
            var total = currentDiffChanges.length;
            $('#acf-bb-diff-total').text(total || 0);
            $('#acf-bb-diff-current').text(total > 0 ? currentDiffIndex + 1 : 0);
            
            // Enable/disable navigation buttons
            $('#acf-bb-diff-prev').prop('disabled', currentDiffIndex <= 0 || total === 0);
            $('#acf-bb-diff-next').prop('disabled', currentDiffIndex >= total - 1 || total === 0);
        };

        // Navigate to specific diff
        window.navigateToDiff = function(index) {
            if (index < 0 || index >= currentDiffChanges.length) return;
            
            currentDiffIndex = index;
            var change = currentDiffChanges[index];
            
            if (change && diffEditor) {
                // Navigate to the modified side line
                var modifiedEditor = diffEditor.getModifiedEditor();
                var lineNumber = change.modifiedStartLineNumber || change.originalStartLineNumber;
                modifiedEditor.revealLineInCenter(lineNumber);
                modifiedEditor.setPosition({ lineNumber: lineNumber, column: 1 });
            }
            
            updateDiffNavigation();
        };

        // Update file status UI
        window.updateFileStatusUI = function(tabId) {
            var status = fileAcceptanceStatus[tabId] || 'pending';
            var $tab = $('[data-diff-tab="' + tabId + '"]');
            var $status = $tab.find('.acf-bb-tab-status');
            
            $tab.removeClass('file-accepted file-rejected file-pending');
            $tab.addClass('file-' + status);
            
            if (status === 'accepted') {
                $status.html('<span class="dashicons dashicons-yes-alt"></span>');
            } else if (status === 'rejected') {
                $status.html('<span class="dashicons dashicons-dismiss"></span>');
            } else {
                $status.html('');
            }
            
            // Update file action buttons
            $('#acf-bb-file-accept').toggleClass('active', status === 'accepted');
            $('#acf-bb-file-reject').toggleClass('active', status === 'rejected');
        };

        // Update file navigation counter
        window.updateFileNavigation = function() {
            var currentFileIndex = changedFileTabs.indexOf(currentDiffTab);
            var total = changedFileTabs.length;
            
            $('#acf-bb-file-total').text(total);
            $('#acf-bb-file-current').text(currentFileIndex >= 0 ? currentFileIndex + 1 : 1);
            
            $('#acf-bb-file-prev').prop('disabled', currentFileIndex <= 0);
            $('#acf-bb-file-next').prop('disabled', currentFileIndex >= total - 1);
        };

        // Initialize Monaco editors for any existing code blocks in chat history
        function initHistoryCodeBlocks() {
            $('.acf-bb-chat-messages .acf-bb-code-widget').each(function() {
                var $widget = $(this);
                
                // Skip if already has a Monaco container
                if ($widget.find('.acf-bb-chat-monaco-container').length > 0) {
                    return;
                }
                
                // Find the pre/code block
                var $pre = $widget.find('pre.acf-bb-code-body');
                var $code = $pre.find('code');
                
                if ($code.length === 0 && $pre.length > 0) {
                    // If there's a pre but no code, use the pre content
                    $code = $pre;
                }
                
                if ($code.length === 0) return;
                
                var codeContent = $code.text();
                // Trim leading/trailing whitespace from code
                codeContent = codeContent.replace(/^\s*\n/, '').replace(/\n\s*$/, '');
                
                var langClass = $code.attr('class') || '';
                var lang = 'text';
                
                if (langClass.indexOf('json') !== -1) lang = 'json';
                else if (langClass.indexOf('php') !== -1) lang = 'php';
                else if (langClass.indexOf('css') !== -1) lang = 'css';
                else if (langClass.indexOf('javascript') !== -1 || langClass.indexOf('js') !== -1) lang = 'javascript';
                
                // Create Monaco container
                var editorId = 'chat-history-monaco-' + (++chatEditorCounter);
                var $editorContainer = $('<div id="' + editorId + '" class="acf-bb-code-body acf-bb-chat-monaco-container"></div>');
                
                // Replace the pre/code with Monaco container
                $pre.replaceWith($editorContainer);
                
                // Calculate height based on content
                var lineCount = (codeContent.match(/\n/g) || []).length + 1;
                var lineHeight = 18;
                var minHeight = 80;
                var maxHeight = 400;
                var height = Math.min(Math.max(lineCount * lineHeight + 20, minHeight), maxHeight);
                $editorContainer.css('height', height + 'px');
                
                // Create Monaco editor
                var historyEditor = monaco.editor.create(document.getElementById(editorId), {
                    value: codeContent,
                    language: lang,
                    theme: 'vs-dark',
                    automaticLayout: true,
                    readOnly: true,
                    minimap: { enabled: false },
                    scrollBeyondLastLine: false,
                    lineNumbers: 'on',
                    wordWrap: 'on',
                    fontSize: 12,
                    renderWhitespace: 'none',
                    folding: false,
                    glyphMargin: false,
                    lineDecorationsWidth: 0,
                    lineNumbersMinChars: 3
                });
                
                chatMonacoEditors.push(historyEditor);
            });
        }
        
        // Run initialization for existing code blocks (old format with pre/code)
        initHistoryCodeBlocks();
        
        // Initialize Monaco editors for new format history (with stored code)
        initHistoryMonacoEditors();
        
        // Initialize Mention Autocomplete with access to editors
        if (window.MentionAutocomplete) {
            window.MentionAutocomplete.init({
                textareaSelector: '#acf_block_builder_prompt',
                previewSelector: '#acf-bb-mention-preview',
                editorsGetter: function() { return editors; }
            });
        }
    });

    function showDiffOverlay(data) {
        pendingAIChanges = data;
        $('#acf-bb-diff-overlay').addClass('visible').show();

        // Reset acceptance status for all files
        fileAcceptanceStatus = {};
        changedFileTabs = [];
        
        // Remove any dynamically added custom diff tabs from previous sessions
        $('.acf-bb-diff-tabs .acf-bb-tab[data-custom-diff]').remove();
        
        // Local copies of extension maps (since the originals are in Monaco callback scope)
        var localExtToIcon = {
            'php': 'dashicons-editor-code',
            'js': 'dashicons-media-default',
            'css': 'dashicons-art',
            'json': 'dashicons-media-code',
            'html': 'dashicons-media-text',
            'txt': 'dashicons-text-page'
        };
        var localExtToLanguage = {
            'php': 'php',
            'js': 'javascript',
            'css': 'css',
            'json': 'json',
            'html': 'html',
            'txt': 'plaintext'
        };
        
        // Helper function to create a custom diff tab
        function createCustomDiffTab(tabId, filename, isNew) {
            var ext = filename.split('.').pop().toLowerCase();
            var icon = localExtToIcon[ext] || 'dashicons-media-text';
            var label = isNew ? filename + ' (new)' : filename;
            
            var $newTab = $('<a href="#" class="acf-bb-tab" data-diff-tab="' + tabId + '" data-custom-diff="true">' +
                '<span class="dashicons ' + icon + '"></span> ' + label +
                '<span class="acf-bb-tab-status"></span></a>');
            $('.acf-bb-diff-tabs').append($newTab);
            
            // Bind click handler
            $newTab.on('click', function(e) {
                e.preventDefault();
                $('.acf-bb-diff-tabs .acf-bb-tab').removeClass('active');
                $(this).addClass('active');
                currentDiffTab = tabId;
                if (window.updateDiffEditor) {
                    window.updateDiffEditor(tabId);
                }
                if (window.updateFileNavigation) {
                    window.updateFileNavigation();
                }
            });
            
            return $newTab;
        }
        
        // Add diff tabs for existing custom files that are already in keyMap
        Object.keys(keyMap).forEach(function(tabId) {
            if (tabId.startsWith('custom-')) {
                // Get filename from the main editor tab
                var $mainTab = $('.acf-bb-tabs .acf-bb-tab[data-tab="' + tabId + '"]');
                var filename = $mainTab.find('.tab-filename').text() || tabId.replace('custom-', '').replace(/-/g, '.');
                createCustomDiffTab(tabId, filename, false);
            }
        });
        
        // Add keyMap entries for new custom files from AI
        Object.keys(data).forEach(function(dataKey) {
            if (dataKey.startsWith('custom_') && dataKey !== '_custom_files_meta') {
                // Check if this key already exists in keyMap
                var existingTabId = Object.keys(keyMap).find(function(tid) { return keyMap[tid] === dataKey; });
                if (!existingTabId) {
                    // Create a temporary keyMap entry for the diff view
                    var keyParts = dataKey.replace('custom_', '').split('_');
                    var ext = keyParts.pop();
                    var baseName = keyParts.join('_').replace(/_/g, '-');
                    var filename = baseName + '.' + ext;
                    var tabId = 'custom-' + baseName.replace(/-/g, '-') + '-' + ext;
                    
                    // Add to keyMap temporarily
                    keyMap[tabId] = dataKey;
                    languageMap[tabId] = localExtToLanguage[ext] || 'plaintext';
                    
                    // Create a diff tab for this new file
                    createCustomDiffTab(tabId, filename, true);
                }
            }
        });

        // 1. Identify changes
        var firstChangedTab = null;
        $('.acf-bb-diff-tabs .acf-bb-tab').removeClass('active has-changes file-accepted file-rejected file-pending').hide();
        $('.acf-bb-diff-tabs .acf-bb-tab .acf-bb-tab-status').html('');

        $.each(keyMap, function(tabId, dataKey) {
            var newVal = data[dataKey];
            var currentVal = editors[tabId] ? editors[tabId].getValue() : '';

             // Ensure newVal is a string before comparison
            if (newVal === null || newVal === undefined) {
                newVal = '';
            } else if (typeof newVal !== 'string') {
                newVal = String(newVal);
            }

            // Normalize line endings for comparison
            if (newVal.replace(/\r\n/g, '\n').trim() !== currentVal.replace(/\r\n/g, '\n').trim()) {
                $('[data-diff-tab="' + tabId + '"]').addClass('has-changes').show();
                fileAcceptanceStatus[tabId] = 'pending';
                changedFileTabs.push(tabId);
                if (!firstChangedTab) firstChangedTab = tabId;
            }
        });

        // 2. Select default tab (first changed, or block-json)
        var targetTab = firstChangedTab || 'block-json';
        $('[data-diff-tab="' + targetTab + '"]').addClass('active');
        currentDiffTab = targetTab;

        // 3. Initialize or Update Diff Editor
        if (window.updateDiffEditor) {
            window.updateDiffEditor(targetTab);
        }

        // 4. Update file navigation
        if (window.updateFileNavigation) {
            window.updateFileNavigation();
        }

        // 5. Update apply button text to show count
        updateApplyButtonText();
    }

    function updateApplyButtonText() {
        var acceptedCount = 0;
        var pendingCount = 0;
        
        $.each(fileAcceptanceStatus, function(tabId, status) {
            if (status === 'accepted') acceptedCount++;
            if (status === 'pending') pendingCount++;
        });
        
        var totalChanges = changedFileTabs.length;
        var keepCount = acceptedCount + pendingCount; // Pending files will be kept by default
        
        if (keepCount === totalChanges) {
            $('#acf-bb-diff-apply').text('Apply Changes');
        } else if (keepCount > 0) {
            $('#acf-bb-diff-apply').text('Apply Changes (' + keepCount + '/' + totalChanges + ' files)');
        } else {
            $('#acf-bb-diff-apply').text('Apply Changes (none selected)');
        }
    }

    // Tab switching
    $('.acf-bb-tab').on('click', function(e) {
        if ($(this).data('diff-tab')) return; // Ignore diff tabs here
        e.preventDefault();
        var tabId = $(this).data('tab');

        $('.acf-bb-tab').removeClass('active');
        $(this).addClass('active');

        $('.acf-bb-tab-content').removeClass('active');
        $('#tab-' + tabId).addClass('active');
        
        // Refresh editor layout when becoming visible
        if (editors[tabId]) {
            editors[tabId].layout();
        }
    });

    // Diff Tab Click
    $('.acf-bb-diff-tabs .acf-bb-tab').on('click', function(e) {
        e.preventDefault();
        var tabId = $(this).data('diff-tab');
        
        $('.acf-bb-diff-tabs .acf-bb-tab').removeClass('active');
        $(this).addClass('active');
        
        currentDiffTab = tabId;
        
        if (window.updateDiffEditor) {
            window.updateDiffEditor(tabId);
        }
        
        if (window.updateFileNavigation) {
            window.updateFileNavigation();
        }
    });

    // Helper function to create custom file from AI response
    function createCustomFileFromAI(dataKey, content) {
        // Local copies of extension maps (since the originals are in Monaco callback scope)
        var localExtToLanguage = {
            'php': 'php',
            'js': 'javascript',
            'css': 'css',
            'json': 'json',
            'html': 'html',
            'txt': 'plaintext'
        };
        var localExtToIcon = {
            'php': 'dashicons-editor-code',
            'js': 'dashicons-media-default',
            'css': 'dashicons-art',
            'json': 'dashicons-media-code',
            'html': 'dashicons-media-text',
            'txt': 'dashicons-text-page'
        };
        
        // Extract filename from key (e.g., custom_helpers_php -> helpers.php)
        var keyParts = dataKey.replace('custom_', '').split('_');
        var ext = keyParts.pop();
        var baseName = keyParts.join('_').replace(/_/g, '-');
        var filename = baseName + '.' + ext;
        var fileId = filename.replace(/\./g, '_');
        var tabId = 'custom-' + fileId.replace(/_/g, '-');
        
        // Check if file already exists
        if (editors[tabId]) {
            return tabId;
        }
        
        // Get language and icon for file type
        var lang = localExtToLanguage[ext] || 'plaintext';
        var icon = localExtToIcon[ext] || 'dashicons-media-text';
        
        // Update customFiles object
        if (typeof customFiles === 'undefined') {
            customFiles = {};
        }
        customFiles[fileId] = {
            filename: filename,
            content: content
        };
        
        // Create tab
        var $tab = $('<a href="#" class="acf-bb-tab acf-bb-custom-tab" data-tab="' + tabId + '" data-file-type="' + ext + '" data-custom-file="true" data-file-id="' + fileId + '">' +
            '<span class="dashicons ' + icon + '"></span> ' + filename +
            '<button type="button" class="acf-bb-delete-file" data-file-id="' + fileId + '" title="Delete file">' +
            '<span class="dashicons dashicons-no-alt"></span>' +
            '</button>' +
            '<span class="acf-bb-lint-badge" data-lint-tab="' + tabId + '"></span>' +
            '</a>');
        
        // Insert before the add button
        $('#acf-bb-add-file').before($tab);
        
        // Create tab content
        var $content = $('<div class="acf-bb-tab-content" id="tab-' + tabId + '">' +
            '<div id="editor-' + tabId + '" class="monaco-editor-container"></div>' +
            '<textarea name="acf_block_builder_custom_file_' + fileId + '" id="textarea-' + tabId + '" class="hidden-textarea"></textarea>' +
            '</div>');
        
        $('.acf-bb-editor-wrapper').append($content);
        
        // Initialize Monaco editor
        editors[tabId] = monaco.editor.create(document.getElementById('editor-' + tabId), {
            value: '',
            language: lang,
            theme: 'vs-dark',
            automaticLayout: true
        });
        
        // Sync with textarea
        editors[tabId].onDidChangeModelContent(function() {
            $('#textarea-' + tabId).val(editors[tabId].getValue());
            if (typeof updateCustomFilesData === 'function') {
                updateCustomFilesData();
            }
        });
        
        // Update keyMap and languageMap
        keyMap[tabId] = dataKey;
        languageMap[tabId] = lang;
        
        // Register with SmartTokens for clickable chips in chat
        if (window.SmartTokens && window.SmartTokens.registerCustomFile) {
            window.SmartTokens.registerCustomFile(filename, tabId);
        }
        
        // Update custom files data
        $('#acf-bb-custom-files').val(JSON.stringify(customFiles));
        
        return tabId;
    }
    
    // Apply All Changes - bypasses review status and applies all pending AI changes
    $('#acf-bb-diff-apply-all').on('click', function(e) {
        e.preventDefault();
        if (!pendingAIChanges) return;

        var appliedFiles = [];
        
        // First, create any custom files that don't exist yet
        Object.keys(pendingAIChanges).forEach(function(dataKey) {
            if (dataKey.startsWith('custom_') && dataKey !== '_custom_files_meta') {
                var tabId = Object.keys(keyMap).find(function(tid) { return keyMap[tid] === dataKey; });
                if (!tabId || !editors[tabId]) {
                    createCustomFileFromAI(dataKey, pendingAIChanges[dataKey]);
                }
            }
        });

        $.each(keyMap, function(tabId, dataKey) {
            if (pendingAIChanges[dataKey] !== undefined) {
                 if (editors[tabId]) {
                    var trimmedCode = pendingAIChanges[dataKey]
                        .replace(/^\s*\n/, '')
                        .replace(/\n\s*$/, '');
                    
                    // Check if there's actually a change before applying
                    var currentVal = editors[tabId].getValue();
                     if (trimmedCode.replace(/\r\n/g, '\n').trim() !== currentVal.replace(/\r\n/g, '\n').trim()) {
                        editors[tabId].setValue(trimmedCode);
                        appliedFiles.push(tabId);
                    }
                }
            }
        });

        $('#acf-bb-diff-overlay').removeClass('visible').hide();
        
        var message = 'All changes applied successfully.';
        if (appliedFiles.length > 0) {
             message = 'Applied changes to ' + appliedFiles.length + ' file(s).';
        } else {
             message = 'No changes were applied.';
        }
        
        appendMessage('ai', message);
        
        pendingAIChanges = {};
        fileAcceptanceStatus = {};
        changedFileTabs = [];
        
        // Auto-save to persist changes
        autoSavePost();
    });

    // Apply Changes - only applies accepted or pending (not rejected) files
    $('#acf-bb-diff-apply').on('click', function(e) {
        e.preventDefault();
        if (!pendingAIChanges) return;

        var appliedFiles = [];
        var rejectedFiles = [];
        
        // First, create any custom files that are accepted and don't exist yet
        Object.keys(pendingAIChanges).forEach(function(dataKey) {
            if (dataKey.startsWith('custom_') && dataKey !== '_custom_files_meta') {
                var existingTabId = Object.keys(keyMap).find(function(tid) { return keyMap[tid] === dataKey; });
                if (!existingTabId || !editors[existingTabId]) {
                    // Check if this custom file is not rejected
                    var tempTabId = 'custom-' + dataKey.replace('custom_', '').replace(/_/g, '-');
                    if (fileAcceptanceStatus[tempTabId] !== 'rejected') {
                        createCustomFileFromAI(dataKey, pendingAIChanges[dataKey]);
                    }
                }
            }
        });

        // Apply changes based on acceptance status
        $.each(keyMap, function(tabId, dataKey) {
            if (pendingAIChanges[dataKey] !== undefined) {
                var status = fileAcceptanceStatus[tabId];
                
                // Apply if accepted or pending (not rejected)
                if (status !== 'rejected') {
                 if (editors[tabId]) {
                    var trimmedCode = pendingAIChanges[dataKey]
                        .replace(/^\s*\n/, '')
                        .replace(/\n\s*$/, '');
                    editors[tabId].setValue(trimmedCode);
                        appliedFiles.push(tabId);
                    }
                } else {
                    rejectedFiles.push(tabId);
                 }
            }
        });

        $('#acf-bb-diff-overlay').removeClass('visible').hide();
        
        // Build status message
        var message = '';
        if (appliedFiles.length > 0 && rejectedFiles.length === 0) {
            message = 'All changes applied successfully.';
        } else if (appliedFiles.length > 0 && rejectedFiles.length > 0) {
            message = 'Applied changes to ' + appliedFiles.length + ' file(s). Rejected ' + rejectedFiles.length + ' file(s).';
        } else if (appliedFiles.length === 0) {
            message = 'All changes were rejected.';
        }
        
        appendMessage('ai', message);
        
        pendingAIChanges = {};
        fileAcceptanceStatus = {};
        changedFileTabs = [];
        
        // Auto-save to persist changes
        if (appliedFiles.length > 0) {
            autoSavePost();
        }
    });

    // Discard Changes
    $('#acf-bb-diff-cancel').on('click', function(e) {
        e.preventDefault();
        $('#acf-bb-diff-overlay').removeClass('visible').hide();
        pendingAIChanges = {};
        fileAcceptanceStatus = {};
        changedFileTabs = [];
        appendMessage('ai', 'Changes discarded.');
    });

    // File Accept Button
    $('#acf-bb-file-accept').on('click', function(e) {
        e.preventDefault();
        if (currentDiffTab && changedFileTabs.indexOf(currentDiffTab) !== -1) {
            fileAcceptanceStatus[currentDiffTab] = 'accepted';
            if (window.updateFileStatusUI) {
                window.updateFileStatusUI(currentDiffTab);
            }
            updateApplyButtonText();
            
            // Auto-advance to next file if there is one
            var currentIndex = changedFileTabs.indexOf(currentDiffTab);
            if (currentIndex < changedFileTabs.length - 1) {
                var nextTab = changedFileTabs[currentIndex + 1];
                $('[data-diff-tab="' + nextTab + '"]').click();
            }
        }
    });

    // File Reject Button
    $('#acf-bb-file-reject').on('click', function(e) {
        e.preventDefault();
        if (currentDiffTab && changedFileTabs.indexOf(currentDiffTab) !== -1) {
            fileAcceptanceStatus[currentDiffTab] = 'rejected';
            if (window.updateFileStatusUI) {
                window.updateFileStatusUI(currentDiffTab);
            }
            updateApplyButtonText();
            
            // Auto-advance to next file if there is one
            var currentIndex = changedFileTabs.indexOf(currentDiffTab);
            if (currentIndex < changedFileTabs.length - 1) {
                var nextTab = changedFileTabs[currentIndex + 1];
                $('[data-diff-tab="' + nextTab + '"]').click();
            }
        }
    });

    // Diff Navigation - Previous
    $('#acf-bb-diff-prev').on('click', function(e) {
        e.preventDefault();
        if (currentDiffIndex > 0 && window.navigateToDiff) {
            window.navigateToDiff(currentDiffIndex - 1);
        }
    });

    // Diff Navigation - Next
    $('#acf-bb-diff-next').on('click', function(e) {
        e.preventDefault();
        if (currentDiffIndex < currentDiffChanges.length - 1 && window.navigateToDiff) {
            window.navigateToDiff(currentDiffIndex + 1);
        }
    });

    // File Navigation - Previous
    $('#acf-bb-file-prev').on('click', function(e) {
        e.preventDefault();
        var currentIndex = changedFileTabs.indexOf(currentDiffTab);
        if (currentIndex > 0) {
            var prevTab = changedFileTabs[currentIndex - 1];
            $('[data-diff-tab="' + prevTab + '"]').click();
        }
    });

    // File Navigation - Next
    $('#acf-bb-file-next').on('click', function(e) {
        e.preventDefault();
        var currentIndex = changedFileTabs.indexOf(currentDiffTab);
        if (currentIndex < changedFileTabs.length - 1) {
            var nextTab = changedFileTabs[currentIndex + 1];
            $('[data-diff-tab="' + nextTab + '"]').click();
        }
    });


    // AI Generation
    // Image Upload Handler
    var file_frame;
    $('#acf-bb-upload-image').on('click', function(e) {
        e.preventDefault();

        if (file_frame) {
            file_frame.open();
            return;
        }

        file_frame = wp.media.frames.file_frame = wp.media({
            title: 'Select Reference Image',
            button: { text: 'Use this image' },
            multiple: false
        });

        file_frame.on('select', function() {
            var attachment = file_frame.state().get('selection').first().toJSON();
            
            $('#acf_block_builder_image_id').val(attachment.id);
            // Show preview
            $('#acf-bb-image-preview-mini').html(
                '<div class="acf-bb-attachment-item">' +
                '<img src="' + attachment.url + '" />' +
                '<button type="button" class="acf-bb-remove-attachment" data-attachment-id="' + attachment.id + '">' +
                '<span class="dashicons dashicons-no-alt"></span>' +
                '</button>' +
                '</div>'
            ).show();
            // Enable send button
            $('#acf-block-builder-generate').prop('disabled', false);
            // Add active state to button
            $('#acf-bb-upload-image').addClass('active');
        });

        file_frame.open();
    });

    $('#acf-block-builder-generate').on('click', async function(e) {
        e.preventDefault();

        // Check for Stop action
        if (currentAbortController) {
            currentAbortController.abort();
            currentAbortController = null;
            return;
        }
        
        // Get prompt from MentionAutocomplete (contenteditable) or fallback to textarea
        var prompt = '';
        if (window.MentionAutocomplete && window.MentionAutocomplete.getPlainText) {
            prompt = window.MentionAutocomplete.getPlainText().trim();
        } else {
            prompt = $('#acf_block_builder_prompt').val().trim();
        }
        
        var imageId = $('#acf_block_builder_image_id').val();
        var hasAttachedFiles = window.MentionAutocomplete && window.MentionAutocomplete.getAttachedTokens().length > 0;
        
        if (!prompt && !imageId && !hasAttachedFiles) {
            alert('Please describe your block or upload an image.');
            return;
        }

        var $btn = $(this);
        // Do not disable the button, we transition to Stop mode
        
        // Capture chat history BEFORE adding the current user message
        // This ensures we don't duplicate the current message in the API call
        var historyToSend = JSON.stringify(chatHistory);
        
        // Add User Message with attached files info
        var imageUrl = '';
        if (imageId) {
            var $img = $('#acf-bb-image-preview-mini img');
            if ($img.length) imageUrl = $img.attr('src');
        }
        
        // Build display message with attached chips at their original positions
        var displayMessage = '';
        var attachedTokens = window.MentionAutocomplete ? window.MentionAutocomplete.getAttachedTokens() : [];
        
        if (window.MentionAutocomplete && window.MentionAutocomplete.getDisplayContent) {
            // Use getDisplayContent to preserve chip positions
            displayMessage = window.MentionAutocomplete.getDisplayContent();
        }
        
        // Fallback if no display content (e.g., image-only submission)
        if (!displayMessage) {
            displayMessage = prompt || 'Generating block from image...';
        }
        
        // Get attached context, tokens, and structured content BEFORE clearing (important!)
        var mentionContext = '';
        var savedAttachedTokens = null;
        var savedStructuredContent = null;
        if (window.MentionAutocomplete) {
            mentionContext = window.MentionAutocomplete.getContextString();
            savedAttachedTokens = window.MentionAutocomplete.getAttachedTokens();
            if (window.MentionAutocomplete.getStructuredContent) {
                savedStructuredContent = window.MentionAutocomplete.getStructuredContent();
            }
        }
        
        appendMessage('user', displayMessage, imageUrl, false, null, savedAttachedTokens, savedStructuredContent);
        
        // Auto-save after user submits a message
        autoSavePost();
        
        // Clear input - clear contenteditable editor and textarea
        if (window.MentionAutocomplete) {
            window.MentionAutocomplete.clearAttached();
        }
        $('#acf_block_builder_prompt').val('');
        $('#acf-bb-prompt-editor').empty();
        $('#acf_block_builder_image_id').val('');
        $('#acf-bb-image-preview-mini').hide().html('');
        $('#acf-bb-upload-image').removeClass('active');
        
        // Set Stop Mode
        var $btn = $('#acf-block-builder-generate');
        $btn.addClass('acf-bb-stop-mode');
        $btn.html('<span class="dashicons dashicons-no-alt"></span>');
        $btn.prop('title', 'Stop Generation');
        currentAbortController = new AbortController();

        // Start AI Message Container (will update avatar once we receive provider info)
        var $aiMessage = $('<div class="acf-bb-message ai-message streaming"><div class="acf-bb-avatar"><span class="dashicons dashicons-superhero"></span></div><div class="acf-bb-message-content"><span class="acf-bb-typing">Thinking</span></div></div>');
        $('#acf-bb-chat-messages').append($aiMessage);
        var $aiContent = $aiMessage.find('.acf-bb-message-content');
        var currentProvider = null;
        var currentModel = null;
        var currentResponseMode = currentMode; // Track mode for this response

        scrollToBottom();

        // Get Current Code Context
        var currentCode = getCurrentCode();
        
        // Prepend attached context to prompt (from @ mentions and error chips)
        var finalPrompt = prompt;
        if (mentionContext) {
            finalPrompt = mentionContext + prompt;
        }
        
        var formData = new FormData();
        formData.append('action', 'acf_block_builder_generate');
        formData.append('nonce', acfBlockBuilder.nonce);
        formData.append('prompt', finalPrompt);
        formData.append('image_id', imageId);
        formData.append('title', $('#title').val()); // Get post title
        formData.append('current_code', currentCode);
        formData.append('chat_history', historyToSend);
        formData.append('model', selectedModel || $('#acf_block_builder_model').val());
        formData.append('mode', currentMode); // Send current mode (agent/ask)

        var startTime = Date.now();

        try {
            const response = await fetch(acfBlockBuilder.ajax_url, {
                method: 'POST',
                body: formData,
                signal: currentAbortController.signal
            });

            if (!response.body) throw new Error('ReadableStream not supported.');

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            
            // Streaming State Machine
            let sseBuffer = '';
            let jsonAccumulator = ''; // To rebuild JSON objects split across chunks
            let processorBuffer = ''; // Contains the decoded text to be processed
            let currentMode = 'chat'; // 'chat' or 'code'
            let currentFileKey = null;
            let currentCodeWidget = null;
            let hasReceivedFirstToken = false;
            let lastFileKey = null;
            
            // Duplicate Summary Suppression Logic
            let suppressChatOutput = false;
            let hasSeenSummary = false;
            
            // Reset pending changes for this run
            pendingAIChanges = {};

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value, { stream: true });
                sseBuffer += chunk;
                
                // Process SSE lines
                let lineEndIndex;
                while ((lineEndIndex = sseBuffer.indexOf('\n')) !== -1) {
                    const line = sseBuffer.substring(0, lineEndIndex);
                    sseBuffer = sseBuffer.substring(lineEndIndex + 1);

                    if (line.startsWith('data: ')) {
                        const dataContent = line.replace('data: ', '').trim();
                        if (dataContent === '[DONE]') break;
                        if (!dataContent) continue;

                        try {
                            // Decode base64 -> UTF8
                            const binaryStr = atob(dataContent);
                            const bytes = new Uint8Array(binaryStr.length);
                            for (let i = 0; i < binaryStr.length; i++) {
                                bytes[i] = binaryStr.charCodeAt(i);
                            }
                            const textChunk = new TextDecoder().decode(bytes);
                            
                            // Check if this is provider/mode info (first message)
                            try {
                                const providerInfo = JSON.parse(textChunk);
                                if (providerInfo.provider && providerInfo.model && !currentProvider) {
                                    currentProvider = providerInfo.provider;
                                    currentModel = providerInfo.model;
                                    if (providerInfo.mode) {
                                        currentResponseMode = providerInfo.mode;
                                    }
                                    // Update avatar with provider logo
                                    $aiMessage.find('.acf-bb-avatar').html('<img src="' + acfBlockBuilder.plugin_url + 'assets/images/' + currentProvider + '.svg" alt="' + currentProvider + '" />').addClass('acf-bb-avatar-' + currentProvider);
                                    continue; // Skip to next line
                                }
                            } catch (e) {
                                // Not provider info, continue with normal processing
                            }
                            
                            // Accumulate JSON text
                            jsonAccumulator += textChunk;
                            
                            // Try to parse complete JSON objects from accumulator
                            // The stream sends an array of objects: [{...}, {...}] or just comma separated objects inside an array structure
                            // But usually Gemini REST API stream sends: [{ "candidates": [...] }]
                            // However, we are decoding chunks that might cut through the middle of a JSON object.
                            
                            // Simple brace counting parser to extract valid JSON objects
                            while (true) {
                                jsonAccumulator = jsonAccumulator.trimStart();
                                
                                // Skip array brackets and commas typical in streaming responses
                                if (jsonAccumulator.startsWith('[') || jsonAccumulator.startsWith(',') || jsonAccumulator.startsWith(']')) {
                                    jsonAccumulator = jsonAccumulator.substring(1);
                                    continue;
                                }
                                
                                if (!jsonAccumulator.startsWith('{')) break; // Wait for more data

                                let openBraces = 0;
                                let endIndex = -1;
                                let inString = false;
                                let escaped = false;
                                
                                for (let i = 0; i < jsonAccumulator.length; i++) {
                                    const char = jsonAccumulator[i];
                                    if (escaped) { escaped = false; continue; }
                                    if (char === '\\') { escaped = true; continue; }
                                    if (char === '"') { inString = !inString; continue; }
                                    
                                    if (!inString) {
                                        if (char === '{') openBraces++;
                                        if (char === '}') {
                                            openBraces--;
                                            if (openBraces === 0) {
                                                endIndex = i;
                                                break;
                                            }
                                        }
                                    }
                                }
                                
                                if (endIndex !== -1) {
                                    const jsonStr = jsonAccumulator.substring(0, endIndex + 1);
                                    jsonAccumulator = jsonAccumulator.substring(endIndex + 1);
                                    
                                    try {
                                        const geminiChunk = JSON.parse(jsonStr);
                                        if (geminiChunk.candidates && geminiChunk.candidates[0].content) {
                                            let newText = geminiChunk.candidates[0].content.parts[0].text;
                                            if (newText) {
                                                processorBuffer += newText;
                                                
                                                // Remove "Thinking..." on first actual text received
                                                if (!hasReceivedFirstToken) {
                                                    $aiContent.html(''); // Clear the typing indicator
                                                    hasReceivedFirstToken = true;
                                                }
                                            }
                                        }
                                    } catch (e) {
                                        console.error('JSON Parse Error', e);
                                    }
                                } else {
                                    break; // Wait for more data
                                }
                            }
                        } catch (e) {
                            console.error('Stream processing error', e);
                        }
                    }
                }
                
                // Process the accumulated text buffer (Chat vs Code)
                while (true) {
                    if (currentMode === 'chat') {
                        // Permissive regex to catch variations like "FILE: block.json" or "FILE:block_json"
                        const match = processorBuffer.match(/@@@\s*FILE\s*:\s*([a-zA-Z0-9_\-\.]+)\s*@@@/);
                        if (match) {
                            const chatText = processorBuffer.substring(0, match.index);
                            if (chatText && !suppressChatOutput) {
                                $aiContent.append(textToParagraphs(chatText));
                            }
                            
                            currentMode = 'code';
                            currentFileKey = match[1].trim();

                            // Normalize filenames to internal keys if the AI used filenames
                            if (currentFileKey === 'block.json') currentFileKey = 'block_json';
                            if (currentFileKey === 'render.php') currentFileKey = 'render_php';
                            if (currentFileKey === 'style.css') currentFileKey = 'style_css';
                            if (currentFileKey === 'script.js') currentFileKey = 'script_js';
                            if (currentFileKey === 'fields.php') currentFileKey = 'fields_php';
                            if (currentFileKey === 'assets.php') currentFileKey = 'assets_php';
                            
                            // Reset suppression if we enter a new file
                            suppressChatOutput = false;
                            
                            if (currentFileKey === 'summary') {
                                hasSeenSummary = true;
                                // Create Summary Widget
                                var $summaryWidget = $('<div class="acf-bb-summary-widget"></div>');
                                $summaryWidget.append('<div class="acf-bb-summary-header"><span class="dashicons dashicons-list-view"></span> Change Summary</div>');
                                var $list = $('<ul class="acf-bb-summary-list"></ul>');
                                $summaryWidget.append($list);
                                $aiContent.append($summaryWidget);
                                currentCodeWidget = { 
                                    $el: $summaryWidget, 
                                    $code: { 
                                        text: function(txt) {
                                            if (txt === undefined) return $list.data('raw-text') || '';
                                            $list.data('raw-text', txt);
                                            
                                            // Parse list items
                                            var items = txt.split('\n').filter(function(line) { return line.trim().length > 0; });
                                            $list.empty();
                                            items.forEach(function(item) {
                                                item = item.trim();
                                                
                                                // Check for headers (ends with ** or :)
                                                var isHeader = false;
                                                if (item.match(/^[\d\.]+\s+.*(\*\*|:)$/) || item.match(/^.*(\*\*|:)$/) || item.indexOf('**') === 0) {
                                                     // If it looks like a header but starts with a list marker, treat as list item unless it's purely bold
                                                     if (!item.match(/^[-*]\s/)) {
                                                         isHeader = true;
                                                     }
                                                }
                                                
                                                // Clean up markdown
                                                // Remove leading list markers only if it's a list item
                                                var cleanItem = item;
                                                if (!isHeader) {
                                                    cleanItem = item.replace(/^[\s\-*#\d\.]+/, '').trim();
                                                } else {
                                                    // For headers, remove leading numbers/hashes but keep text
                                                    cleanItem = item.replace(/^[#\d\.]+\s*/, '').trim();
                                                }
                                                
                                                // Handle bold markdown **text**
                                                cleanItem = cleanItem.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
                                                // Handle trailing ** artifacts
                                                cleanItem = cleanItem.replace(/\*\*$/, '');
                                                // Handle bold at start if not closed
                                                cleanItem = cleanItem.replace(/^\*\*/, '');

                                                if (cleanItem) {
                                                    // Process Smart Tokens
                                                    var processedItem = cleanItem;
                                                    if (window.SmartTokens && window.SmartTokens.processPlainText) {
                                                        processedItem = window.SmartTokens.processPlainText(cleanItem);
                                                    }
                                                    
                                                    if (isHeader) {
                                                        $list.append('<li class="summary-header">' + processedItem + '</li>');
                                                    } else {
                                                        $list.append('<li><span class="dashicons dashicons-yes"></span> ' + processedItem + '</li>');
                                                    }
                                                }
                                            });
                                            return txt;
                                        }
                                    } 
                                };
                            } else if (currentFileKey === 'plan') {
                                // Create Plan Widget
                                var $planWidget = $('<div class="acf-bb-summary-widget"></div>');
                                $planWidget.append('<div class="acf-bb-summary-header"><span class="dashicons dashicons-clipboard"></span> Implementation Plan</div>');
                                var $planContent = $('<div class="acf-bb-plan-content"></div>');
                                $planWidget.append($planContent);
                                $aiContent.append($planWidget);
                                
                                currentCodeWidget = { 
                                    $el: $planWidget, 
                                    $code: { 
                                        text: function(txt) {
                                            if (txt === undefined) return $planContent.html();
                                            // Simple markdown parsing for the plan
                                            var lines = txt.split('\n').filter(function(line) { return line.trim().length > 0; });
                                            var html = '';
                                            lines.forEach(function(line) {
                                                line = line.trim();
                                                // Headers
                                                if (line.match(/^### /)) {
                                                    html += '<strong>' + line.replace(/^### /, '') + '</strong>';
                                                }
                                                // Numbered items
                                                else if (line.match(/^\d+\. /)) {
                                                    html += '<div class="acf-bb-plan-item">• ' + line.replace(/^\d+\. /, '').replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>') + '</div>';
                                                }
                                                // Other lines
                                                else {
                                                    html += '<div>' + line.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>') + '</div>';
                                                }
                                            });
                                            
                                            $planContent.html(html);
                                            return txt;
                                        }
                                    } 
                                };
                            } else {
                                // Create Standard Code Widget
                                currentCodeWidget = createCodeWidget(currentFileKey);
                                $aiContent.append(currentCodeWidget.$el);
                            }
                            
                            processorBuffer = processorBuffer.substring(match.index + match[0].length);
                            scrollToBottom();
                        } else {
                            // Flush safe chat text
                            // We used to only flush if buffer > 50 chars, but this delays the "thinking" text.
                            // Let's flush more aggressively, only holding back if we are near a potential @@@ tag.
                            
                            const tagStart = processorBuffer.indexOf('@');
                            if (tagStart === -1) {
                                // No @ symbol.
                                
                                // SAFETY NET: If we have seen a summary, and the text looks like a summary list, suppress it forcibly
                                if (hasSeenSummary && !suppressChatOutput) {
                                    if (processorBuffer.match(/^[\s\n]*[-*] \*\*/)) {
                                        suppressChatOutput = true;
                                    }
                                }

                                if (suppressChatOutput) {
                                    processorBuffer = '';
                                }
                                
                                if (processorBuffer.length > 0) {
                                    $aiContent.append(textToParagraphs(processorBuffer));
                                    processorBuffer = '';
                                }
                            } else {
                                // Has @ symbol. 
                                if (tagStart > 0) {
                                    const textToFlush = processorBuffer.substring(0, tagStart);
                                    
                                    // SAFETY NET: If we have seen a summary, and the text looks like a summary list, suppress it forcibly
                                    if (hasSeenSummary && !suppressChatOutput) {
                                        if (textToFlush.match(/^[\s\n]*[-*] \*\*/)) {
                                            suppressChatOutput = true;
                                        }
                                    }

                                    if (!suppressChatOutput) {
                                        $aiContent.append(textToParagraphs(textToFlush));
                                    }
                                    
                                    processorBuffer = processorBuffer.substring(tagStart);
                                }
                                
                                // Now processorBuffer starts with @.
                                // If suppressChatOutput is true, we technically don't care about the @ UNLESS it starts a tag.
                                // But if it starts a tag, that tag processing logic (above) will handle the reset.
                                // So we can just let it flow into the "wait for tag" logic.
                                
                                // We need to wait to see if it becomes @@@FILE:...
                                // The longest tag is roughly @@@FILE:block_json@@@ which is ~20 chars.
                                // If buffer is longer than 30 chars and still no match, it's likely just text with @ symbols.
                                if (processorBuffer.length > 30) {
                                    // It's not a tag (regex match would have caught it).
                                    // Flush the first character and continue loop
                                    
                                    const char = processorBuffer.substring(0, 1);
                                    if (!suppressChatOutput) {
                                        $aiContent.append(char);
                                        // Too noisy to log every char
                                    }
                                    
                                    processorBuffer = processorBuffer.substring(1);
                                    continue; // Re-evaluate loop
                                }
                            }
                            break; // Wait for more data
                        }
                    } else if (currentMode === 'code') {
                        const match = processorBuffer.match(/@@@\s*END_FILE\s*@@@/);
                        if (match) {
                            const codeContent = processorBuffer.substring(0, match.index);
                            if (currentCodeWidget) {
                                currentCodeWidget.$code.text(currentCodeWidget.$code.text() + codeContent);
                                if (!pendingAIChanges[currentFileKey]) pendingAIChanges[currentFileKey] = '';
                                pendingAIChanges[currentFileKey] += codeContent;
                            }
                            
                            lastFileKey = currentFileKey;
                            
                            // If we just finished a summary, suppress all subsequent chat text
                            // until another file tag appears.
                            if (lastFileKey === 'summary') {
                                suppressChatOutput = true;
                            } else {
                                suppressChatOutput = false;
                            }
                            
                            currentMode = 'chat';
                            currentFileKey = null;
                            currentCodeWidget = null;
                            
                            processorBuffer = processorBuffer.substring(match.index + match[0].length);
                        } else {
                            // Flush safe code
                             const tagStart = processorBuffer.indexOf('@');
                            if (tagStart === -1) {
                                // No @ symbol, flush everything
                                if (processorBuffer.length > 0) {
                                     if (currentCodeWidget) {
                                        currentCodeWidget.$code.text(currentCodeWidget.$code.text() + processorBuffer);
                                        if (!pendingAIChanges[currentFileKey]) pendingAIChanges[currentFileKey] = '';
                                        pendingAIChanges[currentFileKey] += processorBuffer;
                                    }
                                    processorBuffer = '';
                                }
                            } else {
                                // Has @ symbol. Flush up to the first @.
                                if (tagStart > 0) {
                                    const textToFlush = processorBuffer.substring(0, tagStart);
                                     if (currentCodeWidget) {
                                        currentCodeWidget.$code.text(currentCodeWidget.$code.text() + textToFlush);
                                        if (!pendingAIChanges[currentFileKey]) pendingAIChanges[currentFileKey] = '';
                                        pendingAIChanges[currentFileKey] += textToFlush;
                                    }
                                    processorBuffer = processorBuffer.substring(tagStart);
                                }
                                
                                if (processorBuffer.length > 20) {
                                    // Not a tag (regex match would have caught it).
                                    // Flush the first character
                                    const char = processorBuffer.substring(0, 1);
                                     if (currentCodeWidget) {
                                        currentCodeWidget.$code.text(currentCodeWidget.$code.text() + char);
                                        if (!pendingAIChanges[currentFileKey]) pendingAIChanges[currentFileKey] = '';
                                        pendingAIChanges[currentFileKey] += char;
                                    }
                                    processorBuffer = processorBuffer.substring(1);
                                    continue;
                                }
                            }
                            break;
                        }
                    }
                }
            }
            
            // Stream finished. Flush remaining buffer.
             if (processorBuffer) {
                if (currentMode === 'chat') {
                    if (suppressChatOutput) {
                        processorBuffer = '';
                    }
                    
                    if (processorBuffer.length > 0) {
                         $aiContent.append(textToParagraphs(processorBuffer));
                    }
                } else if (currentMode === 'code' && currentCodeWidget) {
                    currentCodeWidget.$code.text(currentCodeWidget.$code.text() + processorBuffer);
                    if (!pendingAIChanges[currentFileKey]) pendingAIChanges[currentFileKey] = '';
                    pendingAIChanges[currentFileKey] += processorBuffer;
                }
            }

            $aiMessage.removeClass('streaming');
            
            // Save structured data to history (code as plain text, not Monaco HTML)
            // This prevents JSON parsing issues while preserving the code content
            var historyEntry = {
                type: 'ai',
                text: '',
                code: {},
                summary: [],
                image_url: null,
                provider: currentProvider,
                model: currentModel,
                mode: currentResponseMode
            };
            
            // Extract code from pendingAIChanges (plain text, not HTML)
            $.each(keyMap, function(tabId, dataKey) {
                if (pendingAIChanges[dataKey]) {
                    // Store the raw code string
                    historyEntry.code[dataKey] = pendingAIChanges[dataKey]
                        .replace(/^\s*\n/, '')
                        .replace(/\n\s*$/, '');
                }
            });
            
            // Extract summary as array of items
            if (pendingAIChanges.summary) {
                var summaryLines = pendingAIChanges.summary.split('\n').filter(function(line) {
                    return line.trim().length > 0;
                });
                summaryLines.forEach(function(line) {
                    var cleanLine = line.replace(/^[\s\-*#\d\.]+/, '').trim();
                    if (cleanLine) {
                        historyEntry.summary.push(cleanLine);
                    }
                });
            }
            
            // Build text description
            var changedFiles = Object.keys(historyEntry.code).map(function(k) {
                if (k.startsWith('custom_')) {
                    // Parse custom file key properly (e.g., custom_readme_txt -> readme.txt)
                    var keyParts = k.replace('custom_', '').split('_');
                    var ext = keyParts.pop();
                    var baseName = keyParts.join('_').replace(/_/g, '-');
                    return baseName + '.' + ext;
                }
                return k.replace('_', '.');
            });
            if (changedFiles.length > 0) {
                historyEntry.text = 'Updated: ' + changedFiles.join(', ');
            } else {
                historyEntry.text = 'Code generation completed.';
            }
            
            chatHistory.push(historyEntry);
            saveChatHistory();
            
            // Auto-save after AI completes message
            autoSavePost();
            
            // Only trigger Diff View in Agent mode
            if (currentResponseMode === 'agent') {
                if (Object.keys(pendingAIChanges).length > 0) {
                     showDiffOverlay(pendingAIChanges);
                     var duration = ((Date.now() - startTime) / 1000).toFixed(1);
                     
                     var statusMsg = '<div><strong>Updates ready for review. (' + duration + 's)</strong></div>';
                     $aiContent.append(statusMsg);
                } else {
                     var statusMsg = '<div><em>No code changes detected.</em></div>';
                     $aiContent.append(statusMsg);
                }
            } else {
                // Ask mode - just show completion message
                var duration = ((Date.now() - startTime) / 1000).toFixed(1);
                var statusMsg = '<div class="acf-bb-ask-mode-footer"><em>Response complete (' + duration + 's). Switch to Agent mode to generate code.</em></div>';
                $aiContent.append(statusMsg);
            }

        } catch (err) {
            if (err.name === 'AbortError') {
                 $aiContent.append('<div class="acf-bb-system-message" style="color: #d63638; margin-top: 10px;"><em><span class="dashicons dashicons-no-alt" style="font-size: 14px; width: 14px; height: 14px; vertical-align: middle;"></span> Generation stopped by user.</em></div>');
            } else {
                $aiContent.append('<div class="error">Connection Error: ' + err.message + '</div>');
            }
        } finally {
            // Reset button
            var $btn = $('#acf-block-builder-generate');
            $btn.removeClass('acf-bb-stop-mode');
            $btn.html('<span class="dashicons dashicons-arrow-up-alt2"></span>');
            $btn.removeAttr('title');
            
            // Re-evaluate disabled state
            var prompt = '';
            var hasAttachedFiles = false;
            
            if (window.MentionAutocomplete && window.MentionAutocomplete.getPlainText) {
                prompt = window.MentionAutocomplete.getPlainText().trim();
                hasAttachedFiles = window.MentionAutocomplete.getAttachedTokens().length > 0;
            } else {
                prompt = $('#acf_block_builder_prompt').val().trim();
            }
            
            var imageId = $('#acf_block_builder_image_id').val();
            $btn.prop('disabled', !prompt && !imageId && !hasAttachedFiles);
            
            currentAbortController = null;
        }
    });

    // Enter key support
    $('#acf_block_builder_prompt').on('keydown', function(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            $('#acf-block-builder-generate').click();
        }
    });

    // Export ZIP
    $('#acf-block-builder-export').on('click', function(e) {
        e.preventDefault();
        var postId = $(this).data('post-id');
        var exportUrl = acfBlockBuilder.ajax_url + '?action=acf_block_builder_export_zip&post_id=' + postId + '&nonce=' + acfBlockBuilder.export_nonce;
        window.location.href = exportUrl;
    });

    // Export Plugin
    $('#acf-block-builder-export-plugin').on('click', function(e) {
        e.preventDefault();
        var postId = $(this).data('post-id');
        var exportUrl = acfBlockBuilder.ajax_url + '?action=acf_block_builder_export_plugin&post_id=' + postId + '&nonce=' + acfBlockBuilder.export_nonce;
        window.location.href = exportUrl;
    });

    // Export to Theme
    $('#acf-block-builder-export-theme').on('click', function(e) {
        e.preventDefault();
        if (!confirm('This will copy the block files to your active theme\'s "blocks" directory. Continue?')) {
            return;
        }

        var postId = $(this).data('post-id');
        var $btn = $(this);
        $btn.prop('disabled', true);

        $.ajax({
            url: acfBlockBuilder.ajax_url,
            type: 'POST',
            data: {
                action: 'acf_block_builder_export_theme',
                nonce: acfBlockBuilder.export_nonce,
                post_id: postId
            },
            success: function(response) {
                if (response.success) {
                    alert(response.data);
                } else {
                    alert('Error: ' + response.data);
                }
            },
            error: function() {
                alert('System Error: Could not connect to the server.');
            },
            complete: function() {
                $btn.prop('disabled', false);
            }
        });
    });

    // Toggle JSON Sync Visibility
    $('#acf_block_builder_json_sync').on('change', function() {
        if ($(this).is(':checked')) {
            $('#acf-bb-json-actions').slideDown();
        } else {
            $('#acf-bb-json-actions').slideUp();
        }
    });

    // Sync Back Button
    $('#acf-block-builder-sync-back').on('click', function(e) {
        e.preventDefault();
        if (!confirm('This will overwrite the internal "fields.php" with the fields from the ACF JSON file. Continue?')) {
            return;
        }

        var $btn = $(this);
        var postId = $btn.data('post-id');
        $btn.prop('disabled', true);
        
        var originalText = $btn.html();
        $btn.text('Importing...');

        $.ajax({
            url: acfBlockBuilder.ajax_url,
            type: 'POST',
            data: {
                action: 'acf_block_builder_sync_back',
                nonce: acfBlockBuilder.export_nonce,
                post_id: postId
            },
            success: function(response) {
                if (response.success) {
                    alert(response.data);
                    location.reload();
                } else {
                    alert('Error: ' + response.data);
                    $btn.html(originalText);
                }
            },
            error: function() {
                alert('System Error: Could not connect to the server.');
                $btn.html(originalText);
            },
            complete: function() {
                $btn.prop('disabled', false);
            }
        });
    });

    // ==========================================
    // VERSION HISTORY MANAGER
    // ==========================================
    
    var versionManager = {
        currentFileType: 'json',
        allVersions: {},
        versionDiffEditor: null,
        selectedVersionFrom: null,
        selectedVersionTo: null,
        
        fileTypeMap: {
            'json': 'block-json',
            'php': 'render-php',
            'css': 'style-css',
            'js': 'script-js',
            'fields': 'fields-php',
            'assets': 'assets-php'
        },
        
        languageMap: {
            'json': 'json',
            'php': 'php',
            'css': 'css',
            'js': 'javascript',
            'fields': 'php',
            'assets': 'php'
        },
        
        init: function() {
            var self = this;
            
            // Open version history overlay
            $('#acf-bb-open-history').on('click', function(e) {
                e.preventDefault();
                self.openOverlay();
            });
            
            // Close overlay
            $('#acf-bb-version-close').on('click', function(e) {
                e.preventDefault();
                self.closeOverlay();
            });
            
            // Close on overlay background click
            $('#acf-bb-version-overlay').on('click', function(e) {
                if ($(e.target).is('#acf-bb-version-overlay')) {
                    self.closeOverlay();
                }
            });
            
            // File type tab switching
            $('.acf-bb-version-file-tab').on('click', function(e) {
                e.preventDefault();
                var fileType = $(this).data('file-type');
                self.switchFileType(fileType);
            });
            
            // Version selection from list
            $(document).on('click', '.acf-bb-version-item', function(e) {
                e.preventDefault();
                var versionId = $(this).data('version-id');
                self.selectVersion(versionId);
            });
            
            // Version dropdown changes
            $('#acf-bb-version-from, #acf-bb-version-to').on('change', function() {
                self.onVersionSelectChange();
            });
            
            // Restore button
            $('#acf-bb-version-restore').on('click', function(e) {
                e.preventDefault();
                self.restoreSelectedVersion();
            });
            
            // ESC key to close
            $(document).on('keydown', function(e) {
                if (e.key === 'Escape' && $('#acf-bb-version-overlay').is(':visible')) {
                    self.closeOverlay();
                }
            });
        },
        
        openOverlay: function() {
            var self = this;
            $('#acf-bb-version-overlay').addClass('visible').show();
            
            // Get the current active tab's file type
            var activeTab = $('.acf-bb-tabs .acf-bb-tab.active');
            if (activeTab.length && activeTab.data('file-type')) {
                this.currentFileType = activeTab.data('file-type');
            }
            
            // Load all versions
            this.loadAllVersions();
        },
        
        closeOverlay: function() {
            $('#acf-bb-version-overlay').removeClass('visible').hide();
            
            // Dispose diff editor to free memory
            if (this.versionDiffEditor) {
                this.versionDiffEditor.dispose();
                this.versionDiffEditor = null;
            }
        },
        
        loadAllVersions: function() {
            var self = this;
            
            // Show loading state
            $('#acf-bb-version-list').html('<div class="acf-bb-version-loading"><span class="spinner is-active"></span> Loading versions...</div>');
            
            $.ajax({
                url: acfBlockBuilder.ajax_url,
                type: 'POST',
                data: {
                    action: 'acf_bb_get_all_file_versions',
                    nonce: acfBlockBuilder.versions_nonce,
                    post_id: acfBlockBuilder.post_id
                },
                success: function(response) {
                    if (response.success) {
                        self.allVersions = response.data.versions || {};
                        self.updateVersionCounts(response.data.counts || {});
                        self.switchFileType(self.currentFileType);
                    } else {
                        $('#acf-bb-version-list').html('<div class="acf-bb-version-empty">' + (acfBlockBuilder.i18n.no_versions || 'No versions found.') + '</div>');
                    }
                },
                error: function() {
                    $('#acf-bb-version-list').html('<div class="acf-bb-version-error">Error loading versions.</div>');
                }
            });
        },
        
        updateVersionCounts: function(counts) {
            var self = this;
            var $tabContainer = $('.acf-bb-version-file-tabs');
            
            // First update existing tabs
            $.each(counts, function(fileType, data) {
                var $badge = $('[data-count-for="' + fileType + '"]');
                if ($badge.length) {
                    $badge.text(data.count > 0 ? data.count : '-');
                }
            });
            
            // Remove old custom file tabs
            $tabContainer.find('.acf-bb-version-file-tab.is-custom').remove();
            
            // Add tabs for custom files
            $.each(counts, function(fileType, data) {
                // Check if it's a custom file (starts with 'custom_')
                if (fileType.indexOf('custom_') === 0) {
                    // Check if tab already exists
                    if ($tabContainer.find('[data-file-type="' + fileType + '"]').length === 0) {
                        var label = data.label || fileType;
                        var ext = self.getExtensionFromFilename(label);
                        var icon = self.getIconForExtension(ext);
                        
                        var $tab = $('<button type="button" class="acf-bb-version-file-tab is-custom" data-file-type="' + fileType + '">' +
                            '<span class="file-name">' + label + '</span>' +
                            '<span class="version-count" data-count-for="' + fileType + '">' + (data.count > 0 ? data.count : '-') + '</span>' +
                            '</button>');
                        
                        $tabContainer.append($tab);
                        
                        // Bind click handler
                        $tab.on('click', function(e) {
                            e.preventDefault();
                            self.switchFileType(fileType);
                        });
                    }
                }
            });
        },
        
        getExtensionFromFilename: function(filename) {
            var parts = filename.split('.');
            return parts.length > 1 ? parts.pop().toLowerCase() : '';
        },
        
        getIconForExtension: function(ext) {
            var iconMap = {
                'php': 'dashicons-editor-code',
                'js': 'dashicons-media-default',
                'css': 'dashicons-art',
                'json': 'dashicons-media-code',
                'html': 'dashicons-media-text',
                'txt': 'dashicons-text-page'
            };
            return iconMap[ext] || 'dashicons-media-text';
        },
        
        getLanguageForFileType: function(fileType) {
            // Check core file types first
            if (this.languageMap[fileType]) {
                return this.languageMap[fileType];
            }
            
            // For custom files, extract from the file label
            if (fileType.indexOf('custom_') === 0 && this.allVersions[fileType]) {
                var label = this.allVersions[fileType].label || '';
                var ext = this.getExtensionFromFilename(label);
                return this.getLanguageForExtension(ext);
            }
            
            return 'text';
        },
        
        getLanguageForExtension: function(ext) {
            var langMap = {
                'php': 'php',
                'js': 'javascript',
                'css': 'css',
                'json': 'json',
                'html': 'html',
                'txt': 'plaintext',
                'md': 'markdown',
                'xml': 'xml',
                'svg': 'xml',
                'sql': 'sql',
                'sh': 'shell',
                'bash': 'shell'
            };
            return langMap[ext] || 'plaintext';
        },
        
        switchFileType: function(fileType) {
            var self = this;
            this.currentFileType = fileType;
            
            // Update active tab
            $('.acf-bb-version-file-tab').removeClass('active');
            $('[data-file-type="' + fileType + '"]').addClass('active');
            
            // Clear selections
            this.selectedVersionFrom = null;
            this.selectedVersionTo = null;
            
            // Render version list
            this.renderVersionList();
            
            // Reset dropdowns
            this.updateVersionDropdowns();
            
            // Clear diff viewer
            this.showPlaceholder();
        },
        
        renderVersionList: function() {
            var self = this;
            var $list = $('#acf-bb-version-list');
            var fileData = this.allVersions[this.currentFileType];
            
            if (!fileData || !fileData.versions || fileData.versions.length === 0) {
                $list.html('<div class="acf-bb-version-empty">' + (acfBlockBuilder.i18n.no_versions || 'No version history yet.') + '</div>');
                return;
            }
            
            var html = '';
            var versions = fileData.versions;
            
            versions.forEach(function(v, index) {
                var isLatest = index === 0;
                var date = self.formatDate(v.created_at);
                var time = self.formatTime(v.created_at);
                
                html += '<div class="acf-bb-version-item' + (isLatest ? ' is-latest' : '') + '" data-version-id="' + v.id + '">';
                html += '<div class="acf-bb-version-item-header">';
                html += '<span class="acf-bb-version-number">v' + v.version_number + '</span>';
                if (isLatest) {
                    html += '<span class="acf-bb-version-badge">' + (acfBlockBuilder.i18n.current || 'Current') + '</span>';
                }
                html += '</div>';
                html += '<div class="acf-bb-version-item-meta">';
                html += '<span class="acf-bb-version-author"><span class="dashicons dashicons-admin-users"></span> ' + (v.author_name || 'Unknown') + '</span>';
                html += '<span class="acf-bb-version-date"><span class="dashicons dashicons-calendar-alt"></span> ' + date + ' ' + time + '</span>';
                html += '</div>';
                html += '<div class="acf-bb-version-item-actions">';
                html += '<button type="button" class="button button-small acf-bb-compare-btn" data-version-id="' + v.id + '">Compare</button>';
                if (!isLatest) {
                    html += '<button type="button" class="button button-small acf-bb-restore-btn" data-version-id="' + v.id + '">Restore</button>';
                }
                html += '</div>';
                html += '</div>';
            });
            
            $list.html(html);
            
            // Bind compare buttons
            $list.find('.acf-bb-compare-btn').on('click', function(e) {
                e.stopPropagation();
                var versionId = $(this).data('version-id');
                self.compareWithCurrent(versionId);
            });
            
            // Bind restore buttons
            $list.find('.acf-bb-restore-btn').on('click', function(e) {
                e.stopPropagation();
                var versionId = $(this).data('version-id');
                self.restoreVersion(versionId);
            });
        },
        
        updateVersionDropdowns: function() {
            var self = this;
            var fileData = this.allVersions[this.currentFileType];
            var $from = $('#acf-bb-version-from');
            var $to = $('#acf-bb-version-to');
            
            // Clear options
            $from.html('<option value="">' + (acfBlockBuilder.i18n.select_versions || 'Select version...') + '</option>');
            $to.html('<option value="">' + (acfBlockBuilder.i18n.select_versions || 'Select version...') + '</option>');
            
            if (!fileData || !fileData.versions) return;
            
            fileData.versions.forEach(function(v, index) {
                var label = 'v' + v.version_number + ' - ' + self.formatDate(v.created_at);
                if (index === 0) label += ' (Current)';
                
                $from.append('<option value="' + v.id + '">' + label + '</option>');
                $to.append('<option value="' + v.id + '">' + label + '</option>');
            });
            
            // Pre-select first two if available
            if (fileData.versions.length >= 2) {
                $from.val(fileData.versions[1].id); // Older
                $to.val(fileData.versions[0].id);   // Newer (current)
                this.selectedVersionFrom = fileData.versions[1].id;
                this.selectedVersionTo = fileData.versions[0].id;
            }
        },
        
        onVersionSelectChange: function() {
            this.selectedVersionFrom = $('#acf-bb-version-from').val();
            this.selectedVersionTo = $('#acf-bb-version-to').val();
            
            if (this.selectedVersionFrom && this.selectedVersionTo) {
                this.loadDiff(this.selectedVersionFrom, this.selectedVersionTo);
                $('#acf-bb-version-restore').prop('disabled', false);
            } else {
                this.showPlaceholder();
                $('#acf-bb-version-restore').prop('disabled', true);
            }
        },
        
        selectVersion: function(versionId) {
            // Highlight selected item
            $('.acf-bb-version-item').removeClass('selected');
            $('[data-version-id="' + versionId + '"]').addClass('selected');
            
            // Compare with current (latest) version
            this.compareWithCurrent(versionId);
        },
        
        compareWithCurrent: function(versionId) {
            var self = this;
            var fileData = this.allVersions[this.currentFileType];
            
            if (!fileData || !fileData.versions || fileData.versions.length === 0) return;
            
            var currentVersionId = fileData.versions[0].id;
            
            // Update dropdowns
            $('#acf-bb-version-from').val(versionId);
            $('#acf-bb-version-to').val(currentVersionId);
            
            this.selectedVersionFrom = versionId;
            this.selectedVersionTo = currentVersionId;
            
            this.loadDiff(versionId, currentVersionId);
            $('#acf-bb-version-restore').prop('disabled', false);
        },
        
        loadDiff: function(versionIdA, versionIdB) {
            var self = this;
            
            // Show loading
            $('#acf-bb-version-diff-container').html('<div class="acf-bb-version-loading"><span class="spinner is-active"></span> ' + (acfBlockBuilder.i18n.comparing || 'Loading diff...') + '</div>');
            
            $.ajax({
                url: acfBlockBuilder.ajax_url,
                type: 'POST',
                data: {
                    action: 'acf_bb_get_version_diff',
                    nonce: acfBlockBuilder.versions_nonce,
                    version_a: versionIdA,
                    version_b: versionIdB
                },
                success: function(response) {
                    if (response.success) {
                        self.renderDiffEditor(response.data.original, response.data.modified);
                    } else {
                        $('#acf-bb-version-diff-container').html('<div class="acf-bb-version-error">Error loading diff.</div>');
                    }
                },
                error: function() {
                    $('#acf-bb-version-diff-container').html('<div class="acf-bb-version-error">Connection error.</div>');
                }
            });
        },
        
        renderDiffEditor: function(originalData, modifiedData) {
            var self = this;
            var container = document.getElementById('acf-bb-version-diff-container');
            
            // Clear container
            $(container).empty();
            
            // Dispose existing editor
            if (this.versionDiffEditor) {
                this.versionDiffEditor.dispose();
                this.versionDiffEditor = null;
            }
            
            // Wait for Monaco to be available
            if (typeof monaco === 'undefined') {
                $(container).html('<div class="acf-bb-version-error">Editor not loaded. Please try again.</div>');
                return;
            }
            
            var language = this.getLanguageForFileType(this.currentFileType);
            
            // Create diff editor
            this.versionDiffEditor = monaco.editor.createDiffEditor(container, {
                automaticLayout: true,
                theme: 'vs-dark',
                readOnly: true,
                originalEditable: false,
                renderSideBySide: true,
                enableSplitViewResizing: true,
                scrollBeyondLastLine: false,
                minimap: { enabled: false }
            });
            
            var originalModel = monaco.editor.createModel(originalData.content || '', language);
            var modifiedModel = monaco.editor.createModel(modifiedData.content || '', language);
            
            this.versionDiffEditor.setModel({
                original: originalModel,
                modified: modifiedModel
            });
        },
        
        showPlaceholder: function() {
            var $container = $('#acf-bb-version-diff-container');
            
            if (this.versionDiffEditor) {
                this.versionDiffEditor.dispose();
                this.versionDiffEditor = null;
            }
            
            $container.html(
                '<div class="acf-bb-version-placeholder">' +
                '<span class="dashicons dashicons-visibility"></span>' +
                '<p>' + (acfBlockBuilder.i18n.select_versions || 'Select versions to compare.') + '</p>' +
                '</div>'
            );
        },
        
        restoreSelectedVersion: function() {
            if (!this.selectedVersionFrom) return;
            this.restoreVersion(this.selectedVersionFrom);
        },
        
        restoreVersion: function(versionId) {
            var self = this;
            
            if (!confirm(acfBlockBuilder.i18n.confirm_restore || 'Are you sure you want to restore this version?')) {
                return;
            }
            
            $.ajax({
                url: acfBlockBuilder.ajax_url,
                type: 'POST',
                data: {
                    action: 'acf_bb_restore_file_version',
                    nonce: acfBlockBuilder.versions_nonce,
                    post_id: acfBlockBuilder.post_id,
                    version_id: versionId
                },
                success: function(response) {
                    if (response.success) {
                        // Update the editor with restored content
                        var editorKey = self.fileTypeMap[response.data.file_type];
                        if (editors[editorKey]) {
                            editors[editorKey].setValue(response.data.content);
                        }
                        
                        alert(acfBlockBuilder.i18n.restored || 'Version restored successfully!');
                        
                        // Reload versions
                        self.loadAllVersions();
                    } else {
                        alert('Error: ' + response.data);
                    }
                },
                error: function() {
                    alert('Connection error. Please try again.');
                }
            });
        },
        
        formatDate: function(dateStr) {
            if (!dateStr) return '';
            var date = new Date(dateStr.replace(' ', 'T'));
            return date.toLocaleDateString();
        },
        
        formatTime: function(dateStr) {
            if (!dateStr) return '';
            var date = new Date(dateStr.replace(' ', 'T'));
            return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }
    };
    
    // Initialize version manager
    versionManager.init();
});
