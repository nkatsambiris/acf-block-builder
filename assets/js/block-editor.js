jQuery(document).ready(function($) {
    var editors = {};
    var chatHistory = [];
    var diffEditor = null;
    var pendingAIChanges = {};
    
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
        var lang = 'text';
        if (fileKey.endsWith('_json')) lang = 'json';
        if (fileKey.endsWith('_php')) lang = 'php';
        if (fileKey.endsWith('_css')) lang = 'css';
        if (fileKey.endsWith('_js')) lang = 'javascript';

        var $widget = $('<div class="acf-bb-code-widget"></div>');
        $widget.append('<div class="acf-bb-code-header"><span class="dashicons dashicons-editor-code"></span> ' + name + '</div>');
        var $pre = $('<pre class="acf-bb-code-body"></pre>');
        var $code = $('<code class="language-' + lang + '"></code>');
        $pre.append($code);
        $widget.append($pre);
        
        return { $el: $widget, $code: $code };
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
            var modifiedValue = (pendingAIChanges && pendingAIChanges[dataKey] !== undefined) ? pendingAIChanges[dataKey] : originalValue;
    
            // We need to create models only if they don't match what we want, or create new ones every time.
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

             // Ensure newVal is a string before comparison
            if (newVal === null || newVal === undefined) {
                newVal = '';
            } else if (typeof newVal !== 'string') {
                newVal = String(newVal);
            }

            // Normalize line endings for comparison
            if (newVal.replace(/\r\n/g, '\n').trim() !== currentVal.replace(/\r\n/g, '\n').trim()) {
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
        
        var message = 'Changes applied successfully.';
        if (pendingAIChanges.summary) {
            message = pendingAIChanges.summary;
        }
        appendMessage('ai', message);
        
        pendingAIChanges = {};
    });

    // Discard Changes
    $('#acf-bb-diff-cancel').on('click', function(e) {
        e.preventDefault();
        $('#acf-bb-diff-overlay').removeClass('visible').hide();
        pendingAIChanges = {};
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

    $('#acf-block-builder-generate').on('click', async function(e) {
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
            var $img = $('#acf-bb-image-preview-mini img');
            if ($img.length) imageUrl = $img.attr('src');
        }
        
        appendMessage('user', prompt || 'Generating block from image...', imageUrl);
        
        // Clear input
        $('#acf_block_builder_prompt').val('');
        $('#acf_block_builder_image_id').val('');
        $('#acf-bb-image-preview-mini').hide().html('');
        $('#acf-bb-upload-image').removeClass('active-image');

        // Start AI Message Container
        var $aiMessage = $('<div class="acf-bb-message ai-message streaming"><div class="acf-bb-avatar"><span class="dashicons dashicons-superhero"></span></div><div class="acf-bb-message-content"><span class="acf-bb-typing">Thinking</span></div></div>');
        $('#acf-bb-chat-messages').append($aiMessage);
        var $aiContent = $aiMessage.find('.acf-bb-message-content');
        scrollToBottom();

        // Get Current Code Context
        var currentCode = getCurrentCode();
        var formData = new FormData();
        formData.append('action', 'acf_block_builder_generate');
        formData.append('nonce', acfBlockBuilder.nonce);
        formData.append('prompt', prompt);
        formData.append('image_id', imageId);
        formData.append('title', $('#title').val()); // Get post title
        formData.append('current_code', currentCode);

        var startTime = Date.now();

        try {
            const response = await fetch(acfBlockBuilder.ajax_url, {
                method: 'POST',
                body: formData
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
                        const match = processorBuffer.match(/@@@FILE:([a-z_]+)@@@/);
                        if (match) {
                            const chatText = processorBuffer.substring(0, match.index);
                            if (chatText) {
                                $aiContent.append(chatText.replace(/\n/g, '<br>'));
                            }
                            
                            currentMode = 'code';
                            currentFileKey = match[1];
                            
                            if (currentFileKey === 'summary') {
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
                                                // Clean up markdown list markers
                                                var cleanItem = item.replace(/^[\s\-*#\d\.]+/, '').trim();
                                                if (cleanItem) {
                                                     $list.append('<li><span class="dashicons dashicons-yes"></span> ' + cleanItem + '</li>');
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
                                            if (txt === undefined) return $planContent.html(); // Return HTML for simplicity or store raw?
                                            // Simple markdown parsing for the plan
                                            var html = txt
                                                .replace(/^### (.*$)/gim, '<strong>$1</strong>')
                                                .replace(/^\d+\. (.*$)/gim, '<div>• $1</div>')
                                                .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                                                .replace(/\n/g, '<br>');
                                            
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
                                // No @ symbol, flush everything
                                if (processorBuffer.length > 0) {
                                    $aiContent.append(processorBuffer.replace(/\n/g, '<br>'));
                                    processorBuffer = '';
                                }
                            } else {
                                // Has @ symbol. Flush up to the first @.
                                if (tagStart > 0) {
                                    const textToFlush = processorBuffer.substring(0, tagStart);
                                    $aiContent.append(textToFlush.replace(/\n/g, '<br>'));
                                    processorBuffer = processorBuffer.substring(tagStart);
                                }
                                // Now processorBuffer starts with @.
                                // We need to wait to see if it becomes @@@FILE:...
                                // The longest tag is roughly @@@FILE:block_json@@@ which is ~20 chars.
                                // If buffer is longer than 30 chars and still no match, it's likely just text with @ symbols.
                                if (processorBuffer.length > 30) {
                                    // It's not a tag (regex match would have caught it).
                                    // Flush the first character and continue loop
                                    $aiContent.append(processorBuffer.substring(0, 1));
                                    processorBuffer = processorBuffer.substring(1);
                                    continue; // Re-evaluate loop
                                }
                            }
                            break; // Wait for more data
                        }
                    } else if (currentMode === 'code') {
                        const match = processorBuffer.match(/@@@END_FILE@@@/);
                        if (match) {
                            const codeContent = processorBuffer.substring(0, match.index);
                            if (currentCodeWidget) {
                                currentCodeWidget.$code.text(currentCodeWidget.$code.text() + codeContent);
                                if (!pendingAIChanges[currentFileKey]) pendingAIChanges[currentFileKey] = '';
                                pendingAIChanges[currentFileKey] += codeContent;
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
                    // Check if the remaining buffer is just a trailing summary or random text
                    // If it contains the "summary" keyword from the previous prompt leakage, hide it?
                    // No, let's just append. But usually the issue is the AI repeating the summary text AFTER the widget.
                    // If the processorBuffer is very short and we just finished a file, maybe ignore?
                    if (processorBuffer.trim().length > 0) {
                        // Improved filter: Don't append if it looks exactly like the summary content we just processed
                        // Or if it starts with "- " or "* " and we just finished a summary widget.
                        if (currentCodeWidget && currentCodeWidget.$el.hasClass('acf-bb-summary-widget')) {
                             // Skip flushing trailing text after a summary widget if it looks like markdown list items
                             if (!processorBuffer.match(/^[\s\n]*[-*]/)) {
                                 $aiContent.append(processorBuffer.replace(/\n/g, '<br>'));
                             }
                        } else {
                             $aiContent.append(processorBuffer.replace(/\n/g, '<br>'));
                        }
                    }
                } else if (currentMode === 'code' && currentCodeWidget) {
                    currentCodeWidget.$code.text(currentCodeWidget.$code.text() + processorBuffer);
                    if (!pendingAIChanges[currentFileKey]) pendingAIChanges[currentFileKey] = '';
                    pendingAIChanges[currentFileKey] += processorBuffer;
                }
            }

            $aiMessage.removeClass('streaming');
            
            // Save the generated message to history
            var finalHtml = $aiContent.html();
            
            // Re-bind monaco editor data or code state if needed?
            // When saving HTML, we lose the monaco editor instances and potentially the raw text if we aren't careful.
            // But here we are just saving the "chat display".
            // The issue is likely that when we reload, we just dump this HTML back into the div.
            // If the HTML relies on CSS classes that expect specific structure, and that structure is broken by
            // incorrect HTML escaping or nesting during the .html() capture, it will look bad.
            
            // Specifically, <pre><code>...</code></pre> blocks might have HTML entities inside.
            // When we do $aiContent.html(), entities like &lt; might be converted if not careful,
            // or if we just blindly re-output it.
            
            // Let's ensure we are capturing the state correctly.
            // Actually, the previous step where we did $code.text(...) ensures safety in the DOM.
            // $aiContent.html() should return the escaped HTML string.
            // When we load it back in PHP, we output it with wp_kses_post or similar.
            // If wp_kses_post strips some classes or tags, that breaks it.
            
            chatHistory.push({ type: 'ai', content: finalHtml, image_url: null });
            saveChatHistory();
            
            // Trigger Diff View automatically
            if (Object.keys(pendingAIChanges).length > 0) {
                 showDiffOverlay(pendingAIChanges);
                 var duration = ((Date.now() - startTime) / 1000).toFixed(1);
                 // We append this status message to the chat UI, but we ALSO need to save it to history?
                 // Actually, if we append it now, it's NOT in 'finalHtml' captured above.
                 // Let's append it first, THEN capture.
                 
                 var statusMsg = '<div><strong>Updates ready for review. (' + duration + 's)</strong></div>';
                 $aiContent.append(statusMsg);
                 
                 // Re-capture HTML including the status message
                 finalHtml = $aiContent.html();
                 // Update the last entry we just pushed
                 chatHistory[chatHistory.length - 1].content = finalHtml;
                 saveChatHistory();
            } else {
                 var statusMsg = '<div><em>No code changes detected.</em></div>';
                 $aiContent.append(statusMsg);
                 
                 finalHtml = $aiContent.html();
                 chatHistory[chatHistory.length - 1].content = finalHtml;
                 saveChatHistory();
            }

        } catch (err) {
            $aiContent.append('<div class="error">Connection Error: ' + err.message + '</div>');
        } finally {
            $btn.prop('disabled', false);
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
});
