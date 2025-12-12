<?php
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

if ( ! class_exists( 'ACF_Block_Builder_AI' ) ) :

class ACF_Block_Builder_AI {

	/**
	 * Available AI models grouped by provider.
	 */
	private $available_models = array(
		'anthropic' => array(
			'claude-sonnet-4-5' => 'Claude Sonnet 4.5',
			'claude-haiku-4-5' => 'Claude Haiku 4.5',
			'claude-opus-4-5' => 'Claude Opus 4.5'
		),
		'gemini' => array(
			'gemini-3-pro-preview' => 'Gemini 3 Pro',
			'gemini-2.5-pro-preview-06-05' => 'Gemini 2.5 Pro',
			'gemini-2.5-flash-preview-05-20' => 'Gemini 2.5 Flash',
			'gemini-2.0-flash' => 'Gemini 2.0 Flash'
		),
		'openai' => array(
			'gpt-5.2' => 'GPT-5.2',
			'gpt-5.2-pro' => 'GPT-5.2 Pro',
			'gpt-5.1-codex-max' => 'GPT-5.1 Codex Max',
			'gpt-5-mini' => 'GPT-5 Mini',
			'gpt-5-nano' => 'GPT-5 Nano',
		),
	);

	public function __construct() {
		add_action( 'wp_ajax_acf_block_builder_generate', array( $this, 'handle_ajax_generate' ) );
		add_action( 'wp_ajax_acf_block_builder_get_models', array( $this, 'handle_get_models' ) );
	}

	/**
	 * AJAX handler to return available models based on configured API keys.
	 */
	public function handle_get_models() {
		check_ajax_referer( 'acf_block_builder_ai', 'nonce' );

		$models = array();

		// Check which API keys are configured
		$anthropic_key = get_option( 'acf_block_builder_anthropic_api_key' );
		$gemini_key = get_option( 'acf_block_builder_gemini_api_key' );
		$openai_key = get_option( 'acf_block_builder_openai_api_key' );

		if ( ! empty( $anthropic_key ) ) {
			foreach ( $this->available_models['anthropic'] as $id => $name ) {
				$models[] = array(
					'id' => $id,
					'name' => $name,
					'provider' => 'anthropic',
				);
			}
		}

		if ( ! empty( $gemini_key ) ) {
			foreach ( $this->available_models['gemini'] as $id => $name ) {
				$models[] = array(
					'id' => $id,
					'name' => $name,
					'provider' => 'gemini',
				);
			}
		}

		if ( ! empty( $openai_key ) ) {
			foreach ( $this->available_models['openai'] as $id => $name ) {
				$models[] = array(
					'id' => $id,
					'name' => $name,
					'provider' => 'openai',
				);
			}
		}

		if ( empty( $models ) ) {
			wp_send_json_error( 'No API keys configured. Please add at least one API key in Settings.' );
		}

		wp_send_json_success( $models );
	}

	/**
	 * Detect provider from model ID.
	 */
	private function get_provider_from_model( $model ) {
		if ( strpos( $model, 'claude' ) === 0 ) {
			return 'anthropic';
		}
		if ( strpos( $model, 'gemini' ) === 0 ) {
			return 'gemini';
		}
		if ( strpos( $model, 'gpt' ) === 0 || strpos( $model, 'o1' ) === 0 || strpos( $model, 'o3' ) === 0 ) {
			return 'openai';
		}
		return null;
	}

	/**
	 * Get the API key for a provider.
	 */
	private function get_api_key( $provider ) {
		switch ( $provider ) {
			case 'anthropic':
				return get_option( 'acf_block_builder_anthropic_api_key' );
			case 'gemini':
				return get_option( 'acf_block_builder_gemini_api_key' );
			case 'openai':
				return get_option( 'acf_block_builder_openai_api_key' );
			default:
				return null;
		}
	}

	public function handle_ajax_generate() {
		check_ajax_referer( 'acf_block_builder_ai', 'nonce' );

		if ( ! current_user_can( 'edit_posts' ) ) {
			wp_send_json_error( 'Permission denied.' );
		}

		// Close session to prevent locking if applicable
		if ( session_status() === PHP_SESSION_ACTIVE ) {
			session_write_close();
		}

		$prompt = isset( $_POST['prompt'] ) ? sanitize_textarea_field( $_POST['prompt'] ) : '';
		$title  = isset( $_POST['title'] ) ? sanitize_text_field( $_POST['title'] ) : 'New Block';
		$image_id = isset( $_POST['image_id'] ) ? absint( $_POST['image_id'] ) : 0;
		$current_code = isset( $_POST['current_code'] ) ? wp_unslash( $_POST['current_code'] ) : '';
		$chat_history = isset( $_POST['chat_history'] ) ? json_decode( wp_unslash( $_POST['chat_history'] ), true ) : array();
		$model = isset( $_POST['model'] ) ? sanitize_text_field( $_POST['model'] ) : '';
		$mode = isset( $_POST['mode'] ) ? sanitize_text_field( $_POST['mode'] ) : 'agent';

		if ( empty( $prompt ) && empty( $image_id ) ) {
			wp_send_json_error( 'Prompt or Image is required.' );
		}

		// Detect provider from model
		$provider = $this->get_provider_from_model( $model );
		if ( empty( $provider ) ) {
			// Default to first available provider
			$anthropic_key = get_option( 'acf_block_builder_anthropic_api_key' );
			$gemini_key = get_option( 'acf_block_builder_gemini_api_key' );
			$openai_key = get_option( 'acf_block_builder_openai_api_key' );

			if ( ! empty( $anthropic_key ) ) {
				$provider = 'anthropic';
				$model = 'claude-sonnet-4-20250514';
			} elseif ( ! empty( $gemini_key ) ) {
				$provider = 'gemini';
				$model = 'gemini-2.5-pro-preview-06-05';
			} elseif ( ! empty( $openai_key ) ) {
				$provider = 'openai';
				$model = 'gpt-5.1';
			} else {
				wp_send_json_error( 'No API keys configured. Please add at least one API key in Settings.' );
			}
		}

		$api_key = $this->get_api_key( $provider );
		if ( empty( $api_key ) ) {
			wp_send_json_error( ucfirst( $provider ) . ' API Key is missing. Please set it in Settings.' );
		}

		// Enable Streaming Headers
		header( 'Content-Type: text/event-stream' );
		header( 'Cache-Control: no-cache' );
		header( 'Connection: keep-alive' );
		header( 'X-Accel-Buffering: no' ); // Disable Nginx buffering
		
		// Send provider info and mode as first event
		echo "data: " . base64_encode( json_encode( array( 'provider' => $provider, 'model' => $model, 'mode' => $mode ) ) ) . "\n\n";
		flush();

		// Route to appropriate provider
		switch ( $provider ) {
			case 'anthropic':
				$this->stream_anthropic_api( $api_key, $model, $prompt, $title, $image_id, $current_code, $chat_history, $mode );
				break;
			case 'gemini':
				$this->stream_gemini_api( $api_key, $model, $prompt, $title, $image_id, $current_code, $chat_history, $mode );
				break;
			case 'openai':
				$this->stream_openai_api( $api_key, $model, $prompt, $title, $image_id, $current_code, $chat_history, $mode );
				break;
		}
		
		die(); // Terminate WP execution
	}

	public function log( $message ) {
		if ( get_option( 'acf_block_builder_debug_enabled' ) ) {
			error_log( '[ACF Block Builder AI] ' . $message );
		}
	}

	/**
	 * Build the system instruction for AI models in Ask mode.
	 */
	private function get_ask_mode_instruction( $title ) {
		$slug = sanitize_title( $title );
		
		return "You are an expert WordPress developer specializing in Advanced Custom Fields (ACF) Blocks in the Gutenberg editor.

		ASK MODE - GUIDANCE ONLY:
		You are in ASK MODE. This means:
		
		1. DO NOT generate, update, or output any code files
		2. DO NOT use @@@FILE:...@@@ delimiters at all
		3. DO NOT provide complete code solutions
		
		Instead, you should:
		- Answer questions about ACF blocks, WordPress, PHP, JavaScript, CSS
		- Explain concepts and best practices
		- Provide guidance and suggestions
		- Help debug issues by asking clarifying questions
		- Suggest approaches and strategies
		- Point users in the right direction
		- Explain how things work
		
		If the user asks you to generate or modify code, politely remind them that you're in Ask mode and suggest they switch to Agent mode for code generation.
		
		Keep responses conversational, helpful, and educational. Focus on teaching and guiding rather than doing the work.
		
		FILE REFERENCES:
		When mentioning block files, always wrap the file name in backticks:
		- Use \`block.json\` not block.json
		- Use \`render.php\` not render.php
		- Use \`style.css\` not style.css
		- Use \`script.js\` not script.js
		- Use \`fields.php\` not fields.php
		- Use \`assets.php\` not assets.php
		This ensures file references are properly highlighted in the chat interface.
		
		CONTEXT:
		Block Title: $title
		Block Slug: $slug
		
		Current mode: ASK (guidance only, no code generation)
		";
	}

	/**
	 * Build the system instruction for AI models in Agent mode.
	 */
	private function get_agent_mode_instruction( $title ) {
		$slug = sanitize_title( $title );
		
		// Load Reference Templates
		$ref_block_json = file_get_contents( ACF_BLOCK_BUILDER_PATH . 'templates/reference-block.json' );
		$ref_script_js  = file_get_contents( ACF_BLOCK_BUILDER_PATH . 'templates/reference-script.js' );

		return "You are an expert WordPress developer specializing in Advanced Custom Fields (ACF) Blocks in the Gutenberg editor.
		
		FLUID STREAMING MODE:
		1. You must communicate your thought process and code updates in a specific streaming format.
		2. First, PLAN and CHAT with the user in plain text.
		3. If you need to clarify something, ask a follow up question before generating code this will only be done once if required DO NOT ASK further questions and end up in a loop.
		4. Then, when you are ready to write code for a specific file, use the delimiters below.
		
		STREAMING FORMAT DELIMITERS:
		To start a file: @@@FILE:file_key@@@
		To end a file:   @@@END_FILE@@@
		
		Valid 'file_key' values:
		- plan (Use this for the initial step-by-step plan)
		- block_json
		- render_php
		- style_css
		- script_js
		- fields_php
		- assets_php
		- summary  (Use this for the final changelog summary)
		
		EXAMPLE INTERACTION:
		\"I will start by creating a plan...\"
		
		@@@FILE:plan@@@
		1. **block.json**: Update version...
		2. **render.php**: Add new loop...
		@@@END_FILE@@@
		
		\"Now I will update the block.json...\"
		
		@@@FILE:block_json@@@
		{
		  \"name\": \"acf/example\",
		  ...
		}
		@@@END_FILE@@@
		
		\"Finally, here is the summary...\"
		
		@@@FILE:summary@@@
		- Updated block.json
		- Fixed render.php
		@@@END_FILE@@@
		
		CRITICAL RULES:
		- Do NOT output the summary as plain text at the end. ALWAYS use @@@FILE:summary@@@.
		- Do NOT wrap the code in markdown code blocks (like \`\`\`php). Just output the raw code between the delimiters.
		- Do NOT output a single large JSON object. Output file by file mixed with chat.
		- Do NOT change the 'blockVersion' in the block.json file.
		- Always ensure any .php files start with <?php and end with ?> tags.
		- Verify complex fields (Link, Image) are arrays using !empty() && is_array().
		- Initialize variables.
		
		FILE REFERENCES:
		When mentioning block files in your explanations or summaries, always wrap the file name in backticks:
		- Use \`block.json\` not block.json
		- Use \`render.php\` not render.php
		- Use \`style.css\` not style.css
		- Use \`script.js\` not script.js
		- Use \`fields.php\` not fields.php
		- Use \`assets.php\` not assets.php
		This ensures file references are properly highlighted in the chat interface.
		
		JAVASCRIPT/TYPESCRIPT BEST PRACTICES:
		- When writing JavaScript code that uses WordPress/ACF/jQuery globals, use @ts-ignore comments to suppress TypeScript linting errors.
		- Place // @ts-ignore on the line immediately before code that accesses globals like window.acf, window.jQuery, or jQuery.
		- Example:
		  // @ts-ignore - ACF adds the acf object to window
		  if (typeof window.acf !== 'undefined') {
		    // @ts-ignore
		    window.acf.addAction('render_block_preview', initializeBlock);
		  }
		- Use @ts-ignore sparingly - only when accessing known WordPress/plugin globals that TypeScript can't verify.
		
		REFERENCES:
		1. block.json: $ref_block_json
		2. script.js: $ref_script_js
		
		CONTEXT:
		Block Title: $title
		Block Slug: $slug
		
		Current mode: AGENT (full code generation)
		";
	}
	
	/**
	 * Get the appropriate system instruction based on mode.
	 */
	private function get_system_instruction( $title, $mode = 'agent' ) {
		if ( $mode === 'ask' ) {
			return $this->get_ask_mode_instruction( $title );
		}
		return $this->get_agent_mode_instruction( $title );
	}

	/**
	 * Stream from Gemini API.
	 */
	private function stream_gemini_api( $api_key, $model, $user_prompt, $title, $image_id = 0, $current_code = '', $chat_history = array(), $mode = 'agent' ) {
		$url = 'https://generativelanguage.googleapis.com/v1beta/models/' . $model . ':streamGenerateContent?key=' . $api_key;

		$system_instruction = $this->get_system_instruction( $title, $mode );

		// Build conversation contents array
		$contents = array();
		
		// First message includes system instruction with context
		$first_message_text = $system_instruction;
		if ( ! empty( $current_code ) ) {
			$first_message_text .= "\n\nCURRENT CODE CONTEXT (JSON):\n$current_code";
		}
		
		// Add chat history as alternating user/model messages
		if ( ! empty( $chat_history ) && is_array( $chat_history ) ) {
			$is_first_user_message = true;
			
			foreach ( $chat_history as $msg ) {
				if ( ! isset( $msg['type'] ) || ! isset( $msg['text'] ) ) {
					continue;
				}
				
				$role = ( $msg['type'] === 'user' ) ? 'user' : 'model';
				$text = sanitize_textarea_field( $msg['text'] );
				
				if ( empty( $text ) ) {
					continue;
				}
				
				// Prepend system instruction to the first user message
				if ( $role === 'user' && $is_first_user_message ) {
					$text = $first_message_text . "\n\nUSER REQUEST:\n" . $text;
					$is_first_user_message = false;
				}
				
				$contents[] = array(
					'role'  => $role,
					'parts' => array( array( 'text' => $text ) )
				);
			}
		}
		
		// Add the current user message
		$current_message_parts = array();
		
		// Build prompt based on mode
		$delimiter_reminder = ( $mode === 'agent' ) ? "\n\nRemember: Use @@@FILE:key@@@ delimiters. DO NOT WRAP CODE in markdown ``` blocks inside the delimiters." : "";
		
		if ( empty( $chat_history ) || empty( $contents ) ) {
			// No history - include system instruction in this message
			if ( ! empty( $current_code ) ) {
				$full_prompt = $first_message_text . "\n\nUSER REQUEST:\n$user_prompt" . $delimiter_reminder;
			} else {
				$full_prompt = $first_message_text . "\n\nDescription: $user_prompt" . $delimiter_reminder;
			}
		} else {
			// Has history - just send the user prompt
			$full_prompt = $user_prompt . $delimiter_reminder;
		}
		
		$current_message_parts[] = array( 'text' => $full_prompt );

		// Handle Image
		if ( $image_id ) {
			$image_path = get_attached_file( $image_id );
			if ( $image_path && file_exists( $image_path ) ) {
				$mime_type = get_post_mime_type( $image_id );
				$image_data = base64_encode( file_get_contents( $image_path ) );
				
				$current_message_parts[] = array(
					'inline_data' => array(
						'mime_type' => $mime_type,
						'data'      => $image_data
					)
				);
			}
		}
		
		// Add current message to contents
		$contents[] = array(
			'role'  => 'user',
			'parts' => $current_message_parts
		);

		$body = array(
			'contents' => $contents,
			'generationConfig' => array(
				'temperature' => 0.2,
				'responseMimeType' => 'text/plain'
			)
		);

		$this->log( 'Gemini Request - Model: ' . $model );

		// Use CURL for Streaming
		$ch = curl_init();
		curl_setopt( $ch, CURLOPT_URL, $url );
		curl_setopt( $ch, CURLOPT_POST, true );
		curl_setopt( $ch, CURLOPT_POSTFIELDS, json_encode( $body ) );
		curl_setopt( $ch, CURLOPT_HTTPHEADER, array( 'Content-Type: application/json' ) );
		curl_setopt( $ch, CURLOPT_RETURNTRANSFER, false );
		curl_setopt( $ch, CURLOPT_WRITEFUNCTION, function( $curl, $data ) {
			// Wrap in SSE event
			echo "data: " . base64_encode( $data ) . "\n\n";
			
			if ( ob_get_level() > 0 ) ob_flush();
			flush();
			
			return strlen( $data );
		} );

		curl_exec( $ch );
		
		$http_code = curl_getinfo( $ch, CURLINFO_HTTP_CODE );
		$error = curl_error( $ch );
		
		if ( $error ) {
			$this->log( 'Gemini CURL Error: ' . $error );
		}
		
		if ( $http_code !== 200 ) {
			$this->log( 'Gemini HTTP Error Code: ' . $http_code );
		}
		
		curl_close( $ch );
        
		// End stream
		echo "data: [DONE]\n\n";
		flush();
	}

	/**
	 * Stream from OpenAI API.
	 */
	private function stream_openai_api( $api_key, $model, $user_prompt, $title, $image_id = 0, $current_code = '', $chat_history = array(), $mode = 'agent' ) {
		$url = 'https://api.openai.com/v1/chat/completions';

		$system_instruction = $this->get_system_instruction( $title, $mode );

		// Build messages array
		$messages = array();
		
		// System message
		$system_content = $system_instruction;
		if ( ! empty( $current_code ) ) {
			$system_content .= "\n\nCURRENT CODE CONTEXT (JSON):\n$current_code";
		}
		
		$messages[] = array(
			'role' => 'system',
			'content' => $system_content
		);
		
		// Add chat history
		if ( ! empty( $chat_history ) && is_array( $chat_history ) ) {
			foreach ( $chat_history as $msg ) {
				if ( ! isset( $msg['type'] ) || ! isset( $msg['text'] ) ) {
					continue;
				}
				
				$role = ( $msg['type'] === 'user' ) ? 'user' : 'assistant';
				$text = sanitize_textarea_field( $msg['text'] );
				
				if ( empty( $text ) ) {
					continue;
				}
				
				$messages[] = array(
					'role' => $role,
					'content' => $text
				);
			}
		}
		
		// Add current user message
		$user_content = array();
		
		$delimiter_reminder = ( $mode === 'agent' ) ? "\n\nRemember: Use @@@FILE:key@@@ delimiters. DO NOT WRAP CODE in markdown ``` blocks inside the delimiters." : "";
		$full_prompt = $user_prompt . $delimiter_reminder;
		
		// Handle image for vision models
		if ( $image_id ) {
			$image_path = get_attached_file( $image_id );
			if ( $image_path && file_exists( $image_path ) ) {
				$mime_type = get_post_mime_type( $image_id );
				$image_data = base64_encode( file_get_contents( $image_path ) );
				
				$user_content[] = array(
					'type' => 'text',
					'text' => $full_prompt
				);
				$user_content[] = array(
					'type' => 'image_url',
					'image_url' => array(
						'url' => 'data:' . $mime_type . ';base64,' . $image_data
					)
				);
				
				$messages[] = array(
					'role' => 'user',
					'content' => $user_content
				);
			} else {
				$messages[] = array(
					'role' => 'user',
					'content' => $full_prompt
				);
			}
		} else {
			$messages[] = array(
				'role' => 'user',
				'content' => $full_prompt
			);
		}

		$body = array(
			'model' => $model,
			'messages' => $messages,
			'temperature' => 0.2,
			'stream' => true
		);

		$this->log( 'OpenAI Request - Model: ' . $model );

		// Use CURL for Streaming
		$ch = curl_init();
		curl_setopt( $ch, CURLOPT_URL, $url );
		curl_setopt( $ch, CURLOPT_POST, true );
		curl_setopt( $ch, CURLOPT_POSTFIELDS, json_encode( $body ) );
		curl_setopt( $ch, CURLOPT_HTTPHEADER, array(
			'Content-Type: application/json',
			'Authorization: Bearer ' . $api_key
		) );
		curl_setopt( $ch, CURLOPT_RETURNTRANSFER, false );
		
		$self = $this;
		$error_buffer = '';
		
		curl_setopt( $ch, CURLOPT_WRITEFUNCTION, function( $curl, $data ) use ( $self, &$error_buffer ) {
			// Check for error responses (non-streamed JSON error)
			if ( strpos( $data, '"error"' ) !== false && strpos( $data, 'data: ' ) === false ) {
				$error_buffer .= $data;
				$error_json = json_decode( $error_buffer, true );
				if ( $error_json && isset( $error_json['error']['message'] ) ) {
					$error_text = 'OpenAI API Error: ' . $error_json['error']['message'];
					$self->log( $error_text );
					
					// Send error as chat message
					$gemini_format = array(
						'candidates' => array(
							array(
								'content' => array(
									'parts' => array(
										array( 'text' => $error_text )
									)
								)
							)
						)
					);
					
					echo "data: " . base64_encode( json_encode( $gemini_format ) ) . "\n\n";
					if ( ob_get_level() > 0 ) ob_flush();
					flush();
				}
				return strlen( $data );
			}
			
			// OpenAI sends SSE format: data: {...}\n\n
			// We need to parse and re-encode to match our frontend format
			
			$lines = explode( "\n", $data );
			foreach ( $lines as $line ) {
				$line = trim( $line );
				if ( empty( $line ) ) continue;
				
				if ( strpos( $line, 'data: ' ) === 0 ) {
					$json_str = substr( $line, 6 );
					
					if ( $json_str === '[DONE]' ) {
						continue; // We'll send our own DONE
					}
					
					$parsed = json_decode( $json_str, true );
					
					// Handle error in stream
					if ( $parsed && isset( $parsed['error'] ) ) {
						$error_text = 'OpenAI API Error: ' . ( $parsed['error']['message'] ?? 'Unknown error' );
						$self->log( $error_text );
						
						$gemini_format = array(
							'candidates' => array(
								array(
									'content' => array(
										'parts' => array(
											array( 'text' => $error_text )
										)
									)
								)
							)
						);
						
						echo "data: " . base64_encode( json_encode( $gemini_format ) ) . "\n\n";
						if ( ob_get_level() > 0 ) ob_flush();
						flush();
						continue;
					}
					
					if ( $parsed && isset( $parsed['choices'][0]['delta']['content'] ) ) {
						$text = $parsed['choices'][0]['delta']['content'];
						
						// Wrap in Gemini-compatible format for frontend
						$gemini_format = array(
							'candidates' => array(
								array(
									'content' => array(
										'parts' => array(
											array( 'text' => $text )
										)
									)
								)
							)
						);
						
						echo "data: " . base64_encode( json_encode( $gemini_format ) ) . "\n\n";
						
						if ( ob_get_level() > 0 ) ob_flush();
						flush();
					}
				}
			}
			
			return strlen( $data );
		} );

		curl_exec( $ch );
		
		$http_code = curl_getinfo( $ch, CURLINFO_HTTP_CODE );
		$error = curl_error( $ch );
		
		if ( $error ) {
			$this->log( 'OpenAI CURL Error: ' . $error );
		}
		
		if ( $http_code !== 200 ) {
			$this->log( 'OpenAI HTTP Error Code: ' . $http_code );
		}
		
		curl_close( $ch );
        
		// End stream
		echo "data: [DONE]\n\n";
		flush();
	}

	/**
	 * Stream from Anthropic API.
	 */
	private function stream_anthropic_api( $api_key, $model, $user_prompt, $title, $image_id = 0, $current_code = '', $chat_history = array(), $mode = 'agent' ) {
		$url = 'https://api.anthropic.com/v1/messages';

		$system_instruction = $this->get_system_instruction( $title, $mode );

		// Build system content
		$system_content = $system_instruction;
		if ( ! empty( $current_code ) ) {
			$system_content .= "\n\nCURRENT CODE CONTEXT (JSON):\n$current_code";
		}

		// Build messages array
		$messages = array();
		
		// Add chat history
		if ( ! empty( $chat_history ) && is_array( $chat_history ) ) {
			foreach ( $chat_history as $msg ) {
				if ( ! isset( $msg['type'] ) || ! isset( $msg['text'] ) ) {
					continue;
				}
				
				$role = ( $msg['type'] === 'user' ) ? 'user' : 'assistant';
				$text = sanitize_textarea_field( $msg['text'] );
				
				if ( empty( $text ) ) {
					continue;
				}
				
				$messages[] = array(
					'role' => $role,
					'content' => $text
				);
			}
		}
		
		// Add current user message
		$delimiter_reminder = ( $mode === 'agent' ) ? "\n\nRemember: Use @@@FILE:key@@@ delimiters. DO NOT WRAP CODE in markdown ``` blocks inside the delimiters." : "";
		$full_prompt = $user_prompt . $delimiter_reminder;
		
		// Handle image
		if ( $image_id ) {
			$image_path = get_attached_file( $image_id );
			if ( $image_path && file_exists( $image_path ) ) {
				$mime_type = get_post_mime_type( $image_id );
				$image_data = base64_encode( file_get_contents( $image_path ) );
				
				$messages[] = array(
					'role' => 'user',
					'content' => array(
						array(
							'type' => 'image',
							'source' => array(
								'type' => 'base64',
								'media_type' => $mime_type,
								'data' => $image_data
							)
						),
						array(
							'type' => 'text',
							'text' => $full_prompt
						)
					)
				);
			} else {
				$messages[] = array(
					'role' => 'user',
					'content' => $full_prompt
				);
			}
		} else {
			$messages[] = array(
				'role' => 'user',
				'content' => $full_prompt
			);
		}

		$body = array(
			'model' => $model,
			'max_tokens' => 8192,
			'system' => $system_content,
			'messages' => $messages,
			'stream' => true
		);

		$this->log( 'Anthropic Request - Model: ' . $model );

		// Use CURL for Streaming
		$ch = curl_init();
		curl_setopt( $ch, CURLOPT_URL, $url );
		curl_setopt( $ch, CURLOPT_POST, true );
		curl_setopt( $ch, CURLOPT_POSTFIELDS, json_encode( $body ) );
		curl_setopt( $ch, CURLOPT_HTTPHEADER, array(
			'Content-Type: application/json',
			'x-api-key: ' . $api_key,
			'anthropic-version: 2023-06-01'
		) );
		curl_setopt( $ch, CURLOPT_RETURNTRANSFER, false );
		
		$self = $this;
		$error_buffer = '';
		
		curl_setopt( $ch, CURLOPT_WRITEFUNCTION, function( $curl, $data ) use ( $self, &$error_buffer ) {
			// Check for error responses (non-streamed JSON error)
			if ( strpos( $data, '"error"' ) !== false && strpos( $data, 'event:' ) === false ) {
				$error_buffer .= $data;
				$error_json = json_decode( $error_buffer, true );
				if ( $error_json && isset( $error_json['error']['message'] ) ) {
					$error_text = 'Anthropic API Error: ' . $error_json['error']['message'];
					$self->log( $error_text );
					
					// Send error as chat message
					$gemini_format = array(
						'candidates' => array(
							array(
								'content' => array(
									'parts' => array(
										array( 'text' => $error_text )
									)
								)
							)
						)
					);
					
					echo "data: " . base64_encode( json_encode( $gemini_format ) ) . "\n\n";
					if ( ob_get_level() > 0 ) ob_flush();
					flush();
				}
				return strlen( $data );
			}
			
			// Anthropic sends SSE format: event: content_block_delta\ndata: {...}\n\n
			
			$lines = explode( "\n", $data );
			foreach ( $lines as $line ) {
				$line = trim( $line );
				if ( empty( $line ) ) continue;
				
				if ( strpos( $line, 'data: ' ) === 0 ) {
					$json_str = substr( $line, 6 );
					$parsed = json_decode( $json_str, true );
					
					if ( $parsed ) {
						// Handle error event
						if ( isset( $parsed['type'] ) && $parsed['type'] === 'error' ) {
							$error_text = 'Anthropic API Error: ' . ( $parsed['error']['message'] ?? 'Unknown error' );
							$self->log( $error_text );
							
							$gemini_format = array(
								'candidates' => array(
									array(
										'content' => array(
											'parts' => array(
												array( 'text' => $error_text )
											)
										)
									)
								)
							);
							
							echo "data: " . base64_encode( json_encode( $gemini_format ) ) . "\n\n";
							if ( ob_get_level() > 0 ) ob_flush();
							flush();
							continue;
						}
						
						// Handle content_block_delta event
						if ( isset( $parsed['type'] ) && $parsed['type'] === 'content_block_delta' ) {
							if ( isset( $parsed['delta']['text'] ) ) {
								$text = $parsed['delta']['text'];
								
								// Wrap in Gemini-compatible format for frontend
								$gemini_format = array(
									'candidates' => array(
										array(
											'content' => array(
												'parts' => array(
													array( 'text' => $text )
												)
											)
										)
									)
								);
								
								echo "data: " . base64_encode( json_encode( $gemini_format ) ) . "\n\n";
								
								if ( ob_get_level() > 0 ) ob_flush();
								flush();
							}
						}
					}
				}
			}
			
			return strlen( $data );
		} );

		curl_exec( $ch );
		
		$http_code = curl_getinfo( $ch, CURLINFO_HTTP_CODE );
		$error = curl_error( $ch );
		
		if ( $error ) {
			$this->log( 'Anthropic CURL Error: ' . $error );
		}
		
		if ( $http_code !== 200 ) {
			$this->log( 'Anthropic HTTP Error Code: ' . $http_code );
		}
		
		curl_close( $ch );
        
		// End stream
		echo "data: [DONE]\n\n";
		flush();
	}
}

endif; // End class check

new ACF_Block_Builder_AI();
