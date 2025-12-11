jQuery(document).ready(function($) {
    var editors = {};
    var chatHistory = [];
    var diffEditor = null;
    var pendingAIChanges = {};
    
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

    // Clear Chat History button handler
    $(document).on('click', '#acf-bb-clear-history', function(e) {
        e.preventDefault();
        if (confirm('This will clear all chat history. Continue?')) {
            $('#acf_block_builder_chat_history').val('[]');
            chatHistory = [];
            $('#acf-bb-chat-messages').empty();
            
            // Show welcome message
            var welcomeHtml = '<div class="acf-bb-message ai-message">' +
                '<div class="acf-bb-avatar"><span class="dashicons dashicons-superhero"></span></div>' +
                '<div class="acf-bb-message-content">Hello! Describe the block you want to build, or upload a reference image.</div>' +
                '</div>';
            $('#acf-bb-chat-messages').append(welcomeHtml);
        }
    });

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
            // Store plain text only, not HTML - prevents JSON parsing issues
            var plainText = content.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
            chatHistory.push({ type: type, text: plainText, image_url: imageUrl || null });
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
        
        chatHistory.forEach(function(msg, msgIndex) {
            var icon = msg.type === 'ai' ? 'superhero' : 'admin-users';
            var displayContent = msg.text || msg.content || '';
            
            // If it's old HTML content, strip tags for clean display
            if (displayContent.indexOf('<') !== -1) {
                displayContent = displayContent.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
            }
            
            // Escape HTML entities for safe display
            displayContent = $('<div>').text(displayContent).html();
            
            // Wrap in paragraph tags
            if (displayContent && !displayContent.startsWith('<p>')) {
                displayContent = '<p>' + displayContent + '</p>';
            }
            
            var html = '<div class="acf-bb-message ' + msg.type + '-message">';
            html += '<div class="acf-bb-avatar"><span class="dashicons dashicons-' + icon + '"></span></div>';
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
                    html += '<li><span class="dashicons dashicons-yes"></span> ' + $('<div>').text(item).html() + '</li>';
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
        var lang = 'text';
        if (fileKey.endsWith('_json')) lang = 'json';
        if (fileKey.endsWith('_php')) lang = 'php';
        if (fileKey.endsWith('_css')) lang = 'css';
        if (fileKey.endsWith('_js')) lang = 'javascript';

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
    });

    function showDiffOverlay(data) {
        pendingAIChanges = data;
        $('#acf-bb-diff-overlay').addClass('visible').show();

        // Reset acceptance status for all files
        fileAcceptanceStatus = {};
        changedFileTabs = [];

        // 1. Identify changes
        var firstChangedTab = null;
        $('.acf-bb-diff-tabs .acf-bb-tab').removeClass('active has-changes file-accepted file-rejected file-pending');
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
                $('[data-diff-tab="' + tabId + '"]').addClass('has-changes');
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

    // Apply Changes - only applies accepted or pending (not rejected) files
    $('#acf-bb-diff-apply').on('click', function(e) {
        e.preventDefault();
        if (!pendingAIChanges) return;

        var appliedFiles = [];
        var rejectedFiles = [];

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
        
        // Capture chat history BEFORE adding the current user message
        // This ensures we don't duplicate the current message in the API call
        var historyToSend = JSON.stringify(chatHistory);
        
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
        formData.append('chat_history', historyToSend);

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
                            if (chatText && !suppressChatOutput) {
                                $aiContent.append(textToParagraphs(chatText));
                            }
                            
                            currentMode = 'code';
                            currentFileKey = match[1];
                            
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
                        const match = processorBuffer.match(/@@@END_FILE@@@/);
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
                image_url: null
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
                return k.replace('_', '.');
            });
            if (changedFiles.length > 0) {
                historyEntry.text = 'Updated: ' + changedFiles.join(', ');
            } else {
                historyEntry.text = 'Code generation completed.';
            }
            
            chatHistory.push(historyEntry);
            saveChatHistory();
            
            // Trigger Diff View automatically
            if (Object.keys(pendingAIChanges).length > 0) {
                 showDiffOverlay(pendingAIChanges);
                 var duration = ((Date.now() - startTime) / 1000).toFixed(1);
                 
                 var statusMsg = '<div><strong>Updates ready for review. (' + duration + 's)</strong></div>';
                 $aiContent.append(statusMsg);
            } else {
                 var statusMsg = '<div><em>No code changes detected.</em></div>';
                 $aiContent.append(statusMsg);
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
            $.each(counts, function(fileType, data) {
                var $badge = $('[data-count-for="' + fileType + '"]');
                $badge.text(data.count > 0 ? data.count : '-');
            });
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
            
            var language = this.languageMap[this.currentFileType] || 'text';
            
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
