jQuery(document).ready(function($) {
    var editors = {};
    var chatHistory = [];
    var diffEditor = null;
    var pendingAIChanges = null;
    
    // Load existing history
    try {
        var historyVal = $('#acf_block_builder_chat_history').val();
        if (historyVal) {
            chatHistory = JSON.parse(historyVal);
        }
    } catch(e) { console.error('Error parsing chat history', e); }

    function saveChatHistory() {
        $('#acf_block_builder_chat_history').val(JSON.stringify(chatHistory));
    }

    function scrollToBottom() {
        var $chat = $('#acf-bb-chat-messages');
        if ($chat.length) {
            $chat.scrollTop($chat[0].scrollHeight);
        }
    }
    
    // Scroll on load
    scrollToBottom();

    function appendMessage(type, content, imageUrl, skipSave) {
        var icon = type === 'ai' ? 'superhero' : 'admin-users';
        var html = '<div class="acf-bb-message ' + type + '-message">';
        html += '<div class="acf-bb-avatar"><span class="dashicons dashicons-' + icon + '"></span></div>';
        html += '<div class="acf-bb-message-content">';
        html += content; 
        if (imageUrl) {
            html += '<div class="acf-bb-chat-image"><img src="' + imageUrl + '" alt="Reference" /></div>';
        }
        html += '</div></div>';
        
        $('#acf-bb-chat-messages').append(html);
        scrollToBottom();
        
        if (!skipSave) {
            chatHistory.push({ type: type, content: content, image_url: imageUrl });
            saveChatHistory();
        }
    }

    var thinkingTimer;
    var startTime;

    function appendLoadingMessage() {
        var html = '<div class="acf-bb-message ai-message loading-message">';
        html += '<div class="acf-bb-avatar"><span class="dashicons dashicons-superhero"></span></div>';
        html += '<div class="acf-bb-message-content">';
        html += '<span class="acf-bb-typing">Thinking</span>';
        html += '<span class="acf-bb-timer-pill">0.0s</span>';
        html += '</div></div>';
        $('#acf-bb-chat-messages').append(html);
        scrollToBottom();

        startTime = Date.now();
        thinkingTimer = setInterval(function() {
            var elapsed = (Date.now() - startTime) / 1000;
            $('.acf-bb-timer-pill').text(elapsed.toFixed(1) + 's');
        }, 100);
    }

    function removeLoadingMessage() {
        clearInterval(thinkingTimer);
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

    require.config({ paths: { 'vs': 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.44.0/min/vs' }});

    require(['vs/editor/editor.main'], function() {
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

        // --- Diff View Functions (Inside require to access monaco) ---
        window.updateDiffEditor = function(tabId) {
            if (!diffEditor) {
                 diffEditor = monaco.editor.createDiffEditor(document.getElementById('acf-bb-diff-editor-container'), {
                    automaticLayout: true,
                    theme: 'vs-dark',
                    readOnly: true,
                    originalEditable: false
                });
            }
    
            var dataKey = keyMap[tabId];
            var lang = languageMap[tabId];
            
            var originalValue = editors[tabId] ? editors[tabId].getValue() : '';
            var modifiedValue = (pendingAIChanges && pendingAIChanges[dataKey]) ? pendingAIChanges[dataKey] : originalValue;
    
            // We need to create models only if they don't match what we want, or create new ones every time.
            // Creating new ones every time is safer to avoid disposing issues for now.
            var originalModel = monaco.editor.createModel(originalValue, lang);
            var modifiedModel = monaco.editor.createModel(modifiedValue, lang);
    
            diffEditor.setModel({
                original: originalModel,
                modified: modifiedModel
            });
        };
    });

    function showDiffOverlay(data) {
        pendingAIChanges = data;
        $('#acf-bb-diff-overlay').addClass('visible').show();

        // 1. Identify changes
        var firstChangedTab = null;
        $('.acf-bb-diff-tabs .acf-bb-tab').removeClass('active has-changes');

        $.each(keyMap, function(tabId, dataKey) {
            var newVal = data[dataKey];
            var currentVal = editors[tabId] ? editors[tabId].getValue() : '';

            // Normalize line endings for comparison
            if (newVal && newVal.replace(/\r\n/g, '\n').trim() !== currentVal.replace(/\r\n/g, '\n').trim()) {
                $('[data-diff-tab="' + tabId + '"]').addClass('has-changes');
                if (!firstChangedTab) firstChangedTab = tabId;
            }
        });

        // 2. Select default tab (first changed, or block-json)
        var targetTab = firstChangedTab || 'block-json';
        $('[data-diff-tab="' + targetTab + '"]').addClass('active');

        // 3. Initialize or Update Diff Editor
        if (window.updateDiffEditor) {
            window.updateDiffEditor(targetTab);
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
        
        if (window.updateDiffEditor) {
            window.updateDiffEditor(tabId);
        }
    });

    // Apply Changes
    $('#acf-bb-diff-apply').on('click', function(e) {
        e.preventDefault();
        if (!pendingAIChanges) return;

        // Apply all pending changes
        $.each(keyMap, function(tabId, dataKey) {
            if (pendingAIChanges[dataKey] !== undefined) {
                 if (editors[tabId]) {
                    editors[tabId].setValue(pendingAIChanges[dataKey]);
                 }
            }
        });

        $('#acf-bb-diff-overlay').removeClass('visible').hide();
        appendMessage('ai', 'Changes applied successfully.');
    });

    // Discard Changes
    $('#acf-bb-diff-cancel').on('click', function(e) {
        e.preventDefault();
        $('#acf-bb-diff-overlay').removeClass('visible').hide();
        pendingAIChanges = null;
        appendMessage('ai', 'Changes discarded.');
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
            $('#acf-bb-image-preview-mini').html('<img src="' + attachment.url + '" style="height: 40px; width: auto; border-radius: 4px;" />').show();
            // Change icon style to indicate active
            $('#acf-bb-upload-image').addClass('active-image');
        });

        file_frame.open();
    });

    $('#acf-block-builder-generate').on('click', function(e) {
        e.preventDefault();
        var prompt = $('#acf_block_builder_prompt').val().trim();
        var imageId = $('#acf_block_builder_image_id').val();
        
        if (!prompt && !imageId) {
            alert('Please describe your block or upload an image.');
            return;
        }

        var $btn = $(this);
        $btn.prop('disabled', true);
        
        // Add User Message
        var imageUrl = '';
        if (imageId) {
            // Try to get URL from preview if available, otherwise just show generic
            var $img = $('#acf-bb-image-preview-mini img');
            if ($img.length) imageUrl = $img.attr('src');
        }
        
        appendMessage('user', prompt || 'Generating block from image...', imageUrl);
        
        // Clear input
        $('#acf_block_builder_prompt').val('');
        $('#acf_block_builder_image_id').val('');
        $('#acf-bb-image-preview-mini').hide().html('');
        $('#acf-bb-upload-image').removeClass('active-image');

        appendLoadingMessage();

        // Get Current Code Context
        var currentCode = getCurrentCode();

        $.ajax({
            url: acfBlockBuilder.ajax_url,
            type: 'POST',
            data: {
                action: 'acf_block_builder_generate',
                nonce: acfBlockBuilder.nonce,
                prompt: prompt,
                image_id: imageId,
                title: $('#title').val(), // Get post title
                current_code: currentCode
            },
            success: function(response) {
                removeLoadingMessage();
                var duration = ((Date.now() - startTime) / 1000).toFixed(1);
                
                if (response.success) {
                    var data = response.data;
                    // Instead of applying directly, show diff
                    showDiffOverlay(data);
                    
                    // We don't append success message here anymore, only after 'Apply' is clicked.
                    // But we might want to say "Changes generated, please review."
                    appendMessage('ai', 'Code generated. Please review the changes in the Diff view. (Took ' + duration + 's)', null, true); // skipSave because we might discard
                } else {
                    appendMessage('ai', 'Error: ' + response.data + ' (Took ' + duration + 's)');
                }
            },
            error: function() {
                removeLoadingMessage();
                appendMessage('ai', 'System Error: Could not connect to the server.');
            },
            complete: function() {
                $btn.prop('disabled', false);
            }
        });
    });

    // Enter key support for textarea (Shift+Enter for new line)
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
        
        // Add spin class if available or just change text
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

    // Add Theme Loader
    // Logic moved to settings page.
});
